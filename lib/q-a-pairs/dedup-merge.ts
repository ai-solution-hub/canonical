// lib/q-a-pairs/dedup-merge.ts
//
// ID-120 {120.7} P-5 — cross-workspace + cross-form Q&A dedup merge primitive.
//
// `mergeDedupPair` archives the NON-survivor of a curator-approved duplicate
// pair: it sets the loser's `publication_status='archived'` and stamps
// `superseded_by=<survivorId>`, under a compare-and-set (CAS) guard that the
// loser is still `published`. The affected-row count is asserted = 1 so a
// 0-row UPDATE (a concurrent run already archived it, or the loser is no
// longer published) is surfaced as a graceful no-op result — NEVER a silent
// success (INV-15: no half-fire).
//
// This REUSES the archive-primitive SHAPE from `retireSupersededPairs`
// (lib/q-a-pairs/promote-corpus.ts: `publication_status:'archived'` +
// `superseded_by` + `.eq('publication_status','published')` CAS +
// affected-row=1) but is a SEPARATE function and does NOT call it:
// `retireSupersededPairs` is extraction-lineage-keyed and picks the survivor
// automatically, whereas a dedup merge's survivor is CURATOR-CHOSEN (possibly
// an override of the proposer's nomination — INV-9/13).
//
// The q_a_pair_history snapshot is the EXISTING AFTER-UPDATE trigger's job
// (INV-16) — this helper performs NO app-side history insert. The
// cross-workspace `superseded_by` is permitted by the FK (ON DELETE SET NULL,
// no workspace constraint — INV-11).
//
// Supabase safety: uses `tryQuery()` (lib/supabase/safe.ts) so a Postgrest
// error is a typed `Result` the caller branches on, never a thrown surprise.
// Direct file import only — NO barrel re-export.
import { tryQuery, isOk } from '@/lib/supabase/safe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

/**
 * The outcome of a {@link mergeDedupPair} call.
 *
 * - `{ ok: true }` — the non-survivor was archived (affected-row = 1) and now
 *   carries `superseded_by = survivorId`. The caller may proceed to flip the
 *   proposal `status='approved'`.
 * - `{ ok: false, reason: 'cas_no_match' }` — the CAS matched 0 rows: the
 *   non-survivor is no longer `published` (already archived / concurrent
 *   run). The caller MUST leave the proposal `pending` and the corpus
 *   unchanged — this is the graceful-failure path, not a half-fire.
 * - `{ ok: false, reason: 'db_error', message }` — the UPDATE itself errored.
 *   Same caller obligation: leave the proposal pending, surface the failure.
 */
export type MergeDedupPairResult =
  | { ok: true }
  | { ok: false; reason: 'cas_no_match' }
  | { ok: false; reason: 'db_error'; message: string };

type QAPairsUpdate = Database['public']['Tables']['q_a_pairs']['Update'];

/**
 * Archive the non-survivor of a curator-approved duplicate pair.
 *
 * Runs under the CALLER's Supabase client (the curator's role-scoped client —
 * NOT service-role, INV-9), so the write is gated by the caller's RLS posture.
 *
 * @param client       The curator's role-scoped Supabase client.
 * @param survivorId   The pair member that SURVIVES (becomes `superseded_by`
 *                     on the loser). Curator-chosen — may be the proposer's
 *                     nomination or an override.
 * @param nonSurvivorId The pair member that is ARCHIVED. MUST differ from
 *                     `survivorId` (the caller enforces membership; this
 *                     helper additionally refuses a self-merge defensively).
 */
export async function mergeDedupPair(
  client: SupabaseClient<Database>,
  { survivorId, nonSurvivorId }: { survivorId: string; nonSurvivorId: string },
): Promise<MergeDedupPairResult> {
  // Defence-in-depth: archiving a pair with superseded_by pointing at itself
  // is never valid (INV-15 "never archive-without-superseded_by" implies a
  // DISTINCT survivor). The caller already guards membership; refuse here too.
  if (survivorId === nonSurvivorId) {
    return {
      ok: false,
      reason: 'db_error',
      message: 'mergeDedupPair: survivor and non-survivor must differ',
    };
  }

  // Archive payload: publication_status='archived'; superseded_by=<survivorId>.
  // Never archive-without-superseded_by (INV-15) — both fields move together.
  const archivePayload: Pick<
    QAPairsUpdate,
    'publication_status' | 'superseded_by'
  > = {
    publication_status: 'archived',
    superseded_by: survivorId,
  };

  // CAS: only flip a STILL-published loser. `.select('id')` returns the
  // affected rows so we can assert affected-row = 1 — a 0-row result means a
  // concurrent run already archived it (the loser is no longer 'published'),
  // which is the graceful-failure path, not a thrown error.
  const result = await tryQuery<{ id: string }[]>(
    client
      .from('q_a_pairs')
      .update(archivePayload)
      .eq('id', nonSurvivorId)
      .eq('publication_status', 'published')
      .select('id'),
    'q_a_pairs.dedupMerge.archiveNonSurvivor',
  );

  if (!isOk(result)) {
    return { ok: false, reason: 'db_error', message: result.error.message };
  }

  const affectedRows = result.data ?? [];
  if (affectedRows.length === 0) {
    // 0 rows: CAS matched nothing — the non-survivor is no longer published
    // (already archived / concurrent run). Graceful failure, corpus unchanged.
    return { ok: false, reason: 'cas_no_match' };
  }

  // affected-row = 1: archive landed; the AFTER-UPDATE trigger writes the
  // q_a_pair_history snapshot (INV-16, no app-side insert here).
  return { ok: true };
}

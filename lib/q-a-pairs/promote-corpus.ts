/**
 * lib/q-a-pairs/promote-corpus.ts
 *
 * ID-59 {59.22} — promoteCorpusExtractions core loop + atomic CAS + field map.
 *
 * Spec: specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-corpus-promotion.md
 *       R1 steps 1, 2, 3, 5.
 * Product invariants: INV-1, INV-4, INV-5, INV-6, INV-7, INV-8.
 *
 * THIS SLICE stops each promoted pair at publication_status='draft' with
 * question_embedding NULL. Embedding + publish is {59.23}.
 *
 * Auth discipline: the caller (HTTP route or pipeline) passes an authorised/
 * operator Supabase client. ALL DB access is via tryQuery() — no service-role
 * escalation, RLS-scoped throughout (INV-14, INV-15). Direct import — no barrel.
 *
 * Alternate question phrasings: q_a_extractions has no dedicated phrasings
 * column (the extraction_metadata JSONB is the only place per-extraction
 * metadata lives, but no standard phrasings key is established). Route i
 * omits alternate_question_phrasings from the INSERT payload entirely and
 * relies on the column DEFAULT '{}' (an empty text[]). When ID-94.1/G4 lands
 * a dedicated column or well-known metadata key, update the INSERT payload
 * below — see the note near the INSERT.
 */

import { tryQuery } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import type { Database } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Reason a single extraction was not promoted in this run. */
export type SkipReason = 'no_answer_text';

/** Per-extraction skip record (INV-7). */
export interface SkipRecord {
  extractionId: string;
  reason: SkipReason;
}

/**
 * Structured summary returned by promoteCorpusExtractions (R1 step 5).
 *
 * Extended in {59.23} with embed_failed, and in {59.24} with retired /
 * retired_no_replacement.
 */
export interface PromotionSummary {
  /** Total extractions the RPC returned (eligible set). */
  considered: number;
  /** Extractions newly linked to a fresh pair this run. */
  promoted: number;
  /** Extractions skipped (unpromotable — e.g. no answer text). */
  skipped: SkipRecord[];
  /** Extractions where the CAS lost a race (concurrent run won; orphan cleaned). */
  already_promoted: number;
  /**
   * Extractions that were already linked but whose pair is unembedded.
   * These are passed through untouched — {59.23} will re-attempt embedding.
   * They are not promoted (no new pair), not skipped (have usable content),
   * not already_promoted (the link is real). The count is surfaced so the
   * operator can see the embedding backlog.
   */
  pass_through: number;
}

// ---------------------------------------------------------------------------
// Minimal Supabase client shape required by this function
// (avoids importing the full generated Database type here — callers supply
//  the typed client; we just describe what we call on it)
// ---------------------------------------------------------------------------

/** Minimal interface needed from the Supabase client (injected by callers). */
export interface SupabaseClientLike {
  rpc: (
    name: string,
    params?: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => PromiseLike<{ data: any; error: any }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
}

// ---------------------------------------------------------------------------
// Core promotion loop
// ---------------------------------------------------------------------------

/**
 * Promotes eligible corpus extractions to q_a_pairs (route i, origin_kind=
 * 'extracted_from_corpus').
 *
 * Algorithm per TECH R1:
 *   1. SELECT eligible set via q_a_extractions_promotion_candidates() RPC.
 *   2. SKIP rows with no usable answer text (INV-7).
 *   3a. For unpromoted rows: INSERT pair (draft, no embedding), then CAS-link.
 *       CAS 0 rows → delete orphan + count already_promoted.
 *   3d. For linked-but-unembedded rows: pass through; {59.23} embeds them.
 *   5. Return structured summary.
 *
 * @param client  Authorised/operator Supabase client (RLS-scoped; injected by
 *                the HTTP route or ID-45 pipeline).
 */
export async function promoteCorpusExtractions(
  client: SupabaseClientLike,
): Promise<PromotionSummary> {
  // -------------------------------------------------------------------------
  // Step 1 — Fetch eligible extractions via the landed {59.21} RPC.
  // The RPC returns SETOF q_a_extractions: live AND (unlinked OR
  // linked-but-unembedded), ordered by created_at.
  // -------------------------------------------------------------------------
  const eligibleResult = await tryQuery(
    client.rpc('q_a_extractions_promotion_candidates') as ReturnType<
      typeof client.rpc
    >,
    'q_a_extractions_promotion_candidates',
  );

  if (!eligibleResult.ok) {
    // Surface the error — callers decide whether to retry or abort the batch.
    throw new Error(
      safeErrorMessage(
        eligibleResult.error,
        'Failed to fetch promotion candidates from q_a_extractions_promotion_candidates()',
      ),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extractions: any[] = eligibleResult.data ?? [];

  // -------------------------------------------------------------------------
  // Summary accumulators
  // -------------------------------------------------------------------------
  let promoted = 0;
  let already_promoted = 0;
  let pass_through = 0;
  const skipped: SkipRecord[] = [];

  // -------------------------------------------------------------------------
  // Per-extraction loop
  // -------------------------------------------------------------------------
  for (const extraction of extractions) {
    const extractionId: string = extraction.id;

    // -----------------------------------------------------------------------
    // Step 3d — linked-but-unembedded pass-through (R1 step 3d).
    // The RPC returns these so {59.23} can re-embed them. In this slice they
    // are neither promoted (no new pair) nor skipped; we count them as
    // pass_through and continue. No INSERT, no CAS.
    // -----------------------------------------------------------------------
    if (extraction.promoted_to_pair_id !== null) {
      pass_through++;
      continue;
    }

    // -----------------------------------------------------------------------
    // Step 2 — Skip unpromotable rows (INV-7).
    // NULL, empty, or whitespace-only answer text → skip with reason.
    // NEVER throw the batch; mirrors route-iii 422 as a batch skip.
    // -----------------------------------------------------------------------
    const answerText: string | null = extraction.extracted_answer_text;
    if (!answerText || answerText.trim().length === 0) {
      skipped.push({ extractionId, reason: 'no_answer_text' });
      continue;
    }

    // -----------------------------------------------------------------------
    // Step 3a — Atomic CAS (unpromoted case).
    //
    // INSERT the q_a_pairs row FIRST (draft, no embedding), then CAS-link
    // on q_a_extractions WHERE promoted_to_pair_id IS NULL. If 0 rows
    // updated (concurrent run won), DELETE the orphan pair.
    //
    // Order is load-bearing: pair exists before the link is written; the
    // UNIQUE partial index (uq_q_a_extractions_promoted_to_pair_id) is
    // the DB backstop on the link column.
    // -----------------------------------------------------------------------

    // ---- 3a-i: INSERT the pair (draft, embedding omitted — {59.23} adds it) ----
    //
    // Field map (INV-6):
    //   question_text             ← extracted_question_text
    //   answer_standard           ← extracted_answer_text
    //   alternate_question_phrasings ← omitted; relies on column DEFAULT '{}'
    //                                   (an empty text[]). No dedicated column on
    //                                   q_a_extractions. Update when ID-94.1/G4
    //                                   adds a known phrasings key.
    //   origin_kind               ← 'extracted_from_corpus' (INV-4)
    //   publication_status        ← 'draft' (embedding + publish is {59.23})
    //   question_embedding        ← omitted/NULL ({59.23})
    //   source_form_response_id   ← omitted (route-i pairs have no form lineage)
    //   source_question_id        ← omitted (route-i pairs have no form lineage)
    //   source_workspace_id       ← omitted (nullable/defaulted; mirrors
    //                               route-iii lines 155-164 which also omit it)
    //   superseded_by             ← omitted/NULL
    //
    // The payload is typed as the generated Insert type so a future
    // alternate_question_phrasings: '{}' (string, not string[]) would be a
    // compile error — preventing recurrence of the 22P02 bug class.
    const pairInsert: Database['public']['Tables']['q_a_pairs']['Insert'] = {
      question_text: extraction.extracted_question_text,
      answer_standard: answerText,
      // alternate_question_phrasings intentionally omitted — DB DEFAULT '{}'
      // (text[] NOT NULL DEFAULT '{}') fills it. Update here for ID-94.1/G4.
      origin_kind: 'extracted_from_corpus',
      publication_status: 'draft',
      // question_embedding intentionally omitted — {59.23} embeds + publishes
    };
    const insertResult = await tryQuery(
      client.from('q_a_pairs').insert(pairInsert).select('id').single(),
      'q_a_pairs.insertCorpusDraft',
    );

    if (!insertResult.ok) {
      // Surface insert failure — do not silently skip; callers see the error.
      throw new Error(
        safeErrorMessage(
          insertResult.error,
          `Failed to insert q_a_pairs draft for extraction ${extractionId}`,
        ),
      );
    }

    const newPairId: string = (insertResult.data as { id: string }).id;

    // ---- 3a-ii: CAS — link the extraction to the new pair ----
    //
    // UPDATE q_a_extractions SET promoted_to_pair_id = newPairId
    //  WHERE id = extractionId AND promoted_to_pair_id IS NULL
    // returning the affected rows. The REST PATCH can silently no-op;
    // the affected-row COUNT is the truth signal (CLAUDE.md gotcha).
    const casResult = await client
      .from('q_a_extractions')
      .update({
        promoted_to_pair_id: newPairId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', extractionId)
      .is('promoted_to_pair_id', null)
      .select('id');

    // The chain is awaited directly (then); the resolved value has {data, error}.
    const casData: { id: string }[] | null = casResult?.data ?? null;
    const casError = casResult?.error ?? null;

    if (casError) {
      // CAS error — clean up the orphan pair we just inserted, then surface.
      await client.from('q_a_pairs').delete().eq('id', newPairId);
      throw new Error(
        safeErrorMessage(
          casError,
          `CAS UPDATE failed for extraction ${extractionId}; orphan pair ${newPairId} deleted`,
        ),
      );
    }

    const casRowCount = (casData ?? []).length;

    if (casRowCount === 0) {
      // ---- 3a-iii: CAS lost the race (0 rows) — delete orphan pair ----
      //
      // A concurrent run already linked this extraction. Our just-inserted
      // pair has no link, no embedding, was never published — safe to delete.
      await client.from('q_a_pairs').delete().eq('id', newPairId);
      already_promoted++;
    } else {
      // ---- CAS won (1 row) — pair is linked ----
      promoted++;
      // {59.23} will embed + publish this pair. It is left at draft + NULL
      // embedding so q_a_search correctly excludes it until fully promoted.
    }
  }

  return {
    considered: extractions.length,
    promoted,
    skipped,
    already_promoted,
    pass_through,
  };
}

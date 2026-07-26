// app/api/q-a-pairs/[id]/route.ts
//
// ID-59 {59.11} — UC6 user-direct Q&A write route (PC-A4 / PC-4).
//
// AUTHENTICATED route. It is NOT in proxy.ts `publicRoutes` — it must sit
// behind auth (any non-API public endpoint would otherwise need allowlisting;
// this one deliberately does not, so unauthenticated callers are rejected by
// the middleware before reaching the handler, and the in-handler role guard
// rejects anyone below editor).
//
// KH-DB-ONLY (TECH UC6): a revision writes to Postgres and NOTHING else. No
// Storage object is read, written or minted by this route, for any
// `origin_kind` — the save is one `q_a_pairs` UPDATE with an affected-row
// assertion.
//
// ID-127 {127.38} / DR-086 — SIDECAR WRITE HALF RETIRED. The {59.30} dual-write
// is gone: both the INV-12 write-back leg (rewrite the pair's existing sidecar
// object) and the INV-13 MATERIALISE-ON-FIRST-EDIT leg (mint a reserved-prefix
// sidecar object and stamp the uuid5 of its path as `source_document_id`) have
// been deleted, along with the `{138.12}` T4 re-point that had moved them onto
// the `corpus` Storage bucket. No app code derives or mints a Q&A sidecar path
// any more — the prefix stays RESERVED (guarded by the RATIFY-2 assertion in
// `__tests__/integration/cocoindex/platform-corpus-shape.test.ts`), but no
// writer targets it. This restores the KH-DB-only contract `TECH.md` never
// stopped specifying for UC6.
//
// History snapshots: the existing `q_a_pairs_history_trigger()` (AFTER UPDATE
// on q_a_pairs, updated in {59.5} to also copy OLD.edit_intent) writes the
// q_a_pair_history row. This route performs NO app-side history insert.
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import {
  arbitrateMany,
  coerceIntent,
  type EditIntent,
} from '@/lib/edit-intent/arbitrate';
import { safeErrorMessage } from '@/lib/error';
import { isOk, tryQuery, type PostgrestLike } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Per-actor edit intent contributed by one side of a concurrent (CRDT) merge.
 * Surface is identical to `{59.8}`'s `arbitration_inputs` element shape
 * (`lib/validation/schemas.ts` `ItemUpdateBodySchema`): `actor` is a free
 * string (max 200, NOT a UUID) and `intent` is a free string (max 50). The
 * untrusted `intent` is the trust gate's input — `coerceIntent` maps any
 * out-of-CV value to the unit element 'cosmetic', never rejecting it.
 */
const ArbitrationInputSchema = z.object({
  actor: z.string().max(200),
  intent: z.string().max(50),
});

/**
 * Editable fields on the UC6 user-direct Q&A revision surface. All optional —
 * a PATCH may touch any subset. `edit_intent`/`arbitration_inputs` are
 * resolution inputs, not directly-trusted column values (the stamped value is
 * server-resolved). The per-actor CRDT field is named `arbitration_inputs` to
 * match `{59.8}`'s items route — both routes share one CRDT input surface.
 */
const QAPairUpdateSchema = z
  .object({
    question_text: z.string().min(1).optional(),
    alternate_question_phrasings: z.array(z.string()).optional(),
    answer_standard: z.string().min(1).optional(),
    answer_advanced: z.string().nullable().optional(),
    scope_tag: z.array(z.string()).optional(),
    anti_scope_tag: z.array(z.string()).optional(),
    // Single-actor intent input (coerced, then folded as a singleton).
    edit_intent: z.unknown().optional(),
    // CRDT merge inputs: per-actor intents arbitrated to one stamped value.
    // Named `arbitration_inputs` to match `{59.8}`'s items route surface.
    arbitration_inputs: z.array(ArbitrationInputSchema).optional(),
  })
  .strict();

/** The q_a_pairs columns this route is allowed to write (excludes intent inputs). */
const EDITABLE_COLUMNS = [
  'question_text',
  'alternate_question_phrasings',
  'answer_standard',
  'answer_advanced',
  'scope_tag',
  'anti_scope_tag',
] as const;

/**
 * The pair shape the existence pre-read projects. {127.38}: the pre-read no
 * longer feeds a sidecar decision — it exists ONLY to distinguish "no such
 * pair" (404) from a genuine write failure (500). Without it the UPDATE's
 * `.single()` raises PGRST116 on a missing id and the route would answer 500.
 */
interface PairExistsRow {
  id: string;
}

/** The generated `q_a_pairs` row + update shapes (the codebase typed-update pattern). */
type QAPairsRow = Database['public']['Tables']['q_a_pairs']['Row'];
type QAPairsUpdate = Database['public']['Tables']['q_a_pairs']['Update'];

/**
 * Resolve the post-arbitration {@link EditIntent} to stamp on this UPDATE.
 *
 * - CRDT merge path (`arbitration_inputs` present): coerce each per-actor
 *   intent through the trust gate, then `arbitrateMany` to a single intent. An
 *   empty array folds to 'cosmetic' (the unit element).
 * - Single-actor path: coerce the lone `edit_intent` and fold it as a
 *   singleton (`arbitrateMany([x])`), so both paths share one resolution rule.
 */
function resolveEditIntent(
  parsed: z.infer<typeof QAPairUpdateSchema>,
  ctx: { userId: string; contentItemId: string },
): EditIntent {
  if (parsed.arbitration_inputs !== undefined) {
    const coerced = parsed.arbitration_inputs.map((input) =>
      coerceIntent(input.intent, {
        userId: ctx.userId,
        contentItemId: ctx.contentItemId,
        opId: input.actor,
      }),
    );
    return arbitrateMany(coerced);
  }

  const single = coerceIntent(parsed.edit_intent, {
    userId: ctx.userId,
    contentItemId: ctx.contentItemId,
    opId: ctx.userId,
  });
  return arbitrateMany([single]);
}

export const PATCH = defineRoute(
  z.unknown(),
  async (request: NextRequest, context: RouteContext) => {
    try {
      const { id } = await context.params;

      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase, user } = auth;

      // Malformed/empty JSON body → null, which parseBody rejects as a 400.
      // The parse failure IS the surfaced signal, so the swallow is intentional.
      const raw = await request.json().catch((_err) => null);
      const parsedResult = parseBody(QAPairUpdateSchema, raw);
      if (!parsedResult.success) return parsedResult.response;
      const parsed = parsedResult.data;

      // Project just the writable content fields from the parsed body.
      // Typed as a `q_a_pairs` Update partial so it spreads into the UPDATE
      // payload without a cast (the editable columns are a strict subset of the
      // generated Update shape). The per-column assignment widens to the Update
      // value via a single localised cast — the EDITABLE_COLUMNS allowlist plus
      // the zod schema already constrain the keys + value shapes.
      const directFields: QAPairsUpdate = {};
      for (const col of EDITABLE_COLUMNS) {
        if (parsed[col] !== undefined) {
          (directFields as Record<string, unknown>)[col] = parsed[col];
        }
      }

      if (Object.keys(directFields).length === 0) {
        return NextResponse.json(
          { error: 'No editable fields to update' },
          { status: 400 },
        );
      }

      // Resolve + stamp the post-arbitration edit intent on the UC6 CRDT path.
      const editIntent = resolveEditIntent(parsed, {
        userId: user.id,
        contentItemId: id,
      });

      // ── Existence pre-read: 404 vs 500 ───────────────────────────────────────
      // {127.38}: this used to also project the INV-7 gate inputs + the carried
      // set for the sidecar decision. With the file leg retired it is narrowed
      // to a bare existence check — but it must NOT be removed: it is what
      // makes a PATCH against an unknown id a 404 rather than the 500 the
      // UPDATE's `.single()` PGRST116 would otherwise produce.
      const pairResult = await tryQuery<PairExistsRow | null>(
        supabase
          .from('q_a_pairs')
          .select('id')
          .eq('id', id)
          .maybeSingle() as unknown as PostgrestLike<PairExistsRow | null>,
        'q_a_pairs.userDirectRevision.preRead',
      );
      if (!isOk(pairResult)) {
        return NextResponse.json(
          { error: 'Failed to update Q&A pair' },
          { status: 500 },
        );
      }
      if (pairResult.data === null) {
        return NextResponse.json(
          { error: 'Q&A pair not found' },
          { status: 404 },
        );
      }

      // ── The DB leg — the whole save (KH-DB-only) ────────────────────────────
      // Captures the updated row + an explicit affected-row assertion so a 0-row
      // PATCH is a surfaced failure, never a silent no-op (REST PATCH gotcha).
      const updatePayload: QAPairsUpdate = {
        ...directFields,
        edit_intent: editIntent,
        updated_at: new Date().toISOString(),
      };
      const updateResult = await tryQuery<QAPairsRow>(
        supabase
          .from('q_a_pairs')
          .update(updatePayload)
          .eq('id', id)
          .select('*')
          .single() as unknown as PostgrestLike<QAPairsRow>,
        'q_a_pairs.userDirectRevision',
      );
      if (!isOk(updateResult)) {
        throw updateResult.error;
      }
      // Affected-row assertion: `.single()` already errors PGRST116 on 0 rows,
      // but a null data with no error is a silent failure we must not swallow.
      if (updateResult.data === null) {
        throw new Error('Q&A pair UPDATE affected 0 rows');
      }

      return NextResponse.json({
        q_a_pair: updateResult.data,
        edit_intent: editIntent,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update Q&A pair') },
        { status: 500 },
      );
    }
  },
);

/**
 * ID-135 {135.22} — /library bulk-delete rehome (admin only, mirroring the
 * pre-M6 `/api/items/[id]` DELETE's admin-only comment). Hard delete: every
 * FK referencing `q_a_pairs.id` (q_a_pair_history, q_a_pair_dedup_proposals,
 * question_matches, citations, record_lifecycle) is `ON DELETE CASCADE` or
 * `ON DELETE SET NULL` (verified against the live schema), so this is
 * DB-safe and matches the old route's hard-delete semantics (never a
 * soft-archive). `record_embeddings` has no FK to `q_a_pairs` (by design —
 * see that table's own comment) and is reconciled by the existing orphan
 * reaper, not by this route.
 *
 * `.select('id')` + an affected-row-count check is the only way to detect a
 * 0-row DELETE match (not a Postgres error) — mirrors the PATCH handler
 * above's affected-row assertion for the same reason.
 */
export const DELETE = defineRoute(
  z.unknown(),
  async (_request: NextRequest, context: RouteContext) => {
    try {
      const { id } = await context.params;

      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { data, error } = await supabase
        .from('q_a_pairs')
        .delete()
        .eq('id', id)
        .select('id');

      if (error) {
        return NextResponse.json(
          { error: safeErrorMessage(error, 'Failed to delete Q&A pair') },
          { status: 500 },
        );
      }

      if (!data || data.length === 0) {
        return NextResponse.json(
          { error: 'Q&A pair not found' },
          { status: 404 },
        );
      }

      return NextResponse.json({ success: true });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to delete Q&A pair') },
        { status: 500 },
      );
    }
  },
);

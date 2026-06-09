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
// KH-DB-ONLY (INV-4): this revision path writes ONLY to Postgres. The
// file-sidecar materialisation for Q&A is DEFERRED-v1.1 — there is no file
// write here, by design.
//
// History snapshots: the existing `q_a_pairs_history_trigger()` (AFTER UPDATE
// on q_a_pairs, updated in {59.5} to also copy OLD.edit_intent) writes the
// q_a_pair_history row. This route performs NO app-side history insert.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { tryQuery } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import { safeErrorMessage } from '@/lib/error';
import {
  arbitrateMany,
  coerceIntent,
  type EditIntent,
} from '@/lib/edit-intent/arbitrate';

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

/**
 * PATCH /api/q-a-pairs/:id — apply a user-direct revision to one Q&A pair.
 *
 * Role guard: admin/editor only (viewer ⇒ 403 via authFailureResponse). The
 * UPDATE goes through `tryQuery`; the history snapshot is the existing trigger.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
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
    const directFields: Record<string, unknown> = {};
    for (const col of EDITABLE_COLUMNS) {
      if (parsed[col] !== undefined) directFields[col] = parsed[col];
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

    // KH-DB-only UPDATE. The AFTER UPDATE trigger snapshots the OLD row (with
    // its prior edit_intent) into q_a_pair_history — NO app-side history insert.
    const updateResult = await tryQuery(
      supabase
        .from('q_a_pairs')
        .update({
          ...directFields,
          edit_intent: editIntent,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single(),
      'q_a_pairs.userDirectRevision',
    );

    if (!updateResult.ok) {
      if (updateResult.error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Q&A pair not found' },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: 'Failed to update Q&A pair' },
        { status: 500 },
      );
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
}

// app/api/q-a-pairs/promote/route.ts
//
// ID-59 {59.14} — UC5 bid→Q&A promotion endpoint (PC-5 / INV-5(UC5)).
//
// AUTHENTICATED route. It is NOT in proxy.ts `publicRoutes` — it sits behind
// auth middleware, and the in-handler role guard (admin/editor, per TECH
// §PC-19) rejects viewers with a 403 via `authFailureResponse`.
//
// KH-DB-ONLY with lineage (PRODUCT §A.7 / TECH §PC-5): promoting a form
// response to a Q&A pair INSERTs a `q_a_pairs` DRAFT carrying lineage back to
//   (a) the source form response  (source_form_response_id)
//   (b) its originating question  (source_question_id)
// NO file is written. Arbitration is NOT invoked — `arbitrate`/`arbitrateMany`
// are never imported here; at most `coerceIntent` normalises the promoter's
// single optional intent selection. The user reviews the draft
// (publication_status = 'draft') before publish.
//
// Source-response context uses the `form_*` naming per {64.14} (NOT stale
// `bid_*`): the read targets `form_responses` + `form_questions`.
//
// RLS scoping (PC-20): the authorised cookie-based client is used for BOTH the
// source read and the draft insert, so the acting user can only promote
// content they can already access — there is no service-role escalation and no
// cross-workspace write.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { tryQuery } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import { safeErrorMessage } from '@/lib/error';
// Single-selection intent normalisation ONLY. `arbitrate`/`arbitrateMany` are
// deliberately NOT imported — UC5 is single-actor and does not merge intents.
import { coerceIntent, type EditIntent } from '@/lib/edit-intent/arbitrate';

/**
 * Promotion request body.
 *
 * - `source_form_response_id` (required) — the `form_responses(id)` to promote.
 * - `source_question_id` (optional) — the originating `form_questions(id)`. When
 *   omitted it is derived from the source response's `question_id`, so callers
 *   normally need only supply the response id.
 * - `edit_intent` (optional, untrusted) — the promoter's single intent
 *   selection. Coerced via `coerceIntent` (out-of-CV → 'cosmetic'); never
 *   arbitrated. Recorded on the draft's `edit_intent` column.
 */
const PromoteBodySchema = z
  .object({
    source_form_response_id: z.string().uuid(),
    source_question_id: z.string().uuid().optional(),
    edit_intent: z.unknown().optional(),
  })
  .strict();

/** Shape projected from the source form response + its originating question. */
interface SourceResponseRow {
  id: string;
  question_id: string;
  response_text: string | null;
  response_text_advanced: string | null;
  form_questions: { id: string; question_text: string } | null;
}

/**
 * POST /api/q-a-pairs/promote — promote a form response to a Q&A draft.
 *
 * Role guard: admin/editor only (viewer ⇒ 403 via authFailureResponse).
 * Reads the source response (RLS-scoped) to derive the question/answer text and
 * the originating question, then INSERTs a `q_a_pairs` draft with lineage. NO
 * file write; NO arbitration.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, user } = auth;

    // Malformed/empty JSON body → null, which parseBody rejects as a 400. The
    // parse failure IS the surfaced signal, so the swallow is intentional.
    const raw = await request.json().catch((_err) => null);
    const parsedResult = parseBody(PromoteBodySchema, raw);
    if (!parsedResult.success) return parsedResult.response;
    const parsed = parsedResult.data;

    // Read the source form response + its originating question through the
    // AUTHORISED client (RLS-scoped per PC-20). A response the user cannot
    // read returns no row → 404, so promotion is confined to content the
    // acting user can already access. `form_*` naming per {64.14}.
    const sourceResult = await tryQuery<SourceResponseRow>(
      supabase
        .from('form_responses')
        .select(
          'id, question_id, response_text, response_text_advanced, form_questions ( id, question_text )',
        )
        .eq('id', parsed.source_form_response_id)
        .single(),
      'form_responses.promoteSource',
    );

    if (!sourceResult.ok) {
      if (sourceResult.error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Source form response not found' },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: 'Failed to load source form response' },
        { status: 500 },
      );
    }

    const source = sourceResult.data;

    // The originating question: prefer the explicit body value, else derive it
    // from the source response's FK. Both reference form_questions(id).
    const sourceQuestionId = parsed.source_question_id ?? source.question_id;

    const questionText = source.form_questions?.question_text;
    if (!questionText) {
      // The draft's question_text is NOT NULL; a response with no resolvable
      // originating question cannot be promoted. Surface, do not paper over.
      return NextResponse.json(
        {
          error:
            'Source response has no resolvable originating question to promote',
        },
        { status: 422 },
      );
    }

    // answer_standard is NOT NULL on q_a_pairs; an empty response body cannot
    // become a publishable answer. Reject rather than insert an empty draft.
    const answerStandard = source.response_text;
    if (!answerStandard || answerStandard.trim().length === 0) {
      return NextResponse.json(
        { error: 'Source response has no answer text to promote' },
        { status: 422 },
      );
    }

    // Normalise the promoter's single optional intent selection. This is NOT
    // arbitration — it is the boundary coercion only (out-of-CV → 'cosmetic').
    const editIntent: EditIntent = coerceIntent(parsed.edit_intent, {
      userId: user.id,
      contentItemId: parsed.source_form_response_id,
      opId: user.id,
    });

    // Insert the review-before-publish DRAFT with lineage. The authorised
    // client enforces the q_a_pairs INSERT RLS policy (authenticated role);
    // no service-role escalation, no cross-workspace write.
    const insertResult = await tryQuery(
      supabase
        .from('q_a_pairs')
        .insert({
          question_text: questionText,
          answer_standard: answerStandard,
          answer_advanced: source.response_text_advanced,
          origin_kind: 'derived_from_form_response',
          publication_status: 'draft',
          edit_intent: editIntent,
          source_form_response_id: parsed.source_form_response_id,
          source_question_id: sourceQuestionId,
        })
        .select('*')
        .single(),
      'q_a_pairs.promoteDraft',
    );

    if (!insertResult.ok) {
      return NextResponse.json(
        { error: 'Failed to create Q&A draft' },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        q_a_pair: insertResult.data,
        lineage: {
          source_form_response_id: parsed.source_form_response_id,
          source_question_id: sourceQuestionId,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to promote form response') },
      { status: 500 },
    );
  }
}

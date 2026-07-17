/**
 * Shared per-question procurement drafting step (jscpd dedup roadmap-13, C2).
 *
 * The per-question body — fetch matched content → run the three-pass drafting
 * pipeline → upsert the `form_responses` row → mark the question `ai_drafted` —
 * was duplicated between the synchronous route
 * (`app/api/procurement/[id]/responses/draft/route.ts`) and the async queue
 * handler (`lib/queue/handlers/procurement-draft-all.ts`, whose docstring notes
 * the loop was a "literal extraction from draft-all route"). This module is the
 * single canonical home for that body.
 *
 * BEHAVIOUR-PRESERVING extraction: the two callers diverge ONLY in how they map
 * a DB write error, so this function NEVER swallows or reclassifies — it returns
 * a discriminated {@link DraftOutcome} and each caller applies its own existing
 * policy (the route swallows `update_failed` → still reports drafted; the handler
 * maps `update_failed` → failed). Content-fetch and pipeline errors THROW, exactly
 * as before, so each caller's per-question try/catch records `status: 'failed'`.
 *
 * Interim home: Wave-6 relocates `lib/procurement` → `lib/domains/procurement`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  DraftableContent,
  DraftableQuestion,
  DraftResult,
} from '@/lib/domains/procurement/ai/draft';
import { runDraftingPipeline } from '@/lib/domains/procurement/ai/draft';
import { PIPELINE_SYSTEM_USER_ID } from '@/lib/intelligence/types';
import { logger } from '@/lib/logger';
import type { Database, Json } from '@/supabase/types/database.types';

/**
 * The `form_questions` columns the drafting step reads. Mirrors the `select`
 * both callers issue (`id, question_text, word_limit, section_name,
 * confidence_posture`).
 *
 * ID-145 {145.23}: `matched_record_ids` (dropped W1c STEP 4) is no longer a
 * field on this row — matches are sourced from `question_match_search`
 * (R7 substrate, BI-37) inside {@link draftSingleQuestion} below, mirroring
 * the {145.21} draft-stream route's re-point.
 */
export interface DraftableQuestionRow {
  id: string;
  question_text: string;
  word_limit: number | null;
  section_name: string | null;
  confidence_posture: string | null;
}

/**
 * Outcome of drafting one question. `draftResult` is present on every variant
 * once the pipeline has run, so callers can accumulate cost/tokens regardless of
 * the subsequent write outcome (matching the pre-extraction accumulate-after-
 * pipeline ordering). The three outcomes carry the exact information each caller
 * needs to reproduce its prior behaviour:
 *   - `drafted`       — response upserted + question marked `ai_drafted`.
 *   - `upsert_failed` — the `form_responses` upsert errored (no response id).
 *   - `update_failed` — the response was upserted, but marking the question
 *                       `ai_drafted` errored. The route ignores this (its update
 *                       was unchecked); the handler treats it as a failure (its
 *                       update went through the throwing `sb()` wrapper).
 */
export type DraftOutcome =
  | { outcome: 'drafted'; responseId: string; draftResult: DraftResult }
  | { outcome: 'upsert_failed'; error: string; draftResult: DraftResult }
  | {
      outcome: 'update_failed';
      responseId: string;
      error: string;
      draftResult: DraftResult;
    };

/**
 * Resolve `form_questions.matched_record_ids` / `form_responses.source_record_ids`
 * (uuid[]) into full drafting content.
 *
 * Post-{131.16} (BI-29/30/31): those arrays now carry q_a_pair (primary) and
 * reference_item (optional) ids — never the retired content_items ids, and
 * never source_document ids (SD is provenance-only, not a match source —
 * TECH.md D2/E5). Shared by every caller that dereferences these arrays
 * (`draftSingleQuestion` below; the draft-stream route and the regenerate
 * route each had their own duplicate content_items fetch pre-{131.16} — all
 * three now call this one function). `content_type` on the returned
 * {@link DraftableContent} doubles as the kind discriminator
 * (`'q_a_pair' | 'reference_item'`) for callers that need to branch on it
 * (e.g. the `citations` table writer, which needs `cited_q_a_pair_id` vs
 * `cited_reference_item_id`).
 *
 * q_a_pairs compose `content` as `Q: {question}\n\n{answer_standard}\n\n
 * {answer_advanced}` — the same canonical shape already used to rebuild
 * `content_items.content` for q_a_pair-typed rows elsewhere in the codebase
 * (app/api/items/[id]/route.ts:517). reference_items use `body` verbatim.
 *
 * Ids that resolve to neither table are silently dropped (matches the
 * pre-{131.16} content_items `.in()` behaviour: a stale/deleted id was never
 * surfaced as an error, just absent from the returned array). Result order
 * follows the input `ids` order for determinism.
 */
export async function fetchMatchedContentForDrafting(
  supabase: SupabaseClient<Database>,
  ids: string[],
): Promise<DraftableContent[]> {
  if (ids.length === 0) return [];

  const [qaResult, riResult] = await Promise.all([
    supabase
      .from('q_a_pairs')
      .select('id, question_text, answer_standard, answer_advanced')
      .in('id', ids),
    supabase
      .from('reference_items')
      .select('id, title, body, summary')
      .in('id', ids),
  ]);

  if (qaResult.error) {
    throw new Error(
      `Failed to fetch matched q_a_pairs: ${qaResult.error.message}`,
    );
  }
  if (riResult.error) {
    throw new Error(
      `Failed to fetch matched reference_items: ${riResult.error.message}`,
    );
  }

  const byId = new Map<string, DraftableContent>();

  for (const row of qaResult.data ?? []) {
    byId.set(row.id, {
      id: row.id,
      title: row.question_text,
      content: [
        `Q: ${row.question_text}`,
        row.answer_standard,
        row.answer_advanced,
      ]
        .filter((part): part is string => Boolean(part))
        .join('\n\n'),
      content_type: 'q_a_pair',
      summary: row.answer_standard,
    });
  }

  for (const row of riResult.data ?? []) {
    byId.set(row.id, {
      id: row.id,
      title: row.title,
      content: row.body,
      content_type: 'reference_item',
      summary: row.summary,
    });
  }

  return ids
    .map((id) => byId.get(id))
    .filter((item): item is DraftableContent => item !== undefined);
}

/**
 * Draft a single procurement question: fetch its matched content, run the
 * drafting pipeline, upsert the response, and mark the question `ai_drafted`.
 *
 * THROWS on matched-content fetch error (S151 WP4 — never draft with empty
 * source content on a DB error; that produces a hallucinated, falsely-grounded
 * response) and on any `runDraftingPipeline` failure. Returns a discriminated
 * {@link DraftOutcome} for the two write steps so callers keep their own
 * error-mapping policy.
 *
 * @param supabase       Caller's client (route: RLS user client; handler: service-role).
 * @param question       The question row to draft.
 * @param formInstanceId The owning form id (route path-param `id` / handler `form_id`).
 * @param modelTier      Which model the drafting Pass 2 runs against.
 */
export async function draftSingleQuestion(
  supabase: SupabaseClient<Database>,
  question: DraftableQuestionRow,
  formInstanceId: string,
  modelTier: 'analysis' | 'drafting',
): Promise<DraftOutcome> {
  // Fetch matched content for this question.
  //
  // ID-145 {145.23}: form_questions.matched_record_ids was DROPPED (W1c,
  // {145.6}); matches are now sourced from question_match_search below (R7
  // substrate, BI-37) — mirrors the {145.21} draft-stream route's BI-37
  // degrade path (RPC error -> logger.warn + matchedIds=[] + draft proceeds,
  // never a hard failure here).
  const { data: matchRows, error: matchError } = await supabase.rpc(
    'question_match_search',
    { p_form_question_id: question.id, p_limit: 20 },
  );
  if (matchError) {
    logger.warn(
      { err: matchError },
      'Failed to read question_matches; drafting proceeds with no matched content',
    );
  }
  const matchedIds = (matchRows ?? []).map((row) => row.q_a_pair_id);
  let matchedContent: DraftableContent[] = [];
  if (matchedIds.length > 0) {
    try {
      matchedContent = await fetchMatchedContentForDrafting(
        supabase,
        matchedIds,
      );
    } catch (err) {
      // S151 WP4: never draft with empty source content on a DB error — that
      // produces a hallucinated response that looks grounded. Fail the
      // per-question draft loudly; the caller's try/catch records 'failed'.
      throw new Error(
        `Failed to fetch matched content for question ${question.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const draftableQuestion: DraftableQuestion = {
    id: question.id,
    question_text: question.question_text,
    word_limit: question.word_limit,
    section_name: question.section_name,
    confidence_posture: question.confidence_posture,
  };

  // Run the three-pass drafting pipeline (throws propagate to the caller).
  const draftResult = await runDraftingPipeline(
    draftableQuestion,
    matchedContent,
    modelTier,
  );

  // Upsert the response (overall_score written to both column and metadata for
  // backward compat).
  const overallScore = draftResult.metadata.quality_data?.overall_score ?? null;
  const { data: response, error: upsertError } = await supabase
    .from('form_responses')
    .upsert(
      {
        question_id: question.id,
        response_text: draftResult.response_text,
        source_record_ids: draftResult.source_record_ids,
        metadata: draftResult.metadata as unknown as Json,
        review_status: 'ai_drafted',
        drafted_by: PIPELINE_SYSTEM_USER_ID,
        updated_at: new Date().toISOString(),
        overall_score: overallScore,
      },
      { onConflict: 'question_id' },
    )
    .select('id')
    .single();

  if (upsertError || !response) {
    return {
      outcome: 'upsert_failed',
      error: upsertError?.message ?? 'Failed to save response',
      draftResult,
    };
  }

  // Mark the question as drafted.
  // ID-145 {145.23}: form_questions.workspace_id -> form_instance_id (W1c).
  const { error: updateError } = await supabase
    .from('form_questions')
    .update({ status: 'ai_drafted' })
    .eq('id', question.id)
    .eq('form_instance_id', formInstanceId);

  if (updateError) {
    return {
      outcome: 'update_failed',
      responseId: response.id,
      error: updateError.message,
      draftResult,
    };
  }

  return { outcome: 'drafted', responseId: response.id, draftResult };
}

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
} from '@/lib/ai/draft';
import { runDraftingPipeline } from '@/lib/ai/draft';
import { PIPELINE_SYSTEM_USER_ID } from '@/lib/intelligence/types';
import type { Database, Json } from '@/supabase/types/database.types';

/**
 * The `form_questions` columns the drafting step reads. Mirrors the `select`
 * both callers issue (`id, question_text, word_limit, section_name,
 * confidence_posture, matched_content_ids`).
 */
export interface DraftableQuestionRow {
  id: string;
  question_text: string;
  word_limit: number | null;
  section_name: string | null;
  confidence_posture: string | null;
  matched_content_ids: string[] | null;
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
 * Draft a single procurement question: fetch its matched content, run the
 * drafting pipeline, upsert the response, and mark the question `ai_drafted`.
 *
 * THROWS on matched-content fetch error (S151 WP4 — never draft with empty
 * source content on a DB error; that produces a hallucinated, falsely-grounded
 * response) and on any `runDraftingPipeline` failure. Returns a discriminated
 * {@link DraftOutcome} for the two write steps so callers keep their own
 * error-mapping policy.
 *
 * @param supabase    Caller's client (route: RLS user client; handler: service-role).
 * @param question    The question row to draft.
 * @param workspaceId The owning workspace id (route path-param `id` / handler `form_id`).
 * @param modelTier   Which model the drafting Pass 2 runs against.
 */
export async function draftSingleQuestion(
  supabase: SupabaseClient<Database>,
  question: DraftableQuestionRow,
  workspaceId: string,
  modelTier: 'analysis' | 'drafting',
): Promise<DraftOutcome> {
  // Fetch matched content items for this question.
  const matchedIds = question.matched_content_ids ?? [];
  let matchedContent: DraftableContent[] = [];
  if (matchedIds.length > 0) {
    const { data: contentItems, error: contentError } = await supabase
      .from('content_items')
      .select('id, suggested_title, content, content_type, summary')
      .in('id', matchedIds);

    if (contentError) {
      // S151 WP4: never draft with empty source content on a DB error — that
      // produces a hallucinated response that looks grounded. Fail the
      // per-question draft loudly; the caller's try/catch records 'failed'.
      throw new Error(
        `Failed to fetch matched content for question ${question.id}: ${contentError.message}`,
      );
    }

    matchedContent = (contentItems ?? []).map((item) => ({
      id: item.id,
      title: item.suggested_title,
      content: item.content,
      content_type: item.content_type,
      summary: item.summary,
    }));
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
        source_content_ids: draftResult.source_content_ids,
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
  const { error: updateError } = await supabase
    .from('form_questions')
    .update({ status: 'ai_drafted' })
    .eq('id', question.id)
    .eq('workspace_id', workspaceId);

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

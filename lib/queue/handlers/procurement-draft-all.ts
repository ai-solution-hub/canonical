/**
 * `form_draft_all` queue handler — Session 224 W4-IMPL.
 *
 * Spec: `docs/specs/§5.4.1-batch-draft-all-spec.md` §4 (handler signature),
 * §5 (retry classification), §6.3 (pipeline_runs Pattern 2 linkage).
 * Source-of-truth for the loop body: literal extraction from
 * `app/api/procurement/[id]/responses/draft-all/route.ts` (the pre-S224
 * synchronous loop, since removed when the route was renamed `bids`→
 * `procurement`), with these adjustments:
 *
 *   - `form_id` lifted from path-param to body field (per spec §3.1).
 *   - `supabase` is the worker's service-role client (RLS-bypassing).
 *   - `auth_context.user_id` populates `updated_by` on the bid transition
 *     (instead of `user.id` from `getAuthorisedClient()`).
 *   - NO time-budget guard — handler runs to completion bounded externally
 *     by `runJobByType`'s 60s cap (spec §4.4 + D-3 ratification).
 *   - Per-question `try/catch` aggregation preserved (continue-with-partial,
 *     per spec D-2 ratified at authored default).
 *   - Procurement-level fatal conditions (404 bid, non-draftable state, 0 questions,
 *     workspaces SELECT error, form_questions SELECT error) throw
 *     `PermanentJobError` so the worker dispatcher classifies them as
 *     permanent-failure (no retry).
 *   - `drafted_response_ids[]` collected as upserts complete so the worker
 *     can pass them to `pipeline_runs.items_created` (per
 *     feedback_record_pipeline_run_signature: `string[]` not `number`).
 *
 * The handler is invoked from `lib/queue/dispatch.ts` `case 'form_draft_all':`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { draftSingleQuestion } from '@/lib/domains/procurement/draft-response';
import { canTransition } from '@/lib/domains/procurement/procurement-workflow';
import type { ProcurementWorkflowState } from '@/lib/domains/procurement/procurement-workflow';
import { logger } from '@/lib/logger';
import { PermanentJobError } from '@/lib/queue/dispatch';
import { sb } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';

/**
 * Body of a `form_draft_all` job, stored at `processing_queue.payload.body`
 * per the envelope contract in `lib/queue/envelope.ts`.
 *
 * Lifted verbatim from `ResponseDraftAllBodySchema`
 * (`lib/validation/schemas.ts`) plus the path parameter `form_id`
 * promoted from URL to body — per spec §3.1.
 */
export interface ProcurementDraftAllBody extends Record<string, unknown> {
  /** UUID of the form (workspace) being drafted. Validated against
   *  `workspaces` JOIN `application_types` where key='procurement' before
   *  the worker proceeds. */
  form_id: string;
  /** Matches `lib/anthropic.ts` `ModelTier` — controls which model
   *  the drafting Pass 2 runs against. Default: 'drafting'. */
  model_tier: 'analysis' | 'drafting';
  /** When true, questions that already have a row in `form_responses`
   *  are skipped (status='skipped', reason='already_drafted'). Default
   *  true — matches the route's authored default. */
  skip_existing: boolean;
}

/**
 * Per-question result entry — same shape as the pre-S224 sync route's
 * results array (`app/api/procurement/[id]/responses/draft-all/route.ts`,
 * since removed).
 */
export interface ProcurementDraftAllQuestionResult {
  question_id: string;
  status: 'drafted' | 'skipped' | 'failed';
  quality_score?: number;
  reason?: string;
  error?: string;
}

/**
 * Result envelope returned by the handler. The worker writes this to
 * `processing_queue.result` AND to `pipeline_runs.result` (per spec §6.3
 * Pattern 2 finalisation).
 *
 * `drafted_response_ids` is the list of `form_responses.id` UUIDs the
 * handler upserted — passed to `pipeline_runs.items_created` per
 * feedback_record_pipeline_run_signature (`string[]` not `number`).
 */
export interface ProcurementDraftAllResult extends Record<string, unknown> {
  /** Total number of questions in the bid. */
  total_questions: number;
  /** Count of questions where runDraftingPipeline succeeded. */
  drafted: number;
  /** Count of questions skipped (no_content posture OR already_drafted with
   *  skip_existing=true). Each skipped entry has a reason field in `results`. */
  skipped: number;
  /** Count of questions where runDraftingPipeline threw. */
  failed: number;
  /** Per-question outcome — same shape as today's L131-137 results array. */
  results: ProcurementDraftAllQuestionResult[];
  /** Sum of `runDraftingPipeline` cost across drafted questions (USD). */
  total_cost: number;
  /** Sum of token usage across drafted questions. */
  total_tokens: number;
  /** True when bid was transitioned drafting → in_review at the end. */
  bid_transitioned: boolean;
  /** UUIDs of `form_responses` rows upserted during the run. Passed to
   *  `pipeline_runs.items_created` per feedback_record_pipeline_run_signature. */
  drafted_response_ids: string[];
}

/**
 * Auth context the dispatcher passes through to the handler. Mirrors
 * `QueueJobPayload<TBody>['auth_context']` from `lib/queue/envelope.ts`.
 * Used for `updated_by` on the bid transition (spec §4.4 step 4).
 */
export interface ProcurementDraftAllAuthContext {
  user_id: string;
  role: 'admin' | 'editor' | 'viewer';
  workspace_id?: string;
}

/**
 * Handler entry point. Pure async function — no Next.js Request/Response,
 * no auth lookups (the dispatcher has already re-validated auth context per
 * spec §4.2 PR-5 before calling).
 *
 * Throws `PermanentJobError` for handler-level fatal conditions:
 *   - bid not found in `workspaces` where `type='bid'`
 *   - bid status not in `draftableStates` (`drafting`, `in_review`, `ready_for_export`)
 *   - 0 questions on the bid
 *   - DB error reading `workspaces` or `form_questions`
 *
 * Per-question failures are caught and recorded as `status: 'failed'` in
 * `results[]` (continue-with-partial, per spec D-2 authored default) — the
 * job-level outcome is `'completed'` (or `'completed_with_errors'` via
 * pipeline_runs) when at least one question succeeded.
 */
export async function runFormDraftAllJob(
  body: ProcurementDraftAllBody,
  supabase: SupabaseClient<Database>,
  authContext: ProcurementDraftAllAuthContext,
): Promise<ProcurementDraftAllResult> {
  const { form_id, model_tier, skip_existing } = body;

  // ------------------------------------------------------------------
  // 1. Verify bid exists + is in a draftable state.
  //    Mirrors route.ts L52-78 verbatim, but throws PermanentJobError
  //    instead of returning HTTP 4xx.
  // ------------------------------------------------------------------
  // Post-T2: discriminator is application_types.key via JOIN, not the dropped
  // workspaces.type col. 'bid' maps to 'procurement'.
  const { data: bid, error: procurementError } = await supabase
    .from('workspaces')
    .select('id, status, domain_metadata, application_types!inner(key)')
    .eq('id', form_id)
    .eq('application_types.key', 'procurement')
    .single();

  if (procurementError || !bid) {
    throw new PermanentJobError(`form_not_found: ${form_id}`);
  }

  const procurementStatus = (bid.status as ProcurementWorkflowState) ?? 'draft';
  const draftableStates: ProcurementWorkflowState[] = [
    'drafting',
    'in_review',
    'ready_for_export',
  ];
  if (!draftableStates.includes(procurementStatus)) {
    throw new PermanentJobError(`bid_not_draftable: ${procurementStatus}`);
  }

  // ------------------------------------------------------------------
  // 2. Fetch all questions for the bid in (section_sequence,
  //    question_sequence) order — mirrors route.ts L80-99.
  // ------------------------------------------------------------------
  const { data: questions, error: questionsError } = await supabase
    .from('form_questions')
    .select(
      'id, question_text, word_limit, section_name, confidence_posture, matched_record_ids',
    )
    .eq('workspace_id', form_id)
    .order('section_sequence', { ascending: true })
    .order('question_sequence', { ascending: true });

  if (questionsError) {
    logger.error(
      { err: questionsError, form_id },
      'form_draft_all handler: failed to fetch questions',
    );
    throw new PermanentJobError(
      `form_questions_fetch_failed: ${questionsError.message}`,
    );
  }

  if (!questions || questions.length === 0) {
    throw new PermanentJobError('no_questions_in_bid');
  }

  // ------------------------------------------------------------------
  // 3. If skipping existing, build set of question_ids that already
  //    have `form_responses` rows. Mirrors route.ts L113-128.
  // ------------------------------------------------------------------
  const existingResponseIds = new Set<string>();
  if (skip_existing) {
    const questionIds = questions.map((q) => q.id);
    const existingResponses = await sb(
      supabase
        .from('form_responses')
        .select('question_id')
        .in('question_id', questionIds),
      'queue.form_draft_all.existingResponses',
    );
    for (const r of existingResponses) {
      existingResponseIds.add(r.question_id);
    }
  }

  // ------------------------------------------------------------------
  // 4. Per-question loop — mirrors route.ts L130-261 verbatim, with
  //    NO time-budget guard (handler is bounded externally by 60s cap).
  // ------------------------------------------------------------------
  const results: ProcurementDraftAllQuestionResult[] = [];
  const draftedResponseIds: string[] = [];
  let totalCost = 0;
  let totalTokens = 0;

  for (const question of questions) {
    // Skip no_content questions (mirrors route.ts L153-160).
    if (question.confidence_posture === 'no_content') {
      results.push({
        question_id: question.id,
        status: 'skipped',
        reason: 'no_content',
      });
      continue;
    }

    // Skip already-drafted if requested (mirrors route.ts L162-170).
    if (skip_existing && existingResponseIds.has(question.id)) {
      results.push({
        question_id: question.id,
        status: 'skipped',
        reason: 'already_drafted',
      });
      continue;
    }

    try {
      const outcome = await draftSingleQuestion(
        supabase,
        question,
        form_id,
        model_tier,
      );

      // Accumulate cost/tokens after the pipeline runs, regardless of the
      // subsequent write outcome (matches the pre-extraction ordering).
      totalCost += outcome.draftResult.total_cost;
      totalTokens += outcome.draftResult.total_tokens;

      if (outcome.outcome !== 'drafted') {
        // upsert_failed OR update_failed — both went through the throwing sb()
        // wrapper before extraction, so the handler treats either as a failure
        // (continue-with-partial per spec D-2).
        logger.error(
          { err: outcome.error, form_id, question_id: question.id },
          `form_draft_all handler: per-question draft failed`,
        );
        results.push({
          question_id: question.id,
          status: 'failed',
          error: outcome.error,
        });
        continue;
      }

      // drafted_response_ids[] feeds pipeline_runs.items_created (per
      // feedback_record_pipeline_run_signature).
      draftedResponseIds.push(outcome.responseId);
      results.push({
        question_id: question.id,
        status: 'drafted',
        quality_score: outcome.draftResult.metadata.quality_data?.overall_score,
      });
    } catch (draftErr) {
      logger.error(
        { err: draftErr, form_id, question_id: question.id },
        `form_draft_all handler: per-question draft failed`,
      );
      results.push({
        question_id: question.id,
        status: 'failed',
        error:
          draftErr instanceof Error
            ? draftErr.message
            : 'Drafting pipeline failed',
      });
    }
  }

  // ------------------------------------------------------------------
  // 5. Final transition — mirrors route.ts L263-301. Uses
  //    authContext.user_id for `updated_by` (instead of user.id).
  // ------------------------------------------------------------------
  const draftedCount = results.filter((r) => r.status === 'drafted').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;
  let procurementTransitioned = false;

  if (
    draftedCount > 0 &&
    failedCount === 0 &&
    procurementStatus === 'drafting' &&
    canTransition(procurementStatus, 'in_review')
  ) {
    // Check if there are any questions still without responses.
    const { count: undraftedCount } = await supabase
      .from('form_questions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', form_id)
      .neq('confidence_posture', 'no_content')
      .not(
        'id',
        'in',
        `(${results
          .filter((r) => r.status === 'drafted' || r.status === 'skipped')
          .map((r) => r.question_id)
          .join(',')})`,
      )
      .is('status', null);

    if (undraftedCount === null || undraftedCount === 0) {
      // Post-T2: the application-type filter on the WHERE clause requires a
      // JOIN through application_types. For a single-row update by `id` we
      // skip the application-type recheck since the bid was already verified
      // at the start of the handler.
      await sb(
        supabase
          .from('workspaces')
          .update({
            status: 'in_review',
            updated_by: authContext.user_id,
            updated_at: new Date(Date.now()).toISOString(),
          })
          .eq('id', form_id),
        'queue.form_draft_all.transitionToInReview',
      );
      procurementTransitioned = true;
    }
  }

  return {
    total_questions: questions.length,
    drafted: draftedCount,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: failedCount,
    results,
    total_cost: totalCost,
    total_tokens: totalTokens,
    bid_transitioned: procurementTransitioned,
    drafted_response_ids: draftedResponseIds,
  };
}

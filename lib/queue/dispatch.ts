/**
 * Per-job-type handler dispatch — Session 222 Wave 2-A.
 *
 * Spec source: `docs/specs/background-queue-infra-spec.md` §4.3 (worker
 * reference shape, lines 632-681) + §5.1 (permanent vs transient
 * classification). Plan source:
 * `docs/plans/background-queue-infra-plan.md` §1 W2, §2 W2-A.
 *
 * Each §5.4.x candidate spec (5.4.1 / 5.4.2 / 5.4.4) adds its own `case`
 * dispatching to its own handler. As of S224 W4-IMPL the `bid_draft_all`
 * case is registered (per `docs/specs/§5.4.1-batch-draft-all-spec.md` §7.4).
 *
 * Until each candidate ships, claimed jobs of unhandled types fall through
 * to the `default` branch and are permanent-failed (no retry) by the
 * worker's failure classifier (`lib/queue/failure.ts`, W2-B). This is the
 * correct behaviour: an unrecognised `job_type` value should not loop
 * indefinitely on transient-retry semantics.
 *
 * pipeline_runs Pattern 2 finalisation (per S224 W4-IMPL drift note):
 *   `recordPipelineRun()` (`lib/pipeline/record-run.ts:127-211`) is
 *   INSERT-only — calling it at-terminal would create a SECOND
 *   `pipeline_runs` row instead of finalising the producer's pre-allocated
 *   row. So the dispatch case performs a direct UPDATE on the existing row
 *   when `payload.pipeline_run_id` is set, and replicates Sentry alerting
 *   semantics inline (failed → error, completed_with_errors → warning,
 *   completed → no alert) per spec §6.3 + §6.1. The
 *   `feedback_record_pipeline_run_signature` contract is preserved
 *   (`itemsCreated: string[]`, `status: 'completed' | 'completed_with_errors'
 *   | 'failed'`, `result` not `metadata`) — only the write mode changes
 *   from INSERT to UPDATE.
 */

import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  queueJobPayloadSchema,
  type JobType,
  type QueueJobPayload,
} from '@/lib/queue/envelope';
import { reValidateAuthContext } from '@/lib/queue/auth';
import { runBidDraftAllJob } from '@/lib/queue/handlers/bid-draft-all';
import type { BidDraftAllBody } from '@/lib/queue/handlers/bid-draft-all';
import { runBatchReclassifyJob } from '@/lib/queue/handlers/batch-reclassify';
import type { BatchReclassifyBody } from '@/lib/queue/handlers/batch-reclassify';
import { runMarkdownBatchJob } from '@/lib/queue/handlers/markdown-batch';
import type { MarkdownBatchBody } from '@/lib/queue/handlers/markdown-batch';
import type { Database, Json } from '@/supabase/types/database.types';

/**
 * Permanent-failure marker. The worker's failure classifier (W2-B
 * `lib/queue/failure.ts`) treats throws of this class as permanent —
 * no retry, status='failed' immediately. Per spec §5.1.
 */
export class PermanentJobError extends Error {
  readonly permanent = true as const;
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

/**
 * Per-job-type handler dispatch. Each §5.4.x candidate spec adds its own
 * `case` clause; the W2 shell is intentionally empty so that an unknown
 * `job_type` falls through to the permanent-failure default.
 *
 * The `job` parameter comes from `claim_next_job()` (`SETOF
 * processing_queue`); the worker normalises `payload` into the envelope
 * shape from `@/lib/queue/envelope`.
 */
export async function runJobByType(
  job: {
    id: string;
    job_type: string;
    payload: unknown;
    attempts: number;
    max_attempts: number;
  },
  supabase: SupabaseClient<Database>,
): Promise<Record<string, unknown>> {
  switch (job.job_type as JobType) {
    case 'bid_draft_all': {
      // -------------------------------------------------------------
      // 1. Validate envelope shape per spec §3.1 / §7.4.
      // -------------------------------------------------------------
      const parsed = queueJobPayloadSchema.safeParse(job.payload);
      if (!parsed.success) {
        throw new PermanentJobError(
          `invalid_envelope: ${parsed.error.message}`,
        );
      }
      const payload = parsed.data as QueueJobPayload<BidDraftAllBody>;

      // -------------------------------------------------------------
      // 2. Re-validate auth context per spec §4.2 + PR-5 — required
      //    role for `bid_draft_all` is `editor` (admins satisfy via
      //    `ROLE_RANK`).
      // -------------------------------------------------------------
      const auth = await reValidateAuthContext(
        supabase,
        payload.auth_context.user_id,
        payload.auth_context.role,
        'editor',
      );
      if (!auth.ok) {
        throw new PermanentJobError(auth.reason);
      }

      // -------------------------------------------------------------
      // 3. Invoke handler with the typed body. Per-question
      //    failures are caught inside; only handler-level fatal
      //    conditions throw `PermanentJobError`.
      // -------------------------------------------------------------
      const result = await runBidDraftAllJob(
        payload.body,
        supabase,
        payload.auth_context,
      );

      // -------------------------------------------------------------
      // 4. pipeline_runs Pattern 2 finalisation (spec §6.3 +
      //    feedback_record_pipeline_run_signature). DRIFT NOTE:
      //    `recordPipelineRun()` is INSERT-only, so this case writes
      //    a direct UPDATE on the producer's pre-allocated row.
      //    Replicates Sentry alerting semantics inline.
      // -------------------------------------------------------------
      if (payload.pipeline_run_id) {
        const status: 'completed' | 'completed_with_errors' | 'failed' =
          result.failed === 0
            ? 'completed'
            : result.drafted > 0
              ? 'completed_with_errors'
              : 'failed';
        const errorMessage =
          status === 'completed'
            ? null
            : `${result.failed}/${result.total_questions} questions failed`;

        const { error: updateErr } = await supabase
          .from('pipeline_runs')
          .update({
            status,
            completed_at: new Date(Date.now()).toISOString(),
            items_processed: result.total_questions,
            items_created: result.drafted_response_ids,
            cost: result.total_cost,
            result: result as unknown as Json,
            error_message: errorMessage,
          })
          .eq('id', payload.pipeline_run_id);

        if (updateErr) {
          // Best-effort — log but don't fail the job (the
          // `processing_queue` row will still mark `completed`).
          // Replicates `recordPipelineRun`'s
          // `pipeline.record_run.insert_failed` Sentry capture.
          Sentry.captureMessage(
            `pipeline_runs UPDATE failed for ${payload.pipeline_run_id}: ${updateErr.message}`,
            {
              level: 'error',
              tags: { pipeline: 'bid_draft_all' },
              extra: {
                pipelineName: 'bid_draft_all',
                pipelineRunId: payload.pipeline_run_id,
                status,
                errorMessage,
              },
            },
          );
        } else if (status !== 'completed') {
          // Replicates `recordPipelineRun`'s status-driven Sentry
          // alerting (failed → error, completed_with_errors → warning).
          Sentry.captureMessage(
            `Pipeline bid_draft_all ${status}${
              errorMessage ? `: ${errorMessage}` : ''
            }`,
            {
              level: status === 'failed' ? 'error' : 'warning',
              tags: { pipeline: 'bid_draft_all', status },
              extra: {
                pipelineName: 'bid_draft_all',
                status,
                errorMessage,
                itemsProcessed: result.total_questions,
                workspaceId: payload.body.bid_id,
              },
            },
          );
        }
      }

      // The worker writes `result` to `processing_queue.result`. Cast
      // through `unknown` because BidDraftAllResult's typed shape is
      // a stricter subset of `Record<string, unknown>` per the dispatch
      // return contract.
      return result as unknown as Record<string, unknown>;
    }
    case 'batch_reclassify': {
      // -------------------------------------------------------------
      // 1. Validate envelope shape per spec §3.1 / §7.4.
      // -------------------------------------------------------------
      const parsed = queueJobPayloadSchema.safeParse(job.payload);
      if (!parsed.success) {
        throw new PermanentJobError(
          `invalid_envelope: ${parsed.error.message}`,
        );
      }
      const payload = parsed.data as QueueJobPayload<BatchReclassifyBody>;

      // -------------------------------------------------------------
      // 2. Re-validate auth context per spec §4.2 + PR-5.
      //    Per D-1 (ratified May 5 2026): requiredRole flipped from
      //    authored 'admin' to 'editor' for §5.4.1 symmetry.
      // -------------------------------------------------------------
      const auth = await reValidateAuthContext(
        supabase,
        payload.auth_context.user_id,
        payload.auth_context.role,
        'editor',
      );
      if (!auth.ok) {
        throw new PermanentJobError(auth.reason);
      }

      // -------------------------------------------------------------
      // 3. Invoke handler. The handler's `jobId` parameter is used for
      //    cooperative-cancel polling per D-9 — the dispatcher passes
      //    `job.id` so the handler can SELECT processing_queue.status
      //    every 10 items.
      // -------------------------------------------------------------
      const result = await runBatchReclassifyJob(
        payload.body,
        supabase,
        payload.auth_context,
        job.id,
      );

      // -------------------------------------------------------------
      // 4. pipeline_runs Pattern 2 finalisation (spec §6.3 +
      //    feedback_record_pipeline_run_signature +
      //    feedback_pipeline_runs_pattern_2_direct_update). DRIFT NOTE:
      //    `recordPipelineRun()` is INSERT-only, so this case writes
      //    a direct UPDATE on the producer's pre-allocated row.
      //
      //    Cancellation handling per D-9.1: if handler returned with
      //    `cancelled=true`, write status='completed_with_errors' with
      //    the cancellation_message as error_message.
      //
      //    R5: itemsCreated[] is truncated to first 1000 UUIDs to
      //    avoid pipeline_runs.items_created (JSONB) bloat on
      //    workspaces with thousands of items; if truncated, set
      //    `result.truncated = true` flag in JSONB.
      // -------------------------------------------------------------
      if (payload.pipeline_run_id) {
        const reclassifiedItemIds = result.results
          .filter((r) => r.status === 'reclassified')
          .map((r) => r.item_id);

        const ITEMS_CREATED_TRUNCATION_LIMIT = 1000;
        let itemsCreated = reclassifiedItemIds;
        let truncated = false;
        if (reclassifiedItemIds.length > ITEMS_CREATED_TRUNCATION_LIMIT) {
          itemsCreated = reclassifiedItemIds.slice(
            0,
            ITEMS_CREATED_TRUNCATION_LIMIT,
          );
          truncated = true;
        }

        let status: 'completed' | 'completed_with_errors' | 'failed';
        let errorMessage: string | null = null;
        if (result.cancelled) {
          status = 'completed_with_errors';
          errorMessage =
            result.cancellation_message ??
            `cancelled mid-run after ${result.results.length}/${result.total_items} items`;
        } else if (result.failed === 0) {
          status = 'completed';
        } else if (result.reclassified > 0) {
          status = 'completed_with_errors';
          errorMessage = `${result.failed}/${result.total_items} items failed`;
        } else {
          status = 'failed';
          errorMessage = `${result.failed}/${result.total_items} items failed`;
        }

        // Mutate result with truncation flag for the audit trail
        // (matches §6.3 R5 mitigation).
        const resultForJsonb: Record<string, unknown> = {
          ...(result as unknown as Record<string, unknown>),
        };
        if (truncated) {
          resultForJsonb.truncated = true;
        }

        const { error: updateErr } = await supabase
          .from('pipeline_runs')
          .update({
            status,
            completed_at: new Date(Date.now()).toISOString(),
            items_processed: result.total_items,
            items_created: itemsCreated,
            cost: result.total_cost,
            result: resultForJsonb as unknown as Json,
            error_message: errorMessage,
          })
          .eq('id', payload.pipeline_run_id);

        if (updateErr) {
          // Best-effort — log but don't fail the job (the
          // `processing_queue` row will still mark `completed`).
          // Replicates `recordPipelineRun`'s
          // `pipeline.record_run.insert_failed` Sentry capture.
          Sentry.captureMessage(
            `pipeline_runs UPDATE failed for ${payload.pipeline_run_id}: ${updateErr.message}`,
            {
              level: 'error',
              tags: { pipeline: 'batch_reclassify' },
              extra: {
                pipelineName: 'batch_reclassify',
                pipelineRunId: payload.pipeline_run_id,
                status,
                errorMessage,
              },
            },
          );
        } else if (status !== 'completed') {
          // Replicates `recordPipelineRun`'s status-driven Sentry
          // alerting (failed → error, completed_with_errors → warning).
          Sentry.captureMessage(
            `Pipeline batch_reclassify ${status}${
              errorMessage ? `: ${errorMessage}` : ''
            }`,
            {
              level: status === 'failed' ? 'error' : 'warning',
              tags: { pipeline: 'batch_reclassify', status },
              extra: {
                pipelineName: 'batch_reclassify',
                status,
                errorMessage,
                itemsProcessed: result.total_items,
                workspaceId: payload.body.workspace_id,
              },
            },
          );
        }
      }

      // The worker writes `result` to `processing_queue.result`. Cast
      // through `unknown` because BatchReclassifyResult's typed shape is
      // a stricter subset of `Record<string, unknown>`.
      return result as unknown as Record<string, unknown>;
    }
    case 'markdown_batch': {
      // -------------------------------------------------------------
      // 1. Validate envelope shape per spec §3.1 / §7.4.
      // -------------------------------------------------------------
      const parsed = queueJobPayloadSchema.safeParse(job.payload);
      if (!parsed.success) {
        throw new PermanentJobError(
          `invalid_envelope: ${parsed.error.message}`,
        );
      }
      const payload = parsed.data as QueueJobPayload<MarkdownBatchBody>;

      // -------------------------------------------------------------
      // 2. Re-validate auth context per spec §4.2 + PR-5.
      //    Per D-1 ratified default: requiredRole='editor' matches the
      //    route's existing `getAuthorisedClient(['admin','editor'])`
      //    auth gate; admins satisfy via ROLE_RANK
      //    (`lib/queue/auth.ts:25-36`).
      // -------------------------------------------------------------
      const auth = await reValidateAuthContext(
        supabase,
        payload.auth_context.user_id,
        payload.auth_context.role,
        'editor',
      );
      if (!auth.ok) {
        throw new PermanentJobError(auth.reason);
      }

      // -------------------------------------------------------------
      // 3. Invoke handler. The handler's `jobId` parameter is used for
      //    cooperative-cancel polling per D-8 (cadence=1 — check before
      //    each file). The dispatcher passes `job.id` so the handler's
      //    cancelCheck callback can SELECT processing_queue.status.
      // -------------------------------------------------------------
      const result = await runMarkdownBatchJob(
        payload.body,
        supabase,
        payload.auth_context,
        job.id,
      );

      // -------------------------------------------------------------
      // 4. NO inline pipeline_runs UPDATE — orchestrator's finaliseRun
      //    already wrote the terminal status. NO inline Sentry emission
      //    for pipeline-completion — orchestrator's finaliseRun handles
      //    it (lib/ingest/markdown-orchestrator.ts:809-836). This is
      //    the KEY DIFFERENCE from §5.4.1 + §5.4.2 dispatch cases per
      //    spec §6.3 drift note + R3.
      //
      //    Cooperative-cancel handling (D-8): the orchestrator's per-
      //    file loop already broke and finaliseRun already wrote
      //    status='completed_with_errors' with the cancellation
      //    error_message. The handler's `cancelled` flag in the result
      //    envelope is for the queue-level Sentry/PostHog telemetry
      //    that runs inside `lib/queue/telemetry.ts` (handled by the
      //    cron worker post-dispatch).
      // -------------------------------------------------------------

      // The worker writes `result` to `processing_queue.result`. Cast
      // through `unknown` because MarkdownBatchResult's typed shape is
      // a stricter subset of `Record<string, unknown>`.
      return result as unknown as Record<string, unknown>;
    }
    default:
      throw new PermanentJobError(`no_handler_registered: ${job.job_type}`);
  }
}

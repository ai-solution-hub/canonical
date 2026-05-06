/**
 * `markdown_batch` queue handler — Session 226 W1-IMPL.
 *
 * Spec: `docs/specs/§5.4.4-ep2-markdown-batch-migration-spec.md` §3.1 (body
 * interface), §4.1 (handler signature + result envelope), §4.3
 * (PermanentJobError conditions), §5.2 (continue-with-partial — inherited
 * from orchestrator), §10 D-8 (cooperative cancellation poll cadence=1),
 * §7.3 (handler module migration step).
 *
 * Source-of-truth: this handler is a thin wrapper around the existing
 * `orchestrateMarkdownBatch({ phase: 'import', ... })` from
 * `lib/ingest/markdown-orchestrator.ts`. The orchestrator already
 * implements the full Pattern E lifecycle (at-start INSERT via
 * `startPipelineRun`, mid-flight `updatePipelineProgress` writes,
 * terminal UPDATE via `finaliseRun`) so this handler does NOT touch
 * `pipeline_runs` directly. KEY DIFFERENCE from §5.4.1 + §5.4.2 dispatch
 * cases (per spec §6.3 drift note + R3): the dispatch case-clause for
 * `markdown_batch` does NOT do an inline `pipeline_runs.update` — the
 * orchestrator's `finaliseRun` already wrote terminal status.
 *
 * Cooperative cancellation (per spec §10 D-8 ratified flip from authored
 * hard-409 default):
 *   "Cooperative cancellation between files (mirror §5.4.2 D-9). The
 *    orchestrator's per-file loop polls `processing_queue.status` for the
 *    current `job_id` between each file iteration; on `status='cancelled'`
 *    it stops the loop, finalises pipeline_runs with
 *    `'completed_with_errors'` + `error_message='cancelled mid-batch
 *    after N/M files'`, returns. … cadence=1 because typical batches are
 *    1-3 files; every-10 cadence would defeat the purpose."
 *
 * Per spec §10 D-8: the poll cadence is 1 (check before EVERY file). The
 * handler wires a `cancelCheck` callback into the orchestrator's
 * per-file loop seam (added S226 to `MarkdownBatchOptions.cancelCheck`)
 * that SELECTs `processing_queue.status` for the current `job_id` via
 * an internal service-role client (per
 * `feedback_pipeline_runs_rls_chokepoint`).
 *
 * Permanent-error contract (per spec §4.3 + §10 D-1):
 *   - `body.files` empty or missing → `PermanentJobError('files_empty')`
 *   - `body.pipeline_run_id` missing → `PermanentJobError('pipeline_run_id_missing')`
 *   - `body.caller_user_id` missing → `PermanentJobError('caller_user_id_missing')`
 *   - All-files-fail (orchestrator returns `status='failed'`) → handler
 *     surfaces the partial envelope; the dispatch case sees the empty
 *     `stored[]` and finalises pipeline_runs as 'failed' (orchestrator
 *     already does this internally — handler just returns).
 *
 * Per-file failures are NOT permanent at the job level (per spec §5.2 +
 * orchestrator `computeRunStatus` at L698-708). They are caught inside
 * the orchestrator's per-file loop and recorded in
 * `result.results_summary.errored[]`; the orchestrator continues to the
 * next file (continue-with-partial).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  orchestrateMarkdownBatch,
  type MarkdownIngestFile,
} from '@/lib/ingest/markdown-orchestrator';
import type {
  MarkdownBatchResultsSummary,
  MarkdownPerFileOverride,
} from '@/types/ingest';
import { PermanentJobError } from '@/lib/queue/dispatch';
import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Types — verbatim from spec §3.1 (MarkdownBatchBody) + §4.1
// (MarkdownBatchResult), per `feedback_brief_quote_spec_verbatim`.
// ---------------------------------------------------------------------------

/**
 * Body of a `markdown_batch` job, stored at
 * `processing_queue.payload.body` per the envelope contract in
 * `docs/specs/background-queue-infra-spec.md` §3.1.
 *
 * Mirrors the existing route handler's input payload after multipart
 * decode — the route turns multipart File objects into UTF-8 strings
 * (per `decodeUtf8` at `app/api/ingest/markdown/route.ts:80-88`)
 * BEFORE enqueueing, because the queue payload is JSONB and cannot
 * carry binary File objects. The decode happens in the producer; the
 * handler receives the strings already-decoded.
 *
 * The `files` array carries the FULL UTF-8 content per file. For 10
 * files × 1 MB = 10 MB of payload — well within
 * processing_queue.payload JSONB practical limits.
 */
export interface MarkdownBatchBody extends Record<string, unknown> {
  /** Decoded files. Each file has filename + UTF-8 content + sizeBytes
   *  (matches `MarkdownIngestFile` from `@/types/ingest`). */
  files: Array<{
    filename: string;
    content: string;
    sizeBytes: number;
  }>;
  /** Pre-allocated pipeline_runs row UUID (Pattern E + Pattern 2). */
  pipeline_run_id: string;
  /** Caller user UUID (carried separately from `auth_context.user_id`
   *  for explicit pass-through to `orchestrateMarkdownBatch.callerUserId`). */
  caller_user_id: string;
  /** Caller role at enqueue time. `'admin' | 'editor'` only (route
   *  refuses viewers at gate). */
  caller_role: 'admin' | 'editor';
  /** Optional batch-wide options. Mirrors `BatchWideOptions` from
   *  `lib/ingest/markdown-batch-schema.ts:36-45`. */
  batch?: {
    auto_supersede?: boolean;
    tag?: string;
    author?: string;
  };
  /** Optional per-file overrides. Mirrors `PerFileOverrideSchema` from
   *  `lib/ingest/markdown-batch-schema.ts:22-33`. */
  per_file_overrides?: Array<{
    filename: string;
    excluded?: boolean;
    draft_or_final?: 'draft' | 'final';
    skip_dedup?: boolean;
  }>;
}

/**
 * Result envelope returned by the handler. The worker writes this to
 * `processing_queue.result`. `pipeline_runs.result` is written separately
 * by the orchestrator's `finaliseRun` (per spec §6.3 drift note —
 * orchestrator already does the terminal UPDATE; the dispatch case-clause
 * for markdown_batch does NOT replicate it).
 *
 * Mirrors the orchestrator's existing `MarkdownImportPhaseResult` shape
 * from `@/types/ingest` plus optional cancellation flags surfaced when
 * the cooperative-cancel poll fired.
 */
export interface MarkdownBatchResult extends Record<string, unknown> {
  /** UUID of the pipeline_runs row the orchestrator finalised. Same
   *  value as body.pipeline_run_id (Pattern 2 caller-allocated). */
  pipeline_run_id: string;
  /** Per-file outcome aggregations (matches `MarkdownBatchResultsSummary`
   *  from `@/types/ingest`). */
  results_summary: MarkdownBatchResultsSummary;
  /** True if the run was cancelled mid-flight via cooperative cancel
   *  (per spec D-8). The orchestrator finalises pipeline_runs with
   *  status='completed_with_errors' + a cancellation error_message; the
   *  dispatch case-clause inspects this flag for telemetry purposes
   *  (Sentry, PostHog) but does NOT need to write pipeline_runs again
   *  (orchestrator already covers it). */
  cancelled?: boolean;
  /** When `cancelled=true`: human-readable summary like
   *  "cancelled mid-batch after 2/5 files". */
  cancellation_message?: string;
}

/**
 * Auth context the dispatcher passes through to the handler. Mirrors
 * `QueueJobPayload<TBody>['auth_context']` from `lib/queue/envelope.ts`.
 */
export interface MarkdownBatchAuthContext {
  user_id: string;
  role: 'admin' | 'editor' | 'viewer';
  workspace_id?: string;
}

/**
 * Polls `processing_queue` for the current job's status using an internal
 * service-role client (per `feedback_pipeline_runs_rls_chokepoint`).
 * Returns true when the row's status is `'cancelled'`, indicating the
 * operator has requested mid-flight cancellation.
 *
 * Best-effort: if the SELECT errors, returns false (the next poll-tick
 * re-checks). Per spec D-8: race-safe via the cancel-route's
 * `.in('status', [...])` filter on the UPDATE plus a final guard in the
 * handler. Mirrors the `isJobCancelled` helper in
 * `lib/queue/handlers/batch-reclassify.ts` (same pattern).
 */
async function isJobCancelled(jobId: string | undefined): Promise<boolean> {
  if (!jobId) return false;
  try {
    const serviceClient = createServiceClient();
    const { data, error } = await serviceClient
      .from('processing_queue')
      .select('status')
      .eq('id', jobId)
      .maybeSingle();
    if (error || !data) return false;
    return data.status === 'cancelled';
  } catch {
    return false;
  }
}

/**
 * Handler entry point. Pure async function — no Next.js Request/Response,
 * no auth lookups (the dispatcher has already re-validated auth context per
 * spec §4.2 PR-5 before calling).
 *
 * @param body Job-type body — see `MarkdownBatchBody`.
 * @param supabase Service-role Supabase client (RLS-bypassing).
 * @param authContext Dispatcher-provided auth context. Currently unused
 *   inside the handler body (orchestrator uses `body.caller_user_id`
 *   verbatim; the parameter is preserved for parity with sibling
 *   handlers + forward-compat).
 * @param jobId Optional `processing_queue.id` for cooperative-cancel
 *   polling (cadence=1 per spec §10 D-8). Tests may omit.
 */
export async function runMarkdownBatchJob(
  body: MarkdownBatchBody,
  supabase: SupabaseClient<Database>,
  authContext: MarkdownBatchAuthContext,
  jobId?: string,
): Promise<MarkdownBatchResult> {
  // ------------------------------------------------------------------
  // 1. Envelope-level fatal validations per spec §4.3.
  // ------------------------------------------------------------------
  if (!Array.isArray(body.files) || body.files.length === 0) {
    throw new PermanentJobError('files_empty');
  }
  if (!body.pipeline_run_id || body.pipeline_run_id.length === 0) {
    throw new PermanentJobError('pipeline_run_id_missing');
  }
  if (!body.caller_user_id || body.caller_user_id.length === 0) {
    throw new PermanentJobError('caller_user_id_missing');
  }
  // Per spec §4.3 line 783-784 — defence against payload tampering. The
  // `enqueueQueueJob` path always sets both fields from the same
  // `auth.user.id`, so this guard only fires on a hand-crafted envelope
  // that bypasses the producer.
  if (body.caller_user_id !== authContext.user_id) {
    throw new PermanentJobError('caller_user_id_mismatch');
  }
  if (body.caller_role !== 'admin' && body.caller_role !== 'editor') {
    throw new PermanentJobError(
      `caller_role_invalid: ${String(body.caller_role)}`,
    );
  }

  // ------------------------------------------------------------------
  // 2. Map body shape → MarkdownImportPhaseParams. The orchestrator
  //    consumes its existing camelCase shape; we translate snake_case
  //    body fields verbatim per spec §4.4.
  // ------------------------------------------------------------------
  const files: MarkdownIngestFile[] = body.files.map((f) => ({
    filename: f.filename,
    content: f.content,
    sizeBytes: f.sizeBytes,
  }));

  const perFileOverrides: MarkdownPerFileOverride[] | undefined =
    body.per_file_overrides?.map((o) => ({
      filename: o.filename,
      excluded: o.excluded,
      draftOrFinal: o.draft_or_final,
      skipDedup: o.skip_dedup,
    }));

  // ------------------------------------------------------------------
  // 3. Invoke orchestrator with cancelCheck wired to processing_queue
  //    poll. Per spec §10 D-8 ratified verbatim:
  //      "cooperative-cancel poll BEFORE each file (cadence=1) because
  //       typical batch is 1-3 files; every-10 cadence would defeat
  //       the purpose."
  //    The orchestrator's per-file loop calls `cancelCheck()` BEFORE
  //    each file iteration; on `true` the loop breaks and the partial
  //    outcome is finalised by `finaliseRun` as
  //    `'completed_with_errors'` with `error_message='cancelled
  //    mid-batch after N/M files'`. Pattern E mid-flight progress
  //    writes are preserved for files BEFORE the cancel-tick (D-10
  //    RATIFIED MANDATORY).
  // ------------------------------------------------------------------
  const result = await orchestrateMarkdownBatch({
    phase: 'import',
    files,
    supabase,
    callerUserId: body.caller_user_id,
    callerRole: body.caller_role,
    options: {
      perFileOverrides,
      tag: body.batch?.tag ?? null,
      author: body.batch?.author ?? null,
      autoSupersede: body.batch?.auto_supersede,
      // Critical Pattern E preservation — orchestrator's at-start INSERT
      // adopts this UUID via the §7.7 idempotent UPSERT (Path B per D-11).
      pipelineRunIdOverride: body.pipeline_run_id,
      // Cooperative-cancel poll. cadence=1 per spec §10 D-8.
      cancelCheck: () => isJobCancelled(jobId),
    },
  });

  // ------------------------------------------------------------------
  // 4. Detect cancellation by inspecting orchestrator's terminal output.
  //    The orchestrator records the partial outcome in
  //    `result.results_summary` and writes pipeline_runs as
  //    'completed_with_errors' when cancelled. We surface the
  //    cancellation flag in the handler's result envelope for the
  //    dispatcher's telemetry (PostHog `queue_job_cancelled` event,
  //    Sentry tags). The orchestrator already wrote pipeline_runs;
  //    the dispatcher does NOT need to UPDATE again.
  //
  //    Cancellation is detected by `processing_queue.status='cancelled'`
  //    on a final poll — the orchestrator only stops the loop when
  //    cancelCheck returned true, but doesn't expose that signal in
  //    its result. We re-poll ONCE post-orchestrator to set the flag
  //    correctly (idempotent — if not cancelled, returns false and we
  //    skip).
  // ------------------------------------------------------------------
  const cancelled = await isJobCancelled(jobId);

  const handlerResult: MarkdownBatchResult = {
    pipeline_run_id: result.pipeline_run_id,
    results_summary: result.results_summary,
  };

  if (cancelled) {
    const filesProcessed = result.results_summary.files_processed;
    const filesTotal = body.files.length;
    handlerResult.cancelled = true;
    handlerResult.cancellation_message = `cancelled mid-batch after ${filesProcessed}/${filesTotal} files`;
  }

  return handlerResult;
}

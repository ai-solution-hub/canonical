// lib/pipeline/record-run.ts
//
// S152B WP4: checked `pipeline_runs` insertion helper with Sentry alerting.
//
// Closes Liam's Q-10 decision and roadmap §1.7: "the only users currently
// working on the platform are Liam and Claude — `pipeline_runs` is not
// monitored by anyone." Before launch every cron handler needs to surface
// its status through at least one alerting channel, and the failed-run
// detection must not depend on anyone actively checking the table.
//
// Side effect: closes Q-36 library-smell #1 (cron handlers were inserting
// `pipeline_runs` rows with `await supabase.from(...).insert(...)` and
// discarding the error, so DB-level insertion failures also went silent).
// The helper uses `sb()` from `@/lib/supabase/safe` so insertion failures
// now throw a `SupabaseError` that is then funnelled to
// `logBestEffortWarn` + `Sentry.captureMessage` so every failure mode
// (DB insert failed, pipeline status is `failed`, pipeline status is
// `completed_with_errors`) surfaces to the one place Liam will actually
// see it — Sentry.

import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sb, SupabaseError } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import type { Database, Json } from '@/supabase/types/database.types';

/**
 * Status value for a `pipeline_runs.status` column.
 *
 * - `completed` — the pipeline finished without any failures. No alert.
 * - `completed_with_errors` — the pipeline finished but some sub-tasks
 *   failed (e.g. one feed out of ten, one template out of fifty).
 *   Alerts as a Sentry warning so we see the degradation but not as an
 *   emergency.
 * - `failed` — the pipeline did not complete at all. Alerts as a Sentry
 *   error. These should be rare and must be actioned.
 */
export type PipelineRunStatus =
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

export interface RecordPipelineRunParams {
  /** The Supabase client the caller already has (usually from `getAuthorisedClient`). */
  supabase: SupabaseClient<Database>;
  /**
   * Pipeline identifier — lowercase snake_case, matches the existing
   * `pipeline_runs.pipeline_name` values (`content_gaps`,
   * `freshness_transitions`, `quality_score`, `classification_quality`,
   * `coverage_alert`, `provenance_audit_pdf`, etc.). Used as the Sentry
   * fingerprint so repeated failures of the same pipeline group in the
   * Sentry UI.
   */
  pipelineName: string;
  status: PipelineRunStatus;
  /** Total items the pipeline looked at. Optional. */
  itemsProcessed?: number | null;
  /** IDs of items the pipeline created, if applicable. Optional. */
  itemsCreated?: string[] | null;
  /** Workspace scope, if applicable. Optional. */
  workspaceId?: string | null;
  /** Source file, if applicable. Optional (mainly for ingestion). */
  sourceFilename?: string | null;
  /** Run cost, if measured. Optional. */
  cost?: number | null;
  /** Progress JSON for in-progress runs. Optional. */
  progress?: Json | null;
  /** Arbitrary structured result payload. Optional. */
  result?: Json | null;
  /**
   * Human-readable error message. Set when status is `failed` or
   * `completed_with_errors`; included in the Sentry message body and
   * stored on the row for audit.
   */
  errorMessage?: string | null;
  /**
   * Opt-out of Sentry alerting. Use sparingly — tests and bulk
   * backfills may legitimately want to avoid alerting. When `true`,
   * only the DB insertion + logBestEffortWarn on failure paths fire;
   * no `Sentry.captureMessage` is emitted.
   */
  skipSentryAlert?: boolean;
}

/**
 * Insert a `pipeline_runs` row with checked error handling and
 * automatic Sentry alerting when the run is not successful.
 *
 * **Never throws.** All failure modes are captured and reported; the
 * caller does not need to wrap this in a try/catch. This is the single
 * point of instrumentation for cron handlers — calling it means the
 * cron has done its observability duty regardless of what happens next.
 *
 * **Sentry alerting contract:**
 *
 * - `status === 'failed'` → `Sentry.captureMessage(..., 'error')`.
 *   Triggers the default Sentry email alert (assuming the DSN is
 *   configured — see roadmap §1.2).
 * - `status === 'completed_with_errors'` → `Sentry.captureMessage(..., 'warning')`.
 *   Warnings still appear in Sentry but do not fire the default email
 *   alert; they are meant for the weekly review rather than immediate
 *   action.
 * - `status === 'completed'` → no Sentry emission (healthy path).
 * - DB insertion itself fails → `logBestEffortWarn` + Sentry error
 *   capture under the `pipeline.record_run` category. This covers the
 *   Q-36 library smell: the previous `await supabase.from(...).insert`
 *   pattern silently dropped insertion failures.
 *
 * If the Sentry DSN is not configured, `Sentry.captureMessage` is a
 * no-op, so this helper is safe to call pre-launch (before roadmap
 * §1.2 lands).
 *
 * @example
 *   await recordPipelineRun({
 *     supabase,
 *     pipelineName: 'content_gaps',
 *     status: failedTemplates.length > 0
 *       ? 'completed_with_errors'
 *       : 'completed',
 *     itemsProcessed: totalRequirements,
 *     errorMessage: failedTemplates.length > 0
 *       ? `${failedTemplates.length} templates failed`
 *       : null,
 *     result: { snapshots, notifications_created: n },
 *   });
 */
export async function recordPipelineRun(
  params: RecordPipelineRunParams,
): Promise<void> {
  const {
    supabase,
    pipelineName,
    status,
    itemsProcessed,
    itemsCreated,
    workspaceId,
    sourceFilename,
    cost,
    progress,
    result,
    errorMessage,
    skipSentryAlert = false,
  } = params;

  // Insert the row via `sb()` so any insertion failure throws a
  // SupabaseError. Catch the throw here — this helper is never-throws by
  // contract — and report it through logBestEffortWarn + Sentry.
  try {
    await sb(
      supabase.from('pipeline_runs').insert({
        pipeline_name: pipelineName,
        status,
        completed_at: new Date().toISOString(),
        items_processed: itemsProcessed ?? null,
        items_created: itemsCreated ?? null,
        workspace_id: workspaceId ?? null,
        source_filename: sourceFilename ?? null,
        cost: cost ?? null,
        progress: progress ?? null,
        result: result ?? null,
        error_message: errorMessage ?? null,
      }),
      'pipeline.record_run.insert',
    );
  } catch (err) {
    const message =
      err instanceof SupabaseError
        ? `${err.message}${err.code ? ` [${err.code}]` : ''}`
        : err instanceof Error
          ? err.message
          : String(err);

    logBestEffortWarn(
      'pipeline.record_run.insert_failed',
      `Failed to insert pipeline_runs row for ${pipelineName}`,
      { pipelineName, status, errorMessage, dbError: message },
    );

    if (!skipSentryAlert) {
      Sentry.captureMessage(
        `pipeline_runs insert failed for ${pipelineName}: ${message}`,
        { level: 'error', extra: { pipelineName, status, errorMessage } },
      );
    }

    // Do NOT rethrow — the cron handler has already done its real work;
    // a failed audit-trail insert should not take the cron handler down
    // with it. The alert + breadcrumb is the escalation.
    return;
  }

  // Insert succeeded. If the run itself reported a problem, alert.
  if (skipSentryAlert) return;
  if (status === 'completed') return;

  const level: 'error' | 'warning' =
    status === 'failed' ? 'error' : 'warning';
  Sentry.captureMessage(
    `Pipeline ${pipelineName} ${status}${errorMessage ? `: ${errorMessage}` : ''}`,
    {
      level,
      tags: { pipeline: pipelineName, status },
      extra: {
        pipelineName,
        status,
        errorMessage,
        itemsProcessed,
        workspaceId,
      },
    },
  );
}

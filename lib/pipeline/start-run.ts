// lib/pipeline/start-run.ts
//
// At-start INSERT helper for the Pattern E pipeline_runs lifecycle.
// Returns the new row's id so the route handler / orchestrator can
// surface it to the client BEFORE the import completes (Pattern E
// requires polling against this id mid-flight).
//
// Companion to:
//   - lib/pipeline/update-progress.ts (mid-flight UPDATEs — silent-catch)
//   - lib/pipeline/record-run.ts      (terminal-only INSERT for cron
//                                      handlers that don't need mid-flight
//                                      progress — never-throws by contract)
//
// Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §7.2 Pattern E.
// Plan: docs/plans/§1.11-ep2-build-plan.md EP2-T6 (e).
//
// Why a new helper rather than reusing `recordPipelineRun()`:
//
//   - `recordPipelineRun()` writes `completed_at` baked-in (line 153 in
//     `lib/pipeline/record-run.ts`) — it is terminal-only.
//   - `recordPipelineRun()` does not return the inserted row's id, but
//     Pattern E requires the caller to surface the id to the client for
//     parallel polling.
//   - `recordPipelineRun()` is never-throws (silent-success on insert
//     failure). At-start failure is FATAL for Pattern E: no row → no
//     polling visibility → no audit trail. We need fail-fast.
//
// CLAUDE.md gotcha G6 ("Cron pipeline_runs inserts: use recordPipelineRun")
// applies to CRON handlers. Pattern E request-response handlers use this
// helper instead — see roadmap §5.2 Phase 4 + memory
// `feedback_record_pipeline_run_signature`.

import { createServiceClient } from '@/lib/supabase/server';
import type { Json } from '@/supabase/types/database.types';
import * as Sentry from '@sentry/nextjs';

/** @public */
export interface StartPipelineRunParams {
  /**
   * Optional pre-generated UUID. When provided, the server adopts it as
   * the row's id (Pattern E client-UUID flow — UI generates the id BEFORE
   * firing the mutation so polling can begin immediately). When absent,
   * Postgres generates one via the column default and we read it back.
   */
  id?: string;
  /** Pipeline name (e.g. 'upload_markdown_batch', 'file_upload'). */
  pipelineName: string;
  /**
   * User id for `created_by` — gates polling visibility via the
   * `GET /api/pipeline-runs/:id` route's `eq('created_by', user.id)` filter
   * for non-admin callers (mirrors the list endpoint at
   * `app/api/pipeline-runs/route.ts:46`).
   */
  createdBy: string;
  /** Optional source filename for single-file pipelines (EP3). */
  sourceFilename?: string | null;
  /**
   * Initial progress JSONB shape. Free-form by convention. EP3 uses
   * `{ step, steps_completed, steps_total, detail }`; EP2 uses
   * `{ step, files_completed, files_total, detail }`.
   */
  progress: {
    step: string;
    steps_completed?: number;
    steps_total?: number;
    files_completed?: number;
    files_total?: number;
    detail: string;
    [key: string]: Json | undefined;
  };
}

/**
 * INSERT a new `pipeline_runs` row with status='running' and a starting
 * progress JSONB. Returns the row's id so callers can surface it to
 * clients for parallel polling (Pattern E).
 *
 * **Throws on insert failure.** At-start failure is fatal — no row → no
 * polling visibility → no audit trail. The mid-flight UPDATEs in
 * `updatePipelineProgress()` are silent-catch; this one is not.
 *
 * @example
 *   const pipelineRunId = await startPipelineRun({
 *     id: clientGeneratedUuid,            // Pattern E adopt
 *     pipelineName: 'upload_markdown_batch',
 *     createdBy: callerUserId,
 *     progress: {
 *       step: 'starting',
 *       files_completed: 0,
 *       files_total: files.length,
 *       detail: 'Beginning batch import…',
 *     },
 *   });
 */
export async function startPipelineRun(
  params: StartPipelineRunParams,
): Promise<string> {
  const { id, pipelineName, createdBy, sourceFilename, progress } = params;
  const serviceClient = createServiceClient();

  const insertPayload = {
    pipeline_name: pipelineName,
    status: 'running' as const,
    started_at: new Date().toISOString(),
    items_created: [] as string[],
    created_by: createdBy,
    source_filename: sourceFilename ?? null,
    progress: progress as unknown as Json,
    ...(id ? { id } : {}),
  };

  const { data, error } = await serviceClient
    .from('pipeline_runs')
    .insert(insertPayload)
    .select('id')
    .single();

  if (error || !data) {
    Sentry.captureMessage(`startPipelineRun failed for ${pipelineName}`, {
      level: 'error',
      extra: { pipelineName, error: error?.message ?? 'unknown' },
    });
    throw new Error(
      `Failed to start pipeline_run for ${pipelineName}: ${
        error?.message ?? 'unknown'
      }`,
    );
  }

  return data.id;
}

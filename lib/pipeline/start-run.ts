// lib/pipeline/start-run.ts
//
// At-start INSERT (now UPSERT) helper for the Pattern E pipeline_runs
// lifecycle. Returns the row's id so the route handler / orchestrator
// can surface it to the client BEFORE the import completes (Pattern E
// requires polling against this id mid-flight).
//
// Companion to:
//   - lib/pipeline/update-progress.ts (mid-flight UPDATEs — silent-catch)
//   - lib/pipeline/record-run.ts      (terminal-only INSERT for cron
//                                      handlers that don't need mid-flight
//                                      progress — never-throws by contract)
//
// Spec sources:
//   - docs/specs/ep2-markdown-ui-ingest-spec.md §7.2 Pattern E.
//   - docs/specs/§5.4.4-ep2-markdown-batch-migration-spec.md §7.7 +
//     §10 D-11 (Path B ratified — UPSERT with ignoreDuplicates so the
//     orchestrator's at-start INSERT does not collide with a producer
//     pre-INSERT under Pattern 2).
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

  // Date.now() symmetry per `feedback_date_now_constructor_testability` —
  // `vi.spyOn(Date, 'now')` cannot stub the bare `Date` constructor; using
  // `new Date(Date.now())` lets tests pin the ISO timestamp. Paired
  // alignment with the §5.4.4 Pattern 2 producer pre-INSERT (the
  // route handler also uses `new Date(Date.now()).toISOString()`).
  const insertPayload = {
    pipeline_name: pipelineName,
    status: 'running' as const,
    started_at: new Date(Date.now()).toISOString(),
    items_created: [] as string[],
    created_by: createdBy,
    source_filename: sourceFilename ?? null,
    progress: progress as unknown as Json,
    ...(id ? { id } : {}),
  };

  // Path B per §5.4.4 §10 D-11 RATIFIED: switch from `.insert(...)` to
  // `.upsert(..., { onConflict: 'id', ignoreDuplicates: true })` so a
  // producer pre-INSERT (Pattern 2 caller-allocated UUID) does not
  // collide with the orchestrator's at-start INSERT inside the worker.
  //
  // ignoreDuplicates compiles to PostgreSQL `ON CONFLICT (id) DO NOTHING`,
  // which (a) does NOT overwrite the producer's pre-existing row (the
  // worker MUST NOT clobber the caller-allocated row's status/progress),
  // and (b) does NOT include the conflicting row in RETURNING — so the
  // upsert response is empty when the row already exists. We therefore
  // use `.select('id')` WITHOUT `.single()` and inspect the array; on
  // empty (conflict-skipped) we trust the `id` we passed in (we only
  // get here when a conflict on the caller-supplied UUID happened, so
  // the row exists with that id by construction).
  //
  // SAFETY: this only changes behaviour when `id` is supplied AND
  // already exists. Non-Pattern-2 callers (sync route pre-§5.4.4 + EP3
  // file-upload + cron jobs) supply `id` but the row doesn't exist yet —
  // upsert behaves like insert and returns the new row. Net behaviour
  // change is zero for non-queued callers.
  const { data, error } = await serviceClient
    .from('pipeline_runs')
    .upsert(insertPayload, { onConflict: 'id', ignoreDuplicates: true })
    .select('id');

  if (error) {
    Sentry.captureMessage(`startPipelineRun failed for ${pipelineName}`, {
      level: 'error',
      extra: { pipelineName, error: error.message },
    });
    throw new Error(
      `Failed to start pipeline_run for ${pipelineName}: ${error.message}`,
    );
  }

  // Empty array = conflict on the caller-supplied id (DO NOTHING path).
  // The pre-existing row was created by the producer (Pattern 2); return
  // the same id so subsequent UPDATEs target the correct row.
  if (data && data.length > 0) {
    return data[0].id;
  }
  if (id) {
    return id;
  }

  // No conflict-skip AND no caller-supplied id AND no returned row —
  // unexpected. Treat as fatal (the row was supposed to be inserted).
  Sentry.captureMessage(
    `startPipelineRun returned empty result for ${pipelineName}`,
    {
      level: 'error',
      extra: { pipelineName, providedId: id },
    },
  );
  throw new Error(
    `Failed to start pipeline_run for ${pipelineName}: empty result without conflict`,
  );
}

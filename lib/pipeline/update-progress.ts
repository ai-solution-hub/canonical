// lib/pipeline/update-progress.ts
//
// Mid-flight pipeline_runs progress UPDATE helper. Extracted from
// `app/api/upload/route.ts:142-164` (EP3 file_upload pipeline) so EP2's
// markdown-batch orchestrator can write the same shape against the same
// row column without duplicating the silent-catch / service-client wiring.
//
// Companion to:
//   - lib/pipeline/start-run.ts   (at-start INSERT — Pattern E §7.2)
//   - lib/pipeline/record-run.ts  (terminal-only INSERT for cron handlers
//                                  that don't need mid-flight progress)
//
// Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §7.2 Pattern E.
// Plan: docs/plans/§1.11-ep2-build-plan.md EP2-T6 (e).
//
// Behaviour notes (preserved verbatim from the EP3 inline implementation):
//
// - Uses `createServiceClient()` to bypass RLS — system pipeline writes
//   are not user-scoped (the originating route handler has already
//   authorised the caller before calling startPipelineRun).
//
// - SILENT-CATCH on failure. Mid-flight progress UPDATEs are observability,
//   not correctness — a transient DB blip while the import worker is
//   running must NOT fail the import. The at-start INSERT
//   (`startPipelineRun`) is the fail-fast surface; the terminal UPDATE
//   in the orchestrator is also fail-fast (audit trail). This helper
//   is the only one in the lifecycle that swallows.
//
// - `progress` JSONB column is free-form. EP3 writes
//   `{ step, steps_completed, steps_total, detail }`. EP2 writes
//   `{ step, files_completed, files_total, detail }`. The shape on this
//   helper accepts both via the union — callers pass whichever fits
//   their pipeline.
//
// - `extraFields` lets a caller stamp adjacent columns in the same
//   UPDATE (e.g. `status='failed'` + `error_message` on the failure
//   path of the EP3 route — see app/api/upload/route.ts:362-374). Not
//   used by the EP2 orchestrator's mid-flight loop, but preserved
//   here so the EP3 callers can swap their inline copy for this import
//   without behaviour drift.

import { logger } from '@/lib/logger';
import { createServiceClient } from '@/lib/supabase/server';
import type { Json } from '@/supabase/types/database.types';

/** @public */
export interface PipelineProgressUpdate {
  /** Current step name — free-form, conventional values in §7.2. */
  step: string;
  /** Total/completed counter — EP3 uses steps_*, EP2 uses files_*. */
  steps_completed?: number;
  steps_total?: number;
  files_completed?: number;
  files_total?: number;
  /** Human-readable detail line surfaced to the polling UI. */
  detail: string;
}

/**
 * UPDATE the `pipeline_runs.progress` JSONB (and optional adjacent
 * columns) for an in-flight pipeline run. Silently catches errors so
 * mid-flight observability never blocks the worker.
 *
 * Use-cases:
 *   - Mid-flight loop step boundaries in `app/api/upload/route.ts`
 *     (EP3 file_upload pipeline).
 *   - Per-file boundaries in any batch producer that pre-allocates a
 *     pipeline_runs row and reports incremental progress.
 *
 * Do NOT use for at-start INSERT — see `startPipelineRun()`.
 * Do NOT use for terminal UPDATE — orchestrators write the final
 * row directly with `sb()` so insert failures surface to Sentry.
 */
export async function updatePipelineProgress(
  pipelineRunId: string,
  update: PipelineProgressUpdate,
  extraFields?: Record<string, unknown>,
): Promise<void> {
  try {
    const serviceClient = createServiceClient();
    await serviceClient
      .from('pipeline_runs')
      .update({
        progress: update as unknown as Json,
        ...extraFields,
      })
      .eq('id', pipelineRunId);
  } catch (err) {
    // Silent-catch is INTENTIONAL — see file header. The helper is
    // server-only (transitively imports `next/headers` via
    // `createServiceClient`), so structured logging via `@/lib/logger`
    // is safe here: no client bundle pulls this in.
    logger.error(
      { err, op: 'pipeline.update_progress' },
      'Failed to update pipeline progress',
    );
  }
}

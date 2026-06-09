-- bl-271 — backfill pipeline_runs.ended_at for historical terminal runs.
--
-- Context: pipeline_runs.ended_at was added by mig 20260530121355 as a nullable
-- timestamptz but never had a writer — recordPipelineRun only ever wrote
-- completed_at. The companion code change (lib/pipeline/record-run.ts) now stamps
-- ended_at on every terminal-status insert going forward. This migration backfills
-- the historical rows so observability queries over ended_at see a complete series.
--
-- Backfill rule: for any already-terminal run that pre-dates the writer, ended_at
-- is best-approximated by completed_at (the row's insert instant — which, for a
-- terminal status, coincides with the run finishing). In-progress rows are left
-- NULL (they had not finished). Idempotent via the `ended_at IS NULL` guard.
--
-- Scope: STAGING push only (this branch is the canonical-pipeline-setup track).
-- Production rides the Liam-gated cutover, NOT this push.

UPDATE public.pipeline_runs
SET ended_at = completed_at
WHERE status IN ('completed', 'completed_with_errors', 'failed', 'cancelled')
  AND ended_at IS NULL;

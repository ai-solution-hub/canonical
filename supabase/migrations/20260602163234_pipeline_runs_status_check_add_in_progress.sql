-- pipeline_runs.status CHECK — add 'in_progress' (S299 run-tracking fix)
--
-- BUG (S299): the cocoindex pipeline write path emits status='in_progress'
-- at flow start (scripts/cocoindex_pipeline/flow.py:2033 →
-- /api/internal/pipeline-runs/record → lib/pipeline/record-run.ts INSERT),
-- but the live CHECK constraint omitted 'in_progress':
--
--   CHECK (status = ANY (ARRAY['running','completed','completed_with_errors','failed']))
--
-- Every flow-start INSERT was therefore rejected by Postgres and swallowed
-- by recordPipelineRun's never-throws guard (Sentry breadcrumb only, no row
-- landed). Live staging confirmed ZERO 'in_progress' rows despite the
-- pipeline emitting them. Run-tracking for the canonical pipeline was broken.
--
-- ROOT CAUSE: the entire codebase already standardises on 'in_progress' for
-- the cocoindex in-flight state — the Python `PipelineRunStatus` Literal
-- (flow.py:504-509), the TS `PipelineRunStatus` type (record-run.ts:41-45),
-- and the route Zod schema (route.ts:58-63). The DB constraint was the sole
-- outlier. This widens the constraint to match the code (least-blast-radius
-- fix; the running staging image already emits 'in_progress', so NO image
-- rebuild is required).
--
-- 'running' is RETAINED: a separate subsystem (lib/pipeline/start-run.ts,
-- lib/ingest/markdown-orchestrator.ts, the taxonomy-sync stale-row sweep, and
-- the upload-tab UI poller) legitimately writes/reads 'running' for the
-- markdown-batch in-flight state (67 live rows). 'running' and 'in_progress'
-- are distinct in-flight states belonging to two different producers — they
-- are NOT merged.
--
-- No functions are introduced → no `SET search_path` clause needed.
-- Idempotent: DROP IF EXISTS before ADD.

ALTER TABLE public.pipeline_runs
  DROP CONSTRAINT IF EXISTS pipeline_runs_status_check;

ALTER TABLE public.pipeline_runs
  ADD CONSTRAINT pipeline_runs_status_check
    CHECK (status = ANY (ARRAY[
      'running',
      'in_progress',
      'completed',
      'completed_with_errors',
      'failed'
    ]));

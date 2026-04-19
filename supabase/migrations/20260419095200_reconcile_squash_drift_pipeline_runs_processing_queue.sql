-- Reconcile post-squash schema drift (S180 follow-up to S176).
--
-- The S176 migration squash diverged from the old-production schema in two
-- tables. The deployed code (TypeScript on Vercel) currently targets the old
-- project and references the old names; renaming code to match the squashed
-- schema would break production. Reconcile NEW to match OLD so the same code
-- works on both until cutover.
--
-- Pre-flight: both tables empty on the new project — no data migration needed.
--
-- Drift map (from `information_schema.columns` diff 2026-04-19):
--
--   pipeline_runs
--     OLD: error_message TEXT         NEW: error_log JSONB         → rename + type
--     (NEW also has benign extras items_skipped, items_updated — leave in place)
--
--   processing_queue
--     OLD: job_type VARCHAR           NEW: task_type TEXT          → rename
--     OLD: updated_at TIMESTAMPTZ     NEW: (missing)               → add

-- pipeline_runs.error_log → error_message TEXT
ALTER TABLE public.pipeline_runs RENAME COLUMN error_log TO error_message;
ALTER TABLE public.pipeline_runs
  ALTER COLUMN error_message TYPE text
  USING CASE
    WHEN error_message IS NULL THEN NULL
    WHEN jsonb_typeof(error_message) = 'object'
      AND error_message ? 'message' THEN error_message->>'message'
    ELSE error_message::text
  END;

-- processing_queue.task_type → job_type
ALTER TABLE public.processing_queue RENAME COLUMN task_type TO job_type;

-- processing_queue.updated_at restored (was dropped by squash).
ALTER TABLE public.processing_queue
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone
  NOT NULL DEFAULT now();

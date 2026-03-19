-- Extend pipeline_runs with user-facing upload progress tracking
-- See docs/reference/schema-evolution-assessment.md section 5

-- Progress JSONB stores step-by-step progress:
--   { "step": "classifying", "steps_completed": 2, "steps_total": 5, "detail": "Running AI classification..." }
ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS progress jsonb DEFAULT '{}'::jsonb;

-- Original filename for user-facing display
ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS source_filename text;

-- Array of content_item UUIDs created by this pipeline run
ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS items_created uuid[] DEFAULT '{}'::uuid[];

-- Optional workspace context (e.g. bid-context uploads)
ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL;

-- Index for "my recent uploads" queries
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created_by_created_at
  ON pipeline_runs (created_by, created_at DESC);

-- Index for workspace-scoped queries
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_workspace_id
  ON pipeline_runs (workspace_id)
  WHERE workspace_id IS NOT NULL;

-- Pipeline Runs: Track when each automation agent executes
-- Replaces the misleading "Last Ran" column that inferred execution time
-- from the most recently ingested item's created_at timestamp.

CREATE TABLE pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_name VARCHAR(50) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  items_processed INT DEFAULT 0,
  error_message TEXT,
  cost NUMERIC(8, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by pipeline name + recency
CREATE INDEX idx_pipeline_runs_name_started
  ON pipeline_runs(pipeline_name, started_at DESC);

-- RLS (permissive, single-user system)
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pipeline_runs" ON pipeline_runs FOR ALL USING (true);

-- RPC: Get the most recent run for each pipeline
CREATE OR REPLACE FUNCTION get_pipeline_last_runs()
RETURNS TABLE (
  pipeline_name VARCHAR(50),
  last_started_at TIMESTAMPTZ,
  last_status VARCHAR(20),
  last_items_processed INT,
  last_error_message TEXT,
  last_duration_seconds NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT ON (pr.pipeline_name)
    pr.pipeline_name,
    pr.started_at AS last_started_at,
    pr.status AS last_status,
    pr.items_processed AS last_items_processed,
    pr.error_message AS last_error_message,
    CASE
      WHEN pr.completed_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (pr.completed_at - pr.started_at))
      ELSE NULL
    END AS last_duration_seconds
  FROM pipeline_runs pr
  ORDER BY pr.pipeline_name, pr.started_at DESC;
$$;

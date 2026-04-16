-- Pipeline health tab queries: order by started_at DESC, filter by pipeline_name
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started_at
  ON public.pipeline_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_name_started_at
  ON public.pipeline_runs (pipeline_name, started_at DESC);

-- ============================================================
-- si_processing_queue: tracks each pipeline run per feed source
-- ============================================================

CREATE TABLE si_processing_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  feed_source_id  uuid NOT NULL REFERENCES feed_sources(id) ON DELETE CASCADE,
  status          varchar NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  started_at      timestamptz,
  completed_at    timestamptz,
  error_message   text,
  articles_found  int NOT NULL DEFAULT 0,
  articles_new    int NOT NULL DEFAULT 0,
  articles_passed int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_si_processing_queue_workspace ON si_processing_queue(workspace_id);
CREATE INDEX idx_si_processing_queue_source ON si_processing_queue(feed_source_id);
CREATE INDEX idx_si_processing_queue_status ON si_processing_queue(status) WHERE status IN ('pending', 'processing');

-- RLS
ALTER TABLE si_processing_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read si_processing_queue"
  ON si_processing_queue FOR SELECT TO authenticated
  USING (true);

-- Service role inserts/updates (cron job uses createServiceClient)
-- No authenticated INSERT/UPDATE policies needed — cron uses service role

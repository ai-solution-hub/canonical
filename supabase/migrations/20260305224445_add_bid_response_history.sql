-- Migration: add_bid_response_history
-- Purpose: Preserve previous versions of bid responses for viewing and restoration

-- 1. Create history table
CREATE TABLE IF NOT EXISTS bid_response_history (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id            UUID NOT NULL REFERENCES bid_responses(id) ON DELETE CASCADE,
  version                INTEGER NOT NULL,
  response_text          TEXT,
  response_text_advanced TEXT,
  review_status          VARCHAR NOT NULL,
  metadata               JSONB DEFAULT '{}'::jsonb,
  source_content_ids     UUID[],
  edited_by              UUID REFERENCES auth.users(id),
  change_reason          TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(response_id, version)
);

CREATE INDEX IF NOT EXISTS idx_bid_response_history_response
  ON bid_response_history(response_id, version DESC);

-- 2. Snapshot trigger (SECURITY DEFINER for Python pipeline compatibility)
CREATE OR REPLACE FUNCTION snapshot_bid_response_history()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.response_text IS DISTINCT FROM NEW.response_text
     OR OLD.response_text_advanced IS DISTINCT FROM NEW.response_text_advanced
     OR OLD.metadata IS DISTINCT FROM NEW.metadata THEN

    INSERT INTO bid_response_history (
      response_id, version, response_text, response_text_advanced,
      review_status, metadata, source_content_ids, edited_by, change_reason
    ) VALUES (
      OLD.id, OLD.version, OLD.response_text, OLD.response_text_advanced,
      OLD.review_status, OLD.metadata, OLD.source_content_ids,
      COALESCE(auth.uid(), NEW.last_edited_by),
      current_setting('app.change_reason', true)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bid_response_history_snapshot ON bid_responses;

CREATE TRIGGER bid_response_history_snapshot
  BEFORE UPDATE ON bid_responses
  FOR EACH ROW
  EXECUTE FUNCTION snapshot_bid_response_history();

-- 3. RLS policies
-- SECURITY DEFINER trigger bypasses RLS for INSERT, so no INSERT policy needed.
-- Only a SELECT policy for authenticated users to read history.
ALTER TABLE bid_response_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view bid response history"
  ON bid_response_history
  FOR SELECT TO authenticated
  USING (true);

-- No UPDATE or DELETE policies -- history is immutable (same pattern as content_history)
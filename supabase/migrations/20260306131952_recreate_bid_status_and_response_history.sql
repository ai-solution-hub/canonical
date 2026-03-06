-- =============================================================================
-- Migration: Recreate bid status column + bid response history
-- =============================================================================
-- Migrations 20260305224420 and 20260305224445 were recorded as applied but
-- the objects were not created (silent failure — same issue as tag RPCs).
-- This migration re-applies both.
-- =============================================================================

-- =============================================
-- PART 1: Bid status column (from 20260305224420)
-- =============================================

-- 1a. Add the column
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS status VARCHAR(30)
  CHECK (
    status IS NULL
    OR status::text = ANY (ARRAY[
      'draft', 'questions_extracted', 'matching', 'drafting',
      'in_review', 'ready_for_export', 'submitted',
      'won', 'lost', 'withdrawn'
    ]::text[])
  );

-- 1b. Backfill from existing JSONB data
UPDATE projects
SET status = domain_metadata->>'status'
WHERE type = 'bid'
  AND domain_metadata->>'status' IS NOT NULL
  AND domain_metadata->>'status' IN (
    'draft', 'questions_extracted', 'matching', 'drafting',
    'in_review', 'ready_for_export', 'submitted',
    'won', 'lost', 'withdrawn'
  );

-- 1c. Set default for any bids with missing/invalid status in JSONB
UPDATE projects
SET status = 'draft'
WHERE type = 'bid'
  AND status IS NULL;

-- 1d. Composite index for bid list queries
CREATE INDEX IF NOT EXISTS idx_projects_type_status
  ON projects (type, status)
  WHERE type = 'bid';

-- 1e. Sync trigger: keep JSONB status in sync when column is updated
CREATE OR REPLACE FUNCTION sync_bid_status_to_jsonb()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.type = 'bid' AND NEW.status IS NOT NULL THEN
    NEW.domain_metadata := COALESCE(NEW.domain_metadata, '{}'::jsonb)
      || jsonb_build_object('status', NEW.status);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_bid_status ON projects;

CREATE TRIGGER sync_bid_status
  BEFORE INSERT OR UPDATE OF status ON projects
  FOR EACH ROW
  WHEN (NEW.type = 'bid')
  EXECUTE FUNCTION sync_bid_status_to_jsonb();

-- =============================================
-- PART 2: Bid response history (from 20260305224445)
-- =============================================

-- 2a. Create history table
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

-- 2b. Snapshot trigger
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

-- 2c. RLS policies
ALTER TABLE bid_response_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'bid_response_history'
      AND policyname = 'Authenticated users can view bid response history'
  ) THEN
    CREATE POLICY "Authenticated users can view bid response history"
      ON bid_response_history
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END;
$$;

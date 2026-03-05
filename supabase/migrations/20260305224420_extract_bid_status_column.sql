-- Migration: extract_bid_status_column
-- Purpose: Move bid status from JSONB domain_metadata to proper column

-- 1. Add the column
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

-- 2. Backfill from existing JSONB data
UPDATE projects
SET status = domain_metadata->>'status'
WHERE type = 'bid'
  AND domain_metadata->>'status' IS NOT NULL
  AND domain_metadata->>'status' IN (
    'draft', 'questions_extracted', 'matching', 'drafting',
    'in_review', 'ready_for_export', 'submitted',
    'won', 'lost', 'withdrawn'
  );

-- 3. Set default for any bids with missing/invalid status in JSONB
UPDATE projects
SET status = 'draft'
WHERE type = 'bid'
  AND status IS NULL;

-- 4. Create composite index for bid list queries
CREATE INDEX IF NOT EXISTS idx_projects_type_status
  ON projects (type, status)
  WHERE type = 'bid';

-- 5. Sync trigger: keep JSONB status in sync when column is updated
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
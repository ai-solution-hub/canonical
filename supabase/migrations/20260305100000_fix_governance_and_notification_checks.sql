-- Fix C1: governance_review_status CHECK constraint
-- Old values: pending_review, reviewed, auto_accepted, changes_requested
-- New values to match API code: pending, approved, reverted, changes_requested
--
-- The API at app/api/items/[id]/route.ts sets 'pending' on edit
-- The API at app/api/governance/review/route.ts sets 'approved', 'reverted', 'changes_requested'

ALTER TABLE content_items
  DROP CONSTRAINT IF EXISTS content_items_governance_review_status_check;

ALTER TABLE content_items
  ADD CONSTRAINT content_items_governance_review_status_check
  CHECK (
    governance_review_status IS NULL
    OR governance_review_status = ANY (ARRAY[
      'pending'::text,
      'approved'::text,
      'reverted'::text,
      'changes_requested'::text
    ])
  );

-- Fix C2: notifications.type CHECK constraint
-- Old values: governance_review, changes_requested, review_timeout_warning, quality_flag, digest_ready
-- New values to match API code:
--   app/api/items/[id]/route.ts inserts type='governance_review_needed'
--   app/api/governance/review/route.ts inserts type='governance_approve', 'governance_request_changes', 'governance_revert'
-- Keep existing values that may be used in future: quality_flag, digest_ready

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (
    type = ANY (ARRAY[
      'governance_review_needed'::text,
      'governance_approve'::text,
      'governance_request_changes'::text,
      'governance_revert'::text,
      'quality_flag'::text,
      'digest_ready'::text
    ])
  );

-- I2: Add missing freshness index (governance and lifecycle indexes already exist)
CREATE INDEX IF NOT EXISTS idx_content_items_freshness
  ON content_items (freshness)
  WHERE freshness IS NOT NULL AND freshness != 'fresh';

-- I2: Add composite index on projects(type, is_archived) for bid listing
CREATE INDEX IF NOT EXISTS idx_projects_type_archived
  ON projects (type, is_archived);

-- I5: Add DELETE policy on ingestion_quality_log for admins
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ingestion_quality_log'
      AND policyname = 'ingestion_quality_log_delete'
  ) THEN
    CREATE POLICY ingestion_quality_log_delete ON ingestion_quality_log
      FOR DELETE TO authenticated
      USING (get_user_role()::text = 'admin');
  END IF;
END $$;

-- I6: Allow viewer SELECT on processing_queue for template job status
-- Current policy restricts to editor+; viewers need to check their template completion jobs
DO $$
BEGIN
  -- Drop existing restrictive policy and replace with all-authenticated SELECT
  DROP POLICY IF EXISTS "processing_queue_select" ON processing_queue;
  CREATE POLICY processing_queue_select ON processing_queue
    FOR SELECT TO authenticated
    USING (true);
EXCEPTION
  WHEN undefined_object THEN
    -- Policy doesn't exist, just create it
    CREATE POLICY processing_queue_select ON processing_queue
      FOR SELECT TO authenticated
      USING (true);
END $$;

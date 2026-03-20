-- Content Owner Assignment — Phase 1 of Content Lifecycle
-- Adds content_owner_id to content_items, expands notification types,
-- and creates RPCs for bulk assignment and owner stats.

-- 1. Add content_owner_id column
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS content_owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Index for owner-filtered queries
CREATE INDEX IF NOT EXISTS idx_content_items_content_owner_id
  ON content_items (content_owner_id)
  WHERE content_owner_id IS NOT NULL;

-- Composite index for "my stale content" queries
CREATE INDEX IF NOT EXISTS idx_content_items_owner_freshness
  ON content_items (content_owner_id, freshness)
  WHERE content_owner_id IS NOT NULL AND freshness IN ('stale', 'expired');

COMMENT ON COLUMN content_items.content_owner_id IS
  'User responsible for keeping this content current. Receives targeted freshness and governance notifications.';

-- 2. Expand notification type CHECK to include owner-related types
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
      'governance_review_needed'::text,
      'governance_approve'::text,
      'governance_request_changes'::text,
      'governance_revert'::text,
      'quality_flag'::text,
      'digest_ready'::text,
      'freshness_transition'::text,
      'coverage_alert'::text,
      'content_gap'::text,
      'owner_content_stale'::text,
      'owner_content_updated'::text,
      'owner_assignment'::text,
      'source_document_updated'::text
    ])
  );

-- 3. Bulk assignment RPC
CREATE OR REPLACE FUNCTION bulk_assign_content_owner(
  p_item_ids uuid[],
  p_owner_id uuid,
  p_assigned_by uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  updated_count int;
BEGIN
  UPDATE content_items
    SET content_owner_id = p_owner_id,
        updated_by = p_assigned_by,
        updated_at = now()
    WHERE id = ANY(p_item_ids);

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- 4. Owner stats RPC
CREATE OR REPLACE FUNCTION get_content_owner_stats()
RETURNS TABLE (
  owner_id uuid,
  total_items int,
  fresh_count int,
  aging_count int,
  stale_count int,
  expired_count int,
  unverified_count int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    content_owner_id AS owner_id,
    count(*)::int AS total_items,
    count(*) FILTER (WHERE freshness = 'fresh')::int AS fresh_count,
    count(*) FILTER (WHERE freshness IN ('aging', 'ageing'))::int AS aging_count,
    count(*) FILTER (WHERE freshness = 'stale')::int AS stale_count,
    count(*) FILTER (WHERE freshness = 'expired')::int AS expired_count,
    count(*) FILTER (WHERE verified_at IS NULL)::int AS unverified_count
  FROM content_items
  WHERE content_owner_id IS NOT NULL
    AND archived_at IS NULL
  GROUP BY content_owner_id;
$$;

-- 5. RLS: content_owner_id inherits existing content_items policies
-- No new RLS policies needed — the existing SELECT/UPDATE policies on
-- content_items already cover this column. Editors and admins can update
-- content items (which includes content_owner_id), and all authenticated
-- users can read.

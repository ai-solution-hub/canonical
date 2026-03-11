-- =============================================================================
-- Migration: Update recalculate_all_freshness() with snapshot step
-- =============================================================================
-- Adds a "SET previous_freshness = freshness" step before recalculating,
-- enabling the freshness-transitions cron to detect state changes.
-- Depends on: 20260311224728 (previous_freshness column)
-- =============================================================================

DROP FUNCTION IF EXISTS recalculate_all_freshness();

CREATE OR REPLACE FUNCTION recalculate_all_freshness()
RETURNS TABLE (total_count INTEGER, fresh_count INTEGER, aging_count INTEGER, stale_count INTEGER, expired_count INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
  v_total int := 0;
  v_fresh int := 0;
  v_aging int := 0;
  v_stale int := 0;
  v_expired int := 0;
BEGIN
  -- Snapshot current freshness before recalculation
  UPDATE content_items
  SET previous_freshness = freshness
  WHERE archived_at IS NULL;

  -- bid_discovered: always fresh
  UPDATE content_items
  SET freshness = 'fresh', freshness_checked_at = v_now
  WHERE lifecycle_type = 'bid_discovered'
    AND archived_at IS NULL
    AND (freshness IS DISTINCT FROM 'fresh');

  -- date_bound: based on expiry_date
  UPDATE content_items
  SET freshness = CASE
    WHEN expiry_date IS NULL THEN 'aging'
    WHEN expiry_date < v_now THEN 'expired'
    WHEN expiry_date < v_now + interval '1 month' THEN 'stale'
    WHEN expiry_date < v_now + interval '3 months' THEN 'aging'
    ELSE 'fresh'
  END,
  freshness_checked_at = v_now
  WHERE lifecycle_type = 'date_bound'
    AND archived_at IS NULL;

  -- regulation: based on months since updated_at
  UPDATE content_items
  SET freshness = CASE
    WHEN updated_at IS NULL THEN 'stale'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 6 THEN 'fresh'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 9 THEN 'aging'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 12 THEN 'stale'
    ELSE 'expired'
  END,
  freshness_checked_at = v_now
  WHERE lifecycle_type = 'regulation'
    AND archived_at IS NULL;

  -- evergreen + null lifecycle_type: based on months since updated_at
  UPDATE content_items
  SET freshness = CASE
    WHEN updated_at IS NULL THEN 'stale'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 12 THEN 'fresh'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 18 THEN 'aging'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 24 THEN 'stale'
    ELSE 'expired'
  END,
  freshness_checked_at = v_now
  WHERE (lifecycle_type = 'evergreen' OR lifecycle_type IS NULL)
    AND archived_at IS NULL;

  -- Count final states (excluding archived)
  SELECT COUNT(*) FILTER (WHERE freshness = 'fresh'),
         COUNT(*) FILTER (WHERE freshness = 'aging'),
         COUNT(*) FILTER (WHERE freshness = 'stale'),
         COUNT(*) FILTER (WHERE freshness = 'expired'),
         COUNT(*)
  INTO v_fresh, v_aging, v_stale, v_expired, v_total
  FROM content_items
  WHERE archived_at IS NULL;

  RETURN QUERY SELECT v_total, v_fresh, v_aging, v_stale, v_expired;
END;
$$;

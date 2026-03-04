-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Grant usage to postgres role (required for Supabase)
GRANT USAGE ON SCHEMA cron TO postgres;

-- Create a function that recalculates freshness for all content items.
-- This mirrors the logic in lib/freshness.ts but runs entirely in SQL.
CREATE OR REPLACE FUNCTION recalculate_all_freshness()
RETURNS TABLE(total_updated int, fresh_count int, aging_count int, stale_count int, expired_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_total int := 0;
  v_fresh int := 0;
  v_aging int := 0;
  v_stale int := 0;
  v_expired int := 0;
BEGIN
  -- bid_discovered: always fresh
  UPDATE content_items
  SET freshness = 'fresh', freshness_checked_at = v_now
  WHERE lifecycle_type = 'bid_discovered'
    AND (freshness IS DISTINCT FROM 'fresh');
  GET DIAGNOSTICS v_fresh = ROW_COUNT;

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
  WHERE lifecycle_type = 'date_bound';

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
  WHERE lifecycle_type = 'regulation';

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
  WHERE lifecycle_type = 'evergreen'
    OR lifecycle_type IS NULL;

  -- Count final states
  SELECT COUNT(*) FILTER (WHERE freshness = 'fresh'),
         COUNT(*) FILTER (WHERE freshness = 'aging'),
         COUNT(*) FILTER (WHERE freshness = 'stale'),
         COUNT(*) FILTER (WHERE freshness = 'expired'),
         COUNT(*)
  INTO v_fresh, v_aging, v_stale, v_expired, v_total
  FROM content_items;

  RETURN QUERY SELECT v_total, v_fresh, v_aging, v_stale, v_expired;
END;
$$;

-- Schedule daily recalculation at 03:00 UTC
SELECT cron.schedule(
  'recalculate-freshness-daily',
  '0 3 * * *',
  $$SELECT * FROM recalculate_all_freshness()$$
);

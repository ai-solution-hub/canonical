-- ============================================================
-- get_due_feed_sources: returns feed sources due for polling,
-- respecting per-source polling_interval_minutes with
-- exponential backoff on consecutive failures.
-- ============================================================

CREATE OR REPLACE FUNCTION get_due_feed_sources(max_sources int DEFAULT 5)
RETURNS SETOF feed_sources
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT *
  FROM feed_sources
  WHERE is_active = true
    AND consecutive_failures < 10
    AND (
      last_polled_at IS NULL
      OR last_polled_at + (
        polling_interval_minutes * POWER(2, LEAST(consecutive_failures, 6))
        || ' minutes'
      )::interval < now()
    )
  ORDER BY last_polled_at ASC NULLS FIRST
  LIMIT max_sources;
$$;

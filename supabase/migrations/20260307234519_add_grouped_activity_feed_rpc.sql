-- Migration: Add get_grouped_activity_feed RPC
-- Returns a pre-grouped activity feed combining content_history and
-- ingestion_quality_log. Quality flags of the same type within a 24-hour
-- window are collapsed into a single row with a count.

CREATE OR REPLACE FUNCTION public.get_grouped_activity_feed(
  p_limit    integer DEFAULT 10,
  p_is_admin boolean DEFAULT false
)
RETURNS TABLE(
  id          uuid,
  type        text,
  entity_type text,
  entity_id   uuid,
  summary     text,
  user_id     uuid,
  latest_at   timestamptz,
  earliest_at timestamptz,
  event_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH history_events AS (
    -- Each content_history row is an individual event (no grouping).
    SELECT
      ch.id,
      CASE
        WHEN ch.change_type = 'rollback' THEN 'rollback'
        ELSE ch.change_type
      END AS type,
      'content_item'::text AS entity_type,
      ch.content_item_id AS entity_id,
      COALESCE(ch.change_summary, 'Version ' || ch.version::text) AS summary,
      ch.created_by AS user_id,
      ch.created_at AS latest_at,
      ch.created_at AS earliest_at,
      1 AS event_count
    FROM content_history ch
    ORDER BY ch.created_at DESC
    LIMIT p_limit * 3
  ),

  quality_grouped AS (
    -- Group quality flags by flag_type + severity within calendar-day buckets.
    SELECT
      iql.flag_type,
      iql.severity,
      date_trunc('day', iql.created_at) AS day_bucket,
      MAX(iql.created_at) AS latest_at,
      MIN(iql.created_at) AS earliest_at,
      COUNT(*)::integer AS event_count
    FROM ingestion_quality_log iql
    WHERE p_is_admin = true
    GROUP BY
      iql.flag_type,
      iql.severity,
      date_trunc('day', iql.created_at)
    ORDER BY MAX(iql.created_at) DESC
    LIMIT p_limit * 2
  ),

  quality_events AS (
    -- Resolve representative id and entity_id from the grouped results.
    SELECT
      (
        SELECT sub.id
        FROM ingestion_quality_log sub
        WHERE sub.flag_type = qg.flag_type
          AND sub.severity = qg.severity
          AND date_trunc('day', sub.created_at) = qg.day_bucket
        ORDER BY sub.created_at DESC
        LIMIT 1
      ) AS id,
      'quality_flag'::text AS type,
      'content_item'::text AS entity_type,
      (
        SELECT sub.content_item_id
        FROM ingestion_quality_log sub
        WHERE sub.flag_type = qg.flag_type
          AND sub.severity = qg.severity
          AND date_trunc('day', sub.created_at) = qg.day_bucket
        ORDER BY sub.created_at DESC
        LIMIT 1
      ) AS entity_id,
      qg.severity || ': ' || REPLACE(qg.flag_type, '_', ' ') AS summary,
      NULL::uuid AS user_id,
      qg.latest_at,
      qg.earliest_at,
      qg.event_count
    FROM quality_grouped qg
  )

  SELECT * FROM history_events
  UNION ALL
  SELECT * FROM quality_events
  ORDER BY latest_at DESC
  LIMIT p_limit;
$$;

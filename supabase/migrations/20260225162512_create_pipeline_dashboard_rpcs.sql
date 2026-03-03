-- Pipeline dashboard RPC functions
-- Provides aggregated stats for the /pipeline dashboard page.

-- 1. Pipeline overview stats (single call for KPI cards + enrichment coverage)
-- Returns a single JSON object with all at-a-glance metrics.
CREATE OR REPLACE FUNCTION get_pipeline_stats()
RETURNS JSON AS $$
SELECT json_build_object(
  'total_items', (SELECT count(*) FROM content_items),
  'items_7d', (SELECT count(*) FROM content_items WHERE created_at >= now() - interval '7 days'),
  'items_30d', (SELECT count(*) FROM content_items WHERE created_at >= now() - interval '30 days'),
  'unread_count', (SELECT count(*) FROM content_items ci LEFT JOIN read_marks rm ON rm.content_item_id = ci.id WHERE rm.id IS NULL),
  'bookmarklet_queue', (SELECT count(*) FROM content_items WHERE metadata->>'ingestion_source' = 'bookmarklet' AND embedding IS NULL),
  'missing_summaries', (SELECT count(*) FROM content_items WHERE summary_data IS NULL),
  'missing_embeddings', (SELECT count(*) FROM content_items WHERE embedding IS NULL),
  'has_embedding', (SELECT count(*) FROM content_items WHERE embedding IS NOT NULL),
  'has_summary', (SELECT count(*) FROM content_items WHERE summary_data IS NOT NULL),
  'has_thumbnail', (SELECT count(*) FROM content_items WHERE thumbnail_url IS NOT NULL AND thumbnail_url != ''),
  'is_classified', (SELECT count(*) FROM content_items WHERE classified_at IS NOT NULL),
  'quality_issues_unresolved', (SELECT count(*) FROM ingestion_quality_log WHERE resolved = false),
  'confidence_distribution', (
    SELECT json_agg(row_to_json(t))
    FROM (
      SELECT
        CASE
          WHEN classification_confidence >= 0.9 THEN '0.90-1.00'
          WHEN classification_confidence >= 0.8 THEN '0.80-0.89'
          WHEN classification_confidence >= 0.7 THEN '0.70-0.79'
          WHEN classification_confidence >= 0.6 THEN '0.60-0.69'
          ELSE 'Below 0.60'
        END AS confidence_band,
        count(*) AS item_count
      FROM content_items
      WHERE classification_confidence IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    ) t
  ),
  'content_type_breakdown', (
    SELECT json_agg(row_to_json(t))
    FROM (
      SELECT content_type, count(*) AS item_count
      FROM content_items
      GROUP BY content_type
      ORDER BY count(*) DESC
    ) t
  ),
  'quality_issues_by_type', (
    SELECT json_agg(row_to_json(t))
    FROM (
      SELECT flag_type, severity, count(*) AS issue_count
      FROM ingestion_quality_log
      WHERE resolved = false
      GROUP BY flag_type, severity
      ORDER BY count(*) DESC
    ) t
  )
);
$$ LANGUAGE SQL STABLE;

-- 2. Source activity timeline (for stacked area chart)
-- Returns one row per (period, platform) pair for the specified time range.
-- p_granularity accepts 'day' or 'week'.
CREATE OR REPLACE FUNCTION get_ingestion_timeline(
  p_days INT DEFAULT 90,
  p_granularity TEXT DEFAULT 'week'
)
RETURNS TABLE (period TIMESTAMPTZ, platform VARCHAR, item_count BIGINT)
AS $$
SELECT
  date_trunc(p_granularity, created_at) AS period,
  platform,
  count(*) AS item_count
FROM content_items
WHERE created_at >= now() - (p_days || ' days')::interval
GROUP BY 1, 2
ORDER BY 1;
$$ LANGUAGE SQL STABLE;

-- 3. Source freshness (for freshness cards)
-- Returns one row per platform with last ingestion time and recent counts.
CREATE OR REPLACE FUNCTION get_source_freshness()
RETURNS TABLE (
  platform VARCHAR,
  total_items BIGINT,
  last_ingested TIMESTAMPTZ,
  last_7d BIGINT,
  last_30d BIGINT
) AS $$
SELECT
  platform,
  count(*) AS total_items,
  max(created_at) AS last_ingested,
  count(*) FILTER (WHERE created_at >= now() - interval '7 days') AS last_7d,
  count(*) FILTER (WHERE created_at >= now() - interval '30 days') AS last_30d
FROM content_items
GROUP BY platform
ORDER BY total_items DESC;
$$ LANGUAGE SQL STABLE;

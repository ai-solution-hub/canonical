-- Composite index for efficient workspace + time range queries
CREATE INDEX IF NOT EXISTS idx_feed_articles_workspace_ingested
ON feed_articles(workspace_id, ingested_at);

-- RPC function for trend aggregation
CREATE OR REPLACE FUNCTION public.get_filter_ratio_trend(
  p_workspace_id uuid,
  p_granularity text DEFAULT 'daily',
  p_period_days int DEFAULT 90
)
RETURNS TABLE(
  date text,
  total bigint,
  passed bigint,
  filtered bigint,
  ratio int
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT
    CASE WHEN p_granularity = 'weekly'
         THEN date_trunc('week', ingested_at)::date::text
         ELSE date_trunc('day', ingested_at)::date::text
    END AS date,
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE passed)::bigint AS passed,
    COUNT(*) FILTER (WHERE NOT passed)::bigint AS filtered,
    CASE WHEN COUNT(*) > 0
         THEN ROUND(COUNT(*) FILTER (WHERE passed)::numeric / COUNT(*) * 100)::int
         ELSE 0
    END AS ratio
  FROM feed_articles
  WHERE workspace_id = p_workspace_id
    AND ingested_at >= now() - (p_period_days || ' days')::interval
  GROUP BY 1
  ORDER BY 1 ASC;
$$;

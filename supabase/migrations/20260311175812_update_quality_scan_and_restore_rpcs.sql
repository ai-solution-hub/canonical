SET search_path TO public, extensions;

-- Restore accidentally replaced functions
DROP FUNCTION IF EXISTS get_domain_subtopic_counts();
CREATE OR REPLACE FUNCTION get_domain_subtopic_counts()
RETURNS TABLE (primary_domain TEXT, primary_subtopic TEXT, item_count BIGINT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT ci.primary_domain::TEXT, ci.primary_subtopic::TEXT, COUNT(*) AS item_count
  FROM content_items ci
  WHERE ci.primary_domain IS NOT NULL
    AND ci.archived_at IS NULL
  GROUP BY ci.primary_domain, ci.primary_subtopic 
  ORDER BY ci.primary_domain, item_count DESC;
END;
$$;

DROP FUNCTION IF EXISTS get_filter_counts();
CREATE OR REPLACE FUNCTION get_filter_counts()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN jsonb_build_object(
    'domain', COALESCE((SELECT jsonb_object_agg(primary_domain, cnt) FROM (SELECT primary_domain, COUNT(*) as cnt FROM content_items WHERE primary_domain IS NOT NULL AND archived_at IS NULL GROUP BY primary_domain) d), '{}'::jsonb),
    'content_type', COALESCE((SELECT jsonb_object_agg(content_type, cnt) FROM (SELECT content_type, COUNT(*) as cnt FROM content_items WHERE content_type IS NOT NULL AND archived_at IS NULL GROUP BY content_type) t), '{}'::jsonb),
    'platform', COALESCE((SELECT jsonb_object_agg(platform, cnt) FROM (SELECT platform, COUNT(*) as cnt FROM content_items WHERE platform IS NOT NULL AND archived_at IS NULL GROUP BY platform) p), '{}'::jsonb)
  );
END;
$$;

-- Update quality scan functions to exclude archived items
DROP FUNCTION IF EXISTS get_quality_issue_counts();
CREATE OR REPLACE FUNCTION get_quality_issue_counts()
RETURNS TABLE (
    flag_type TEXT,
    severity TEXT,
    open_count BIGINT
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT
        iql.flag_type,
        iql.severity,
        COUNT(*) AS open_count
    FROM ingestion_quality_log iql
    LEFT JOIN content_items ci ON iql.content_item_id = ci.id
    WHERE iql.resolved = FALSE
      AND (ci.id IS NULL OR ci.archived_at IS NULL)
    GROUP BY iql.flag_type, iql.severity
    ORDER BY
        CASE iql.severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END,
        iql.flag_type;
$$;

DROP FUNCTION IF EXISTS get_items_with_quality_flags();
CREATE OR REPLACE FUNCTION get_items_with_quality_flags()
RETURNS SETOF UUID LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT DISTINCT iql.content_item_id
    FROM ingestion_quality_log iql
    JOIN content_items ci ON iql.content_item_id = ci.id
    WHERE iql.resolved = FALSE
      AND iql.content_item_id IS NOT NULL
      AND ci.archived_at IS NULL;
$$;

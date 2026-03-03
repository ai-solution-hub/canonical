-- RPC function for the Quality Issues review page.
-- Supports filtering by flag_type, severity, and resolved status with pagination
-- and sorting. Joins to content_items for display fields. Includes a summary
-- object so the page can show global counts regardless of active filters.

CREATE OR REPLACE FUNCTION get_quality_issues(
  p_flag_type TEXT DEFAULT NULL,
  p_severity TEXT DEFAULT NULL,
  p_resolved BOOLEAN DEFAULT NULL,
  p_sort_by TEXT DEFAULT 'created_at',
  p_sort_dir TEXT DEFAULT 'desc',
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSON AS $$
DECLARE
  total_count BIGINT;
  issues JSON;
  summary JSON;
BEGIN
  -- Get total count for pagination (respects current filters)
  SELECT count(*)
  INTO total_count
  FROM ingestion_quality_log ql
  WHERE (p_flag_type IS NULL OR ql.flag_type = p_flag_type)
    AND (p_severity IS NULL OR ql.severity = p_severity)
    AND (p_resolved IS NULL OR ql.resolved = p_resolved);

  -- Get paginated issues with content item details
  SELECT json_agg(row_to_json(t))
  INTO issues
  FROM (
    SELECT
      ql.id,
      ql.content_item_id,
      ql.flag_type,
      ql.severity,
      ql.details,
      ql.resolved,
      ql.resolved_at,
      ql.resolved_by,
      ql.resolution_notes,
      ql.ingestion_batch,
      ql.source_url,
      ql.created_at,
      ci.suggested_title AS item_title,
      ci.title AS item_raw_title,
      ci.content_type AS item_content_type,
      ci.platform AS item_platform,
      ci.primary_domain AS item_domain,
      ci.thumbnail_url AS item_thumbnail_url
    FROM ingestion_quality_log ql
    LEFT JOIN content_items ci ON ql.content_item_id = ci.id
    WHERE (p_flag_type IS NULL OR ql.flag_type = p_flag_type)
      AND (p_severity IS NULL OR ql.severity = p_severity)
      AND (p_resolved IS NULL OR ql.resolved = p_resolved)
    ORDER BY
      CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'desc' THEN ql.created_at END DESC,
      CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'asc' THEN ql.created_at END ASC,
      CASE WHEN p_sort_by = 'severity' AND p_sort_dir = 'desc' THEN
        CASE ql.severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END
      END ASC,
      CASE WHEN p_sort_by = 'severity' AND p_sort_dir = 'asc' THEN
        CASE ql.severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END
      END DESC,
      CASE WHEN p_sort_by = 'flag_type' AND p_sort_dir = 'asc' THEN ql.flag_type END ASC,
      CASE WHEN p_sort_by = 'flag_type' AND p_sort_dir = 'desc' THEN ql.flag_type END DESC
    LIMIT p_limit
    OFFSET p_offset
  ) t;

  -- Build global summary (ignores current filters)
  SELECT json_build_object(
    'total_unresolved', (SELECT count(*) FROM ingestion_quality_log WHERE resolved = false),
    'total_resolved', (SELECT count(*) FROM ingestion_quality_log WHERE resolved = true),
    'by_severity', json_build_object(
      'error', (SELECT count(*) FROM ingestion_quality_log WHERE resolved = false AND severity = 'error'),
      'warning', (SELECT count(*) FROM ingestion_quality_log WHERE resolved = false AND severity = 'warning'),
      'info', (SELECT count(*) FROM ingestion_quality_log WHERE resolved = false AND severity = 'info')
    )
  )
  INTO summary;

  RETURN json_build_object(
    'issues', COALESCE(issues, '[]'::json),
    'total', total_count,
    'limit', p_limit,
    'offset', p_offset,
    'summary', summary
  );
END;
$$ LANGUAGE plpgsql STABLE;

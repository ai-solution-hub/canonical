-- Create get_review_queue() RPC function
-- Replaces 3-query pattern (fetch read marks + fetch items + fetch count) with a single call
-- Uses LEFT JOIN to exclude read items instead of NOT IN clause

CREATE OR REPLACE FUNCTION get_review_queue(
  p_domains TEXT[] DEFAULT NULL,
  p_content_types TEXT[] DEFAULT NULL,
  p_platforms TEXT[] DEFAULT NULL,
  p_cursor TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  items JSONB,
  total_count BIGINT
) AS $$
DECLARE
  v_items JSONB;
  v_count BIGINT;
BEGIN
  -- Count total matching unread items
  SELECT COUNT(*)
  INTO v_count
  FROM content_items ci
  LEFT JOIN read_marks rm ON rm.content_item_id = ci.id
  WHERE rm.id IS NULL
    AND (p_domains IS NULL OR ci.primary_domain = ANY(p_domains))
    AND (p_content_types IS NULL OR ci.content_type = ANY(p_content_types))
    AND (p_platforms IS NULL OR ci.platform = ANY(p_platforms));

  -- Fetch the page of items
  SELECT COALESCE(jsonb_agg(row_to_json(q)), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      ci.id,
      ci.title,
      ci.suggested_title,
      ci.ai_summary,
      ci.primary_domain,
      ci.primary_subtopic,
      ci.content_type,
      ci.platform,
      ci.author_name,
      ci.source_domain,
      ci.thumbnail_url,
      ci.captured_date,
      ci.ai_keywords,
      ci.classification_confidence,
      ci.source_url
    FROM content_items ci
    LEFT JOIN read_marks rm ON rm.content_item_id = ci.id
    WHERE rm.id IS NULL
      AND (p_domains IS NULL OR ci.primary_domain = ANY(p_domains))
      AND (p_content_types IS NULL OR ci.content_type = ANY(p_content_types))
      AND (p_platforms IS NULL OR ci.platform = ANY(p_platforms))
      AND (p_cursor IS NULL OR ci.captured_date < p_cursor)
    ORDER BY ci.captured_date DESC NULLS LAST
    LIMIT p_limit
  ) q;

  RETURN QUERY SELECT v_items, v_count;
END;
$$ LANGUAGE plpgsql STABLE;

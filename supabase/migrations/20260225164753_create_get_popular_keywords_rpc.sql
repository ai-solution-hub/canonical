-- Get the most frequently used AI keywords across all content items.
-- Used for search suggestions when the search bar is focused.

CREATE OR REPLACE FUNCTION get_popular_keywords(p_limit INT DEFAULT 10)
RETURNS TABLE (keyword TEXT, item_count BIGINT) AS $$
  SELECT kw AS keyword, COUNT(*) AS item_count
  FROM content_items, unnest(ai_keywords) AS kw
  WHERE ai_keywords IS NOT NULL
  GROUP BY kw
  ORDER BY item_count DESC
  LIMIT p_limit;
$$ LANGUAGE SQL STABLE;

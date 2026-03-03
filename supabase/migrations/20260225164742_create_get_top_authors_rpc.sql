-- Get top authors by item count.
-- Used on the home page to show clickable author chips.

CREATE OR REPLACE FUNCTION get_top_authors(p_limit INT DEFAULT 8)
RETURNS TABLE (author_name TEXT, item_count BIGINT) AS $$
  SELECT author_name::TEXT, COUNT(*) AS item_count
  FROM content_items
  WHERE author_name IS NOT NULL AND author_name != ''
  GROUP BY author_name
  ORDER BY item_count DESC
  LIMIT p_limit;
$$ LANGUAGE SQL STABLE;

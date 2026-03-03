-- Aggregate content capture activity by date server-side (replaces client-side
-- aggregation that fetched every captured_date value).
CREATE OR REPLACE FUNCTION get_capture_activity()
RETURNS TABLE (day date, count bigint)
LANGUAGE sql STABLE
AS $$
  SELECT captured_date::date AS day, COUNT(*) AS count
  FROM content_items
  WHERE captured_date IS NOT NULL
  GROUP BY 1
  ORDER BY 1;
$$;

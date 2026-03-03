-- Create get_domain_unread_counts() RPC function
-- Returns unread counts per domain using LEFT JOIN on read_marks
-- Replaces client-side pattern of fetching all content items to count unread per domain

CREATE OR REPLACE FUNCTION get_domain_unread_counts()
RETURNS TABLE (
  domain TEXT,
  unread_count BIGINT
) AS $$
  SELECT
    ci.primary_domain AS domain,
    COUNT(*) AS unread_count
  FROM content_items ci
  LEFT JOIN read_marks rm ON rm.content_item_id = ci.id
  WHERE rm.id IS NULL
  GROUP BY ci.primary_domain;
$$ LANGUAGE SQL STABLE;

-- Fix get_topic_layers RPC: use layer_vocabulary for dynamic ordering
-- instead of hardcoded CASE statement. The layer_vocabulary table column
-- is "key" (not "slug"), and display_order provides the sort.

CREATE OR REPLACE FUNCTION get_topic_layers(p_topic_id text)
RETURNS TABLE (
  id uuid,
  title text,
  content_type text,
  primary_domain text,
  metadata jsonb,
  layer text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    ci.id,
    ci.title,
    ci.content_type,
    ci.primary_domain,
    ci.metadata,
    ci.metadata->>'layer' as layer
  FROM content_items ci
  LEFT JOIN layer_vocabulary lv ON lv.key = ci.metadata->>'layer'
  WHERE ci.metadata->>'topic_id' = p_topic_id
  ORDER BY COALESCE(lv.display_order, 999);
$$;

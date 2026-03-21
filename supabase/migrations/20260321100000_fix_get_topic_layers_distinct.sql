-- Fix get_topic_layers RPC: return one representative item per unique layer
-- instead of all items sharing the same topic_id. This eliminates the layer
-- duplication seen in the LayerSwitcherNav on item detail pages.

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
  SELECT DISTINCT ON (ci.metadata->>'layer')
    ci.id,
    ci.title,
    ci.content_type,
    ci.primary_domain,
    ci.metadata,
    ci.metadata->>'layer' as layer
  FROM content_items ci
  LEFT JOIN layer_vocabulary lv ON lv.key = ci.metadata->>'layer'
  WHERE ci.metadata->>'topic_id' = p_topic_id
  ORDER BY ci.metadata->>'layer', COALESCE(lv.display_order, 999), ci.title;
$$;

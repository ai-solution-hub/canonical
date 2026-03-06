-- RPC to get all items sharing a topic_id, ordered by layer
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
AS $$
  SELECT
    ci.id,
    ci.title,
    ci.content_type,
    ci.primary_domain,
    ci.metadata,
    ci.metadata->>'layer' as layer
  FROM content_items ci
  WHERE ci.metadata->>'topic_id' = p_topic_id
  ORDER BY
    CASE ci.metadata->>'layer'
      WHEN 'sales_brief' THEN 1
      WHEN 'bid_detail' THEN 2
      WHEN 'company_reference' THEN 3
      WHEN 'research' THEN 4
      ELSE 5
    END;
$$;

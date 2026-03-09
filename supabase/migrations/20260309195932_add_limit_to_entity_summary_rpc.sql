-- Add optional p_limit parameter to get_entity_summary RPC
-- Allows callers to bound the result set (e.g. top 20 entities for the
-- kb://entities MCP resource). Defaults to NULL (no limit) for backwards
-- compatibility.

-- Drop old 2-parameter signature to avoid overloaded functions
DROP FUNCTION IF EXISTS get_entity_summary(text, text);

CREATE OR REPLACE FUNCTION get_entity_summary(
  p_entity_name text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_limit int DEFAULT NULL
)
RETURNS TABLE (
  canonical_name text,
  entity_type text,
  mention_count bigint,
  content_item_ids uuid[],
  related_entities jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH mention_counts AS (
    SELECT
      em.canonical_name,
      em.entity_type,
      COUNT(*) as mention_count,
      ARRAY_AGG(DISTINCT em.content_item_id) as content_item_ids
    FROM entity_mentions em
    WHERE
      (p_entity_name IS NULL OR em.canonical_name ILIKE '%' || p_entity_name || '%')
      AND (p_entity_type IS NULL OR em.entity_type = p_entity_type)
    GROUP BY em.canonical_name, em.entity_type
  ),
  ranked AS (
    SELECT
      mc.*,
      ROW_NUMBER() OVER (ORDER BY mc.mention_count DESC) as rn
    FROM mention_counts mc
  ),
  bounded AS (
    SELECT * FROM ranked
    WHERE p_limit IS NULL OR rn <= p_limit
  ),
  related AS (
    SELECT
      b.canonical_name,
      b.entity_type,
      COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object(
          'relationship', er.relationship_type,
          'target', er.target_entity
        )) FILTER (WHERE er.id IS NOT NULL),
        '[]'::jsonb
      ) ||
      COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object(
          'relationship', er2.relationship_type,
          'source', er2.source_entity
        )) FILTER (WHERE er2.id IS NOT NULL),
        '[]'::jsonb
      ) as related_entities
    FROM bounded b
    LEFT JOIN entity_relationships er ON er.source_entity = b.canonical_name
    LEFT JOIN entity_relationships er2 ON er2.target_entity = b.canonical_name
    GROUP BY b.canonical_name, b.entity_type
  )
  SELECT
    b.canonical_name,
    b.entity_type,
    b.mention_count,
    b.content_item_ids,
    COALESCE(r.related_entities, '[]'::jsonb)
  FROM bounded b
  LEFT JOIN related r ON r.canonical_name = b.canonical_name AND r.entity_type = b.entity_type
  ORDER BY b.mention_count DESC;
END;
$$;

COMMENT ON FUNCTION get_entity_summary(text, text, int) IS 'Query entity mentions with counts, content items, and related entities. Optional p_limit bounds the result set.';

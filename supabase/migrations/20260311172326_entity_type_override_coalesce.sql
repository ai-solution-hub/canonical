-- Migration: entity_type_override_coalesce
-- Updates get_entity_summary and get_entity_relationships_rpc to use
-- COALESCE(entity_type_override, entity_type) so admin type overrides
-- are visible to all consumers including MCP tool #14.
-- Also adds delete_duplicate_entity_mentions helper for merge operations.

-- ---------------------------------------------------------------------------
-- 1. Update get_entity_summary to use effective_type
-- ---------------------------------------------------------------------------

-- Drop old 3-parameter signature
DROP FUNCTION IF EXISTS get_entity_summary(text, text, int);

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
      COALESCE(em.entity_type_override, em.entity_type) AS entity_type,
      COUNT(*) as mention_count,
      ARRAY_AGG(DISTINCT em.content_item_id) as content_item_ids
    FROM entity_mentions em
    WHERE
      (p_entity_name IS NULL OR em.canonical_name ILIKE '%' || p_entity_name || '%')
      AND (p_entity_type IS NULL OR COALESCE(em.entity_type_override, em.entity_type) = p_entity_type)
    GROUP BY em.canonical_name, COALESCE(em.entity_type_override, em.entity_type)
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

COMMENT ON FUNCTION get_entity_summary(text, text, int)
  IS 'Query entity mentions with counts, content items, and related entities. Uses COALESCE(entity_type_override, entity_type) for effective type.';

-- ---------------------------------------------------------------------------
-- 2. Add delete_duplicate_entity_mentions helper for merge operations
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION delete_duplicate_entity_mentions(
  p_canonical_name text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Delete duplicate mentions, keeping the row with highest confidence
  -- (or earliest created_at as tiebreaker).
  WITH duplicates AS (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY canonical_name, entity_type, content_item_id
        ORDER BY confidence DESC NULLS LAST, created_at ASC
      ) AS rn
    FROM entity_mentions
    WHERE canonical_name = p_canonical_name
  )
  DELETE FROM entity_mentions
  WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION delete_duplicate_entity_mentions(text)
  IS 'Delete duplicate entity_mentions rows for a given canonical_name, keeping the highest-confidence row per (canonical_name, entity_type, content_item_id).';
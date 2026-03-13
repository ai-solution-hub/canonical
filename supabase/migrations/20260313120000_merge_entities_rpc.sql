-- =============================================================================
-- Migration: Atomic merge_entities RPC
--
-- Wraps the 4-step entity merge operation in a single PL/pgSQL transaction:
-- 1. Update entity_mentions canonical_name + entity_type_override
-- 2. Update entity_relationships source_entity
-- 3. Update entity_relationships target_entity
-- 4. Delete duplicate mention rows (reuses delete_duplicate_entity_mentions logic)
--
-- Fixes HF-5: Non-atomic entity merge with no transaction/rollback.
-- =============================================================================

CREATE OR REPLACE FUNCTION merge_entities(
  p_source_names text[],
  p_target_name text,
  p_entity_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentions_updated integer := 0;
  v_rel_sources_updated integer := 0;
  v_rel_targets_updated integer := 0;
  v_duplicates_removed integer := 0;
BEGIN
  -- Validate inputs
  IF p_target_name IS NULL OR p_target_name = '' THEN
    RAISE EXCEPTION 'Target name must not be empty';
  END IF;

  IF p_source_names IS NULL OR array_length(p_source_names, 1) IS NULL THEN
    RAISE EXCEPTION 'Source names array must not be empty';
  END IF;

  -- 1. Update entity_mentions: rename canonical_name to target and set type override
  UPDATE entity_mentions
  SET canonical_name = p_target_name,
      entity_type_override = p_entity_type
  WHERE canonical_name = ANY(p_source_names);

  GET DIAGNOSTICS v_mentions_updated = ROW_COUNT;

  -- 2. Update entity_relationships: source_entity references
  UPDATE entity_relationships
  SET source_entity = p_target_name
  WHERE source_entity = ANY(p_source_names);

  GET DIAGNOSTICS v_rel_sources_updated = ROW_COUNT;

  -- 3. Update entity_relationships: target_entity references
  UPDATE entity_relationships
  SET target_entity = p_target_name
  WHERE target_entity = ANY(p_source_names);

  GET DIAGNOSTICS v_rel_targets_updated = ROW_COUNT;

  -- 4. Delete duplicate mentions (same canonical_name + entity_type + content_item_id)
  --    Keep the row with highest confidence (or earliest created_at as tiebreaker)
  WITH duplicates AS (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY canonical_name, COALESCE(entity_type_override, entity_type), content_item_id
        ORDER BY confidence DESC NULLS LAST, created_at ASC
      ) AS rn
    FROM entity_mentions
    WHERE canonical_name = p_target_name
  )
  DELETE FROM entity_mentions
  WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

  GET DIAGNOSTICS v_duplicates_removed = ROW_COUNT;

  -- Return result summary as JSON
  RETURN jsonb_build_object(
    'merged', true,
    'target', p_target_name,
    'entity_type', p_entity_type,
    'mentions_updated', v_mentions_updated,
    'relationship_sources_updated', v_rel_sources_updated,
    'relationship_targets_updated', v_rel_targets_updated,
    'duplicates_removed', v_duplicates_removed
  );
END;
$$;

COMMENT ON FUNCTION merge_entities(text[], text, text)
  IS 'Atomically merge multiple entities into one canonical form. Updates mentions, relationships, and deduplicates — all within a single transaction.';

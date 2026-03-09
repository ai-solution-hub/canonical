-- =============================================================================
-- Migration: Add entity_mentions, entity_relationships, and notes column
--
-- Part of the context graph implementation (Session 67).
-- Adds PostgreSQL-only entity extraction tables and a notes column on
-- content_items for editorial guidance.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. entity_mentions — Extracted entities from content items
-- ---------------------------------------------------------------------------
CREATE TABLE entity_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN (
    'organisation', 'certification', 'regulation', 'framework',
    'capability', 'person', 'technology', 'project', 'sector'
  )),
  entity_name text NOT NULL,
  canonical_name text NOT NULL,
  confidence numeric(3,2) DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  context_snippet text,
  created_at timestamptz DEFAULT now(),
  -- Prevent duplicate entity mentions for the same item
  UNIQUE(canonical_name, entity_type, content_item_id)
);

COMMENT ON TABLE entity_mentions IS 'Entities extracted from content items by AI classification';
COMMENT ON COLUMN entity_mentions.entity_name IS 'Original entity name as found in text';
COMMENT ON COLUMN entity_mentions.canonical_name IS 'Normalised form for deduplication (e.g. "ISO 27001" not "ISO27001")';
COMMENT ON COLUMN entity_mentions.context_snippet IS 'Short excerpt showing where the entity was found';

-- Indexes
CREATE INDEX idx_entity_mentions_canonical ON entity_mentions(canonical_name, entity_type);
CREATE INDEX idx_entity_mentions_content ON entity_mentions(content_item_id);
CREATE INDEX idx_entity_mentions_type ON entity_mentions(entity_type);

-- ---------------------------------------------------------------------------
-- 2. entity_relationships — Relationships between entities
-- ---------------------------------------------------------------------------
CREATE TABLE entity_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity text NOT NULL,
  relationship_type text NOT NULL CHECK (relationship_type IN (
    'holds', 'complies_with', 'delivers_to', 'uses',
    'demonstrated_by', 'requires', 'part_of', 'supersedes',
    'references', 'evidences'
  )),
  target_entity text NOT NULL,
  source_item_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  confidence numeric(3,2) DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE entity_relationships IS 'Relationships between entities extracted from content';
COMMENT ON COLUMN entity_relationships.source_entity IS 'Canonical name of the source entity';
COMMENT ON COLUMN entity_relationships.target_entity IS 'Canonical name of the target entity';
COMMENT ON COLUMN entity_relationships.source_item_id IS 'Content item where this relationship was found';

-- Indexes
CREATE INDEX idx_entity_relationships_source ON entity_relationships(source_entity);
CREATE INDEX idx_entity_relationships_target ON entity_relationships(target_entity);
CREATE INDEX idx_entity_relationships_content ON entity_relationships(source_item_id);
CREATE INDEX idx_entity_relationships_type ON entity_relationships(relationship_type);

-- ---------------------------------------------------------------------------
-- 3. notes column on content_items
-- ---------------------------------------------------------------------------
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS notes text;
COMMENT ON COLUMN content_items.notes IS 'Editorial guidance and internal notes — not included in search or AI responses';

-- ---------------------------------------------------------------------------
-- 4. RLS policies — match existing project pattern
-- ---------------------------------------------------------------------------

-- entity_mentions
ALTER TABLE entity_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view entity mentions"
  ON entity_mentions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Editors and admins can insert entity mentions"
  ON entity_mentions FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Editors and admins can update entity mentions"
  ON entity_mentions FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Admins can delete entity mentions"
  ON entity_mentions FOR DELETE TO authenticated
  USING (get_user_role() = 'admin');

-- entity_relationships
ALTER TABLE entity_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view entity relationships"
  ON entity_relationships FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Editors and admins can insert entity relationships"
  ON entity_relationships FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Editors and admins can update entity relationships"
  ON entity_relationships FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Admins can delete entity relationships"
  ON entity_relationships FOR DELETE TO authenticated
  USING (get_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 5. RPC: get_entity_summary — query entities by name or type
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_entity_summary(
  p_entity_name text DEFAULT NULL,
  p_entity_type text DEFAULT NULL
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
  related AS (
    SELECT
      mc.canonical_name,
      mc.entity_type,
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
    FROM mention_counts mc
    LEFT JOIN entity_relationships er ON er.source_entity = mc.canonical_name
    LEFT JOIN entity_relationships er2 ON er2.target_entity = mc.canonical_name
    GROUP BY mc.canonical_name, mc.entity_type
  )
  SELECT
    mc.canonical_name,
    mc.entity_type,
    mc.mention_count,
    mc.content_item_ids,
    COALESCE(r.related_entities, '[]'::jsonb)
  FROM mention_counts mc
  LEFT JOIN related r ON r.canonical_name = mc.canonical_name AND r.entity_type = mc.entity_type
  ORDER BY mc.mention_count DESC;
END;
$$;

COMMENT ON FUNCTION get_entity_summary IS 'Query entity mentions with counts, content items, and related entities';

-- ---------------------------------------------------------------------------
-- 6. RPC: get_entity_relationships_rpc — query relationships for an entity
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_entity_relationships_rpc(
  p_entity_name text
)
RETURNS TABLE (
  source_entity text,
  relationship_type text,
  target_entity text,
  source_item_id uuid,
  confidence numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    er.source_entity,
    er.relationship_type,
    er.target_entity,
    er.source_item_id,
    er.confidence
  FROM entity_relationships er
  WHERE er.source_entity ILIKE '%' || p_entity_name || '%'
     OR er.target_entity ILIKE '%' || p_entity_name || '%'
  ORDER BY er.confidence DESC, er.created_at DESC;
END;
$$;

COMMENT ON FUNCTION get_entity_relationships_rpc IS 'Query entity relationships by entity name (matches both source and target)';

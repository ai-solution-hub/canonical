-- =============================================================================
-- Migration: Entity Normalisation Schema Changes
--
-- Part of Entity Normalisation (Context Graph Phase 2).
-- Adds columns for admin type overrides and normalisation version tracking,
-- extends the entity_type CHECK constraint to include 'product', and adds
-- a lowercase index for canonical_name lookups.
-- =============================================================================

-- 1. Add override column for admin-corrected entity types
ALTER TABLE entity_mentions
  ADD COLUMN IF NOT EXISTS entity_type_override text;

COMMENT ON COLUMN entity_mentions.entity_type_override
  IS 'Admin-set entity type that overrides AI-extracted type. NULL = use entity_type.';

-- 2. Add 'product' to entity_type CHECK constraint
--    Drop and recreate (Supabase does not support ALTER CONSTRAINT)
ALTER TABLE entity_mentions DROP CONSTRAINT IF EXISTS entity_mentions_entity_type_check;
ALTER TABLE entity_mentions ADD CONSTRAINT entity_mentions_entity_type_check
  CHECK (entity_type IN (
    'organisation', 'certification', 'regulation', 'framework',
    'capability', 'person', 'technology', 'project', 'sector', 'product'
  ));

-- 3. Add normalisation_version column to track which rules were applied
ALTER TABLE entity_mentions
  ADD COLUMN IF NOT EXISTS normalisation_version integer DEFAULT 1;

COMMENT ON COLUMN entity_mentions.normalisation_version
  IS 'Version of canonicalise() rules applied. Allows selective re-normalisation.';

-- 4. Create index for admin entity management queries
CREATE INDEX IF NOT EXISTS idx_entity_mentions_canonical_lower
  ON entity_mentions(LOWER(canonical_name));
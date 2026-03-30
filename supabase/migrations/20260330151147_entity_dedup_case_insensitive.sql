-- Phase 2a: Case-insensitive entity deduplication
-- Replace case-sensitive unique index with case-insensitive version.
-- This prevents duplicates like 'Nick McCallum' and 'Nick Mccallum'.

-- Step 1: Merge existing case-insensitive duplicates before creating the index.
-- Found: 'Nick McCallum' vs 'Nick Mccallum' for person/08726af7-27ec-4540-bf24-9f8332f22b17
-- Keep the correctly-cased version, delete the other.
DELETE FROM entity_mentions
WHERE id = '7c6c928b-185b-474d-9c30-19243d549a70';

-- Step 2: Drop the existing case-sensitive unique constraint
ALTER TABLE entity_mentions
  DROP CONSTRAINT IF EXISTS entity_mentions_canonical_name_entity_type_content_item_id_key;

-- Step 3: Create case-insensitive unique index
CREATE UNIQUE INDEX entity_mentions_unique_per_content_ci
  ON entity_mentions (LOWER(canonical_name), entity_type, content_item_id);

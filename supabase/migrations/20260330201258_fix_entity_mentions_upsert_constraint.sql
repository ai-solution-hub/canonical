-- Fix entity_mentions upsert constraint mismatch (production bug)
--
-- The S128 migration (20260330151147) replaced the case-sensitive unique
-- constraint with a functional index using LOWER(canonical_name). PostgreSQL's
-- ON CONFLICT clause cannot match functional/expression indexes -- only named
-- constraints or plain column lists.
--
-- Since classify.ts already lowercases canonical_name before insertion (line 476),
-- the LOWER() in the index is redundant. Replace with a plain unique constraint
-- that ON CONFLICT can match.

-- Step 1: Drop the functional index
DROP INDEX IF EXISTS entity_mentions_unique_per_content_ci;

-- Step 2: Create a plain unique constraint on the already-lowercase columns
ALTER TABLE entity_mentions
  ADD CONSTRAINT entity_mentions_canonical_name_entity_type_content_item_id_key
  UNIQUE (canonical_name, entity_type, content_item_id);

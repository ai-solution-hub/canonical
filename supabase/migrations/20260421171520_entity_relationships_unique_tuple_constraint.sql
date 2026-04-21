-- ============================================================
-- Entity relationships — UNIQUE tuple constraint (S183 WP1 G1)
-- ============================================================
-- The `entity_relationships` table has no uniqueness constraint
-- on (source_entity, relationship_type, target_entity,
-- source_item_id). Over the lifetime of the retiring project
-- (OLD, rovrymhhffssilaftdwd), repeated classification passes
-- inflated the table by ~51% (3,636 total rows vs 1,781 distinct
-- tuples). The rebuilt NEW project has not yet accumulated the
-- same volume (472 rows vs 454 distinct tuples), but without the
-- constraint the same drift is inevitable on any future
-- re-ingestion or batch reclassify.
--
-- Evidence: `docs/audits/entity-relationships-old-vs-new-diff-s182.md` §2.1
--
-- Fix shape:
--   1. Dedup existing rows (keep MIN(id) per tuple). GROUP BY
--      treats NULL source_item_id values as equal, so NULL-tuple
--      seed rows are collapsed correctly.
--   2. Create the UNIQUE INDEX with `NULLS NOT DISTINCT` so future
--      inserts of NULL-source_item_id tuples also collide — belt
--      and braces for seed data and pre-classify pipeline stages.
--      Requires PostgreSQL 15+ (NEW runs PG 17.6).
--   3. Insertion callsites catch `23505` gracefully — a duplicate
--      relationship is not an error from the app's perspective.
-- ============================================================

SET search_path = public, extensions;

-- Step 1: dedup existing rows. `row_number()` over the tuple
-- groups, keep row_num = 1 (smallest id). Uses a CTE for clarity.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY source_entity, relationship_type, target_entity, source_item_id
      ORDER BY id
    ) AS rn
  FROM entity_relationships
)
DELETE FROM entity_relationships
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- Step 2: unique constraint with NULLS NOT DISTINCT so NULL
-- source_item_id rows also participate. PG 15+ feature.
CREATE UNIQUE INDEX entity_relationships_unique_tuple
  ON entity_relationships (
    source_entity,
    relationship_type,
    target_entity,
    source_item_id
  )
  NULLS NOT DISTINCT;

-- Document the constraint for future readers.
COMMENT ON INDEX entity_relationships_unique_tuple IS
  'S183 WP1 G1 — prevents duplicate (source_entity, relationship_type, target_entity, source_item_id) rows from accumulating across re-ingestion and batch reclassify runs. NULLS NOT DISTINCT so NULL source_item_id seed tuples also collide.';

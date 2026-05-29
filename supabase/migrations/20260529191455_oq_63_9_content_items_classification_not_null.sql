-- ID-63.11 / OQ-63-9: enforce non-null classification on content_items.
--
-- cocoindex now persists primary_domain + primary_subtopic on every content_items
-- row ({63.5}-{63.10}). This migration backfills the historical rows that predate
-- that behaviour, then makes both columns NOT NULL with a 'unclassified' default.
--
-- The backfill runs BEFORE the constraints so the whole migration is reproducible
-- on prod later (the backfill is part of the migration, ratified by the product
-- owner per OQ-63-11). Statement order is load-bearing: backfill -> default ->
-- not-null.

-- 1. Backfill historical NULL classification rows.
UPDATE content_items SET primary_domain   = 'unclassified' WHERE primary_domain   IS NULL;
UPDATE content_items SET primary_subtopic = 'unclassified' WHERE primary_subtopic IS NULL;

-- 2. Set defaults so future inserts that omit classification are safe.
ALTER TABLE content_items ALTER COLUMN primary_domain   SET DEFAULT 'unclassified';
ALTER TABLE content_items ALTER COLUMN primary_subtopic SET DEFAULT 'unclassified';

-- 3. Enforce non-null now that no NULLs remain.
ALTER TABLE content_items ALTER COLUMN primary_domain   SET NOT NULL;
ALTER TABLE content_items ALTER COLUMN primary_subtopic SET NOT NULL;

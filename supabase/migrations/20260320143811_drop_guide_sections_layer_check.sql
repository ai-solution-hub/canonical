-- Drop hardcoded layer CHECK on guide_sections.
-- Application-level validation via Zod schemas (guide-schemas.ts)
-- already validates against the layer_vocabulary table dynamically.
-- This allows new layers to be added via the admin UI without migrations.

ALTER TABLE guide_sections
  DROP CONSTRAINT IF EXISTS guide_sections_layer_check;

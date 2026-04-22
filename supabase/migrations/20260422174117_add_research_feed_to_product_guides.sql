-- S189 WP5: Add Research Feed section to Product Guides
--
-- Gap analysis (docs/client-documentation/kb-hub-gap-analysis-response-s188.md
-- SS7.7) identified that Sector Guides (4) + Education Safeguarding + MAT
-- Auditing all have a 'Research Feed' section, but the 3 Product Guides
-- (LMS, Websites, Advanced Audits) do not. This migration closes that gap.
--
-- Pre-migration inventory (22/04/2026):
--   - Existing Research Feed rows (5): all have expected_layer = 'research',
--     content_type_filter = NULL, subtopic_filter = NULL, is_required = FALSE.
--     Sector Guides at display_order = 9; MAT Auditing at display_order = 12.
--   - Product Guide max display_order: 19 for all 3 guides (19 sections each).
--   - display_order = 20 is free on all 3 Product Guides.
--   - content_type_filter is scalar TEXT (not array). Existing Research Feed
--     sections use NULL for this column; product-level matching happens via the
--     guide's own domain_filter, not the section filter.
--
-- Guide IDs (verified via live query):
--   Advanced Audits: a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687
--   LMS:             f216848e-decf-4a86-a19f-f9907b6b55c8
--   Websites:        ff2b9333-80f7-41a7-88d8-82baeb65b20e
--
-- Idempotent: WHERE NOT EXISTS guard keyed on (guide_id, section_name).
-- No unique constraint on that pair, so ON CONFLICT is not available.

-- Advanced Audits Product Guide
INSERT INTO guide_sections (
    guide_id,
    section_name,
    description,
    expected_layer,
    subtopic_filter,
    content_type_filter,
    display_order,
    is_required,
    parent_section_id
)
SELECT
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'::uuid,
    'Research Feed',
    NULL,
    'research',
    NULL,
    NULL,
    20,
    FALSE,
    NULL
WHERE NOT EXISTS (
    SELECT 1 FROM guide_sections
     WHERE guide_id = 'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'::uuid
       AND section_name = 'Research Feed'
);

-- LMS Product Guide
INSERT INTO guide_sections (
    guide_id,
    section_name,
    description,
    expected_layer,
    subtopic_filter,
    content_type_filter,
    display_order,
    is_required,
    parent_section_id
)
SELECT
    'f216848e-decf-4a86-a19f-f9907b6b55c8'::uuid,
    'Research Feed',
    NULL,
    'research',
    NULL,
    NULL,
    20,
    FALSE,
    NULL
WHERE NOT EXISTS (
    SELECT 1 FROM guide_sections
     WHERE guide_id = 'f216848e-decf-4a86-a19f-f9907b6b55c8'::uuid
       AND section_name = 'Research Feed'
);

-- Websites Product Guide
INSERT INTO guide_sections (
    guide_id,
    section_name,
    description,
    expected_layer,
    subtopic_filter,
    content_type_filter,
    display_order,
    is_required,
    parent_section_id
)
SELECT
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e'::uuid,
    'Research Feed',
    NULL,
    'research',
    NULL,
    NULL,
    20,
    FALSE,
    NULL
WHERE NOT EXISTS (
    SELECT 1 FROM guide_sections
     WHERE guide_id = 'ff2b9333-80f7-41a7-88d8-82baeb65b20e'::uuid
       AND section_name = 'Research Feed'
);

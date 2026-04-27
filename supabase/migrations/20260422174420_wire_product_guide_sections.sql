-- Wire Product Guide section filters (S189 WP4)
--
-- Populates `subtopic_filter` on all 57 guide_sections rows across the 3
-- Product Guides (LMS, Websites, Advanced Audits) so each section resolves
-- content via the `get_guide_content` RPC.
--
-- CONTEXT
-- -------
-- All 3 Product Guides share `domain_filter = 'product-feature'` and the
-- same 19-section structure (identical section_name, display_order, and
-- expected_layer per section). Prior to this migration, every section had
-- `subtopic_filter IS NULL` and `content_type_filter IS NULL`, causing
-- the RPC to match ALL domain-scoped items into EVERY section (no
-- narrowing). This migration sets `subtopic_filter` to give each section
-- a specific taxonomy lens.
--
-- RESOLUTION LOGIC (get_guide_content RPC)
-- ----------------------------------------
--   Content item matches a section when:
--     1. ci.primary_domain = g.domain_filter OR ci.secondary_domain = g.domain_filter
--     2. gs.subtopic_filter IS NULL OR ci.primary_subtopic = gs.subtopic_filter
--        OR ci.secondary_subtopic = gs.subtopic_filter
--     3. gs.expected_layer IS NULL OR ci.layer = gs.expected_layer
--     4. gs.content_type_filter IS NULL OR ci.content_type = gs.content_type_filter
--
-- INVENTORY (22/04/2026, 'r' rovrymhhffssilaftdwd)
-- --------------------------------------------------
-- Guides (guide_type = 'product'):
--   f216848e-decf-4a86-a19f-f9907b6b55c8  LMS Product Guide          (lms-product)
--   ff2b9333-80f7-41a7-88d8-82baeb65b20e  Websites Product Guide     (websites-product)
--   a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687  Advanced Audits Product Guide (audits-product)
--
-- All 3 guides have domain_filter = 'product-feature'.
--
-- product-feature subtopics (taxonomy_subtopics, all active):
--   functionality, reporting, technical, usability
--
-- Additional subtopics used via secondary_domain or cross-domain matching:
--   approach, company-info, cyber-security, data-protection, deployment,
--   financial, integration, references, sla, standards, certification
--
-- SECTION-FILTER MAPPING RATIONALE
-- ---------------------------------
-- #  Section Name           subtopic_filter   expected_layer      Items on 'r'  Notes
-- 1  Elevator Pitch         functionality     sales_brief         14
-- 2  Key Features           functionality     sales_brief         14            Same pool as #1; sections curate differently
-- 3  Differentiators        approach          sales_brief          2            Methodology/approach items at sales layer
-- 4  Target Audience        company-info      sales_brief          4            Company context items (audience/positioning)
-- 5  Use Cases              functionality     bid_detail           28           Detailed functional use-case Q&As
-- 6  Pricing                financial         company_reference    0            CONTENT-POPULATION PENDING: no financial items at company_reference layer yet
-- 7  Objection Handling     approach          sales_brief          2            Methodology/approach at sales level
-- 8  Demo Flow              usability         sales_brief          8            UX/demo-relevant items
-- 9  Competitor Comparison  standards         bid_detail           11           Standards/benchmarking items for competitive context
-- 10 Success Stories        references        sales_brief          1            Client reference/case-study material
-- 11 Upsell Paths           company-info      sales_brief          4            Company positioning for cross-sell/upsell
-- 12 Technical Spec         technical         bid_detail           51           Core technical detail items
-- 13 Security & Compliance  cyber-security    bid_detail            9           Security-focused items
-- 14 Implementation         deployment        bid_detail            2           Deployment/rollout items
-- 15 SLAs                   sla               company_reference     1           Service-level items
-- 16 Integrations           integration       bid_detail            5           Integration-specific items
-- 17 Data Handling          data-protection   company_reference     0           CONTENT-POPULATION PENDING: 18 data-protection items exist in product-feature domain but none at company_reference layer (5 exist at company_reference in other domains; not visible to Product Guides whose domain_filter is product-feature)
-- 18 Accessibility          usability         bid_detail           38           Accessibility/UX items at detail layer
-- 19 Certifications         certification     company_reference     0           CONTENT-POPULATION PENDING: no certification items at company_reference layer yet
--
-- CONTENT-POPULATION PENDING sections (3 of 19, repeated across 3 guides = 9 of 57):
--   - Pricing (#6): subtopic 'financial' is semantically correct; content at company_reference layer needs loading
--   - Data Handling (#17): subtopic 'data-protection' is semantically correct; 18 items in product-feature domain exist but all at bid_detail/sales_brief layers (5 items at company_reference exist only in other domains, not visible via product-feature domain_filter)
--   - Certifications (#19): subtopic 'certification' is semantically correct; no certification-tagged items exist yet in product-feature domain
--
-- IDEMPOTENCY: Uses WHERE subtopic_filter IS NULL guard on each UPDATE
-- to prevent overwriting any filters set by a later migration or manual edit.
--
-- POST-S4 EDIT 2026-04-27: Wrapped body in DO block gated by EXISTS check
-- on the 3 Product Guide parent rows. Documents the runtime-data assumption
-- that was implicit in the original migration.
-- Already applied on prod (schema_migrations records this version) — no re-apply.
-- On data-empty branches: DO block body skips because parents don't exist yet.
--

-- Update all 3 Product Guides in a single pass using a joined UPDATE.
-- The section_name + expected_layer combination is unique within each guide
-- and identical across all 3 guides, so we can target by guide_id + section_name.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM guides
     WHERE id IN (
       'f216848e-decf-4a86-a19f-f9907b6b55c8'::uuid,
       'ff2b9333-80f7-41a7-88d8-82baeb65b20e'::uuid,
       'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'::uuid
     )
  ) THEN
UPDATE guide_sections
SET subtopic_filter = 'functionality',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Elevator Pitch'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'functionality',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Key Features'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'approach',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Differentiators'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'company-info',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Target Audience'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'functionality',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Use Cases'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'financial',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Pricing'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'approach',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Objection Handling'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'usability',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Demo Flow'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'standards',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Competitor Comparison'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'references',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Success Stories'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'company-info',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Upsell Paths'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'technical',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Technical Spec'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'cyber-security',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Security & Compliance'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'deployment',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Implementation'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'sla',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'SLAs'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'integration',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Integrations'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'data-protection',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Data Handling'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'usability',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Accessibility'
AND subtopic_filter IS NULL;

UPDATE guide_sections
SET subtopic_filter = 'certification',
    updated_at = NOW()
WHERE guide_id IN (
    'f216848e-decf-4a86-a19f-f9907b6b55c8',
    'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
    'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687'
)
AND section_name = 'Certifications'
AND subtopic_filter IS NULL;

  END IF;
END $$;

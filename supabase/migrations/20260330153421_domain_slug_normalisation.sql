-- Phase 3: Domain Slug Normalisation (ATOMIC)
-- All changes in a single migration to avoid a window where RPCs return zero results.
--
-- Current state (verified via live queries 2026-03-30):
--   - taxonomy_domains: 7 baseline (already slug format), 5 client (mixed-case)
--   - guides: 8 published, 7 with mixed-case domain_filter, 1 with 'corporate'
--   - governance_config: empty (0 rows)
--   - content_items: all primary_domain/secondary_domain already lowercase slugs
--     (no mixed-case values exist in content_items)

-- ============================================================================
-- 3a. Add display_name columns and rename taxonomy domain names to slugs
-- ============================================================================

-- Add display_name to taxonomy_domains
ALTER TABLE taxonomy_domains ADD COLUMN IF NOT EXISTS display_name varchar(100);

-- Add display_name to taxonomy_subtopics
ALTER TABLE taxonomy_subtopics ADD COLUMN IF NOT EXISTS display_name varchar(100);

-- Populate display_name from current names (before renaming)
UPDATE taxonomy_domains SET display_name = name;
UPDATE taxonomy_subtopics SET display_name = name;

-- Rename client domains to slug format
UPDATE taxonomy_domains SET name = 'safeguarding-child-protection'
WHERE name = 'Safeguarding & Child Protection';

UPDATE taxonomy_domains SET name = 'safeguarding-adults'
WHERE name = 'Safeguarding Adults';

UPDATE taxonomy_domains SET name = 'multi-academy-trusts'
WHERE name = 'Multi-Academy Trusts';

UPDATE taxonomy_domains SET name = 'education'
WHERE name = 'Education';

UPDATE taxonomy_domains SET name = 'products-services'
WHERE name = 'Products & Services';

-- ============================================================================
-- 3b. Update guide domain_filter values
-- ============================================================================

UPDATE guides SET domain_filter = 'safeguarding-child-protection'
WHERE domain_filter = 'Safeguarding & Child Protection';

UPDATE guides SET domain_filter = 'safeguarding-adults'
WHERE domain_filter = 'Safeguarding Adults';

UPDATE guides SET domain_filter = 'multi-academy-trusts'
WHERE domain_filter = 'Multi-Academy Trusts';

UPDATE guides SET domain_filter = 'education'
WHERE domain_filter = 'Education';

UPDATE guides SET domain_filter = 'products-services'
WHERE domain_filter = 'Products & Services';

-- ============================================================================
-- 3c. Update governance_config domain values
-- (Currently empty, but included for completeness and future-proofing)
-- ============================================================================

UPDATE governance_config SET domain = 'safeguarding-child-protection'
WHERE domain = 'Safeguarding & Child Protection';

UPDATE governance_config SET domain = 'safeguarding-adults'
WHERE domain = 'Safeguarding Adults';

UPDATE governance_config SET domain = 'multi-academy-trusts'
WHERE domain = 'Multi-Academy Trusts';

UPDATE governance_config SET domain = 'education'
WHERE domain = 'Education';

UPDATE governance_config SET domain = 'products-services'
WHERE domain = 'Products & Services';

-- ============================================================================
-- 3c2. Update content_items primary_domain and secondary_domain
-- (Live query confirmed no mixed-case values exist, but included for safety
--  in case content is classified between query time and migration push)
-- ============================================================================

-- primary_domain
UPDATE content_items SET primary_domain = 'safeguarding-child-protection'
WHERE primary_domain IN ('Safeguarding & Child Protection', 'Safeguarding & child protection');

UPDATE content_items SET primary_domain = 'safeguarding-adults'
WHERE primary_domain = 'Safeguarding Adults';

UPDATE content_items SET primary_domain = 'multi-academy-trusts'
WHERE primary_domain = 'Multi-Academy Trusts';

UPDATE content_items SET primary_domain = 'education'
WHERE primary_domain = 'Education';

UPDATE content_items SET primary_domain = 'products-services'
WHERE primary_domain = 'Products & Services';

-- secondary_domain
UPDATE content_items SET secondary_domain = 'safeguarding-child-protection'
WHERE secondary_domain IN ('Safeguarding & Child Protection', 'Safeguarding & child protection');

UPDATE content_items SET secondary_domain = 'safeguarding-adults'
WHERE secondary_domain = 'Safeguarding Adults';

UPDATE content_items SET secondary_domain = 'multi-academy-trusts'
WHERE secondary_domain = 'Multi-Academy Trusts';

UPDATE content_items SET secondary_domain = 'education'
WHERE secondary_domain = 'Education';

UPDATE content_items SET secondary_domain = 'products-services'
WHERE secondary_domain = 'Products & Services';

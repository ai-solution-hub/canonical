-- =============================================================================
-- Migration: Add provenance tracking to taxonomy + procurement compliance subtopics
--
-- 1. Adds provenance columns to taxonomy_domains and taxonomy_subtopics
--    to distinguish baseline, client-added, and system-recommended items.
-- 2. Adds description column to taxonomy_subtopics for classification context.
-- 3. Inserts 4 new procurement compliance subtopics identified during UAT
--    Scenario 1 (Standard Selection Questionnaire) as taxonomy blind spots.
-- 4. Backfills all existing rows with provenance = 'baseline'.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Provenance columns on taxonomy_domains
-- ---------------------------------------------------------------------------

ALTER TABLE taxonomy_domains
  ADD COLUMN IF NOT EXISTS provenance varchar NOT NULL DEFAULT 'baseline'
    CHECK (provenance IN ('baseline', 'client', 'recommended')),
  ADD COLUMN IF NOT EXISTS recommended_by text,
  ADD COLUMN IF NOT EXISTS recommended_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Provenance columns on taxonomy_subtopics
-- ---------------------------------------------------------------------------

ALTER TABLE taxonomy_subtopics
  ADD COLUMN IF NOT EXISTS provenance varchar NOT NULL DEFAULT 'baseline'
    CHECK (provenance IN ('baseline', 'client', 'recommended')),
  ADD COLUMN IF NOT EXISTS recommended_by text,
  ADD COLUMN IF NOT EXISTS recommended_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS description text;

-- ---------------------------------------------------------------------------
-- 3. Backfill existing rows with baseline provenance
-- ---------------------------------------------------------------------------

UPDATE taxonomy_domains
  SET provenance = 'baseline'
  WHERE provenance IS NULL OR provenance = 'baseline';

UPDATE taxonomy_subtopics
  SET provenance = 'baseline'
  WHERE provenance IS NULL OR provenance = 'baseline';

-- ---------------------------------------------------------------------------
-- 4. Insert new procurement compliance subtopics
--    These cover the 4 biggest coverage gaps found during UAT:
--    - Health & Safety (compliance domain)
--    - Environmental / carbon reduction (compliance domain)
--    - Modern slavery (compliance domain)
--    - Supply chain management (corporate domain)
-- ---------------------------------------------------------------------------

-- Get the compliance domain ID
DO $$
DECLARE
  v_compliance_id uuid;
  v_corporate_id uuid;
  v_max_compliance_order int;
  v_max_corporate_order int;
BEGIN
  SELECT id INTO v_compliance_id FROM taxonomy_domains WHERE name = 'compliance';
  SELECT id INTO v_corporate_id FROM taxonomy_domains WHERE name = 'corporate';

  -- Get current max display_order for each domain
  SELECT COALESCE(MAX(display_order), 0) INTO v_max_compliance_order
    FROM taxonomy_subtopics WHERE domain_id = v_compliance_id;

  SELECT COALESCE(MAX(display_order), 0) INTO v_max_corporate_order
    FROM taxonomy_subtopics WHERE domain_id = v_corporate_id;

  -- Insert compliance > health-and-safety
  INSERT INTO taxonomy_subtopics (domain_id, name, display_order, is_active, provenance, description)
  VALUES (
    v_compliance_id,
    'health-and-safety',
    v_max_compliance_order + 1,
    true,
    'baseline',
    'Health and safety policy, risk assessments, incident reporting, RIDDOR, CDM regulations'
  )
  ON CONFLICT DO NOTHING;

  -- Insert compliance > environmental
  INSERT INTO taxonomy_subtopics (domain_id, name, display_order, is_active, provenance, description)
  VALUES (
    v_compliance_id,
    'environmental',
    v_max_compliance_order + 2,
    true,
    'baseline',
    'Carbon reduction plan, net zero targets, environmental policy, ISO 14001, sustainability, PPN 06/20'
  )
  ON CONFLICT DO NOTHING;

  -- Insert compliance > modern-slavery
  INSERT INTO taxonomy_subtopics (domain_id, name, display_order, is_active, provenance, description)
  VALUES (
    v_compliance_id,
    'modern-slavery',
    v_max_compliance_order + 3,
    true,
    'baseline',
    'Modern slavery statement, supply chain due diligence, forced labour prevention, PPN 02/23'
  )
  ON CONFLICT DO NOTHING;

  -- Insert corporate > supply-chain
  INSERT INTO taxonomy_subtopics (domain_id, name, display_order, is_active, provenance, description)
  VALUES (
    v_corporate_id,
    'supply-chain',
    v_max_corporate_order + 1,
    true,
    'baseline',
    'Supply chain management, prompt payment, subcontractor oversight, PPN 02/23'
  )
  ON CONFLICT DO NOTHING;
END;
$$;

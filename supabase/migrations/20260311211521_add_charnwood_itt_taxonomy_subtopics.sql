-- =============================================================================
-- Migration: Add 5 taxonomy subtopics from Charnwood ITT template analysis
--
-- These subtopics were identified as gaps during UAT Scenario 2b (Session 83).
-- The Charnwood Borough Council ITT Services template requires content in areas
-- not covered by the existing taxonomy.
--
-- New subtopics:
--   compliance/equalities       — Equalities Act 2010 statements
--   compliance/safeguarding     — Safeguarding policy, DBS checks
--   corporate/financial-standing — Turnover, credit checks, bankruptcy declarations
--   corporate/references        — Contract references and case studies
--   corporate/methodology       — Method statements (service delivery approach)
--
-- Provenance: 'recommended' with recommended_by = 'template-analysis'
-- =============================================================================

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

  -- compliance/equalities
  INSERT INTO taxonomy_subtopics (domain_id, name, display_order, is_active, provenance, recommended_by, recommended_at, description)
  VALUES (
    v_compliance_id,
    'equalities',
    v_max_compliance_order + 1,
    true,
    'recommended',
    'template-analysis',
    now(),
    'Equalities Act 2010, written equalities statement, equal opportunities policy, diversity and inclusion'
  )
  ON CONFLICT DO NOTHING;

  -- compliance/safeguarding
  INSERT INTO taxonomy_subtopics (domain_id, name, display_order, is_active, provenance, recommended_by, recommended_at, description)
  VALUES (
    v_compliance_id,
    'safeguarding',
    v_max_compliance_order + 2,
    true,
    'recommended',
    'template-analysis',
    now(),
    'Safeguarding policy, DBS checks, vulnerable persons, duty of care, child protection'
  )
  ON CONFLICT DO NOTHING;

  -- corporate/financial-standing
  INSERT INTO taxonomy_subtopics (domain_id, name, display_order, is_active, provenance, recommended_by, recommended_at, description)
  VALUES (
    v_corporate_id,
    'financial-standing',
    v_max_corporate_order + 1,
    true,
    'recommended',
    'template-analysis',
    now(),
    'Turnover thresholds, credit checks, bankruptcy declarations, financial statements, accounts'
  )
  ON CONFLICT DO NOTHING;

  -- corporate/references
  INSERT INTO taxonomy_subtopics (domain_id, name, display_order, is_active, provenance, recommended_by, recommended_at, description)
  VALUES (
    v_corporate_id,
    'references',
    v_max_corporate_order + 2,
    true,
    'recommended',
    'template-analysis',
    now(),
    'Contract references, case studies, testimonials, client referees, past performance evidence'
  )
  ON CONFLICT DO NOTHING;

  -- corporate/methodology
  INSERT INTO taxonomy_subtopics (domain_id, name, display_order, is_active, provenance, recommended_by, recommended_at, description)
  VALUES (
    v_corporate_id,
    'methodology',
    v_max_corporate_order + 3,
    true,
    'recommended',
    'template-analysis',
    now(),
    'Method statements, service delivery approach, working arrangements, key steps, efficiencies, risk mitigation'
  )
  ON CONFLICT DO NOTHING;
END;
$$;
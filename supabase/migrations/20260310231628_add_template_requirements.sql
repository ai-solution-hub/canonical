-- Template Requirements table for template-driven KB completeness
-- Phase 1: Data model only (spec: docs/plans/template-driven-completeness-spec.md §2.1)
--
-- Stores structured metadata about what each bid template section requires.
-- Each row represents one requirement within a template section.

SET search_path TO public, extensions;

-- =============================================================================
-- 1. Create template_requirements table
-- =============================================================================

CREATE TABLE template_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Template identity
  template_name text NOT NULL,        -- e.g. 'Standard Selection Questionnaire'
  template_version text,              -- e.g. 'PPN 03/24'
  template_type text NOT NULL
    CHECK (template_type IN ('sq', 'rfp', 'eqq', 'gcloud', 'method_statement', 'dos', 'dps', 'framework', 'other')),

  -- Section structure
  section_ref text NOT NULL,          -- e.g. 'Part 3 Section 11'
  section_name text NOT NULL,         -- e.g. 'Carbon Reduction'
  question_number int,                -- e.g. 1, 2 (within section)

  -- Requirement definition
  requirement_text text NOT NULL,     -- What the template asks for (raw question wording)
  description text,                   -- User-friendly summary for display in gap checklists
  requirement_type text NOT NULL
    CHECK (requirement_type IN (
      'policy',           -- Formal policy document
      'statement',        -- Written statement or declaration
      'evidence',         -- Proof/certification/audit result
      'data',             -- Factual data (numbers, dates, references)
      'narrative',        -- Descriptive text about approach/methodology
      'declaration',      -- Yes/no or signatory declaration
      'reference'         -- Case study or reference
    )),

  -- Taxonomy mapping
  primary_domain varchar,             -- Maps to taxonomy domain (nullable — some reqs are cross-domain)
  primary_subtopic varchar,           -- Maps to taxonomy subtopic
  secondary_domain varchar,
  secondary_subtopic varchar,

  -- Matching guidance
  matching_keywords text[],           -- Keywords for semantic matching against KB content
  matching_guidance text,             -- Free text guidance for AI matching
  requirement_embedding vector(1024), -- Pre-computed for semantic matching against KB content

  -- Metadata
  is_mandatory boolean DEFAULT true,  -- Whether this section is always required
  is_current boolean DEFAULT true,    -- Version flag: false for superseded versions
  sector_applicability text[],        -- e.g. ['it', 'construction', 'consulting'] or NULL for universal
  word_limit_guidance int,            -- Typical word limit for responses
  display_order int NOT NULL DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(template_name, template_version, section_ref, question_number)
);

-- Indexes
CREATE INDEX idx_template_reqs_template ON template_requirements(template_name, template_version);
CREATE INDEX idx_template_reqs_domain ON template_requirements(primary_domain, primary_subtopic);
CREATE INDEX idx_template_reqs_sector ON template_requirements USING GIN (sector_applicability);
CREATE INDEX idx_template_reqs_current ON template_requirements(template_name, is_current) WHERE is_current = true;

-- Auto-update updated_at on modification (reuses existing trigger function)
CREATE TRIGGER set_template_requirements_updated_at
  BEFORE UPDATE ON template_requirements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 2. Add FK from bid_questions to template_requirements
-- =============================================================================

ALTER TABLE bid_questions
  ADD COLUMN template_requirement_id uuid REFERENCES template_requirements(id);

-- =============================================================================
-- 3. RLS policies
-- =============================================================================

ALTER TABLE template_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "template_requirements_select" ON template_requirements FOR SELECT
  TO authenticated USING (TRUE);

CREATE POLICY "template_requirements_insert" ON template_requirements FOR INSERT
  TO authenticated WITH CHECK (get_user_role() IN ('admin', 'editor'));

CREATE POLICY "template_requirements_update" ON template_requirements FOR UPDATE
  TO authenticated USING (get_user_role() IN ('admin', 'editor'));

CREATE POLICY "template_requirements_delete" ON template_requirements FOR DELETE
  TO authenticated USING (get_user_role() = 'admin');

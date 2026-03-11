-- Migration: add_pqq_template_type
-- Adds 'pqq' (Pre-Qualification Questionnaire) to the template_requirements
-- template_type CHECK constraint. PQQs are common in construction and
-- engineering procurement.

-- Drop and re-create the CHECK constraint with the new value
ALTER TABLE template_requirements
  DROP CONSTRAINT IF EXISTS template_requirements_template_type_check;

ALTER TABLE template_requirements
  ADD CONSTRAINT template_requirements_template_type_check
  CHECK (template_type IN (
    'sq', 'rfp', 'eqq', 'pqq', 'gcloud',
    'method_statement', 'dos', 'dps', 'framework', 'other'
  ));
-- Add dedicated form-level metadata columns to form_templates.
-- v1.1 promotes facets currently packed into description / structure_path into
-- first-class columns. v1 writes to these from day one (no packing prose).

ALTER TABLE public.form_templates
  ADD COLUMN form_type text NULL REFERENCES public.form_types(key);
COMMENT ON COLUMN public.form_templates.form_type IS
  'FK to form_types.key — the form-type CV value '
  '(matches FormMetadata.form_type per CV-lockstep, TECH §2.6b). '
  'NULL permitted for app_upload rows pre-classification.';

ALTER TABLE public.form_templates
  ADD COLUMN deadline timestamptz NULL;
COMMENT ON COLUMN public.form_templates.deadline IS
  'Form submission deadline parsed from the source form (Inv-7 substrate). '
  'NULL = no deadline expressed.';

ALTER TABLE public.form_templates
  ADD COLUMN issuing_organisation text NULL;
COMMENT ON COLUMN public.form_templates.issuing_organisation IS
  'Issuing-organisation string parsed from the source form (Inv-7 substrate). '
  'NULL = no issuer expressed.';

ALTER TABLE public.form_templates
  ADD COLUMN evaluation_methodology text NULL;
COMMENT ON COLUMN public.form_templates.evaluation_methodology IS
  'Evaluation-methodology string parsed from the source form (Inv-7 substrate). '
  'Replaces the v1-deferred description-packing scheme. '
  'NULL = no methodology expressed.';

-- Partial index on form_type for downstream filters (T10 / observability).
CREATE INDEX IF NOT EXISTS idx_form_templates_form_type
  ON public.form_templates (form_type) WHERE form_type IS NOT NULL;

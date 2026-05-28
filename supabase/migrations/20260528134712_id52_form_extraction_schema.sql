-- ID-52 Migration M1 — form-extraction schema additions + CHECK widening
-- Spec: docs/specs/form-extraction/TECH.md §2.6 M1
-- Maps to PRODUCT: Inv-1 (CV lockstep), Inv-7 (form-level metadata persistence),
-- Inv-10 (mandatory column), Inv-14 (reference URLs column),
-- Inv-5 (resolution-failure status surfacing via _emit_stage_error_log).
--
-- Pre-push OQ-52-WAVE-1-B verification:
--   form_templates row_count = 0 (no existing rows to violate the widened CHECK)
--   current CHECK = DOCX-only (matches documented pre-state)
--   No backfill required; pure forward-compatible widening + additive columns.

-- 1. Widen form_templates.mime_type CHECK to include PDF + XLSX (was DOCX-only).
ALTER TABLE public.form_templates
  DROP CONSTRAINT form_templates_mime_type_check;
ALTER TABLE public.form_templates
  ADD CONSTRAINT form_templates_mime_type_check CHECK (
    mime_type IN (
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', -- DOCX
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       -- XLSX
      'application/pdf'                                                          -- PDF
    )
  );

-- 2. Add is_mandatory to form_template_fields (Inv-10 substrate).
ALTER TABLE public.form_template_fields
  ADD COLUMN is_mandatory boolean NULL;
COMMENT ON COLUMN public.form_template_fields.is_mandatory IS
  'Explicit mandatory/optional flag from the source form (Inv-10). '
  'NULL = form expressed no such status (NOT defaulted to optional).';

-- 3. Add reference_urls to form_template_fields (Inv-14 substrate).
ALTER TABLE public.form_template_fields
  ADD COLUMN reference_urls text[] NULL;
COMMENT ON COLUMN public.form_template_fields.reference_urls IS
  'External URLs preserved from the source form question / section (Inv-14). '
  'NULL or [] = no reference URLs on this field.';

-- 4. Add ingest_source to form_templates (provenance: pipeline vs app).
ALTER TABLE public.form_templates
  ADD COLUMN ingest_source text NOT NULL DEFAULT 'pipeline' CHECK (
    ingest_source IN ('pipeline', 'app_upload')
  );
COMMENT ON COLUMN public.form_templates.ingest_source IS
  'Provenance of this template row. v1 = pipeline (folder→workspace). '
  'app_upload reserved for the thin UI front-end per OQ-52-UI-UPLOAD-TENSION.';

-- Inv-5 (workspace-resolution failure) surfacing is handled in code via
-- _emit_stage_error_log + zero form_template_fields + zero form_templates rows
-- (see TECH §2.5 step 1). No new form_templates.status CHECK value is added — a
-- 'failed_workspace_resolution' row is schema-impossible because
-- form_templates.workspace_id is NOT NULL and no workspace_id is resolved on
-- this failure path.

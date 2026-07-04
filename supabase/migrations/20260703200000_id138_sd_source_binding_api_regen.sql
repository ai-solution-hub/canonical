-- ID-138 {138.5} companion — api.source_documents regen for the 7
-- source-binding columns added by 20260703160050_id138_sd_source_binding_cols.sql
-- (origin_type, locator, retention_class, cadence, auth, admission_status,
-- logical_path).
--
-- Root cause: same ADD-COLUMN staleness class as 20260703190000 (DR-030
-- extended). 20260703160050 ADDed columns to public.source_documents without a
-- companion api.* view regen, and it sorts BEFORE 20260703190000 — whose
-- hand-cut column list was byte-sourced from the PRE-batch staging catalog and
-- therefore could not include them. Result: after the S445 GO#2 staging apply,
-- api.source_documents was immediately stale again by exactly these 7 columns
-- (confirmed by a live full-surface public-vs-api information_schema diff on
-- staging — the ONLY gap on the whole api surface).
--
-- Caught in the post-apply staging verification BEFORE the prod push, so prod
-- receives this fix in its first batch and never exposes the gap.
--
-- HOW: same convention as 20260628200001 / 20260703180000 §1 / 20260703190000 —
-- bare column list in live attnum order (44 cols; the pre-existing dropped
-- attnum is skipped by sourcing from the live catalog), security_invoker,
-- INV-10 grants (anon SELECT-only; authenticated/service_role full CRUD).
-- {131.19}'s eventual whole-surface G-API regen supersedes this idempotently.

DROP VIEW IF EXISTS api.source_documents;
CREATE VIEW api.source_documents WITH (security_invoker = true) AS
  SELECT
    id,
    filename,
    original_filename,
    mime_type,
    file_size,
    content_hash,
    version,
    parent_id,
    storage_path,
    status,
    extracted_text,
    extraction_metadata,
    workspace_id,
    pipeline_run_id,
    uploaded_by,
    created_at,
    archived_at,
    archived_by,
    op_id,
    extraction_method,
    source_url,
    primary_domain,
    primary_subtopic,
    secondary_domain,
    secondary_subtopic,
    ai_keywords,
    summary,
    suggested_title,
    classified_at,
    classification_confidence,
    classification_reasoning,
    content_type,
    captured_date,
    summary_data,
    updated_by,
    updated_at,
    publication_status,
    origin_type,
    locator,
    retention_class,
    cadence,
    auth,
    admission_status,
    logical_path
  FROM public.source_documents;
GRANT SELECT ON api.source_documents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.source_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.source_documents TO service_role;

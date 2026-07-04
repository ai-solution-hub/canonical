-- ID-131 {131.34} G-API-HOTFIX — pre-apply api.source_documents /
-- api.citations / api.reference_items view regen (ADD COLUMN class, not a
-- rename). Surfaced by {131.33}'s full-corpus api.* view staleness audit
-- (Part B, full 63-table sweep — orthogonal to {131.33}'s own RENAME-only
-- mandate, which passed clean). Audit artefact:
-- s445-131-33-api-view-audit.md.
--
-- Root cause: 20260628191700_id131_sd_classification_cols.sql and
-- 20260628191703_id131_cite_ext_winrate_fix.sql each ran a plain
-- ALTER TABLE ... ADD COLUMN against a public.* SURFACE_TABLES entry but
-- were never followed by a companion api.* view regen. Unlike a column
-- RENAME (which a dependent view auto-tracks by attnum — see
-- 20260703180000's §0), an ADD COLUMN is invisible to an existing view
-- entirely: the view's SELECT list was fixed at CREATE VIEW time and simply
-- does not mention the new column, so it silently keeps "working" while
-- omitting data every api.* reader actually needs. Both source migrations
-- are already applied on staging; only the api.* view side is stale.
--
-- LIVE BREAK (this migration fixes): api.source_documents is missing 16
-- cols (primary_domain, primary_subtopic, secondary_domain,
-- secondary_subtopic, ai_keywords, summary, suggested_title, classified_at,
-- classification_confidence, classification_reasoning, content_type,
-- captured_date, summary_data, updated_by, updated_at, publication_status).
-- Confirmed live 42703 ("column suggested_title does not exist") against
-- staging (rbwqewalexrzgxtvcqrh) today. Live caller:
-- app/api/search/preview/route.ts:81
-- (`.from('source_documents').select('id, filename, suggested_title, primary_domain')`).
--
-- DORMANT (fixed in the same migration — no live TS caller found, but same
-- root cause/fix cost; closing now rather than leaving a 3rd stale view for
-- {131.19} to rediscover): api.citations is missing cited_reference_item_id,
-- cited_source_document_id, cited_concept_path. api.reference_items is
-- missing thumbnail_url, superseded_by.
--
-- OUT OF SCOPE (NOT touched here): api.record_lifecycle, api.record_embeddings
-- — no view exists for either yet; {131.19}'s G-API whole-surface regen owns
-- authoring them from scratch (see 20260703160000's own header deferral).
--
-- HOW: hand-authored from scripts/generate-api-views.ts's bare-column /
-- security_invoker / explicit-grant convention (same pattern as
-- 20260628200001_id131_extract_reparent_api_regen.sql and 20260703180000's
-- §1), scoped to EXACTLY these 3 views. Column lists sourced by querying
-- staging's live pg_attribute (attnum order, post both ADD COLUMN
-- migrations) rather than running the generator against a local stack —
-- byte-consistent with what {131.19}'s eventual whole-surface regen will
-- produce for these same 3 tables (existing columns keep their current
-- projected order; new columns append in the order they were added, which
-- is exactly attnum order). Grants mirror the current base-table ACL for
-- each table (anon/authenticated/service_role each already carry full
-- SELECT/INSERT/UPDATE/DELETE on all 3 base tables on staging); per the
-- generator's INV-10, anon is capped to SELECT-only on the view regardless.
-- Not run as scripts/generate-api-views.ts itself: that script has no
-- per-table scoping flag, and a full-surface regen now would be premature
-- while {131.19}'s other prerequisite Subtasks (15, 17, 18) are still
-- pending against other surface tables' schemas.
--
-- TIMING: lands in the same GO#2 push batch as 20260703180000 (must sort
-- after it so both apply together; no ordering dependency between the two
-- files themselves — disjoint table sets).

-- source_documents ─────────────────────────────────────────────────────────
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
    publication_status
  FROM public.source_documents;
GRANT SELECT ON api.source_documents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.source_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.source_documents TO service_role;

-- citations ────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.citations;
CREATE VIEW api.citations WITH (security_invoker = true) AS
  SELECT
    id,
    citing_kind,
    citing_form_response_id,
    cited_kind,
    cited_content_item_id,
    cited_q_a_pair_id,
    cited_version,
    cited_q_a_pair_version,
    citation_type,
    cited_text,
    cited_location_kind,
    cited_start,
    cited_end,
    created_at,
    created_by,
    cited_reference_item_id,
    cited_source_document_id,
    cited_concept_path
  FROM public.citations;
GRANT SELECT ON api.citations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.citations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.citations TO service_role;

-- reference_items ──────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.reference_items;
CREATE VIEW api.reference_items WITH (security_invoker = true) AS
  SELECT
    id,
    title,
    body,
    summary,
    source_url,
    published_at,
    primary_domain,
    primary_subtopic,
    layer,
    embedding,
    source_document_id,
    ingestion_source,
    op_id,
    created_at,
    updated_at,
    thumbnail_url,
    superseded_by
  FROM public.reference_items;
GRANT SELECT ON api.reference_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.reference_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.reference_items TO service_role;

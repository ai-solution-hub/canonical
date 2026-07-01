-- ID-131 {131.8} G-PIPELINE — M2 api regen (scoped to the 5 re-parented tables)
-- Companion to 20260628200000_id131_extract_reparent.sql. M2 renamed the parent
-- column on these 5 SURFACE_TABLES from content_item_id / source_item_id /
-- source_content_item_id -> source_document_id; this repoints the security_invoker
-- api.* views so the projected column matches, keeping the app's api.* readers
-- working with NO transient break in the {131.8}->{131.19} window.
--
-- Hand-authored from `scripts/generate-api-views.ts` output (bare-column,
-- security_invoker, explicit-grant pattern) for EXACTLY these 5 views. The
-- {131.19} G-API whole-surface regen supersedes this migration later.

-- content_chunks ───────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.content_chunks;
CREATE VIEW api.content_chunks WITH (security_invoker = true) AS
  SELECT
    id,
    source_document_id,
    heading_text,
    heading_level,
    heading_path,
    content,
    position,
    parent_chunk_id,
    embedding,
    char_count,
    word_count,
    created_at,
    updated_at,
    op_id
  FROM public.content_chunks;
GRANT SELECT ON api.content_chunks TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.content_chunks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.content_chunks TO service_role;

-- entity_mentions ──────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.entity_mentions;
CREATE VIEW api.entity_mentions WITH (security_invoker = true) AS
  SELECT
    id,
    source_document_id,
    entity_type,
    entity_name,
    canonical_name,
    confidence,
    context_snippet,
    created_at,
    entity_type_override,
    normalisation_version,
    metadata,
    op_id
  FROM public.entity_mentions;
GRANT SELECT ON api.entity_mentions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.entity_mentions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.entity_mentions TO service_role;

-- entity_relationships ─────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.entity_relationships;
CREATE VIEW api.entity_relationships WITH (security_invoker = true) AS
  SELECT
    id,
    source_entity,
    relationship_type,
    target_entity,
    source_document_id,
    confidence,
    created_at
  FROM public.entity_relationships;
GRANT SELECT ON api.entity_relationships TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.entity_relationships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.entity_relationships TO service_role;

-- classification_disputes ──────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.classification_disputes;
CREATE VIEW api.classification_disputes WITH (security_invoker = true) AS
  SELECT
    id,
    source_document_id,
    disputed_by,
    disputed_field,
    current_value,
    proposed_value,
    rationale,
    status,
    resolved_by,
    resolved_at,
    resolution_notes,
    created_at,
    updated_at
  FROM public.classification_disputes;
GRANT SELECT ON api.classification_disputes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.classification_disputes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.classification_disputes TO service_role;

-- q_a_extractions ──────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.q_a_extractions;
CREATE VIEW api.q_a_extractions WITH (security_invoker = true) AS
  SELECT
    id,
    source_document_id,
    extractor_kind,
    extracted_question_text,
    extracted_answer_text,
    extraction_metadata,
    promoted_to_pair_id,
    invalidated_at,
    created_at,
    updated_at,
    op_id,
    expected_response_kind,
    evaluation_criteria,
    evidence_requirements,
    scope_tags,
    alternate_question_phrasings
  FROM public.q_a_extractions;
GRANT SELECT ON api.q_a_extractions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.q_a_extractions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.q_a_extractions TO service_role;

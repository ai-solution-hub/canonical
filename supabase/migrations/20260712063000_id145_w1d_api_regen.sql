-- ID-145 {145.6} W1d — api.* view regen for the W1c rename/reshape (TECH.md §2
-- M4; DR-030/DR-032). Sorted AFTER W1c (rename/reshape) so it operates on the
-- new table/column names.
--
-- HAND-AUTHORED, NOT GENERATOR OUTPUT: `scripts/generate-api-views.ts` requires
-- introspecting a LIVE Postgres catalog with W1a-c already applied (default
-- target 127.0.0.1:54322, or $API_VIEWS_DB_URL) — this worktree is under the
-- explicit "author + statically validate only, do NOT apply/push any migration"
-- constraint for this Subtask (staging DB shared with parallel sessions; the
-- push is an Orchestrator-gated integration step), so there is no live-applied
-- schema to introspect. Per the {145.6} brief's own fallback clause ("otherwise
-- author the views in the migration per DR-030/032"), this file is hand-authored
-- against the LATEST known-live column lists (grep-verified against every
-- subsequent api-view-touching migration after the last full regen,
-- 20260706150000_id131_api_views_regen2.sql — specifically
-- 20260708130000_id130_rename_content_ids_columns.sql for
-- api.form_questions' matched_record_ids and
-- 20260707200000_id130_form_requirement_embedding_migrate.sql for
-- api.form_template_requirements' dropped requirement_embedding), scoped to
-- ONLY the 7 views whose base table/columns W1c changed. The Orchestrator
-- should re-run `bun scripts/generate-api-views.ts --check` post-push to
-- confirm this hand-authored file matches the generator's own output
-- byte-for-byte (INV-16 idempotency) and correct it via a follow-up regen if
-- not — this file does not claim generator parity, only correctness against
-- the schema as authored.
--
-- Grant pattern mirrors every view in the surface identically (anon SELECT
-- only, authenticated/service_role full CRUD, security_invoker=true) — see
-- generate-api-views.ts header §3 "least-privilege grants".
SET search_path = public, extensions;

-- form_instances (was form_templates) ──────────────────────────────────────
DROP VIEW IF EXISTS api.form_templates;
DROP VIEW IF EXISTS api.form_instances;
CREATE VIEW api.form_instances WITH (security_invoker = true) AS
  SELECT
    id,
    name,
    description,
    filename,
    storage_path,
    file_size,
    mime_type,
    processing_status,
    field_count,
    mapped_count,
    structure_path,
    created_by,
    created_at,
    updated_at,
    ingest_source,
    form_type,
    deadline,
    issuing_organisation,
    evaluation_methodology,
    status_reason,
    outcome,
    outcome_recorded_at,
    outcome_recorded_by,
    outcome_notes,
    submission_date,
    workflow_state,
    reference_number,
    estimated_value,
    engagement_group_id
  FROM public.form_instances;
GRANT SELECT ON api.form_instances TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_instances TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_instances TO service_role;

-- form_instance_fields (was form_template_fields) ──────────────────────────
DROP VIEW IF EXISTS api.form_template_fields;
DROP VIEW IF EXISTS api.form_instance_fields;
CREATE VIEW api.form_instance_fields WITH (security_invoker = true) AS
  SELECT
    id,
    form_instance_id,
    field_type,
    table_index,
    row_index,
    col_index,
    question_text,
    section_name,
    word_limit,
    placeholder_text,
    question_id,
    mapping_status,
    mapping_confidence,
    fill_status,
    fill_error,
    sequence,
    created_at,
    updated_at,
    is_mandatory,
    reference_urls
  FROM public.form_instance_fields;
GRANT SELECT ON api.form_instance_fields TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_instance_fields TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_instance_fields TO service_role;

-- form_requirement_templates (was form_template_requirements) ─────────────
DROP VIEW IF EXISTS api.form_template_requirements;
DROP VIEW IF EXISTS api.form_requirement_templates;
CREATE VIEW api.form_requirement_templates WITH (security_invoker = true) AS
  SELECT
    id,
    template_name,
    template_version,
    template_type,
    section_ref,
    section_name,
    question_number,
    requirement_text,
    description,
    requirement_type,
    primary_domain,
    primary_subtopic,
    secondary_domain,
    secondary_subtopic,
    matching_keywords,
    matching_guidance,
    is_mandatory,
    is_current,
    sector_applicability,
    word_limit_guidance,
    display_order,
    created_at,
    updated_at
  FROM public.form_requirement_templates;
GRANT SELECT ON api.form_requirement_templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_requirement_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_requirement_templates TO service_role;

-- form_questions (workspace_id + matched_record_ids dropped, form_template_id
-- renamed form_instance_id) ─────────────────────────────────────────────────
DROP VIEW IF EXISTS api.form_questions;
CREATE VIEW api.form_questions WITH (security_invoker = true) AS
  SELECT
    id,
    section_name,
    section_sequence,
    question_sequence,
    question_text,
    word_limit,
    evaluation_weight,
    confidence_posture,
    status,
    has_variants,
    assigned_to,
    created_by,
    created_at,
    updated_at,
    template_requirement_id,
    form_instance_id
  FROM public.form_questions;
GRANT SELECT ON api.form_questions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_questions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_questions TO service_role;

-- q_a_pairs (source_workspace_id dropped, source_form_template_id renamed
-- source_form_instance_id) ──────────────────────────────────────────────────
DROP VIEW IF EXISTS api.q_a_pairs;
CREATE VIEW api.q_a_pairs WITH (security_invoker = true) AS
  SELECT
    id,
    question_text,
    answer_standard,
    answer_advanced,
    scope_tag,
    anti_scope_tag,
    origin_kind,
    publication_status,
    superseded_by,
    valid_from,
    valid_to,
    created_at,
    updated_at,
    alternate_question_phrasings,
    edit_intent,
    source_form_response_id,
    source_question_id,
    source_document_id,
    source_form_instance_id
  FROM public.q_a_pairs;
GRANT SELECT ON api.q_a_pairs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.q_a_pairs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.q_a_pairs TO service_role;

-- q_a_pair_dedup_proposals (pair_a/b_source_workspace_id dropped) ──────────
DROP VIEW IF EXISTS api.q_a_pair_dedup_proposals;
CREATE VIEW api.q_a_pair_dedup_proposals WITH (security_invoker = true) AS
  SELECT
    id,
    pair_a_id,
    pair_b_id,
    similarity_score,
    proposed_survivor_id,
    survivor_reason,
    status,
    pair_a_source_form_response_id,
    pair_b_source_form_response_id,
    pair_a_fingerprint,
    pair_b_fingerprint,
    resolved_survivor_id,
    resolved_by,
    created_at,
    resolved_at
  FROM public.q_a_pair_dedup_proposals;
GRANT SELECT ON api.q_a_pair_dedup_proposals TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.q_a_pair_dedup_proposals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.q_a_pair_dedup_proposals TO service_role;

-- template_completions (template_id renamed form_instance_id) ─────────────
DROP VIEW IF EXISTS api.template_completions;
CREATE VIEW api.template_completions WITH (security_invoker = true) AS
  SELECT
    id,
    form_instance_id,
    job_id,
    storage_path,
    fields_filled,
    fields_skipped,
    fields_failed,
    file_size,
    created_by,
    created_at
  FROM public.template_completions;
GRANT SELECT ON api.template_completions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.template_completions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.template_completions TO service_role;

-- engagement_groups: NEW table (W1c STEP 6) — deliberately NOT added to the
-- api.* Data API surface here. TECH.md §2 M3's RLS note says "no anon grants"
-- for this table, a stricter posture than the blanket surface pattern every
-- view above uses (anon SELECT on every other view), and no {145.6}/{145.7}
-- app code reads/writes it yet (grouping surfaces land in {145.19}, W4).
-- Classified INTERNAL_ONLY in scripts/check-api-view-coverage.ts (same commit)
-- rather than left unclassified — an unclassified new public table trips that
-- script's INV-16 coverage-drift check the first time it runs against a live
-- catalog post-push. Whichever {145.x} Subtask first needs API-reachable
-- engagement-group reads/writes moves it from INTERNAL_ONLY_TABLES to
-- SURFACE_TABLES and regenerates this view for real at that point.

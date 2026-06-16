-- =============================================================================
-- ID-115 — api Data API surface (GENERATED — do not hand-edit)
-- =============================================================================
--
-- Produced by scripts/generate-api-views.ts from the local Postgres catalog.
-- Re-run the generator (not a hand edit) after a public table/column/RPC lands;
-- the api-grant-guard drift check (ID-115 S10) fails CI on an un-mirrored table.
--
-- Views:     60 security_invoker 1:1 views (explicit cols, FK verbatim).
-- Functions: 65 INVOKER entrypoints/wrappers (search_path=public,extensions).
-- Grants:    views fail-closed (explicit GRANT, anon<=SELECT); functions REVOKE
--            EXECUTE FROM PUBLIC then GRANT mirrored roles (set_config sole anon-exec).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- VIEWS (60)
-- ----------------------------------------------------------------------------
-- ai_call_events ────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.ai_call_events;
CREATE VIEW api.ai_call_events WITH (security_invoker = true) AS
  SELECT
    id,
    touchpoint_id,
    model,
    tier,
    input_tokens,
    output_tokens,
    cache_read_tokens,
    cache_write_tokens,
    cost_usd,
    outcome_signal,
    created_at
  FROM public.ai_call_events;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.ai_call_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.ai_call_events TO service_role;

-- application_types ─────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.application_types;
CREATE VIEW api.application_types WITH (security_invoker = true) AS
  SELECT
    id,
    key,
    label,
    provenance,
    default_icon,
    default_colour,
    state_machine_config,
    created_at,
    updated_at,
    label_plural,
    description
  FROM public.application_types;
GRANT SELECT ON api.application_types TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.application_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.application_types TO service_role;

-- change_reports ────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.change_reports;
CREATE VIEW api.change_reports WITH (security_invoker = true) AS
  SELECT
    id,
    frequency,
    period_start,
    period_end,
    item_count,
    domain_summaries,
    narrative_summary,
    generated_at,
    generated_by,
    tokens_used,
    metadata,
    created_at,
    item_ids,
    created_by
  FROM public.change_reports;
GRANT SELECT ON api.change_reports TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.change_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.change_reports TO service_role;

-- citations ─────────────────────────────────────────────────────────────
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
    created_by
  FROM public.citations;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.citations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.citations TO service_role;

-- classification_disputes ───────────────────────────────────────────────
DROP VIEW IF EXISTS api.classification_disputes;
CREATE VIEW api.classification_disputes WITH (security_invoker = true) AS
  SELECT
    id,
    content_item_id,
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

-- company_profiles ──────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.company_profiles;
CREATE VIEW api.company_profiles WITH (security_invoker = true) AS
  SELECT
    id,
    name,
    slug,
    description,
    website_url,
    sectors,
    services,
    certifications,
    geographic_scope,
    competitors,
    target_customers,
    value_proposition,
    key_topics,
    is_active,
    created_at,
    updated_at,
    created_by,
    company_embedding,
    is_primary
  FROM public.company_profiles;
GRANT SELECT ON api.company_profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.company_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.company_profiles TO service_role;

-- content_chunks ────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.content_chunks;
CREATE VIEW api.content_chunks WITH (security_invoker = true) AS
  SELECT
    id,
    content_item_id,
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

-- content_history ───────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.content_history;
CREATE VIEW api.content_history WITH (security_invoker = true) AS
  SELECT
    id,
    content_item_id,
    version,
    title,
    content,
    brief,
    detail,
    reference,
    metadata,
    change_summary,
    change_type,
    created_by,
    created_at,
    change_reason,
    edit_intent,
    arbitration_inputs
  FROM public.content_history;
GRANT SELECT ON api.content_history TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.content_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.content_history TO service_role;

-- content_item_workspaces ───────────────────────────────────────────────
DROP VIEW IF EXISTS api.content_item_workspaces;
CREATE VIEW api.content_item_workspaces WITH (security_invoker = true) AS
  SELECT
    content_item_id,
    workspace_id,
    assigned_at,
    id
  FROM public.content_item_workspaces;
GRANT SELECT ON api.content_item_workspaces TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.content_item_workspaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.content_item_workspaces TO service_role;

-- content_items ─────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.content_items;
CREATE VIEW api.content_items WITH (security_invoker = true) AS
  SELECT
    id,
    title,
    content,
    content_type,
    platform,
    source_url,
    author_name,
    metadata,
    embedding,
    starred,
    quality_score,
    created_at,
    updated_at,
    created_by,
    updated_by,
    brief,
    detail,
    reference,
    source_domain,
    thumbnail_url,
    file_path,
    primary_domain,
    primary_subtopic,
    secondary_domain,
    secondary_subtopic,
    classification_confidence,
    classified_at,
    classification_reasoning,
    suggested_title,
    summary,
    ai_keywords,
    summary_data,
    user_tags,
    priority,
    captured_date,
    freshness,
    freshness_checked_at,
    lifecycle_type,
    expiry_date,
    previous_freshness,
    verified_at,
    verified_by,
    governance_review_status,
    governance_review_due,
    governance_reviewer_id,
    answer_standard,
    answer_advanced,
    archived_at,
    archived_by,
    archive_reason,
    content_owner_id,
    source_document_id,
    quality_score_updated_at,
    previous_quality_score,
    citation_count,
    source_file,
    layer,
    content_text_hash,  -- generated: passthrough (selectable, never insertable)
    classification_model,
    embedding_model,
    dedup_status,
    superseded_by,
    next_review_date,
    review_cadence_days,
    publication_status,
    ingestion_source,
    op_id
  FROM public.content_items;
GRANT SELECT ON api.content_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.content_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.content_items TO service_role;

-- content_propagation_version ───────────────────────────────────────────
DROP VIEW IF EXISTS api.content_propagation_version;
CREATE VIEW api.content_propagation_version WITH (security_invoker = true) AS
  SELECT
    payload_key,
    version,
    payload_checksum,
    applied_at
  FROM public.content_propagation_version;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.content_propagation_version TO service_role;

-- coverage_targets ──────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.coverage_targets;
CREATE VIEW api.coverage_targets WITH (security_invoker = true) AS
  SELECT
    id,
    domain_id,
    metric_name,
    target_value,
    created_by,
    updated_by,
    created_at,
    updated_at
  FROM public.coverage_targets;
GRANT SELECT ON api.coverage_targets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.coverage_targets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.coverage_targets TO service_role;

-- entity_aliases ────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.entity_aliases;
CREATE VIEW api.entity_aliases WITH (security_invoker = true) AS
  SELECT
    id,
    alias,
    canonical,
    provenance,
    is_active,
    created_at
  FROM public.entity_aliases;
GRANT SELECT ON api.entity_aliases TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.entity_aliases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.entity_aliases TO service_role;

-- entity_mentions ───────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.entity_mentions;
CREATE VIEW api.entity_mentions WITH (security_invoker = true) AS
  SELECT
    id,
    content_item_id,
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

-- entity_relationships ──────────────────────────────────────────────────
DROP VIEW IF EXISTS api.entity_relationships;
CREATE VIEW api.entity_relationships WITH (security_invoker = true) AS
  SELECT
    id,
    source_entity,
    relationship_type,
    target_entity,
    source_item_id,
    confidence,
    created_at
  FROM public.entity_relationships;
GRANT SELECT ON api.entity_relationships TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.entity_relationships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.entity_relationships TO service_role;

-- eval_baseline_audit ───────────────────────────────────────────────────
DROP VIEW IF EXISTS api.eval_baseline_audit;
CREATE VIEW api.eval_baseline_audit WITH (security_invoker = true) AS
  SELECT
    id,
    touchpoint_id,
    action,
    actor,
    registry_version,
    at
  FROM public.eval_baseline_audit;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.eval_baseline_audit TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.eval_baseline_audit TO service_role;

-- eval_baselines ────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.eval_baselines;
CREATE VIEW api.eval_baselines WITH (security_invoker = true) AS
  SELECT
    id,
    touchpoint_id,
    metrics,
    thresholds,
    registry_version,
    promoted_by,
    promoted_at
  FROM public.eval_baselines;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.eval_baselines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.eval_baselines TO service_role;

-- eval_runs ─────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.eval_runs;
CREATE VIEW api.eval_runs WITH (security_invoker = true) AS
  SELECT
    id,
    touchpoint_id,
    metrics,
    passed,
    severity_disposition,
    exit_class,
    run_at,
    source
  FROM public.eval_runs;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.eval_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.eval_runs TO service_role;

-- eval_touchpoints ──────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.eval_touchpoints;
CREATE VIEW api.eval_touchpoints WITH (security_invoker = true) AS
  SELECT
    touchpoint_id,
    kind,
    owner,
    suite_name,
    grounding_shape,
    severity_on_fail,
    variance_band,
    graduation_metric,
    contract_version,
    registry_version,
    file_sha256,
    created_at,
    updated_at
  FROM public.eval_touchpoints;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.eval_touchpoints TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.eval_touchpoints TO service_role;

-- feed_articles ─────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.feed_articles;
CREATE VIEW api.feed_articles WITH (security_invoker = true) AS
  SELECT
    id,
    workspace_id,
    feed_source_id,
    external_url,
    external_id,
    title,
    raw_content,
    ai_summary,
    relevance_score,
    relevance_category,
    relevance_reasoning,
    matched_categories,
    passed,
    prompt_version_id,
    content_item_id,
    published_at,
    ingested_at,
    created_at,
    updated_at,
    extraction_method,
    reference_item_id
  FROM public.feed_articles;
GRANT SELECT ON api.feed_articles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.feed_articles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.feed_articles TO service_role;

-- feed_flags ────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.feed_flags;
CREATE VIEW api.feed_flags WITH (security_invoker = true) AS
  SELECT
    id,
    feed_article_id,
    flag_type,
    flagged_by,
    notes,
    resolved,
    resolved_at,
    resolved_by,
    resolved_notes,
    resolution_type,
    prompt_version_id,
    created_at
  FROM public.feed_flags;
GRANT SELECT ON api.feed_flags TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.feed_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.feed_flags TO service_role;

-- feed_prompts ──────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.feed_prompts;
CREATE VIEW api.feed_prompts WITH (security_invoker = true) AS
  SELECT
    id,
    workspace_id,
    prompt_text,
    version,
    is_active,
    change_notes,
    performance_snapshot,
    created_at,
    created_by
  FROM public.feed_prompts;
GRANT SELECT ON api.feed_prompts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.feed_prompts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.feed_prompts TO service_role;

-- feed_sources ──────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.feed_sources;
CREATE VIEW api.feed_sources WITH (security_invoker = true) AS
  SELECT
    id,
    workspace_id,
    name,
    url,
    source_type,
    polling_interval_minutes,
    last_polled_at,
    last_polled_status,
    last_polled_error,
    etag,
    last_modified,
    consecutive_failures,
    article_count,
    is_active,
    created_at,
    updated_at,
    created_by
  FROM public.feed_sources;
GRANT SELECT ON api.feed_sources TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.feed_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.feed_sources TO service_role;

-- form_questions ────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.form_questions;
CREATE VIEW api.form_questions WITH (security_invoker = true) AS
  SELECT
    id,
    workspace_id,
    section_name,
    section_sequence,
    question_sequence,
    question_text,
    word_limit,
    evaluation_weight,
    confidence_posture,
    matched_content_ids,
    status,
    has_variants,
    assigned_to,
    created_by,
    created_at,
    updated_at,
    template_requirement_id
  FROM public.form_questions;
GRANT SELECT ON api.form_questions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_questions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_questions TO service_role;

-- form_response_history ─────────────────────────────────────────────────
DROP VIEW IF EXISTS api.form_response_history;
CREATE VIEW api.form_response_history WITH (security_invoker = true) AS
  SELECT
    id,
    response_id,
    version,
    response_text,
    response_text_advanced,
    review_status,
    metadata,
    source_content_ids,
    edited_by,
    change_reason,
    created_at
  FROM public.form_response_history;
GRANT SELECT ON api.form_response_history TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_response_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_response_history TO service_role;

-- form_responses ────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.form_responses;
CREATE VIEW api.form_responses WITH (security_invoker = true) AS
  SELECT
    id,
    question_id,
    version,
    response_text,
    response_text_advanced,
    source_content_ids,
    review_status,
    drafted_by,
    last_edited_by,
    approved_by,
    metadata,
    created_at,
    updated_at,
    overall_score
  FROM public.form_responses;
GRANT SELECT ON api.form_responses TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_responses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_responses TO service_role;

-- form_template_fields ──────────────────────────────────────────────────
DROP VIEW IF EXISTS api.form_template_fields;
CREATE VIEW api.form_template_fields WITH (security_invoker = true) AS
  SELECT
    id,
    template_id,
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
  FROM public.form_template_fields;
GRANT SELECT ON api.form_template_fields TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_template_fields TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_template_fields TO service_role;

-- form_template_requirements ────────────────────────────────────────────
DROP VIEW IF EXISTS api.form_template_requirements;
CREATE VIEW api.form_template_requirements WITH (security_invoker = true) AS
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
    requirement_embedding,
    is_mandatory,
    is_current,
    sector_applicability,
    word_limit_guidance,
    display_order,
    created_at,
    updated_at
  FROM public.form_template_requirements;
GRANT SELECT ON api.form_template_requirements TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_template_requirements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_template_requirements TO service_role;

-- form_templates ────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.form_templates;
CREATE VIEW api.form_templates WITH (security_invoker = true) AS
  SELECT
    id,
    workspace_id,
    name,
    description,
    filename,
    storage_path,
    file_size,
    mime_type,
    status,
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
    status_reason
  FROM public.form_templates;
GRANT SELECT ON api.form_templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_templates TO service_role;

-- form_types ────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.form_types;
CREATE VIEW api.form_types WITH (security_invoker = true) AS
  SELECT
    key,
    label,
    provenance,
    applicable_application_types,
    created_at
  FROM public.form_types;
GRANT SELECT ON api.form_types TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_types TO service_role;

-- governance_config ─────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.governance_config;
CREATE VIEW api.governance_config WITH (security_invoker = true) AS
  SELECT
    id,
    domain,
    posture,
    reviewer_id,
    timeout_days,
    created_by,
    updated_by,
    created_at,
    updated_at,
    quality_score_threshold,
    auto_flag_on_quality_drop,
    auto_flag_on_freshness_transition,
    auto_flag_cooldown_days,
    preset
  FROM public.governance_config;
GRANT SELECT ON api.governance_config TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.governance_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.governance_config TO service_role;

-- guide_sections ────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.guide_sections;
CREATE VIEW api.guide_sections WITH (security_invoker = true) AS
  SELECT
    id,
    guide_id,
    section_name,
    description,
    expected_layer,
    subtopic_filter,
    content_type_filter,
    display_order,
    is_required,
    created_at,
    updated_at,
    parent_section_id
  FROM public.guide_sections;
GRANT SELECT ON api.guide_sections TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.guide_sections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.guide_sections TO service_role;

-- guides ────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.guides;
CREATE VIEW api.guides WITH (security_invoker = true) AS
  SELECT
    id,
    slug,
    name,
    description,
    guide_type,
    domain_filter,
    icon,
    color,
    display_order,
    is_published,
    created_by,
    created_at,
    updated_at
  FROM public.guides;
GRANT SELECT ON api.guides TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.guides TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.guides TO service_role;

-- ingestion_quality_log ─────────────────────────────────────────────────
DROP VIEW IF EXISTS api.ingestion_quality_log;
CREATE VIEW api.ingestion_quality_log WITH (security_invoker = true) AS
  SELECT
    id,
    content_item_id,
    flag_type,
    details,
    resolved,
    created_at,
    severity,
    ingestion_batch,
    resolved_at,
    resolved_by,
    source_url,
    resolution_notes,
    created_by
  FROM public.ingestion_quality_log;
GRANT SELECT ON api.ingestion_quality_log TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.ingestion_quality_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.ingestion_quality_log TO service_role;

-- intelligence_workspaces ───────────────────────────────────────────────
DROP VIEW IF EXISTS api.intelligence_workspaces;
CREATE VIEW api.intelligence_workspaces WITH (security_invoker = true) AS
  SELECT
    id,
    workspace_id,
    created_at,
    updated_at,
    company_profile_id,
    guide_id,
    relevance_threshold
  FROM public.intelligence_workspaces;
GRANT SELECT ON api.intelligence_workspaces TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.intelligence_workspaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.intelligence_workspaces TO service_role;

-- layer_vocabulary ──────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.layer_vocabulary;
CREATE VIEW api.layer_vocabulary WITH (security_invoker = true) AS
  SELECT
    id,
    key,
    label,
    description,
    display_order,
    is_active,
    created_at,
    updated_at
  FROM public.layer_vocabulary;
GRANT SELECT ON api.layer_vocabulary TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.layer_vocabulary TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.layer_vocabulary TO service_role;

-- notifications ─────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.notifications;
CREATE VIEW api.notifications WITH (security_invoker = true) AS
  SELECT
    id,
    user_id,
    type,
    entity_type,
    entity_id,
    title,
    message,
    read_at,
    dismissed_at,
    expires_at,
    created_at
  FROM public.notifications;
GRANT SELECT ON api.notifications TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.notifications TO service_role;

-- pipeline_runs ─────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.pipeline_runs;
CREATE VIEW api.pipeline_runs WITH (security_invoker = true) AS
  SELECT
    id,
    pipeline_name,
    status,
    items_processed,
    items_updated,
    items_skipped,
    error_message,
    started_at,
    completed_at,
    created_by,
    cost,
    result,
    created_at,
    progress,
    source_filename,
    workspace_id,
    items_created,
    op_id,
    ended_at
  FROM public.pipeline_runs;
GRANT SELECT ON api.pipeline_runs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.pipeline_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.pipeline_runs TO service_role;

-- processing_queue ──────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.processing_queue;
CREATE VIEW api.processing_queue WITH (security_invoker = true) AS
  SELECT
    id,
    job_type,
    payload,
    status,
    priority,
    attempts,
    max_attempts,
    error_message,
    created_at,
    started_at,
    completed_at,
    result,
    created_by,
    updated_at,
    idempotency_key
  FROM public.processing_queue;
GRANT SELECT ON api.processing_queue TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.processing_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.processing_queue TO service_role;

-- q_a_extractions ───────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.q_a_extractions;
CREATE VIEW api.q_a_extractions WITH (security_invoker = true) AS
  SELECT
    id,
    source_content_item_id,
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

-- q_a_pair_history ──────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.q_a_pair_history;
CREATE VIEW api.q_a_pair_history WITH (security_invoker = true) AS
  SELECT
    id,
    q_a_pair_id,
    version,
    question_text,
    alternate_question_phrasings,
    answer_standard,
    answer_advanced,
    scope_tag,
    anti_scope_tag,
    origin_kind,
    publication_status,
    valid_from,
    valid_to,
    changed_at,
    changed_by,
    superseded_by,
    source_workspace_id,
    edit_intent
  FROM public.q_a_pair_history;
GRANT SELECT ON api.q_a_pair_history TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.q_a_pair_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.q_a_pair_history TO service_role;

-- q_a_pairs ─────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.q_a_pairs;
CREATE VIEW api.q_a_pairs WITH (security_invoker = true) AS
  SELECT
    id,
    question_text,
    answer_standard,
    answer_advanced,
    scope_tag,
    anti_scope_tag,
    source_workspace_id,
    origin_kind,
    publication_status,
    superseded_by,
    valid_from,
    valid_to,
    created_at,
    updated_at,
    alternate_question_phrasings,
    question_embedding,
    edit_intent,
    source_form_response_id,
    source_question_id
  FROM public.q_a_pairs;
GRANT SELECT ON api.q_a_pairs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.q_a_pairs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.q_a_pairs TO service_role;

-- read_marks ────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.read_marks;
CREATE VIEW api.read_marks WITH (security_invoker = true) AS
  SELECT
    id,
    content_item_id,
    read_at,
    user_id,
    source
  FROM public.read_marks;
GRANT SELECT ON api.read_marks TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.read_marks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.read_marks TO service_role;

-- reference_items ───────────────────────────────────────────────────────
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
    updated_at
  FROM public.reference_items;
GRANT SELECT ON api.reference_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.reference_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.reference_items TO service_role;

-- review_assignments ────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.review_assignments;
CREATE VIEW api.review_assignments WITH (security_invoker = true) AS
  SELECT
    id,
    reviewer_id,
    assigned_by,
    assignment_type,
    filter_domains,
    filter_content_types,
    filter_freshness,
    filter_date_from,
    filter_date_to,
    item_count,
    status,
    notes,
    due_date,
    completed_at,
    created_at,
    updated_at
  FROM public.review_assignments;
GRANT SELECT ON api.review_assignments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.review_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.review_assignments TO service_role;

-- si_processing_queue ───────────────────────────────────────────────────
DROP VIEW IF EXISTS api.si_processing_queue;
CREATE VIEW api.si_processing_queue WITH (security_invoker = true) AS
  SELECT
    id,
    workspace_id,
    feed_source_id,
    status,
    started_at,
    completed_at,
    error_message,
    articles_found,
    articles_new,
    articles_passed,
    created_at
  FROM public.si_processing_queue;
GRANT SELECT ON api.si_processing_queue TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.si_processing_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.si_processing_queue TO service_role;

-- signup_policy ─────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.signup_policy;
CREATE VIEW api.signup_policy WITH (security_invoker = true) AS
  SELECT
    id,
    allowed_domain
  FROM public.signup_policy;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.signup_policy TO service_role;

-- source_document_diffs ─────────────────────────────────────────────────
DROP VIEW IF EXISTS api.source_document_diffs;
CREATE VIEW api.source_document_diffs WITH (security_invoker = true) AS
  SELECT
    id,
    old_document_id,
    new_document_id,
    diff_type,
    old_content,
    new_content,
    old_question,
    new_question,
    similarity_score,
    affected_content_item_id,
    status,
    created_at,
    updated_at,
    reviewed_at,
    reviewed_by,
    created_by,
    reviewer_note,
    diff_mode,
    section_header
  FROM public.source_document_diffs;
GRANT SELECT ON api.source_document_diffs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.source_document_diffs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.source_document_diffs TO service_role;

-- source_documents ──────────────────────────────────────────────────────
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
    pullmd_share_id,
    extraction_method,
    source_url
  FROM public.source_documents;
GRANT SELECT ON api.source_documents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.source_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.source_documents TO service_role;

-- tag_morphology_drift_flags ────────────────────────────────────────────
DROP VIEW IF EXISTS api.tag_morphology_drift_flags;
CREATE VIEW api.tag_morphology_drift_flags WITH (security_invoker = true) AS
  SELECT
    id,
    stored_tag,
    proposed_canonical,
    usage_count,
    affected_content_ids,
    detected_at,
    decision,
    decided_by,
    decided_at,
    decision_rationale
  FROM public.tag_morphology_drift_flags;
GRANT SELECT ON api.tag_morphology_drift_flags TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.tag_morphology_drift_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.tag_morphology_drift_flags TO service_role;

-- taxonomy_domains ──────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.taxonomy_domains;
CREATE VIEW api.taxonomy_domains WITH (security_invoker = true) AS
  SELECT
    id,
    name,
    description,
    display_order,
    colour,
    is_active,
    provenance,
    recommended_by,
    recommended_at,
    accepted_at,
    created_at,
    display_name,
    key_signal
  FROM public.taxonomy_domains;
GRANT SELECT ON api.taxonomy_domains TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.taxonomy_domains TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.taxonomy_domains TO service_role;

-- taxonomy_subtopics ────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.taxonomy_subtopics;
CREATE VIEW api.taxonomy_subtopics WITH (security_invoker = true) AS
  SELECT
    id,
    domain_id,
    name,
    description,
    display_order,
    is_active,
    provenance,
    recommended_by,
    recommended_at,
    accepted_at,
    created_at,
    display_name
  FROM public.taxonomy_subtopics;
GRANT SELECT ON api.taxonomy_subtopics TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.taxonomy_subtopics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.taxonomy_subtopics TO service_role;

-- taxonomy_sync_state ───────────────────────────────────────────────────
DROP VIEW IF EXISTS api.taxonomy_sync_state;
CREATE VIEW api.taxonomy_sync_state WITH (security_invoker = true) AS
  SELECT
    id,
    last_sync_hash,
    last_sync_at,
    synced_by,
    created_at,
    updated_at
  FROM public.taxonomy_sync_state;
GRANT SELECT ON api.taxonomy_sync_state TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.taxonomy_sync_state TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.taxonomy_sync_state TO service_role;

-- template_completions ──────────────────────────────────────────────────
DROP VIEW IF EXISTS api.template_completions;
CREATE VIEW api.template_completions WITH (security_invoker = true) AS
  SELECT
    id,
    template_id,
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

-- tenant_config ─────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.tenant_config;
CREATE VIEW api.tenant_config WITH (security_invoker = true) AS
  SELECT
    id,
    config,
    created_at,
    updated_at
  FROM public.tenant_config;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.tenant_config TO service_role;

-- user_notification_prefs ───────────────────────────────────────────────
DROP VIEW IF EXISTS api.user_notification_prefs;
CREATE VIEW api.user_notification_prefs WITH (security_invoker = true) AS
  SELECT
    user_id,
    email_weekly_change_report,
    email_review_assigned,
    email_owned_content_flagged,
    created_at,
    updated_at,
    auto_generate_change_reports
  FROM public.user_notification_prefs;
GRANT SELECT ON api.user_notification_prefs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.user_notification_prefs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.user_notification_prefs TO service_role;

-- user_profiles ─────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.user_profiles;
CREATE VIEW api.user_profiles WITH (security_invoker = true) AS
  SELECT
    id,
    email,
    full_name,
    created_at,
    updated_at
  FROM public.user_profiles;
GRANT SELECT ON api.user_profiles TO anon;
GRANT SELECT ON api.user_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.user_profiles TO service_role;

-- user_roles ────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.user_roles;
CREATE VIEW api.user_roles WITH (security_invoker = true) AS
  SELECT
    id,
    user_id,
    role,
    granted_by,
    created_at,
    updated_at,
    display_name
  FROM public.user_roles;
GRANT SELECT ON api.user_roles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.user_roles TO service_role;

-- verification_history ──────────────────────────────────────────────────
DROP VIEW IF EXISTS api.verification_history;
CREATE VIEW api.verification_history WITH (security_invoker = true) AS
  SELECT
    id,
    content_item_id,
    action_type,
    note,
    performed_by,
    performed_at
  FROM public.verification_history;
GRANT SELECT ON api.verification_history TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.verification_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.verification_history TO service_role;

-- workspaces ────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.workspaces;
CREATE VIEW api.workspaces WITH (security_invoker = true) AS
  SELECT
    id,
    name,
    description,
    color,
    created_at,
    updated_at,
    domain_metadata,
    is_archived,
    status,
    created_by,
    updated_by,
    icon,
    application_type_id
  FROM public.workspaces;
GRANT SELECT ON api.workspaces TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.workspaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.workspaces TO service_role;

-- ----------------------------------------------------------------------------
-- RPC ENTRYPOINTS (65)
-- ----------------------------------------------------------------------------
-- api.bulk_delete_tags(p_tags text[], p_type text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.bulk_delete_tags(p_tags text[], p_type text);
CREATE FUNCTION api.bulk_delete_tags(p_tags text[], p_type text)
  RETURNS integer
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.bulk_delete_tags(p_tags => p_tags, p_type => p_type);
$api$;
REVOKE EXECUTE ON FUNCTION api.bulk_delete_tags(p_tags text[], p_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.bulk_delete_tags(p_tags text[], p_type text) TO authenticated, service_role;

-- api.bulk_merge_tags(p_sources text[], p_target text, p_type text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.bulk_merge_tags(p_sources text[], p_target text, p_type text);
CREATE FUNCTION api.bulk_merge_tags(p_sources text[], p_target text, p_type text)
  RETURNS integer
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.bulk_merge_tags(p_sources => p_sources, p_target => p_target, p_type => p_type);
$api$;
REVOKE EXECUTE ON FUNCTION api.bulk_merge_tags(p_sources text[], p_target text, p_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.bulk_merge_tags(p_sources text[], p_target text, p_type text) TO authenticated, service_role;

-- api.check_content_exists(ids uuid[])  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.check_content_exists(ids uuid[]);
CREATE FUNCTION api.check_content_exists(ids uuid[])
  RETURNS TABLE(id uuid, item_exists boolean)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.check_content_exists(ids => ids);
$api$;
REVOKE EXECUTE ON FUNCTION api.check_content_exists(ids uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.check_content_exists(ids uuid[]) TO authenticated, service_role;

-- api.claim_next_job()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.claim_next_job();
CREATE FUNCTION api.claim_next_job()
  RETURNS SETOF public.processing_queue
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.claim_next_job();
$api$;
REVOKE EXECUTE ON FUNCTION api.claim_next_job() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.claim_next_job() TO authenticated, service_role;

-- api.cleanup_filtered_articles()  [INVOKER wrapper over SECURITY DEFINER public fn]
DROP FUNCTION IF EXISTS api.cleanup_filtered_articles();
CREATE FUNCTION api.cleanup_filtered_articles()
  RETURNS integer
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.cleanup_filtered_articles();
$api$;
REVOKE EXECUTE ON FUNCTION api.cleanup_filtered_articles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.cleanup_filtered_articles() TO authenticated, service_role;

-- api.count_auth_users()  [INVOKER wrapper over SECURITY DEFINER public fn]
DROP FUNCTION IF EXISTS api.count_auth_users();
CREATE FUNCTION api.count_auth_users()
  RETURNS bigint
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.count_auth_users();
$api$;
REVOKE EXECUTE ON FUNCTION api.count_auth_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.count_auth_users() TO service_role;

-- api.delete_tag(p_tag text, p_type text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.delete_tag(p_tag text, p_type text);
CREATE FUNCTION api.delete_tag(p_tag text, p_type text)
  RETURNS integer
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.delete_tag(p_tag => p_tag, p_type => p_type);
$api$;
REVOKE EXECUTE ON FUNCTION api.delete_tag(p_tag text, p_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.delete_tag(p_tag text, p_type text) TO authenticated, service_role;

-- api.filter_by_keywords(keyword_list text[], match_mode text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.filter_by_keywords(keyword_list text[], match_mode text);
CREATE FUNCTION api.filter_by_keywords(keyword_list text[], match_mode text DEFAULT 'any'::text)
  RETURNS SETOF public.content_items
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.filter_by_keywords(keyword_list => keyword_list, match_mode => match_mode);
$api$;
REVOKE EXECUTE ON FUNCTION api.filter_by_keywords(keyword_list text[], match_mode text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.filter_by_keywords(keyword_list text[], match_mode text) TO authenticated, service_role;

-- api.filter_by_keywords(search_terms text[])  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.filter_by_keywords(search_terms text[]);
CREATE FUNCTION api.filter_by_keywords(search_terms text[])
  RETURNS SETOF uuid
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.filter_by_keywords(search_terms => search_terms);
$api$;
REVOKE EXECUTE ON FUNCTION api.filter_by_keywords(search_terms text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.filter_by_keywords(search_terms text[]) TO authenticated, service_role;

-- api.find_duplicate_tags(p_type text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.find_duplicate_tags(p_type text);
CREATE FUNCTION api.find_duplicate_tags(p_type text)
  RETURNS TABLE(canonical text, variants text[], variant_count integer, total_usage bigint)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.find_duplicate_tags(p_type => p_type);
$api$;
REVOKE EXECUTE ON FUNCTION api.find_duplicate_tags(p_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.find_duplicate_tags(p_type text) TO authenticated, service_role;

-- api.find_exact_duplicates(p_content_hash text, p_exclude_id uuid)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.find_exact_duplicates(p_content_hash text, p_exclude_id uuid);
CREATE FUNCTION api.find_exact_duplicates(p_content_hash text, p_exclude_id uuid DEFAULT NULL::uuid)
  RETURNS TABLE(id uuid, title text)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.find_exact_duplicates(p_content_hash => p_content_hash, p_exclude_id => p_exclude_id);
$api$;
REVOKE EXECUTE ON FUNCTION api.find_exact_duplicates(p_content_hash text, p_exclude_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.find_exact_duplicates(p_content_hash text, p_exclude_id uuid) TO authenticated, service_role;

-- api.find_related_items(p_item_id uuid, p_similarity_threshold double precision, p_limit_count integer)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.find_related_items(p_item_id uuid, p_similarity_threshold double precision, p_limit_count integer);
CREATE FUNCTION api.find_related_items(p_item_id uuid, p_similarity_threshold double precision DEFAULT 0.6, p_limit_count integer DEFAULT 6)
  RETURNS TABLE(id uuid, title text, suggested_title text, summary text, primary_domain text, primary_subtopic text, content_type character varying, platform character varying, author_name character varying, source_domain character varying, thumbnail_url text, captured_date timestamp with time zone, ai_keywords text[], classification_confidence double precision, priority character varying, user_tags text[], similarity numeric)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.find_related_items(p_item_id => p_item_id, p_similarity_threshold => p_similarity_threshold, p_limit_count => p_limit_count);
$api$;
REVOKE EXECUTE ON FUNCTION api.find_related_items(p_item_id uuid, p_similarity_threshold double precision, p_limit_count integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.find_related_items(p_item_id uuid, p_similarity_threshold double precision, p_limit_count integer) TO authenticated, service_role;

-- api.find_similar_content(query_embedding vector, similarity_threshold double precision, limit_count integer)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.find_similar_content(query_embedding vector, similarity_threshold double precision, limit_count integer);
CREATE FUNCTION api.find_similar_content(query_embedding vector, similarity_threshold double precision DEFAULT 0.7, limit_count integer DEFAULT 10)
  RETURNS TABLE(id uuid, title text, content text, similarity numeric, content_type character varying, platform character varying, author_name character varying, source_domain character varying)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.find_similar_content(query_embedding => query_embedding, similarity_threshold => similarity_threshold, limit_count => limit_count);
$api$;
REVOKE EXECUTE ON FUNCTION api.find_similar_content(query_embedding vector, similarity_threshold double precision, limit_count integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.find_similar_content(query_embedding vector, similarity_threshold double precision, limit_count integer) TO authenticated, service_role;

-- api.find_similar_content(query_embedding vector, similarity_threshold numeric, limit_count integer)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.find_similar_content(query_embedding vector, similarity_threshold numeric, limit_count integer);
CREATE FUNCTION api.find_similar_content(query_embedding vector, similarity_threshold numeric DEFAULT 0.5, limit_count integer DEFAULT 10)
  RETURNS TABLE(id uuid, title text, content text, similarity numeric, content_type character varying, platform character varying, author_name character varying, source_domain character varying)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.find_similar_content(query_embedding => query_embedding, similarity_threshold => similarity_threshold, limit_count => limit_count);
$api$;
REVOKE EXECUTE ON FUNCTION api.find_similar_content(query_embedding vector, similarity_threshold numeric, limit_count integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.find_similar_content(query_embedding vector, similarity_threshold numeric, limit_count integer) TO authenticated, service_role;

-- api.get_aggregate_win_rate_stats()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_aggregate_win_rate_stats();
CREATE FUNCTION api.get_aggregate_win_rate_stats()
  RETURNS TABLE(scope text, total_citations bigint, winning_citations bigint, losing_citations bigint, pending_citations bigint, win_rate numeric, unique_items_cited bigint, unique_bids bigint)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_aggregate_win_rate_stats();
$api$;
REVOKE EXECUTE ON FUNCTION api.get_aggregate_win_rate_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_aggregate_win_rate_stats() TO authenticated, service_role;

-- api.get_all_tag_counts()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_all_tag_counts();
CREATE FUNCTION api.get_all_tag_counts()
  RETURNS TABLE(tag text, count bigint, source text)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_all_tag_counts();
$api$;
REVOKE EXECUTE ON FUNCTION api.get_all_tag_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_all_tag_counts() TO authenticated, service_role;

-- api.get_author_analysis(p_author_name text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_author_analysis(p_author_name text);
CREATE FUNCTION api.get_author_analysis(p_author_name text)
  RETURNS json
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.get_author_analysis(p_author_name => p_author_name);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_author_analysis(p_author_name text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_author_analysis(p_author_name text) TO authenticated, service_role;

-- api.get_content_gaps()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_content_gaps();
CREATE FUNCTION api.get_content_gaps()
  RETURNS json
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.get_content_gaps();
$api$;
REVOKE EXECUTE ON FUNCTION api.get_content_gaps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_content_gaps() TO authenticated, service_role;

-- api.get_coverage_matrix(p_layer text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_coverage_matrix(p_layer text);
CREATE FUNCTION api.get_coverage_matrix(p_layer text DEFAULT NULL::text)
  RETURNS TABLE(domain_name text, subtopic_name text, item_count bigint, fresh_count bigint, aging_count bigint, stale_count bigint, expired_count bigint)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_coverage_matrix(p_layer => p_layer);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_coverage_matrix(p_layer text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_coverage_matrix(p_layer text) TO authenticated, service_role;

-- api.get_coverage_summary()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_coverage_summary();
CREATE FUNCTION api.get_coverage_summary()
  RETURNS TABLE(domain_name text, domain_colour text, total_items bigint, fresh_pct numeric, gap_count bigint, expired_count bigint)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_coverage_summary();
$api$;
REVOKE EXECUTE ON FUNCTION api.get_coverage_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_coverage_summary() TO authenticated, service_role;

-- api.get_dashboard_attention_counts(p_user_id uuid, p_role text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_dashboard_attention_counts(p_user_id uuid, p_role text);
CREATE FUNCTION api.get_dashboard_attention_counts(p_user_id uuid, p_role text DEFAULT 'viewer'::text)
  RETURNS json
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.get_dashboard_attention_counts(p_user_id => p_user_id, p_role => p_role);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_dashboard_attention_counts(p_user_id uuid, p_role text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_dashboard_attention_counts(p_user_id uuid, p_role text) TO authenticated, service_role;

-- api.get_due_feed_sources(max_sources integer)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_due_feed_sources(max_sources integer);
CREATE FUNCTION api.get_due_feed_sources(max_sources integer DEFAULT 5)
  RETURNS SETOF public.feed_sources
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_due_feed_sources(max_sources => max_sources);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_due_feed_sources(max_sources integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_due_feed_sources(max_sources integer) TO authenticated, service_role;

-- api.get_entity_list_aggregated(p_type text, p_search text, p_variants_only boolean, p_type_conflicts boolean, p_limit integer, p_offset integer)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_entity_list_aggregated(p_type text, p_search text, p_variants_only boolean, p_type_conflicts boolean, p_limit integer, p_offset integer);
CREATE FUNCTION api.get_entity_list_aggregated(p_type text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_variants_only boolean DEFAULT false, p_type_conflicts boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
  RETURNS json
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.get_entity_list_aggregated(p_type => p_type, p_search => p_search, p_variants_only => p_variants_only, p_type_conflicts => p_type_conflicts, p_limit => p_limit, p_offset => p_offset);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_entity_list_aggregated(p_type text, p_search text, p_variants_only boolean, p_type_conflicts boolean, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_entity_list_aggregated(p_type text, p_search text, p_variants_only boolean, p_type_conflicts boolean, p_limit integer, p_offset integer) TO authenticated, service_role;

-- api.get_entity_summary(p_entity_name text, p_entity_type text, p_limit integer)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_entity_summary(p_entity_name text, p_entity_type text, p_limit integer);
CREATE FUNCTION api.get_entity_summary(p_entity_name text DEFAULT NULL::text, p_entity_type text DEFAULT NULL::text, p_limit integer DEFAULT NULL::integer)
  RETURNS TABLE(canonical_name text, entity_type text, mention_count bigint, content_item_ids uuid[], related_entities jsonb)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_entity_summary(p_entity_name => p_entity_name, p_entity_type => p_entity_type, p_limit => p_limit);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_entity_summary(p_entity_name text, p_entity_type text, p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_entity_summary(p_entity_name text, p_entity_type text, p_limit integer) TO authenticated, service_role;

-- api.get_filter_counts()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_filter_counts();
CREATE FUNCTION api.get_filter_counts()
  RETURNS jsonb
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.get_filter_counts();
$api$;
REVOKE EXECUTE ON FUNCTION api.get_filter_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_filter_counts() TO authenticated, service_role;

-- api.get_filter_ratio_trend(p_workspace_id uuid, p_granularity text, p_period_days integer)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_filter_ratio_trend(p_workspace_id uuid, p_granularity text, p_period_days integer);
CREATE FUNCTION api.get_filter_ratio_trend(p_workspace_id uuid, p_granularity text DEFAULT 'daily'::text, p_period_days integer DEFAULT 90)
  RETURNS TABLE(date text, total bigint, passed bigint, filtered bigint, ratio integer)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_filter_ratio_trend(p_workspace_id => p_workspace_id, p_granularity => p_granularity, p_period_days => p_period_days);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_filter_ratio_trend(p_workspace_id uuid, p_granularity text, p_period_days integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_filter_ratio_trend(p_workspace_id uuid, p_granularity text, p_period_days integer) TO authenticated, service_role;

-- api.get_form_question_stats(p_project_id uuid)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_form_question_stats(p_project_id uuid);
CREATE FUNCTION api.get_form_question_stats(p_project_id uuid)
  RETURNS TABLE(total_questions bigint, strong_match_count bigint, partial_match_count bigint, needs_sme_count bigint, no_content_count bigint, unmatched_count bigint, drafted_count bigint, complete_count bigint)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_form_question_stats(p_project_id => p_project_id);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_form_question_stats(p_project_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_form_question_stats(p_project_id uuid) TO authenticated, service_role;

-- api.get_form_question_stats_batch(p_project_ids uuid[])  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_form_question_stats_batch(p_project_ids uuid[]);
CREATE FUNCTION api.get_form_question_stats_batch(p_project_ids uuid[])
  RETURNS TABLE(workspace_id uuid, total_questions bigint, strong_match_count bigint, partial_match_count bigint, needs_sme_count bigint, no_content_count bigint, unmatched_count bigint, drafted_count bigint, complete_count bigint)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_form_question_stats_batch(p_project_ids => p_project_ids);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_form_question_stats_batch(p_project_ids uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_form_question_stats_batch(p_project_ids uuid[]) TO authenticated, service_role;

-- api.get_freshness_breakdown()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_freshness_breakdown();
CREATE FUNCTION api.get_freshness_breakdown()
  RETURNS TABLE(freshness text, count bigint)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_freshness_breakdown();
$api$;
REVOKE EXECUTE ON FUNCTION api.get_freshness_breakdown() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_freshness_breakdown() TO authenticated, service_role;

-- api.get_grouped_activity_feed(p_limit integer, p_is_admin boolean, p_before timestamp with time zone)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_grouped_activity_feed(p_limit integer, p_is_admin boolean, p_before timestamp with time zone);
CREATE FUNCTION api.get_grouped_activity_feed(p_limit integer DEFAULT 10, p_is_admin boolean DEFAULT false, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
  RETURNS TABLE(id uuid, type text, entity_type text, entity_id uuid, summary text, user_id uuid, latest_at timestamp with time zone, earliest_at timestamp with time zone, event_count integer)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_grouped_activity_feed(p_limit => p_limit, p_is_admin => p_is_admin, p_before => p_before);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_grouped_activity_feed(p_limit integer, p_is_admin boolean, p_before timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_grouped_activity_feed(p_limit integer, p_is_admin boolean, p_before timestamp with time zone) TO authenticated, service_role;

-- api.get_guide_coverage()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_guide_coverage();
CREATE FUNCTION api.get_guide_coverage()
  RETURNS TABLE(guide_id uuid, guide_name text, guide_slug text, guide_type text, domain_filter text, section_id uuid, section_name text, section_order integer, expected_layer text, is_required boolean, content_count bigint, fresh_count bigint, stale_count bigint)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_guide_coverage();
$api$;
REVOKE EXECUTE ON FUNCTION api.get_guide_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_guide_coverage() TO authenticated, service_role;

-- api.get_item_workspaces(p_item_id uuid)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_item_workspaces(p_item_id uuid);
CREATE FUNCTION api.get_item_workspaces(p_item_id uuid)
  RETURNS SETOF public.workspaces
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_item_workspaces(p_item_id => p_item_id);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_item_workspaces(p_item_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_item_workspaces(p_item_id uuid) TO authenticated, service_role;

-- api.get_items_with_quality_flags()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_items_with_quality_flags();
CREATE FUNCTION api.get_items_with_quality_flags()
  RETURNS SETOF uuid
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_items_with_quality_flags();
$api$;
REVOKE EXECUTE ON FUNCTION api.get_items_with_quality_flags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_items_with_quality_flags() TO authenticated, service_role;

-- api.get_popular_keywords(p_limit integer)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_popular_keywords(p_limit integer);
CREATE FUNCTION api.get_popular_keywords(p_limit integer DEFAULT 10)
  RETURNS TABLE(keyword text, item_count bigint)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_popular_keywords(p_limit => p_limit);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_popular_keywords(p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_popular_keywords(p_limit integer) TO authenticated, service_role;

-- api.get_quality_issue_counts()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_quality_issue_counts();
CREATE FUNCTION api.get_quality_issue_counts()
  RETURNS TABLE(flag_type text, severity text, open_count bigint)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_quality_issue_counts();
$api$;
REVOKE EXECUTE ON FUNCTION api.get_quality_issue_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_quality_issue_counts() TO authenticated, service_role;

-- api.get_reading_patterns(p_days integer)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_reading_patterns(p_days integer);
CREATE FUNCTION api.get_reading_patterns(p_days integer DEFAULT 30)
  RETURNS json
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.get_reading_patterns(p_days => p_days);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_reading_patterns(p_days integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_reading_patterns(p_days integer) TO authenticated, service_role;

-- api.get_review_breakdown_stats()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_review_breakdown_stats();
CREATE FUNCTION api.get_review_breakdown_stats()
  RETURNS json
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.get_review_breakdown_stats();
$api$;
REVOKE EXECUTE ON FUNCTION api.get_review_breakdown_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_review_breakdown_stats() TO authenticated, service_role;

-- api.get_tag_counts_filtered(p_type text, p_min_count integer, p_search text, p_limit integer, p_offset integer)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_tag_counts_filtered(p_type text, p_min_count integer, p_search text, p_limit integer, p_offset integer);
CREATE FUNCTION api.get_tag_counts_filtered(p_type text, p_min_count integer DEFAULT 1, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
  RETURNS TABLE(tag text, count bigint, source text, total_count bigint)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_tag_counts_filtered(p_type => p_type, p_min_count => p_min_count, p_search => p_search, p_limit => p_limit, p_offset => p_offset);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_tag_counts_filtered(p_type text, p_min_count integer, p_search text, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_tag_counts_filtered(p_type text, p_min_count integer, p_search text, p_limit integer, p_offset integer) TO authenticated, service_role;

-- api.get_tags_by_domain(p_type text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_tags_by_domain(p_type text);
CREATE FUNCTION api.get_tags_by_domain(p_type text)
  RETURNS TABLE(domain text, tag text, count bigint)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_tags_by_domain(p_type => p_type);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_tags_by_domain(p_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_tags_by_domain(p_type text) TO authenticated, service_role;

-- api.get_topic_deep_dive(p_keyword text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_topic_deep_dive(p_keyword text);
CREATE FUNCTION api.get_topic_deep_dive(p_keyword text)
  RETURNS json
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.get_topic_deep_dive(p_keyword => p_keyword);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_topic_deep_dive(p_keyword text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_topic_deep_dive(p_keyword text) TO authenticated, service_role;

-- api.get_topic_layers(p_topic_id text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_topic_layers(p_topic_id text);
CREATE FUNCTION api.get_topic_layers(p_topic_id text)
  RETURNS TABLE(id uuid, title text, content_type text, primary_domain text, metadata jsonb, layer text)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_topic_layers(p_topic_id => p_topic_id);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_topic_layers(p_topic_id text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_topic_layers(p_topic_id text) TO authenticated, service_role;

-- api.get_trend_analysis(p_days integer, p_min_count integer)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_trend_analysis(p_days integer, p_min_count integer);
CREATE FUNCTION api.get_trend_analysis(p_days integer DEFAULT 30, p_min_count integer DEFAULT 2)
  RETURNS TABLE(keyword text, current_count bigint, previous_count bigint, growth_rate numeric, domains text[])
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_trend_analysis(p_days => p_days, p_min_count => p_min_count);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_trend_analysis(p_days integer, p_min_count integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_trend_analysis(p_days integer, p_min_count integer) TO authenticated, service_role;

-- api.get_unique_authors()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_unique_authors();
CREATE FUNCTION api.get_unique_authors()
  RETURNS TABLE(author_name text, count bigint)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_unique_authors();
$api$;
REVOKE EXECUTE ON FUNCTION api.get_unique_authors() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_unique_authors() TO authenticated, service_role;

-- api.get_user_display_names(user_ids uuid[])  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_user_display_names(user_ids uuid[]);
CREATE FUNCTION api.get_user_display_names(user_ids uuid[])
  RETURNS TABLE(user_id uuid, display_name text)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_user_display_names(user_ids => user_ids);
$api$;
REVOKE EXECUTE ON FUNCTION api.get_user_display_names(user_ids uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_user_display_names(user_ids uuid[]) TO authenticated, service_role;

-- api.get_user_tag_counts()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.get_user_tag_counts();
CREATE FUNCTION api.get_user_tag_counts()
  RETURNS jsonb
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.get_user_tag_counts();
$api$;
REVOKE EXECUTE ON FUNCTION api.get_user_tag_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_user_tag_counts() TO authenticated, service_role;

-- api.hybrid_search(query_embedding vector, query_text text, similarity_threshold numeric, limit_count integer, include_superseded boolean, visibility_filter character varying)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.hybrid_search(query_embedding vector, query_text text, similarity_threshold numeric, limit_count integer, include_superseded boolean, visibility_filter character varying);
CREATE FUNCTION api.hybrid_search(query_embedding vector, query_text text DEFAULT ''::text, similarity_threshold numeric DEFAULT 0.3, limit_count integer DEFAULT 10, include_superseded boolean DEFAULT false, visibility_filter character varying DEFAULT 'default'::character varying)
  RETURNS TABLE(id uuid, title text, suggested_title text, summary text, primary_domain text, primary_subtopic text, content_type text, platform text, author_name text, source_domain text, thumbnail_url text, captured_date timestamp with time zone, ai_keywords text[], classification_confidence numeric, priority text, metadata jsonb, similarity numeric, snippet text, created_by uuid, verified_at timestamp with time zone, verified_by uuid)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.hybrid_search(query_embedding => query_embedding, query_text => query_text, similarity_threshold => similarity_threshold, limit_count => limit_count, include_superseded => include_superseded, visibility_filter => visibility_filter);
$api$;
REVOKE EXECUTE ON FUNCTION api.hybrid_search(query_embedding vector, query_text text, similarity_threshold numeric, limit_count integer, include_superseded boolean, visibility_filter character varying) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.hybrid_search(query_embedding vector, query_text text, similarity_threshold numeric, limit_count integer, include_superseded boolean, visibility_filter character varying) TO authenticated, service_role;

-- api.list_public_tables()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.list_public_tables();
CREATE FUNCTION api.list_public_tables()
  RETURNS SETOF text
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.list_public_tables();
$api$;
REVOKE EXECUTE ON FUNCTION api.list_public_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.list_public_tables() TO authenticated, service_role;

-- api.merge_entities(p_source_names text[], p_target_name text, p_entity_type text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.merge_entities(p_source_names text[], p_target_name text, p_entity_type text);
CREATE FUNCTION api.merge_entities(p_source_names text[], p_target_name text, p_entity_type text)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.merge_entities(p_source_names => p_source_names, p_target_name => p_target_name, p_entity_type => p_entity_type);
$api$;
REVOKE EXECUTE ON FUNCTION api.merge_entities(p_source_names text[], p_target_name text, p_entity_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.merge_entities(p_source_names text[], p_target_name text, p_entity_type text) TO authenticated, service_role;

-- api.merge_item_metadata(p_item_id uuid, p_new_data jsonb)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.merge_item_metadata(p_item_id uuid, p_new_data jsonb);
CREATE FUNCTION api.merge_item_metadata(p_item_id uuid, p_new_data jsonb)
  RETURNS void
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.merge_item_metadata(p_item_id => p_item_id, p_new_data => p_new_data);
$api$;
REVOKE EXECUTE ON FUNCTION api.merge_item_metadata(p_item_id uuid, p_new_data jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.merge_item_metadata(p_item_id uuid, p_new_data jsonb) TO authenticated, service_role;

-- api.merge_tags(p_source text, p_target text, p_type text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.merge_tags(p_source text, p_target text, p_type text);
CREATE FUNCTION api.merge_tags(p_source text, p_target text, p_type text)
  RETURNS integer
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.merge_tags(p_source => p_source, p_target => p_target, p_type => p_type);
$api$;
REVOKE EXECUTE ON FUNCTION api.merge_tags(p_source text, p_target text, p_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.merge_tags(p_source text, p_target text, p_type text) TO authenticated, service_role;

-- api.q_a_extractions_promotion_candidates()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.q_a_extractions_promotion_candidates();
CREATE FUNCTION api.q_a_extractions_promotion_candidates()
  RETURNS SETOF public.q_a_extractions
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.q_a_extractions_promotion_candidates();
$api$;
REVOKE EXECUTE ON FUNCTION api.q_a_extractions_promotion_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.q_a_extractions_promotion_candidates() TO authenticated, service_role;

-- api.q_a_get_verbatim(p_pair_id uuid)  [INVOKER wrapper over SECURITY DEFINER public fn]
DROP FUNCTION IF EXISTS api.q_a_get_verbatim(p_pair_id uuid);
CREATE FUNCTION api.q_a_get_verbatim(p_pair_id uuid)
  RETURNS TABLE(id uuid, question_text text, alternate_question_phrasings text[], answer_standard text, answer_advanced text, scope_tag text[], anti_scope_tag text[], source_workspace_id uuid, origin_kind text, publication_status text, superseded_by uuid, valid_from timestamp with time zone, valid_to timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.q_a_get_verbatim(p_pair_id => p_pair_id);
$api$;
REVOKE EXECUTE ON FUNCTION api.q_a_get_verbatim(p_pair_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.q_a_get_verbatim(p_pair_id uuid) TO authenticated, service_role;

-- api.q_a_search(p_query text, p_query_embedding vector, p_limit integer)  [INVOKER wrapper over SECURITY DEFINER public fn]
DROP FUNCTION IF EXISTS api.q_a_search(p_query text, p_query_embedding vector, p_limit integer);
CREATE FUNCTION api.q_a_search(p_query text, p_query_embedding vector, p_limit integer DEFAULT 20)
  RETURNS TABLE(pair_id uuid, question_text_preview text, answer_standard_preview text, embedding_score numeric, fulltext_score numeric, scope_tag text[], publication_status text)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.q_a_search(p_query => p_query, p_query_embedding => p_query_embedding, p_limit => p_limit);
$api$;
REVOKE EXECUTE ON FUNCTION api.q_a_search(p_query text, p_query_embedding vector, p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.q_a_search(p_query text, p_query_embedding vector, p_limit integer) TO authenticated, service_role;

-- api.question_match_recompute(p_form_question_id uuid, p_query text, p_query_embedding vector, p_question_kind text, p_scope_tag text[], p_anti_scope_tag text[], p_limit integer)  [INVOKER wrapper over SECURITY DEFINER public fn]
DROP FUNCTION IF EXISTS api.question_match_recompute(p_form_question_id uuid, p_query text, p_query_embedding vector, p_question_kind text, p_scope_tag text[], p_anti_scope_tag text[], p_limit integer);
CREATE FUNCTION api.question_match_recompute(p_form_question_id uuid, p_query text, p_query_embedding vector, p_question_kind text, p_scope_tag text[], p_anti_scope_tag text[], p_limit integer DEFAULT 20)
  RETURNS integer
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.question_match_recompute(p_form_question_id => p_form_question_id, p_query => p_query, p_query_embedding => p_query_embedding, p_question_kind => p_question_kind, p_scope_tag => p_scope_tag, p_anti_scope_tag => p_anti_scope_tag, p_limit => p_limit);
$api$;
REVOKE EXECUTE ON FUNCTION api.question_match_recompute(p_form_question_id uuid, p_query text, p_query_embedding vector, p_question_kind text, p_scope_tag text[], p_anti_scope_tag text[], p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.question_match_recompute(p_form_question_id uuid, p_query text, p_query_embedding vector, p_question_kind text, p_scope_tag text[], p_anti_scope_tag text[], p_limit integer) TO authenticated, service_role;

-- api.question_match_search(p_form_question_id uuid, p_question_kind text, p_limit integer)  [INVOKER wrapper over SECURITY DEFINER public fn]
DROP FUNCTION IF EXISTS api.question_match_search(p_form_question_id uuid, p_question_kind text, p_limit integer);
CREATE FUNCTION api.question_match_search(p_form_question_id uuid, p_question_kind text DEFAULT NULL::text, p_limit integer DEFAULT 20)
  RETURNS TABLE(q_a_pair_id uuid, question_text_preview text, answer_standard_preview text, embedding_score numeric, fulltext_score numeric, scope_tag text[], publication_status text)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.question_match_search(p_form_question_id => p_form_question_id, p_question_kind => p_question_kind, p_limit => p_limit);
$api$;
REVOKE EXECUTE ON FUNCTION api.question_match_search(p_form_question_id uuid, p_question_kind text, p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.question_match_search(p_form_question_id uuid, p_question_kind text, p_limit integer) TO authenticated, service_role;

-- api.reap_stuck_jobs(p_timeout_seconds integer)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.reap_stuck_jobs(p_timeout_seconds integer);
CREATE FUNCTION api.reap_stuck_jobs(p_timeout_seconds integer)
  RETURNS integer
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.reap_stuck_jobs(p_timeout_seconds => p_timeout_seconds);
$api$;
REVOKE EXECUTE ON FUNCTION api.reap_stuck_jobs(p_timeout_seconds integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.reap_stuck_jobs(p_timeout_seconds integer) TO authenticated, service_role;

-- api.recalculate_all_freshness()  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.recalculate_all_freshness();
CREATE FUNCTION api.recalculate_all_freshness()
  RETURNS TABLE(total_count integer, fresh_count integer, aging_count integer, stale_count integer, expired_count integer)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.recalculate_all_freshness();
$api$;
REVOKE EXECUTE ON FUNCTION api.recalculate_all_freshness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.recalculate_all_freshness() TO authenticated, service_role;

-- api.reference_get_verbatim(p_reference_id uuid)  [INVOKER wrapper over SECURITY DEFINER public fn]
DROP FUNCTION IF EXISTS api.reference_get_verbatim(p_reference_id uuid);
CREATE FUNCTION api.reference_get_verbatim(p_reference_id uuid)
  RETURNS TABLE(id uuid, title text, body text, summary text, source_url text, published_at timestamp with time zone, primary_domain text, primary_subtopic text, layer text, source_document_id uuid, ingestion_source text, op_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.reference_get_verbatim(p_reference_id => p_reference_id);
$api$;
REVOKE EXECUTE ON FUNCTION api.reference_get_verbatim(p_reference_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.reference_get_verbatim(p_reference_id uuid) TO authenticated, service_role;

-- api.reference_ingest(p_source_url text, p_title text, p_body text, p_summary text, p_primary_domain text, p_primary_subtopic text, p_embedding vector, p_published_at timestamp with time zone, p_filename text, p_mime_type text, p_file_size integer, p_content_hash text, p_extraction_metadata jsonb, p_op_id uuid)  [INVOKER wrapper over SECURITY DEFINER public fn]
DROP FUNCTION IF EXISTS api.reference_ingest(p_source_url text, p_title text, p_body text, p_summary text, p_primary_domain text, p_primary_subtopic text, p_embedding vector, p_published_at timestamp with time zone, p_filename text, p_mime_type text, p_file_size integer, p_content_hash text, p_extraction_metadata jsonb, p_op_id uuid);
CREATE FUNCTION api.reference_ingest(p_source_url text, p_title text, p_body text, p_summary text, p_primary_domain text, p_primary_subtopic text, p_embedding vector, p_published_at timestamp with time zone, p_filename text, p_mime_type text, p_file_size integer, p_content_hash text, p_extraction_metadata jsonb DEFAULT '{}'::jsonb, p_op_id uuid DEFAULT NULL::uuid)
  RETURNS TABLE(reference_id uuid, source_document_id uuid, title text, summary text, source_url text, primary_domain text, primary_subtopic text, already_existed boolean)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.reference_ingest(p_source_url => p_source_url, p_title => p_title, p_body => p_body, p_summary => p_summary, p_primary_domain => p_primary_domain, p_primary_subtopic => p_primary_subtopic, p_embedding => p_embedding, p_published_at => p_published_at, p_filename => p_filename, p_mime_type => p_mime_type, p_file_size => p_file_size, p_content_hash => p_content_hash, p_extraction_metadata => p_extraction_metadata, p_op_id => p_op_id);
$api$;
REVOKE EXECUTE ON FUNCTION api.reference_ingest(p_source_url text, p_title text, p_body text, p_summary text, p_primary_domain text, p_primary_subtopic text, p_embedding vector, p_published_at timestamp with time zone, p_filename text, p_mime_type text, p_file_size integer, p_content_hash text, p_extraction_metadata jsonb, p_op_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.reference_ingest(p_source_url text, p_title text, p_body text, p_summary text, p_primary_domain text, p_primary_subtopic text, p_embedding vector, p_published_at timestamp with time zone, p_filename text, p_mime_type text, p_file_size integer, p_content_hash text, p_extraction_metadata jsonb, p_op_id uuid) TO authenticated, service_role;

-- api.reference_search(p_query text, p_query_embedding vector, p_limit integer)  [INVOKER wrapper over SECURITY DEFINER public fn]
DROP FUNCTION IF EXISTS api.reference_search(p_query text, p_query_embedding vector, p_limit integer);
CREATE FUNCTION api.reference_search(p_query text, p_query_embedding vector, p_limit integer DEFAULT 20)
  RETURNS TABLE(reference_id uuid, title text, summary_preview text, body_preview text, embedding_score numeric, fulltext_score numeric, source_url text, published_at timestamp with time zone, primary_domain text, primary_subtopic text, layer text, ingestion_source text, source_document_id uuid)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.reference_search(p_query => p_query, p_query_embedding => p_query_embedding, p_limit => p_limit);
$api$;
REVOKE EXECUTE ON FUNCTION api.reference_search(p_query text, p_query_embedding vector, p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.reference_search(p_query text, p_query_embedding vector, p_limit integer) TO authenticated, service_role;

-- api.rename_tag(p_old text, p_new text, p_type text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.rename_tag(p_old text, p_new text, p_type text);
CREATE FUNCTION api.rename_tag(p_old text, p_new text, p_type text)
  RETURNS integer
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.rename_tag(p_old => p_old, p_new => p_new, p_type => p_type);
$api$;
REVOKE EXECUTE ON FUNCTION api.rename_tag(p_old text, p_new text, p_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.rename_tag(p_old text, p_new text, p_type text) TO authenticated, service_role;

-- api.set_config(setting text, value text, is_local boolean)  [INVOKER wrapper over SECURITY DEFINER public fn]
DROP FUNCTION IF EXISTS api.set_config(setting text, value text, is_local boolean);
CREATE FUNCTION api.set_config(setting text, value text, is_local boolean)
  RETURNS text
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.set_config(setting => setting, value => value, is_local => is_local);
$api$;
REVOKE EXECUTE ON FUNCTION api.set_config(setting text, value text, is_local boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.set_config(setting text, value text, is_local boolean) TO anon, authenticated, service_role;

-- api.suggest_tags(p_prefix text, p_type text)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.suggest_tags(p_prefix text, p_type text);
CREATE FUNCTION api.suggest_tags(p_prefix text, p_type text)
  RETURNS TABLE(tag text, count bigint)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.suggest_tags(p_prefix => p_prefix, p_type => p_type);
$api$;
REVOKE EXECUTE ON FUNCTION api.suggest_tags(p_prefix text, p_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.suggest_tags(p_prefix text, p_type text) TO authenticated, service_role;

-- api.toggle_star(item_id uuid)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.toggle_star(item_id uuid);
CREATE FUNCTION api.toggle_star(item_id uuid)
  RETURNS boolean
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.toggle_star(item_id => item_id);
$api$;
REVOKE EXECUTE ON FUNCTION api.toggle_star(item_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.toggle_star(item_id uuid) TO authenticated, service_role;

-- api.toggle_star(p_item_id uuid, p_starred boolean)  [INVOKER entrypoint]
DROP FUNCTION IF EXISTS api.toggle_star(p_item_id uuid, p_starred boolean);
CREATE FUNCTION api.toggle_star(p_item_id uuid, p_starred boolean)
  RETURNS void
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.toggle_star(p_item_id => p_item_id, p_starred => p_starred);
$api$;
REVOKE EXECUTE ON FUNCTION api.toggle_star(p_item_id uuid, p_starred boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.toggle_star(p_item_id uuid, p_starred boolean) TO authenticated, service_role;


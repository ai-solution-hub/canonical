-- Schema Health Phase 2: Medium Priority Fixes
-- 2.1 Add missing auth.users foreign keys
-- 2.2 Add indexes on unindexed FK columns
-- 2.3 Standardise function search_path

-- =============================================================================
-- 2.1 Add missing auth.users foreign keys
-- =============================================================================

-- uploaded_by has NOT NULL constraint but all 20 rows reference an orphaned UUID.
-- Make it nullable first, then clean the orphaned references.
ALTER TABLE source_documents ALTER COLUMN uploaded_by DROP NOT NULL;

UPDATE source_documents SET uploaded_by = NULL
  WHERE uploaded_by IS NOT NULL
  AND uploaded_by NOT IN (SELECT id FROM auth.users);

ALTER TABLE source_documents
  ADD CONSTRAINT source_documents_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE source_documents
  ADD CONSTRAINT source_documents_archived_by_fkey
  FOREIGN KEY (archived_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE content_citations
  ADD CONSTRAINT content_citations_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE content_templates
  ADD CONSTRAINT content_templates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE coverage_targets
  ADD CONSTRAINT coverage_targets_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE coverage_targets
  ADD CONSTRAINT coverage_targets_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE verification_history
  ADD CONSTRAINT verification_history_performed_by_fkey
  FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- =============================================================================
-- 2.2 Add indexes on unindexed FK columns (19 indexes)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_bid_questions_assigned_to ON bid_questions(assigned_to);
CREATE INDEX IF NOT EXISTS idx_bid_questions_created_by ON bid_questions(created_by);
CREATE INDEX IF NOT EXISTS idx_bid_questions_template_requirement_id ON bid_questions(template_requirement_id);
CREATE INDEX IF NOT EXISTS idx_bid_responses_approved_by ON bid_responses(approved_by);
CREATE INDEX IF NOT EXISTS idx_bid_responses_drafted_by ON bid_responses(drafted_by);
CREATE INDEX IF NOT EXISTS idx_bid_responses_last_edited_by ON bid_responses(last_edited_by);
CREATE INDEX IF NOT EXISTS idx_content_items_archived_by ON content_items(archived_by);
CREATE INDEX IF NOT EXISTS idx_content_items_created_by ON content_items(created_by);
CREATE INDEX IF NOT EXISTS idx_content_items_governance_reviewer_id ON content_items(governance_reviewer_id);
CREATE INDEX IF NOT EXISTS idx_content_items_verified_by ON content_items(verified_by);
CREATE INDEX IF NOT EXISTS idx_digests_created_by ON digests(created_by);
CREATE INDEX IF NOT EXISTS idx_guides_created_by ON guides(created_by);
CREATE INDEX IF NOT EXISTS idx_processing_queue_created_by ON processing_queue(created_by);
CREATE INDEX IF NOT EXISTS idx_review_assignments_assigned_by ON review_assignments(assigned_by);
CREATE INDEX IF NOT EXISTS idx_source_document_diffs_created_by ON source_document_diffs(created_by);
CREATE INDEX IF NOT EXISTS idx_source_documents_pipeline_run_id ON source_documents(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_source_documents_workspace_id ON source_documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_created_by ON workspaces(created_by);
CREATE INDEX IF NOT EXISTS idx_workspaces_updated_by ON workspaces(updated_by);

-- =============================================================================
-- 2.3 Standardise function search_path (46 functions)
-- =============================================================================
-- All functions should use SET search_path = public, extensions
-- These currently have search_path=public (missing extensions)

ALTER FUNCTION public.bid_response_auto_version() SET search_path = public, extensions;
ALTER FUNCTION public.check_content_exists(ids uuid[]) SET search_path = public, extensions;
ALTER FUNCTION public.claim_next_job() SET search_path = public, extensions;
ALTER FUNCTION public.content_history_auto_version() SET search_path = public, extensions;
ALTER FUNCTION public.delete_duplicate_entity_mentions(p_canonical_name text) SET search_path = public, extensions;
ALTER FUNCTION public.delete_tag(p_tag text, p_type text) SET search_path = public, extensions;
ALTER FUNCTION public.filter_by_keywords(search_terms text[]) SET search_path = public, extensions;
ALTER FUNCTION public.get_all_tag_counts() SET search_path = public, extensions;
ALTER FUNCTION public.get_audit_content_items(p_domain text, p_limit integer) SET search_path = public, extensions;
ALTER FUNCTION public.get_author_analysis(p_author_name text) SET search_path = public, extensions;
ALTER FUNCTION public.get_bid_question_stats(p_project_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.get_bid_question_stats_batch(p_project_ids uuid[]) SET search_path = public, extensions;
ALTER FUNCTION public.get_bid_summary(bid_workspace_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.get_capture_activity() SET search_path = public, extensions;
ALTER FUNCTION public.get_content_win_rate(p_content_item_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.get_entity_name_counts() SET search_path = public, extensions;
ALTER FUNCTION public.get_entity_relationships_rpc(p_entity_name text) SET search_path = public, extensions;
ALTER FUNCTION public.get_entity_summary(p_entity_name text, p_entity_type text, p_limit integer) SET search_path = public, extensions;
ALTER FUNCTION public.get_grouped_activity_feed(p_limit integer, p_is_admin boolean, p_before timestamp with time zone) SET search_path = public, extensions;
ALTER FUNCTION public.get_guide_content(p_guide_slug text) SET search_path = public, extensions;
ALTER FUNCTION public.get_guide_coverage() SET search_path = public, extensions;
ALTER FUNCTION public.get_item_workspaces(p_item_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.get_popular_keywords(p_limit integer) SET search_path = public, extensions;
ALTER FUNCTION public.get_reading_patterns(p_days integer) SET search_path = public, extensions;
ALTER FUNCTION public.get_source_documents() SET search_path = public, extensions;
ALTER FUNCTION public.get_template_summary(p_template_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.get_top_authors(p_limit integer) SET search_path = public, extensions;
ALTER FUNCTION public.get_topic_deep_dive(p_keyword text) SET search_path = public, extensions;
ALTER FUNCTION public.get_trend_analysis(p_days integer, p_min_count integer) SET search_path = public, extensions;
ALTER FUNCTION public.get_unique_authors() SET search_path = public, extensions;
ALTER FUNCTION public.get_user_role() SET search_path = public, extensions;
ALTER FUNCTION public.get_user_tag_counts() SET search_path = public, extensions;
ALTER FUNCTION public.get_verification_stats() SET search_path = public, extensions;
ALTER FUNCTION public.get_workspace_counts() SET search_path = public, extensions;
ALTER FUNCTION public.get_workspace_item_counts() SET search_path = public, extensions;
ALTER FUNCTION public.handle_new_user_role() SET search_path = public, extensions;
ALTER FUNCTION public.merge_entities(p_source_names text[], p_target_name text, p_entity_type text) SET search_path = public, extensions;
ALTER FUNCTION public.merge_item_metadata(p_item_id uuid, p_new_data jsonb) SET search_path = public, extensions;
ALTER FUNCTION public.merge_tags(p_source text, p_target text, p_type text) SET search_path = public, extensions;
ALTER FUNCTION public.rename_tag(p_old text, p_new text, p_type text) SET search_path = public, extensions;
ALTER FUNCTION public.run_quality_scan(p_batch_name text) SET search_path = public, extensions;
ALTER FUNCTION public.set_config(setting text, value text, is_local boolean) SET search_path = public, extensions;
ALTER FUNCTION public.snapshot_bid_response_history() SET search_path = public, extensions;
ALTER FUNCTION public.suggest_tags(p_prefix text, p_type text) SET search_path = public, extensions;
ALTER FUNCTION public.sync_bid_status_to_jsonb() SET search_path = public, extensions;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public, extensions;

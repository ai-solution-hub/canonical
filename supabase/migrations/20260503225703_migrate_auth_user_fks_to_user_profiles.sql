-- ============================================================
-- Migrate application-level FK references from auth.users → public.user_profiles
-- ============================================================
--
-- When user_profiles was introduced (20260428122626), 35 FK constraints
-- across 24 tables were missed and still reference auth.users(id) directly.
-- This causes two problems:
--   1. PostgREST cannot resolve JOINs across the auth schema boundary.
--   2. pg_restore on staging fails because Supabase's rds_superuser role
--      cannot disable system FK constraint triggers on auth.* tables.
--
-- Since user_profiles.id is a 1:1 mirror of auth.users.id (same UUIDs,
-- ON DELETE CASCADE), this migration changes only the FK target — no data
-- changes are needed. Cascade behavior is preserved:
--   auth.users DELETE → cascades to user_profiles → cascades to referencing tables.
--
-- 5 FK constraints intentionally KEPT on auth.users:
--   - user_profiles.id (the mirror table itself)
--   - user_roles.user_id (core auth role mapping)
--   - user_notification_prefs.user_id (per-user identity link)
--   - notifications.user_id (per-user identity link)
--   - read_marks.user_id (per-user identity link)
--
-- Pre-condition: zero live users (confirmed 2026-05-03). No data migration
-- needed — only FK constraint targets change.
-- ============================================================

-- ── bid_questions ───────────────────────────────────────────────────────────

ALTER TABLE ONLY public.bid_questions
  DROP CONSTRAINT IF EXISTS bid_questions_assigned_to_fkey;
ALTER TABLE ONLY public.bid_questions
  ADD CONSTRAINT bid_questions_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES public.user_profiles(id);

ALTER TABLE ONLY public.bid_questions
  DROP CONSTRAINT IF EXISTS bid_questions_created_by_fkey;
ALTER TABLE ONLY public.bid_questions
  ADD CONSTRAINT bid_questions_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id);

-- ── bid_response_history ────────────────────────────────────────────────────

ALTER TABLE ONLY public.bid_response_history
  DROP CONSTRAINT IF EXISTS bid_response_history_edited_by_fkey;
ALTER TABLE ONLY public.bid_response_history
  ADD CONSTRAINT bid_response_history_edited_by_fkey
  FOREIGN KEY (edited_by) REFERENCES public.user_profiles(id);

-- ── bid_responses ───────────────────────────────────────────────────────────

ALTER TABLE ONLY public.bid_responses
  DROP CONSTRAINT IF EXISTS bid_responses_approved_by_fkey;
ALTER TABLE ONLY public.bid_responses
  ADD CONSTRAINT bid_responses_approved_by_fkey
  FOREIGN KEY (approved_by) REFERENCES public.user_profiles(id);

ALTER TABLE ONLY public.bid_responses
  DROP CONSTRAINT IF EXISTS bid_responses_drafted_by_fkey;
ALTER TABLE ONLY public.bid_responses
  ADD CONSTRAINT bid_responses_drafted_by_fkey
  FOREIGN KEY (drafted_by) REFERENCES public.user_profiles(id);

ALTER TABLE ONLY public.bid_responses
  DROP CONSTRAINT IF EXISTS bid_responses_last_edited_by_fkey;
ALTER TABLE ONLY public.bid_responses
  ADD CONSTRAINT bid_responses_last_edited_by_fkey
  FOREIGN KEY (last_edited_by) REFERENCES public.user_profiles(id);

-- ── classification_disputes ─────────────────────────────────────────────────

ALTER TABLE ONLY public.classification_disputes
  DROP CONSTRAINT IF EXISTS classification_disputes_disputed_by_fkey;
ALTER TABLE ONLY public.classification_disputes
  ADD CONSTRAINT classification_disputes_disputed_by_fkey
  FOREIGN KEY (disputed_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.classification_disputes
  DROP CONSTRAINT IF EXISTS classification_disputes_resolved_by_fkey;
ALTER TABLE ONLY public.classification_disputes
  ADD CONSTRAINT classification_disputes_resolved_by_fkey
  FOREIGN KEY (resolved_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- ── company_profiles ────────────────────────────────────────────────────────

ALTER TABLE ONLY public.company_profiles
  DROP CONSTRAINT IF EXISTS company_profiles_created_by_fkey;
ALTER TABLE ONLY public.company_profiles
  ADD CONSTRAINT company_profiles_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id);

-- ── content_citations ───────────────────────────────────────────────────────

ALTER TABLE ONLY public.content_citations
  DROP CONSTRAINT IF EXISTS content_citations_created_by_fkey;
ALTER TABLE ONLY public.content_citations
  ADD CONSTRAINT content_citations_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- ── content_history ─────────────────────────────────────────────────────────

ALTER TABLE ONLY public.content_history
  DROP CONSTRAINT IF EXISTS content_history_created_by_fkey;
ALTER TABLE ONLY public.content_history
  ADD CONSTRAINT content_history_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id);

-- ── content_items ───────────────────────────────────────────────────────────

ALTER TABLE ONLY public.content_items
  DROP CONSTRAINT IF EXISTS content_items_created_by_fkey;
ALTER TABLE ONLY public.content_items
  ADD CONSTRAINT content_items_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id);

ALTER TABLE ONLY public.content_items
  DROP CONSTRAINT IF EXISTS content_items_updated_by_fkey;
ALTER TABLE ONLY public.content_items
  ADD CONSTRAINT content_items_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES public.user_profiles(id);

-- ── content_templates ───────────────────────────────────────────────────────

ALTER TABLE ONLY public.content_templates
  DROP CONSTRAINT IF EXISTS content_templates_created_by_fkey;
ALTER TABLE ONLY public.content_templates
  ADD CONSTRAINT content_templates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- ── coverage_targets ────────────────────────────────────────────────────────

ALTER TABLE ONLY public.coverage_targets
  DROP CONSTRAINT IF EXISTS coverage_targets_created_by_fkey;
ALTER TABLE ONLY public.coverage_targets
  ADD CONSTRAINT coverage_targets_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.coverage_targets
  DROP CONSTRAINT IF EXISTS coverage_targets_updated_by_fkey;
ALTER TABLE ONLY public.coverage_targets
  ADD CONSTRAINT coverage_targets_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- ── feed_flags ──────────────────────────────────────────────────────────────

ALTER TABLE ONLY public.feed_flags
  DROP CONSTRAINT IF EXISTS feed_flags_flagged_by_fkey;
ALTER TABLE ONLY public.feed_flags
  ADD CONSTRAINT feed_flags_flagged_by_fkey
  FOREIGN KEY (flagged_by) REFERENCES public.user_profiles(id);

ALTER TABLE ONLY public.feed_flags
  DROP CONSTRAINT IF EXISTS feed_flags_resolved_by_fkey;
ALTER TABLE ONLY public.feed_flags
  ADD CONSTRAINT feed_flags_resolved_by_fkey
  FOREIGN KEY (resolved_by) REFERENCES public.user_profiles(id);

-- ── feed_prompts ────────────────────────────────────────────────────────────

ALTER TABLE ONLY public.feed_prompts
  DROP CONSTRAINT IF EXISTS feed_prompts_created_by_fkey;
ALTER TABLE ONLY public.feed_prompts
  ADD CONSTRAINT feed_prompts_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id);

-- ── feed_sources ────────────────────────────────────────────────────────────

ALTER TABLE ONLY public.feed_sources
  DROP CONSTRAINT IF EXISTS feed_sources_created_by_fkey;
ALTER TABLE ONLY public.feed_sources
  ADD CONSTRAINT feed_sources_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id);

-- ── governance_config ───────────────────────────────────────────────────────

ALTER TABLE ONLY public.governance_config
  DROP CONSTRAINT IF EXISTS governance_config_created_by_fkey;
ALTER TABLE ONLY public.governance_config
  ADD CONSTRAINT governance_config_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id);

ALTER TABLE ONLY public.governance_config
  DROP CONSTRAINT IF EXISTS governance_config_reviewer_id_fkey;
ALTER TABLE ONLY public.governance_config
  ADD CONSTRAINT governance_config_reviewer_id_fkey
  FOREIGN KEY (reviewer_id) REFERENCES public.user_profiles(id);

ALTER TABLE ONLY public.governance_config
  DROP CONSTRAINT IF EXISTS governance_config_updated_by_fkey;
ALTER TABLE ONLY public.governance_config
  ADD CONSTRAINT governance_config_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES public.user_profiles(id);

-- ── guides ──────────────────────────────────────────────────────────────────

ALTER TABLE ONLY public.guides
  DROP CONSTRAINT IF EXISTS guides_created_by_fkey;
ALTER TABLE ONLY public.guides
  ADD CONSTRAINT guides_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id);

-- ── pipeline_runs ───────────────────────────────────────────────────────────

ALTER TABLE ONLY public.pipeline_runs
  DROP CONSTRAINT IF EXISTS pipeline_runs_created_by_fkey;
ALTER TABLE ONLY public.pipeline_runs
  ADD CONSTRAINT pipeline_runs_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id);

-- ── review_assignments ──────────────────────────────────────────────────────

ALTER TABLE ONLY public.review_assignments
  DROP CONSTRAINT IF EXISTS review_assignments_assigned_by_fkey;
ALTER TABLE ONLY public.review_assignments
  ADD CONSTRAINT review_assignments_assigned_by_fkey
  FOREIGN KEY (assigned_by) REFERENCES public.user_profiles(id);

ALTER TABLE ONLY public.review_assignments
  DROP CONSTRAINT IF EXISTS review_assignments_reviewer_id_fkey;
ALTER TABLE ONLY public.review_assignments
  ADD CONSTRAINT review_assignments_reviewer_id_fkey
  FOREIGN KEY (reviewer_id) REFERENCES public.user_profiles(id);

-- ── source_document_diffs ───────────────────────────────────────────────────

ALTER TABLE ONLY public.source_document_diffs
  DROP CONSTRAINT IF EXISTS source_document_diffs_created_by_fkey;
ALTER TABLE ONLY public.source_document_diffs
  ADD CONSTRAINT source_document_diffs_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.source_document_diffs
  DROP CONSTRAINT IF EXISTS source_document_diffs_reviewed_by_fkey;
ALTER TABLE ONLY public.source_document_diffs
  ADD CONSTRAINT source_document_diffs_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- ── source_documents ────────────────────────────────────────────────────────

ALTER TABLE ONLY public.source_documents
  DROP CONSTRAINT IF EXISTS source_documents_archived_by_fkey;
ALTER TABLE ONLY public.source_documents
  ADD CONSTRAINT source_documents_archived_by_fkey
  FOREIGN KEY (archived_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.source_documents
  DROP CONSTRAINT IF EXISTS source_documents_uploaded_by_fkey;
ALTER TABLE ONLY public.source_documents
  ADD CONSTRAINT source_documents_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- ── tag_morphology_drift_flags ──────────────────────────────────────────────

ALTER TABLE ONLY public.tag_morphology_drift_flags
  DROP CONSTRAINT IF EXISTS tag_morphology_drift_flags_decided_by_fkey;
ALTER TABLE ONLY public.tag_morphology_drift_flags
  ADD CONSTRAINT tag_morphology_drift_flags_decided_by_fkey
  FOREIGN KEY (decided_by) REFERENCES public.user_profiles(id);

-- ── template_completions ────────────────────────────────────────────────────

ALTER TABLE ONLY public.template_completions
  DROP CONSTRAINT IF EXISTS template_completions_created_by_fkey;
ALTER TABLE ONLY public.template_completions
  ADD CONSTRAINT template_completions_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id);

-- ── templates ───────────────────────────────────────────────────────────────

ALTER TABLE ONLY public.templates
  DROP CONSTRAINT IF EXISTS templates_created_by_fkey;
ALTER TABLE ONLY public.templates
  ADD CONSTRAINT templates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id);

-- ── user_roles (granted_by only — user_id stays on auth.users) ──────────────

ALTER TABLE ONLY public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_granted_by_fkey;
ALTER TABLE ONLY public.user_roles
  ADD CONSTRAINT user_roles_granted_by_fkey
  FOREIGN KEY (granted_by) REFERENCES public.user_profiles(id);

-- ── verification_history ────────────────────────────────────────────────────

ALTER TABLE ONLY public.verification_history
  DROP CONSTRAINT IF EXISTS verification_history_performed_by_fkey;
ALTER TABLE ONLY public.verification_history
  ADD CONSTRAINT verification_history_performed_by_fkey
  FOREIGN KEY (performed_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

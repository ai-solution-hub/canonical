-- ============================================================
-- Migrate application-level FK references from auth.users → public.user_profiles
-- ============================================================
--
-- Schema doc: SCHEMA-QUICK-REFERENCE.md §34 auth.users ON DELETE Behaviour table
-- documents the FK retargeting outcome (which columns now reference
-- user_profiles vs auth.users directly).
--
-- When user_profiles was introduced (20260428122626), 35 FK constraints
-- across 24 tables were missed and still reference auth.users(id) directly.
-- This causes two problems:
--   1. PostgREST cannot resolve JOINs across the auth schema boundary.
--   2. pg_restore on staging fails because Supabase's rds_superuser role
--      cannot disable system FK constraint triggers on auth.* tables.
--
-- Since user_profiles.id is a 1:1 mirror of auth.users.id (same UUIDs,
-- ON DELETE CASCADE), the FK target switch does not rewrite application-table
-- IDs. Cascade behavior is preserved:
--   auth.users DELETE → cascades to user_profiles → cascades to referencing tables.
--
-- 5 FK constraints intentionally KEPT on auth.users:
--   - user_profiles.id (the mirror table itself)
--   - user_roles.user_id (core auth role mapping)
--   - user_notification_prefs.user_id (per-user identity link)
--   - notifications.user_id (per-user identity link)
--   - read_marks.user_id (per-user identity link)
--
-- Defensive precondition repair: user_profiles must contain every auth.users
-- row referenced by the application tables below. The original staging run
-- succeeded, but production later had a live auth.users row that was missing
-- from user_profiles. Re-run the idempotent mirror backfill here so a
-- production retry of this same migration can pass before any later corrective
-- migrations run.
-- ============================================================

INSERT INTO public.user_profiles (id, email, full_name)
SELECT id,
       email,
       raw_user_meta_data ->> 'full_name'
  FROM auth.users
 ON CONFLICT (id) DO NOTHING;
-- Production retry guard: if an application table contains a historical user
-- reference that no longer exists in auth.users, the backfill above cannot
-- create a user_profiles row because user_profiles.id itself references
-- auth.users(id). For nullable audit columns, preserve the row and clear the
-- orphaned user reference before adding the new FK. For NOT NULL columns, fail
-- with a targeted diagnostic rather than surfacing a generic FK error later.
DO $$
DECLARE
  ref record;
  missing_count bigint;
  nullable text;
BEGIN
  FOR ref IN
    SELECT *
      FROM (VALUES
        ('bid_questions', 'assigned_to'),
        ('bid_questions', 'created_by'),
        ('bid_response_history', 'edited_by'),
        ('bid_responses', 'approved_by'),
        ('bid_responses', 'drafted_by'),
        ('bid_responses', 'last_edited_by'),
        ('classification_disputes', 'disputed_by'),
        ('classification_disputes', 'resolved_by'),
        ('company_profiles', 'created_by'),
        ('content_citations', 'created_by'),
        ('content_history', 'created_by'),
        ('content_items', 'created_by'),
        ('content_items', 'updated_by'),
        ('content_templates', 'created_by'),
        ('coverage_targets', 'created_by'),
        ('coverage_targets', 'updated_by'),
        ('feed_flags', 'flagged_by'),
        ('feed_flags', 'resolved_by'),
        ('feed_prompts', 'created_by'),
        ('feed_sources', 'created_by'),
        ('governance_config', 'created_by'),
        ('governance_config', 'reviewer_id'),
        ('governance_config', 'updated_by'),
        ('guides', 'created_by'),
        ('pipeline_runs', 'created_by'),
        ('review_assignments', 'assigned_by'),
        ('review_assignments', 'reviewer_id'),
        ('source_document_diffs', 'created_by'),
        ('source_document_diffs', 'reviewed_by'),
        ('source_documents', 'archived_by'),
        ('source_documents', 'uploaded_by'),
        ('tag_morphology_drift_flags', 'decided_by'),
        ('template_completions', 'created_by'),
        ('templates', 'created_by'),
        ('user_roles', 'granted_by'),
        ('verification_history', 'performed_by')
      ) AS refs(rel_name, col_name)
  LOOP
    SELECT is_nullable
      INTO nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ref.rel_name
       AND column_name = ref.col_name;

    IF nullable IS NULL THEN
      RAISE NOTICE 'Skipping %.% orphan check because the column does not exist',
        ref.rel_name,
        ref.col_name;
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT count(*)
         FROM public.%I AS t
        WHERE t.%I IS NOT NULL
          AND NOT EXISTS (
                SELECT 1
                  FROM public.user_profiles AS up
                 WHERE up.id = t.%I
              )',
      ref.rel_name,
      ref.col_name,
      ref.col_name
    )
    INTO missing_count;

    IF missing_count = 0 THEN
      CONTINUE;
    END IF;

    IF nullable = 'YES' THEN
      RAISE NOTICE 'Clearing % orphaned %.% user reference(s) before FK retarget',
        missing_count,
        ref.rel_name,
        ref.col_name;

      EXECUTE format(
        'UPDATE public.%I AS t
            SET %I = NULL
          WHERE t.%I IS NOT NULL
            AND NOT EXISTS (
                  SELECT 1
                    FROM public.user_profiles AS up
                   WHERE up.id = t.%I
                )',
        ref.rel_name,
        ref.col_name,
        ref.col_name,
        ref.col_name
      );
    ELSE
      RAISE EXCEPTION
        'Cannot retarget %.% to user_profiles: % non-null row(s) reference user ids missing from auth.users/user_profiles',
        ref.rel_name,
        ref.col_name,
        missing_count;
    END IF;
  END LOOP;
END $$;

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

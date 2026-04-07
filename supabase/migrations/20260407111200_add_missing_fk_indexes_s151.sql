-- S151 WP14: Add missing foreign-key indexes + high-signal query indexes
--
-- Background:
-- Pre-launch database performance pass. Supabase advisor flagged 14 foreign
-- key constraints without covering indexes (lint 0001_unindexed_foreign_keys).
-- In parallel, the project-root `supabase_performance_suggestions.json`
-- (pg_stat_statements + index_advisor output) surfaced 5 additional
-- non-FK indexes that would materially reduce startup/total cost for
-- hot production queries.
--
-- Scope (pre-launch only):
--   Group A -- 14 missing foreign-key indexes (advisor lint 0001).
--   Group B -- 5 non-FK query indexes from index_advisor suggestions.
--
-- Deferred to post-launch backlog (NOT in this migration):
--   Group C -- ~51 unused-index cleanups (advisor lint 0005). Pre-launch has
--   insufficient production traffic to judge "unused" meaningfully; we will
--   re-review once real usage patterns stabilise.
--
-- Idempotency: every CREATE INDEX uses IF NOT EXISTS. This file is safe to
-- re-run. CREATE INDEX CONCURRENTLY is not used because `supabase db push`
-- executes migrations inside a transaction, which disallows CONCURRENTLY.
-- Index builds on these tables are fast pre-launch (small row counts).
--
-- References:
--   docs/audits/s151-wp14-fk-indexes-and-perf.md
--   https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys

BEGIN;

-- ---------------------------------------------------------------------------
-- Group A: 14 missing foreign-key indexes
-- ---------------------------------------------------------------------------

-- company_profiles.created_by -> auth.users
CREATE INDEX IF NOT EXISTS idx_company_profiles_created_by
  ON public.company_profiles (created_by);

-- content_citations.created_by -> auth.users
CREATE INDEX IF NOT EXISTS idx_content_citations_created_by
  ON public.content_citations (created_by);

-- content_templates.created_by -> auth.users
CREATE INDEX IF NOT EXISTS idx_content_templates_created_by
  ON public.content_templates (created_by);

-- coverage_targets.created_by -> auth.users
CREATE INDEX IF NOT EXISTS idx_coverage_targets_created_by
  ON public.coverage_targets (created_by);

-- coverage_targets.updated_by -> auth.users
CREATE INDEX IF NOT EXISTS idx_coverage_targets_updated_by
  ON public.coverage_targets (updated_by);

-- feed_articles.content_item_id -> public.content_items(id)
-- (join column for SI -> KB promotion lookups)
CREATE INDEX IF NOT EXISTS idx_feed_articles_content_item_id
  ON public.feed_articles (content_item_id);

-- feed_articles.prompt_version_id -> public.feed_prompts(id)
CREATE INDEX IF NOT EXISTS idx_feed_articles_prompt_version_id
  ON public.feed_articles (prompt_version_id);

-- feed_flags.flagged_by -> auth.users
CREATE INDEX IF NOT EXISTS idx_feed_flags_flagged_by
  ON public.feed_flags (flagged_by);

-- feed_flags.prompt_version_id -> public.feed_prompts(id)
CREATE INDEX IF NOT EXISTS idx_feed_flags_prompt_version_id
  ON public.feed_flags (prompt_version_id);

-- feed_flags.resolved_by -> auth.users
CREATE INDEX IF NOT EXISTS idx_feed_flags_resolved_by
  ON public.feed_flags (resolved_by);

-- feed_prompts.created_by -> auth.users
CREATE INDEX IF NOT EXISTS idx_feed_prompts_created_by
  ON public.feed_prompts (created_by);

-- feed_sources.created_by -> auth.users
CREATE INDEX IF NOT EXISTS idx_feed_sources_created_by
  ON public.feed_sources (created_by);

-- source_documents.archived_by -> auth.users
CREATE INDEX IF NOT EXISTS idx_source_documents_archived_by
  ON public.source_documents (archived_by);

-- source_documents.uploaded_by -> auth.users
-- Note: a composite index idx_source_documents_filename_uploaded_by exists
-- but is filename-leading and cannot serve uploaded_by FK cascade/lookup.
CREATE INDEX IF NOT EXISTS idx_source_documents_uploaded_by
  ON public.source_documents (uploaded_by);

-- ---------------------------------------------------------------------------
-- Group B: 5 query indexes from index_advisor (perf suggestions JSON)
-- ---------------------------------------------------------------------------

-- content_items.archived_at
-- Query: SELECT ... WHERE archived_at IS NULL LIMIT ... (authenticated, 604 calls, mean 984ms)
-- Cost before/after: 38.89 -> 37.58
CREATE INDEX IF NOT EXISTS idx_content_items_archived_at
  ON public.content_items (archived_at);

-- content_items.verified_at
-- Query: SELECT ... WHERE verified_at IS NULL LIMIT ... (authenticated, 12,408 calls combined)
-- Cost before/after: 49.44 -> 44.07
CREATE INDEX IF NOT EXISTS idx_content_items_verified_at
  ON public.content_items (verified_at);

-- content_items.governance_review_status
-- Query: SELECT ... WHERE governance_review_status IS NULL OR governance_review_status <> $1
--                     AND content_type <> $2 ORDER BY captured_date DESC (authenticated, 724 calls)
-- Cost before/after: 420.82 -> 365.21 (largest absolute saving)
CREATE INDEX IF NOT EXISTS idx_content_items_governance_review_status
  ON public.content_items (governance_review_status);

-- template_requirements.display_order
-- Query: SELECT ... WHERE template_name = $1 AND is_current = $2 ORDER BY display_order ASC
-- Cost before/after: 10.85 -> 2.52 (largest proportional saving)
CREATE INDEX IF NOT EXISTS idx_template_requirements_display_order
  ON public.template_requirements (display_order);

-- notifications.created_at
-- Query: SELECT ... WHERE (expires_at IS NULL OR expires_at > $1)
--                     AND user_id = $2 AND dismissed_at IS NULL
--                     ORDER BY created_at DESC (authenticated, 53,585 calls -- highest call rate)
-- Cost before/after: 6.36 -> 2.29
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON public.notifications (created_at);

COMMIT;

-- End S151 WP14 migration.

-- Migration: Fix indexes — add missing FK indexes, drop unused indexes
-- Created: 2026-03-08
--
-- Part A: Add 5 missing indexes on foreign key columns
-- Part B: Drop 23 unused indexes (user UUID tracking, infrastructure, low-traffic)
--
-- ============================================================================
-- INDEXES REVIEWED AND KEPT (22 indexes — not touched by this migration):
-- ============================================================================
--
-- idx_content_items_embedding        — HNSW vector index, critical for semantic search
-- idx_content_items_freshness        — Browse filters + freshness cron job
-- idx_content_items_priority         — Browse filters (priority sorting/filtering)
-- idx_content_items_user_tags        — GIN index for tag containment queries (@>)
-- idx_content_items_metadata         — GIN index for JSONB queries on metadata
-- idx_content_items_ai_keywords      — GIN index on text[] array, used in search
-- idx_content_items_parent_id        — Hierarchical content queries (parent lookup)
-- idx_content_items_source_url       — Deduplication checks during ingestion
-- idx_content_items_layer            — Coverage dashboard + browse filters
-- idx_content_items_topic_id         — Coverage dashboard queries
-- idx_workspaces_type_archived       — Workspace listing filter
-- idx_workspaces_type_status         — Bid workspace listing filter (partial)
-- idx_bid_questions_project          — Bid session queries (project_id)
-- idx_bid_questions_status           — Bid question filtering (project_id, status)
-- idx_notifications_user_unread      — Notification badge queries (partial index)
-- idx_notifications_entity           — Notification grouping (entity_type, entity_id)
-- idx_read_marks_content_item        — Read status lookups
-- idx_read_marks_user                — User read history (user_id, content_item_id)
-- idx_template_fields_template       — Template rendering (template_id)
-- idx_template_fields_question       — Template field lookups (question_id)
-- idx_templates_status               — Template listing filter
-- idx_content_history_item           — Version history lookups (content_item_id, version)
--
-- ============================================================================
-- PART A: Add missing foreign key indexes (5)
-- ============================================================================
-- These FK columns lack covering indexes, which can cause slow joins and
-- cascading delete performance issues.

-- 1. bid_response_history.edited_by → auth.users(id)
CREATE INDEX IF NOT EXISTS idx_bid_response_history_edited_by
  ON public.bid_response_history USING btree (edited_by);

-- 2. content_items.source_bid → workspaces(id)
CREATE INDEX IF NOT EXISTS idx_content_items_source_bid
  ON public.content_items USING btree (source_bid);

-- 3. template_completions.created_by → auth.users(id)
CREATE INDEX IF NOT EXISTS idx_template_completions_created_by
  ON public.template_completions USING btree (created_by);

-- 4. template_completions.job_id → processing_queue(id)
CREATE INDEX IF NOT EXISTS idx_template_completions_job_id
  ON public.template_completions USING btree (job_id);

-- 5. templates.created_by → auth.users(id)
CREATE INDEX IF NOT EXISTS idx_templates_created_by
  ON public.templates USING btree (created_by);


-- ============================================================================
-- PART B: Drop unused indexes (23)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- B1. User UUID tracking columns (13 indexes)
-- These track which user performed an action. They are almost never queried
-- directly — lookups go through the parent entity, not the user UUID.
-- ---------------------------------------------------------------------------

-- content_items user tracking
DROP INDEX IF EXISTS idx_content_items_created_by;
DROP INDEX IF EXISTS idx_content_items_verified_by;
DROP INDEX IF EXISTS idx_content_items_governance_reviewer_id;

-- workspaces user tracking
DROP INDEX IF EXISTS idx_workspaces_created_by;
DROP INDEX IF EXISTS idx_workspaces_updated_by;

-- bid_questions user tracking
DROP INDEX IF EXISTS idx_bid_questions_assigned_to;
DROP INDEX IF EXISTS idx_bid_questions_created_by;

-- bid_responses user tracking
DROP INDEX IF EXISTS idx_bid_responses_approved_by;
DROP INDEX IF EXISTS idx_bid_responses_drafted_by;
DROP INDEX IF EXISTS idx_bid_responses_last_edited_by;

-- digests user tracking
DROP INDEX IF EXISTS idx_digests_created_by;

-- pipeline_runs user tracking
DROP INDEX IF EXISTS idx_pipeline_runs_created_by;

-- processing_queue user tracking
DROP INDEX IF EXISTS idx_processing_queue_created_by;

-- ---------------------------------------------------------------------------
-- B2. Superseded indexes (1 index)
-- ---------------------------------------------------------------------------

-- content_items source_domain: superseded by content_type + domain filters
DROP INDEX IF EXISTS idx_content_items_source_domain;

-- ---------------------------------------------------------------------------
-- B3. Infrastructure / low-traffic table indexes (4 indexes)
-- These tables are small or rarely queried by the application.
-- ---------------------------------------------------------------------------

-- pipeline_runs: infrastructure table, rarely queried by app
DROP INDEX IF EXISTS idx_pipeline_runs_name_started;

-- processing_queue: low-traffic job queue table
DROP INDEX IF EXISTS idx_processing_queue_job_type;

-- user_roles: tiny table (< 10 rows), full scan is faster than index lookup
DROP INDEX IF EXISTS idx_user_roles_role;

-- workspaces domain_metadata: JSONB GIN index unlikely to be queried directly
DROP INDEX IF EXISTS idx_workspaces_domain_metadata;

-- ---------------------------------------------------------------------------
-- B4. Low-value indexes on small/infrequently-queried data (4 indexes)
-- ---------------------------------------------------------------------------

-- quality_log: low-traffic table, boolean index has poor selectivity
DROP INDEX IF EXISTS idx_quality_log_resolved;

-- quality_log: partial index on unresolved — table is small enough for seq scan
DROP INDEX IF EXISTS idx_quality_log_unresolved;

-- digests: small table, period and type filters scan few rows
DROP INDEX IF EXISTS idx_digests_period;
DROP INDEX IF EXISTS idx_digests_type;

-- ---------------------------------------------------------------------------
-- B5. Marginal-value indexes (1 index)
-- ---------------------------------------------------------------------------

-- read_marks: sorting by read_at is rare; user+content_item index covers lookups
DROP INDEX IF EXISTS idx_read_marks_read_at;

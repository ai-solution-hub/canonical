-- =============================================================================
-- Migration 5: RLS Policies & Product Functions
-- =============================================================================
-- Applied remotely via Supabase MCP on 4 March 2026
--
-- This migration:
--   1. Creates get_user_role() SECURITY DEFINER helper
--   2. Drops all permissive IMS policies
--   3. Creates role-based RLS policies on all 14 tables
--   4. Updates hybrid_search to include created_by in results
--   5. Adds new product functions: search_for_bid_response, get_bid_summary
--   6. Removes IMS-specific functions no longer needed
--
-- Role model:
--   admin  - full CRUD on all tables, manage users
--   editor - CRUD on content, bids, taxonomy; read-only on user_roles
--   viewer - read-only on content, bids, taxonomy
--
-- Tables with RLS policies (14):
--   content_items, projects, content_item_projects, ingestion_quality_log,
--   read_marks, digests, pipeline_runs, processing_queue,
--   user_roles, content_history, bid_questions, bid_responses,
--   taxonomy_domains, taxonomy_subtopics
-- =============================================================================

-- ==============================
-- 1. get_user_role() helper
-- ==============================

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_role TEXT;
BEGIN
    SELECT role INTO user_role
    FROM user_roles
    WHERE user_id = auth.uid();

    RETURN COALESCE(user_role, 'viewer');
END;
$$;

-- ==============================
-- 2. Drop all permissive IMS policies
-- ==============================

-- content_items
DROP POLICY IF EXISTS "Allow all access to content_items" ON content_items;
DROP POLICY IF EXISTS "Enable read access for all users" ON content_items;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON content_items;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON content_items;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON content_items;

-- projects
DROP POLICY IF EXISTS "Allow all access to projects" ON projects;

-- content_item_projects
DROP POLICY IF EXISTS "Allow all access to content_item_projects" ON content_item_projects;

-- ingestion_quality_log
DROP POLICY IF EXISTS "Allow all access to ingestion_quality_log" ON ingestion_quality_log;

-- read_marks
DROP POLICY IF EXISTS "Allow all access to read_marks" ON read_marks;

-- digests
DROP POLICY IF EXISTS "Allow all access to digests" ON digests;

-- pipeline_runs
DROP POLICY IF EXISTS "Allow all access to pipeline_runs" ON pipeline_runs;

-- ==============================
-- 3. Role-based RLS policies
-- ==============================

-- Pattern: all authenticated users can SELECT; editors+ can INSERT/UPDATE; admins can DELETE
-- Exceptions noted per table.

-- content_items
CREATE POLICY "content_items_select" ON content_items FOR SELECT
    TO authenticated USING (TRUE);
CREATE POLICY "content_items_insert" ON content_items FOR INSERT
    TO authenticated WITH CHECK (get_user_role() IN ('admin','editor'));
CREATE POLICY "content_items_update" ON content_items FOR UPDATE
    TO authenticated USING (get_user_role() IN ('admin','editor'));
CREATE POLICY "content_items_delete" ON content_items FOR DELETE
    TO authenticated USING (get_user_role() = 'admin');

-- projects
CREATE POLICY "projects_select" ON projects FOR SELECT
    TO authenticated USING (TRUE);
CREATE POLICY "projects_insert" ON projects FOR INSERT
    TO authenticated WITH CHECK (get_user_role() IN ('admin','editor'));
CREATE POLICY "projects_update" ON projects FOR UPDATE
    TO authenticated USING (get_user_role() IN ('admin','editor'));
CREATE POLICY "projects_delete" ON projects FOR DELETE
    TO authenticated USING (get_user_role() = 'admin');

-- content_item_projects
CREATE POLICY "cip_select" ON content_item_projects FOR SELECT
    TO authenticated USING (TRUE);
CREATE POLICY "cip_insert" ON content_item_projects FOR INSERT
    TO authenticated WITH CHECK (get_user_role() IN ('admin','editor'));
CREATE POLICY "cip_delete" ON content_item_projects FOR DELETE
    TO authenticated USING (get_user_role() IN ('admin','editor'));

-- ingestion_quality_log
CREATE POLICY "quality_log_select" ON ingestion_quality_log FOR SELECT
    TO authenticated USING (TRUE);
CREATE POLICY "quality_log_insert" ON ingestion_quality_log FOR INSERT
    TO authenticated WITH CHECK (get_user_role() IN ('admin','editor'));
CREATE POLICY "quality_log_update" ON ingestion_quality_log FOR UPDATE
    TO authenticated USING (get_user_role() IN ('admin','editor'));

-- read_marks (users manage their own)
CREATE POLICY "read_marks_select" ON read_marks FOR SELECT
    TO authenticated USING (user_id = auth.uid());
CREATE POLICY "read_marks_insert" ON read_marks FOR INSERT
    TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "read_marks_delete" ON read_marks FOR DELETE
    TO authenticated USING (user_id = auth.uid());

-- digests
CREATE POLICY "digests_select" ON digests FOR SELECT
    TO authenticated USING (TRUE);
CREATE POLICY "digests_insert" ON digests FOR INSERT
    TO authenticated WITH CHECK (get_user_role() IN ('admin','editor'));
CREATE POLICY "digests_delete" ON digests FOR DELETE
    TO authenticated USING (get_user_role() = 'admin');

-- pipeline_runs (admin only for writes)
CREATE POLICY "pipeline_runs_select" ON pipeline_runs FOR SELECT
    TO authenticated USING (TRUE);
CREATE POLICY "pipeline_runs_insert" ON pipeline_runs FOR INSERT
    TO authenticated WITH CHECK (get_user_role() = 'admin');

-- processing_queue (admin only for writes)
CREATE POLICY "processing_queue_select" ON processing_queue FOR SELECT
    TO authenticated USING (get_user_role() IN ('admin','editor'));
CREATE POLICY "processing_queue_insert" ON processing_queue FOR INSERT
    TO authenticated WITH CHECK (get_user_role() IN ('admin','editor'));
CREATE POLICY "processing_queue_update" ON processing_queue FOR UPDATE
    TO authenticated USING (get_user_role() = 'admin');

-- user_roles (admin manages; users can read own)
CREATE POLICY "user_roles_select_own" ON user_roles FOR SELECT
    TO authenticated USING (user_id = auth.uid() OR get_user_role() = 'admin');
CREATE POLICY "user_roles_insert" ON user_roles FOR INSERT
    TO authenticated WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "user_roles_update" ON user_roles FOR UPDATE
    TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY "user_roles_delete" ON user_roles FOR DELETE
    TO authenticated USING (get_user_role() = 'admin');

-- content_history (read by all; written by editors+)
CREATE POLICY "content_history_select" ON content_history FOR SELECT
    TO authenticated USING (TRUE);
CREATE POLICY "content_history_insert" ON content_history FOR INSERT
    TO authenticated WITH CHECK (get_user_role() IN ('admin','editor'));

-- bid_questions
CREATE POLICY "bid_questions_select" ON bid_questions FOR SELECT
    TO authenticated USING (TRUE);
CREATE POLICY "bid_questions_insert" ON bid_questions FOR INSERT
    TO authenticated WITH CHECK (get_user_role() IN ('admin','editor'));
CREATE POLICY "bid_questions_update" ON bid_questions FOR UPDATE
    TO authenticated USING (get_user_role() IN ('admin','editor'));
CREATE POLICY "bid_questions_delete" ON bid_questions FOR DELETE
    TO authenticated USING (get_user_role() = 'admin');

-- bid_responses
CREATE POLICY "bid_responses_select" ON bid_responses FOR SELECT
    TO authenticated USING (TRUE);
CREATE POLICY "bid_responses_insert" ON bid_responses FOR INSERT
    TO authenticated WITH CHECK (get_user_role() IN ('admin','editor'));
CREATE POLICY "bid_responses_update" ON bid_responses FOR UPDATE
    TO authenticated USING (get_user_role() IN ('admin','editor'));
CREATE POLICY "bid_responses_delete" ON bid_responses FOR DELETE
    TO authenticated USING (get_user_role() = 'admin');

-- taxonomy_domains
CREATE POLICY "taxonomy_domains_select" ON taxonomy_domains FOR SELECT
    TO authenticated USING (TRUE);
CREATE POLICY "taxonomy_domains_insert" ON taxonomy_domains FOR INSERT
    TO authenticated WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "taxonomy_domains_update" ON taxonomy_domains FOR UPDATE
    TO authenticated USING (get_user_role() = 'admin');

-- taxonomy_subtopics
CREATE POLICY "taxonomy_subtopics_select" ON taxonomy_subtopics FOR SELECT
    TO authenticated USING (TRUE);
CREATE POLICY "taxonomy_subtopics_insert" ON taxonomy_subtopics FOR INSERT
    TO authenticated WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "taxonomy_subtopics_update" ON taxonomy_subtopics FOR UPDATE
    TO authenticated USING (get_user_role() = 'admin');

-- ==============================
-- 4. Updated hybrid_search (includes created_by)
-- ==============================

CREATE OR REPLACE FUNCTION hybrid_search(
    query_text       TEXT,
    query_embedding  vector(1536),
    match_count      INTEGER DEFAULT 20,
    full_text_weight FLOAT DEFAULT 1.0,
    semantic_weight  FLOAT DEFAULT 1.0,
    rrf_k            INTEGER DEFAULT 50
) RETURNS TABLE (
    id UUID, title TEXT, body TEXT, content_type TEXT, domain TEXT,
    created_by UUID, similarity FLOAT, rank FLOAT
) LANGUAGE plpgsql AS $$ ... $$;

-- ==============================
-- 5. New product functions
-- ==============================

-- search_for_bid_response: Find KB content relevant to a bid question
CREATE OR REPLACE FUNCTION search_for_bid_response(
    question_id      UUID,
    query_embedding  vector(1536),
    match_count      INTEGER DEFAULT 10,
    domain_filter    TEXT DEFAULT NULL
) RETURNS TABLE (
    id UUID, title TEXT, body TEXT, brief TEXT, detail TEXT,
    content_type TEXT, domain TEXT, quality_score REAL,
    similarity FLOAT
) LANGUAGE plpgsql AS $$ ... $$;

-- get_bid_summary: Aggregate statistics for a bid project
CREATE OR REPLACE FUNCTION get_bid_summary(bid_project_id UUID)
RETURNS JSON
LANGUAGE plpgsql AS $$
-- Returns: { total_questions, by_status: {...}, avg_confidence, completion_pct }
$$ ... $$;

-- ==============================
-- 6. Remove IMS-specific functions
-- ==============================

-- Functions removed (were IMS/Tana-specific):
-- DROP FUNCTION IF EXISTS get_tana_sync_status();
-- DROP FUNCTION IF EXISTS sync_tana_nodes();
-- DROP FUNCTION IF EXISTS get_share_analytics();
-- (Already removed during base schema consolidation)

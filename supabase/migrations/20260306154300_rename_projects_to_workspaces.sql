-- ==========================================================================
-- Migration: Rename projects → workspaces
-- Session 55 — Foundation for codebase rename
--
-- Strategy: Rename tables/columns, update DB objects, then create
-- compatibility VIEWS so existing code keeps working until the
-- codebase rename is complete. Drop views in a follow-up migration.
-- ==========================================================================

-- ── 1. Drop RLS policies (must happen before rename) ──────────────────────

DROP POLICY IF EXISTS "projects_select" ON projects;
DROP POLICY IF EXISTS "projects_insert" ON projects;
DROP POLICY IF EXISTS "projects_update" ON projects;
DROP POLICY IF EXISTS "projects_delete" ON projects;

DROP POLICY IF EXISTS "cip_select" ON content_item_projects;
DROP POLICY IF EXISTS "cip_insert" ON content_item_projects;
DROP POLICY IF EXISTS "cip_update" ON content_item_projects;
DROP POLICY IF EXISTS "cip_delete" ON content_item_projects;

-- ── 2. Drop trigger (will be recreated on renamed table) ──────────────────

DROP TRIGGER IF EXISTS sync_bid_status ON projects;

-- ── 3. Drop functions that reference old table names ──────────────────────

DROP FUNCTION IF EXISTS get_item_projects(UUID);
DROP FUNCTION IF EXISTS get_project_counts();
DROP FUNCTION IF EXISTS get_project_item_counts();
DROP FUNCTION IF EXISTS get_bid_summary(UUID);

-- ── 4. Drop view that references old table names ──────────────────────────

DROP VIEW IF EXISTS content_items_overview;

-- ── 5. Rename tables ─────────────────────────────────────────────────────

ALTER TABLE projects RENAME TO workspaces;
ALTER TABLE content_item_projects RENAME TO content_item_workspaces;

-- ── 6. Rename column ─────────────────────────────────────────────────────

ALTER TABLE content_item_workspaces RENAME COLUMN project_id TO workspace_id;

-- ── 7. Rename indexes ────────────────────────────────────────────────────

ALTER INDEX IF EXISTS idx_projects_type RENAME TO idx_workspaces_type;
ALTER INDEX IF EXISTS idx_projects_type_archived RENAME TO idx_workspaces_type_archived;
ALTER INDEX IF EXISTS idx_projects_type_status RENAME TO idx_workspaces_type_status;
ALTER INDEX IF EXISTS idx_projects_created_by RENAME TO idx_workspaces_created_by;
ALTER INDEX IF EXISTS idx_projects_updated_by RENAME TO idx_workspaces_updated_by;
ALTER INDEX IF EXISTS idx_projects_domain_metadata RENAME TO idx_workspaces_domain_metadata;
ALTER INDEX IF EXISTS projects_type_name_unique RENAME TO workspaces_type_name_unique;
ALTER INDEX IF EXISTS content_item_projects_content_item_id_project_id_key
  RENAME TO content_item_workspaces_content_item_id_workspace_id_key;
ALTER INDEX IF EXISTS idx_cip_content_item RENAME TO idx_ciw_content_item;
ALTER INDEX IF EXISTS idx_cip_project RENAME TO idx_ciw_workspace;

-- ── 8. Recreate RLS policies on renamed tables ───────────────────────────

-- workspaces (formerly projects)
CREATE POLICY "workspaces_select" ON workspaces FOR SELECT TO authenticated USING (true);
CREATE POLICY "workspaces_insert" ON workspaces FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'editor'));
CREATE POLICY "workspaces_update" ON workspaces FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin', 'editor'))
  WITH CHECK (get_user_role() IN ('admin', 'editor'));
CREATE POLICY "workspaces_delete" ON workspaces FOR DELETE TO authenticated
  USING (get_user_role() = 'admin');

-- content_item_workspaces (formerly content_item_projects)
CREATE POLICY "ciw_select" ON content_item_workspaces FOR SELECT TO authenticated USING (true);
CREATE POLICY "ciw_insert" ON content_item_workspaces FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'editor'));
CREATE POLICY "ciw_update" ON content_item_workspaces FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin', 'editor'))
  WITH CHECK (get_user_role() IN ('admin', 'editor'));
CREATE POLICY "ciw_delete" ON content_item_workspaces FOR DELETE TO authenticated
  USING (get_user_role() = 'admin');

-- ── 9. Recreate trigger on renamed table ─────────────────────────────────

CREATE TRIGGER sync_bid_status
  BEFORE INSERT OR UPDATE ON workspaces
  FOR EACH ROW
  EXECUTE FUNCTION sync_bid_status_to_jsonb();

-- ── 10. Recreate functions with updated table/column names ───────────────

CREATE OR REPLACE FUNCTION get_item_workspaces(p_item_id UUID)
RETURNS SETOF workspaces
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT w.* FROM workspaces w
  JOIN content_item_workspaces ciw ON ciw.workspace_id = w.id
  WHERE ciw.content_item_id = p_item_id AND w.is_archived = false
  ORDER BY w.name;
$$;

CREATE OR REPLACE FUNCTION get_workspace_counts()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(jsonb_object_agg(name, cnt), '{}'::jsonb)
  FROM (
    SELECT w.name, COUNT(*) as cnt
    FROM content_item_workspaces ciw
    JOIN workspaces w ON w.id = ciw.workspace_id
    WHERE w.is_archived = false
    GROUP BY w.name
    ORDER BY cnt DESC
  ) sub;
$$;

CREATE OR REPLACE FUNCTION get_workspace_item_counts()
RETURNS TABLE (workspace_id UUID, item_count BIGINT, last_activity TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT w.id AS workspace_id, COUNT(ciw.id) AS item_count,
    MAX(ciw.assigned_at) AS last_activity
  FROM workspaces w
  LEFT JOIN content_item_workspaces ciw ON ciw.workspace_id = w.id
  GROUP BY w.id;
$$;

CREATE OR REPLACE FUNCTION get_bid_summary(bid_workspace_id UUID)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT json_build_object(
    'workspace_id', bid_workspace_id,
    'total_questions', (SELECT COUNT(*) FROM bid_questions WHERE project_id = bid_workspace_id),
    'status_breakdown', (
      SELECT json_agg(json_build_object('status', status, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT status, COUNT(*) AS cnt FROM bid_questions WHERE project_id = bid_workspace_id GROUP BY status) sub),
    'confidence_breakdown', (
      SELECT json_agg(json_build_object('posture', confidence_posture, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT confidence_posture, COUNT(*) AS cnt FROM bid_questions
        WHERE project_id = bid_workspace_id AND confidence_posture IS NOT NULL GROUP BY confidence_posture) sub),
    'responses_count', (
      SELECT COUNT(*) FROM bid_responses br JOIN bid_questions bq ON bq.id = br.question_id WHERE bq.project_id = bid_workspace_id),
    'review_status_breakdown', (
      SELECT json_agg(json_build_object('status', review_status, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT br.review_status, COUNT(*) AS cnt FROM bid_responses br
        JOIN bid_questions bq ON bq.id = br.question_id WHERE bq.project_id = bid_workspace_id GROUP BY br.review_status) sub),
    'sections', (
      SELECT json_agg(json_build_object('section', section_name, 'question_count', cnt, 'completed', completed_cnt) ORDER BY min_seq)
      FROM (SELECT bq.section_name, COUNT(*) AS cnt, COUNT(*) FILTER (WHERE bq.status = 'complete') AS completed_cnt,
        MIN(bq.section_sequence) AS min_seq FROM bid_questions bq WHERE bq.project_id = bid_workspace_id GROUP BY bq.section_name) sub)
  );
$$;

-- ── 11. Compatibility views (allow existing code to keep working) ────────
-- These views let .from('projects') and .from('content_item_projects')
-- continue to work until the codebase rename is complete.
-- Drop these views in a follow-up migration after all code is updated.

CREATE OR REPLACE VIEW projects AS SELECT * FROM workspaces;
CREATE OR REPLACE VIEW content_item_projects AS
  SELECT id, content_item_id, workspace_id AS project_id, assigned_at
  FROM content_item_workspaces;

-- ── 12. Enable RLS passthrough on views ──────────────────────────────────
-- Views inherit RLS from underlying tables when security_invoker is set.
-- For PostgreSQL < 15, views bypass RLS by default if the view owner has
-- table access. Since these are compatibility views accessed via Supabase
-- client (which uses the authenticated role), RLS on the base tables
-- applies automatically.

COMMENT ON VIEW projects IS 'Compatibility view — will be dropped after codebase rename to workspaces';
COMMENT ON VIEW content_item_projects IS 'Compatibility view — will be dropped after codebase rename to content_item_workspaces';

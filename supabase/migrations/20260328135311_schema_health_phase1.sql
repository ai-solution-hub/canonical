-- Schema Health Phase 1: Critical + High Priority Fixes
-- 1.1 Remove duplicate FKs on content_item_workspaces
-- 1.2 Add missing RLS policies on bid_response_history

-- =============================================================================
-- 1.1 Remove duplicate/legacy FK constraints on content_item_workspaces
-- =============================================================================
-- Drop legacy NO ACTION FK on content_item_id (duplicate of CASCADE version)
ALTER TABLE content_item_workspaces
  DROP CONSTRAINT content_item_projects_content_item_id_fkey;

-- Drop legacy NO ACTION FK on workspace_id (will be replaced with CASCADE)
ALTER TABLE content_item_workspaces
  DROP CONSTRAINT content_item_projects_project_id_fkey;

-- Add CASCADE FK for workspace_id (the legacy constraint was the only FK on this column)
ALTER TABLE content_item_workspaces
  ADD CONSTRAINT content_item_workspaces_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- =============================================================================
-- 1.2 Add missing RLS policies on bid_response_history
-- =============================================================================
-- Currently only a SELECT policy exists. Add INSERT + DELETE.
-- No UPDATE policy: bid_response_history is append-only (version snapshots).

CREATE POLICY "Editors and admins can insert bid response history"
  ON bid_response_history FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "Admins can delete bid response history"
  ON bid_response_history FOR DELETE
  TO authenticated
  USING (
    get_user_role() = 'admin'
  );

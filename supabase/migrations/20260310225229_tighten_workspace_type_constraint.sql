-- Tighten workspace type constraint: remove 'project' type
--
-- The 'project' type was inherited from IMS and flagged for removal in the
-- S62 navigation redesign (docs/plans/2026-03-07-workspace-navigation-redesign.md).
-- Projects are metadata/tags, not containers. Future application types become
-- new workspace types (e.g. 'proposal', 'compliance_pack').
--
-- Pre-condition: no rows with type = 'project' exist (cleaned in S80 WP4).

-- Drop the old constraint and create a new one without 'project'
ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS projects_type_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_type_check
  CHECK (type IN ('bid', 'kb_section'));

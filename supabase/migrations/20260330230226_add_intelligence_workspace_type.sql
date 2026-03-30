-- ============================================================
-- Add 'intelligence' to workspaces.type CHECK constraint
-- ============================================================

ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_type_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_type_check
  CHECK (type IN ('bid', 'kb_section', 'intelligence'));

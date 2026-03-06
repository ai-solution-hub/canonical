-- ==========================================================================
-- Migration: Drop compatibility views after codebase rename
-- Session 57 — WP3: Final cleanup
--
-- The codebase has been fully renamed from projects → workspaces.
-- These views were created in the rename migration to keep old code working
-- during the transition. They are no longer needed.
-- ==========================================================================

DROP VIEW IF EXISTS projects;
DROP VIEW IF EXISTS content_item_projects;

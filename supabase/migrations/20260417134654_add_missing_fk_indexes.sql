-- Add covering indexes for foreign keys missing them.
-- Supabase linter flagged 5 FKs without covering indexes on the re-ingestion
-- project; old project had them. Likely dropped when S176 squash rebuilt
-- tables from pg_dump output that did not include these indexes.

CREATE INDEX IF NOT EXISTS idx_content_history_created_by
  ON public.content_history (created_by);

CREATE INDEX IF NOT EXISTS idx_content_item_workspaces_workspace_id
  ON public.content_item_workspaces (workspace_id);

CREATE INDEX IF NOT EXISTS idx_content_items_updated_by
  ON public.content_items (updated_by);

CREATE INDEX IF NOT EXISTS idx_read_marks_content_item_id
  ON public.read_marks (content_item_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_granted_by
  ON public.user_roles (granted_by);

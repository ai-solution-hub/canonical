-- Fix workspaces schema regression + recreate storage buckets lost in squash.
--
-- workspaces:
--   - S176 squash dropped `icon` (used by app) and added `is_active` (unused).
--   - Both existed on old project? NO. Old had icon; squash invented is_active.
--   - Restore icon; drop is_active.
--
-- Storage buckets:
--   - New project has 0 buckets. Old had documents, templates, tender-documents.
--   - Recreate as private (public=false) to match old. Upload route requires them.

-- 1. workspaces column fix
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS is_active;

-- 2. Storage buckets
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('documents', 'documents', false),
  ('templates', 'templates', false),
  ('tender-documents', 'tender-documents', false)
ON CONFLICT (id) DO NOTHING;

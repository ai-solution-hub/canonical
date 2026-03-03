-- Drop all existing permissive policies
DROP POLICY IF EXISTS "content_items_all" ON content_items;
DROP POLICY IF EXISTS "ideas_all" ON ideas;
DROP POLICY IF EXISTS "idea_relationships_all" ON idea_relationships;
DROP POLICY IF EXISTS "idea_keywords_all" ON idea_keywords;
DROP POLICY IF EXISTS "idea_themes_all" ON idea_themes;
DROP POLICY IF EXISTS "idea_theme_assignments_all" ON idea_theme_assignments;
DROP POLICY IF EXISTS "tana_sync_log_all" ON tana_sync_log;
DROP POLICY IF EXISTS "ingestion_quality_log_all" ON ingestion_quality_log;

-- Enable RLS on tables created in later migrations (if not already enabled)
ALTER TABLE IF EXISTS read_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS digests ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies on newer tables
DROP POLICY IF EXISTS "read_marks_all" ON read_marks;
DROP POLICY IF EXISTS "digests_all" ON digests;
DROP POLICY IF EXISTS "Allow all" ON read_marks;
DROP POLICY IF EXISTS "Allow all" ON digests;

-- Create authenticated-only policies for all tables
-- Pattern: any authenticated user gets full access (single-user system)
-- The service_role key bypasses RLS entirely, so Python pipelines are unaffected.

CREATE POLICY "authenticated_full_access" ON content_items
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON ideas
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON idea_relationships
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON idea_keywords
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON idea_themes
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON idea_theme_assignments
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON tana_sync_log
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON ingestion_quality_log
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON read_marks
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON digests
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

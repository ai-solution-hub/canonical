-- ==========================================================================
-- Security + Performance Fixes (WP4)
-- Addresses Supabase advisor warnings for search_path, duplicate permissive
-- policies, and RLS initplan issues.
-- ==========================================================================

-- -------------------------------------------------------------------------
-- SECURITY: Set search_path on functions missing it
-- These 8 functions need search_path = public, extensions to avoid
-- security warnings (get_coverage_matrix already has it).
-- -------------------------------------------------------------------------

ALTER FUNCTION public.get_items_with_quality_flags()
  SET search_path = public, extensions;

ALTER FUNCTION public.get_quality_issue_counts()
  SET search_path = public, extensions;

ALTER FUNCTION public.recalculate_all_freshness()
  SET search_path = public, extensions;

ALTER FUNCTION public.get_freshness_breakdown()
  SET search_path = public, extensions;

ALTER FUNCTION public.get_content_gaps()
  SET search_path = public, extensions;

ALTER FUNCTION public.get_coverage_summary()
  SET search_path = public, extensions;

ALTER FUNCTION public.get_domain_subtopic_counts()
  SET search_path = public, extensions;

ALTER FUNCTION public.get_filter_counts()
  SET search_path = public, extensions;

-- -------------------------------------------------------------------------
-- PERFORMANCE: Fix multiple permissive SELECT policies
-- -------------------------------------------------------------------------

-- 1. content_templates: content_templates_admin_manage (ALL) overlaps with
--    content_templates_select (SELECT, USING true).
DROP POLICY IF EXISTS "content_templates_admin_manage" ON public.content_templates;

CREATE POLICY "content_templates_admin_manage" ON public.content_templates
  FOR INSERT TO authenticated
  WITH CHECK ((get_user_role())::text = 'admin'::text);

CREATE POLICY "content_templates_admin_update" ON public.content_templates
  FOR UPDATE TO authenticated
  USING ((get_user_role())::text = 'admin'::text);

CREATE POLICY "content_templates_admin_delete" ON public.content_templates
  FOR DELETE TO authenticated
  USING ((get_user_role())::text = 'admin'::text);

-- 2. guide_sections: broad SELECT + ALL overlap
DROP POLICY IF EXISTS "Editors and admins can manage guide sections" ON public.guide_sections;

CREATE POLICY "Editors and admins can insert guide sections" ON public.guide_sections
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT get_user_role())::text = ANY (ARRAY['admin'::text, 'editor'::text])));

CREATE POLICY "Editors and admins can update guide sections" ON public.guide_sections
  FOR UPDATE TO authenticated
  USING (((SELECT get_user_role())::text = ANY (ARRAY['admin'::text, 'editor'::text])));

CREATE POLICY "Editors and admins can delete guide sections" ON public.guide_sections
  FOR DELETE TO authenticated
  USING (((SELECT get_user_role())::text = ANY (ARRAY['admin'::text, 'editor'::text])));

-- 3. guides: two SELECT policies overlap
DROP POLICY IF EXISTS "Admins can read all guides" ON public.guides;
DROP POLICY IF EXISTS "Authenticated users can read published guides" ON public.guides;

CREATE POLICY "Authenticated users can read guides" ON public.guides
  FOR SELECT TO authenticated
  USING (
    is_published = true
    OR (SELECT get_user_role())::text = 'admin'::text
  );

-- 4. source_document_diffs: SELECT + ALL overlap + initplan fix
DROP POLICY IF EXISTS "Editors can manage diffs" ON public.source_document_diffs;

CREATE POLICY "Editors can insert diffs" ON public.source_document_diffs
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
      AND (user_roles.role)::text = ANY (ARRAY['editor'::text, 'admin'::text])
    )
  );

CREATE POLICY "Editors can update diffs" ON public.source_document_diffs
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
      AND (user_roles.role)::text = ANY (ARRAY['editor'::text, 'admin'::text])
    )
  );

CREATE POLICY "Editors can delete diffs" ON public.source_document_diffs
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
      AND (user_roles.role)::text = ANY (ARRAY['editor'::text, 'admin'::text])
    )
  );

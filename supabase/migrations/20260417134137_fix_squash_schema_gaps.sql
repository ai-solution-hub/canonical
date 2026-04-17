-- Fix schema gaps from S176 squash (20260416102457_pre_squash_reconciliation.sql)
--
-- Root cause: the squash migration was generated from pg_dump output which
-- omitted the following attributes that were present on the original project:
--   - security_invoker=true reloption on view quality_issues_pending
--   - SET search_path on 8 functions (12 overloads)
--   - (select auth.uid()) wrappers in 6 RLS policies
--   - vector extension schema placement (was public, should be extensions — fixed manually pre-migration)
--   - pg_trgm extension (was added by squash, never existed on old — dropped manually pre-migration)
--
-- Plus two pairs of duplicate indexes introduced by concurrent migrations.
--
-- Extension fixes (vector -> extensions, pg_trgm dropped) were applied via
-- psql before this migration since ALTER EXTENSION SET SCHEMA cannot run
-- inside a migration transaction.

-- 1. View security_invoker
ALTER VIEW public.quality_issues_pending SET (security_invoker = true);

-- 2. Function search_path (12 overloads across 8 function names)
ALTER FUNCTION public.auto_version_content_history() SET search_path = public, extensions;
ALTER FUNCTION public.filter_by_keywords(search_terms text[]) SET search_path = public, extensions;
ALTER FUNCTION public.filter_by_keywords(keyword_list text[], match_mode text) SET search_path = public, extensions;
ALTER FUNCTION public.get_author_analysis(limit_count integer) SET search_path = public, extensions;
ALTER FUNCTION public.get_capture_activity(days_back integer) SET search_path = public, extensions;
ALTER FUNCTION public.get_trend_analysis(days_back integer, bucket_size text) SET search_path = public, extensions;
ALTER FUNCTION public.hybrid_search(query_embedding vector, query_text text, similarity_threshold numeric, limit_count integer) SET search_path = public, extensions;
ALTER FUNCTION public.hybrid_search(query_text text, query_embedding vector, match_count integer, full_text_weight double precision, semantic_weight double precision, rrf_k integer) SET search_path = public, extensions;
ALTER FUNCTION public.search_for_bid_response(query_embedding vector, query_text text, limit_count integer) SET search_path = public, extensions;
ALTER FUNCTION public.search_for_bid_response(question_id uuid, query_embedding vector, match_count integer, domain_filter text) SET search_path = public, extensions;
ALTER FUNCTION public.toggle_star(item_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.toggle_star(p_item_id uuid, p_starred boolean) SET search_path = public, extensions;

-- 3. RLS policies - wrap auth.uid() in (select ...) to avoid per-row reevaluation

-- read_marks: 3 policies
DROP POLICY IF EXISTS read_marks_delete ON public.read_marks;
CREATE POLICY read_marks_delete ON public.read_marks FOR DELETE
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS read_marks_insert ON public.read_marks;
CREATE POLICY read_marks_insert ON public.read_marks FOR INSERT
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS read_marks_select ON public.read_marks;
CREATE POLICY read_marks_select ON public.read_marks FOR SELECT
  USING (user_id = (select auth.uid()));

-- user_roles: 1 policy
DROP POLICY IF EXISTS user_roles_select_own ON public.user_roles;
CREATE POLICY user_roles_select_own ON public.user_roles FOR SELECT
  USING ((user_id = (select auth.uid())) OR (get_user_role() = 'admin'::text));

-- classification_disputes: consolidate 2 SELECT policies into 1 (fixes multiple_permissive_policies too)
DROP POLICY IF EXISTS classification_disputes_select_admin ON public.classification_disputes;
DROP POLICY IF EXISTS classification_disputes_select_own ON public.classification_disputes;
CREATE POLICY classification_disputes_select ON public.classification_disputes FOR SELECT
  USING (
    (get_user_role() = 'admin'::text)
    OR ((get_user_role() = 'editor'::text) AND (disputed_by = (select auth.uid())))
  );

-- classification_disputes_insert: wrap auth.uid()
DROP POLICY IF EXISTS classification_disputes_insert ON public.classification_disputes;
CREATE POLICY classification_disputes_insert ON public.classification_disputes FOR INSERT
  WITH CHECK (
    (get_user_role() = ANY (ARRAY['admin'::text, 'editor'::text]))
    AND (disputed_by = (select auth.uid()))
    AND (status = 'open'::text)
    AND (resolved_by IS NULL)
    AND (resolved_at IS NULL)
    AND (resolution_notes IS NULL)
  );

-- 4. Drop duplicate indexes - keep the more descriptive names
DROP INDEX IF EXISTS public.idx_content_items_archived;
DROP INDEX IF EXISTS public.idx_content_items_governance;

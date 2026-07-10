-- ID-144 {144.5} companion — api.hybrid_search wrapper regen for the 24-col/
-- 12-arg public.hybrid_search signature landed by the prior migration in this
-- same push batch (20260710221255_id144_hybrid_search_projection_filters.sql,
-- DR-032 same-batch companion).
--
-- Root cause avoided: config.toml `schemas = ["api"]` means every
-- supabase-js `.rpc('hybrid_search')` resolves to `api.hybrid_search`, never
-- `public.hybrid_search` directly (DR-030). Without this companion, the old
-- 7-arg/21-col api.hybrid_search wrapper would still be live — the new
-- filter params and projected columns would be silently unreachable through
-- PostgREST (PGRST202 on the new identity, or the old defaults on the old
-- one) — invisible to mocked `bun run test`, only caught by
-- `test:integration` or a live call (TECH §5 risk B).
--
-- Shape emitted by scripts/generate-api-views.ts's emitFunction() for a
-- non-SECURITY-DEFINER public fn ("INVOKER entrypoint" — hybrid_search has
-- no SECURITY DEFINER clause) — DROP/CREATE by identity args, named-argument
-- passthrough (`name => name`, mirrors how PostgREST itself binds RPC args
-- from the JSON body), search_path pinned, REVOKE EXECUTE FROM PUBLIC then
-- GRANT to exactly the roles the public original grants MINUS anon
-- (anonFilteredGrantRoles — DR-035 {61.14}: api wrappers are born-locked
-- regardless of base-fn drift). Verified live: public.hybrid_search grants
-- {authenticated, service_role} only (no anon) — mirrored 1:1 here. The
-- signature (12 identity args, 24-col RETURNS TABLE) was introspected via
-- pg_get_function_arguments / pg_get_function_identity_arguments /
-- pg_get_function_result against the just-applied public.hybrid_search on
-- Platform staging (rbwqewalexrzgxtvcqrh), matching generate-api-views.ts's
-- own catalog-introspection approach byte-for-byte (SURFACE_RPCS entry,
-- generate-api-views.ts:215) — hand-authored as a standalone companion
-- migration rather than through the full-surface OUTPUT_FILE regen (same
-- precedent as 20260703210000_id138_api_rpc_wrappers.sql: the whole-surface
-- generator target is a separate, independently-regenerated snapshot file
-- that is not touched by this Task).
--
-- Applied to Platform staging in the SAME push batch as migration 1, before
-- the type regen (supabase/CLAUDE.md recipe, TECH §2.6 step 3).
--
-- UK English throughout (DD/MM/YYYY). Authored 10/07/2026.

SET search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- api.hybrid_search(query_embedding vector, query_text text, similarity_threshold
-- numeric, limit_count integer, include_superseded boolean, visibility_filter
-- character varying, application_type text, filter_kind text, filter_domain
-- text, filter_subtopic text, filter_date_from timestamp with time zone,
-- filter_date_to timestamp with time zone)  [INVOKER entrypoint]
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.hybrid_search(query_embedding vector, query_text text, similarity_threshold numeric, limit_count integer, include_superseded boolean, visibility_filter character varying, application_type text);
DROP FUNCTION IF EXISTS api.hybrid_search(query_embedding vector, query_text text, similarity_threshold numeric, limit_count integer, include_superseded boolean, visibility_filter character varying, application_type text, filter_kind text, filter_domain text, filter_subtopic text, filter_date_from timestamp with time zone, filter_date_to timestamp with time zone);
CREATE FUNCTION api.hybrid_search(query_embedding vector, query_text text DEFAULT ''::text, similarity_threshold numeric DEFAULT 0.3, limit_count integer DEFAULT 10, include_superseded boolean DEFAULT false, visibility_filter character varying DEFAULT 'default'::character varying, application_type text DEFAULT 'procurement'::text, filter_kind text DEFAULT NULL::text, filter_domain text DEFAULT NULL::text, filter_subtopic text DEFAULT NULL::text, filter_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, filter_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
  RETURNS TABLE(id uuid, title text, suggested_title text, summary text, primary_domain text, primary_subtopic text, content_type text, platform text, author_name text, source_domain text, thumbnail_url text, captured_date timestamp with time zone, ai_keywords text[], classification_confidence numeric, priority text, metadata jsonb, similarity numeric, snippet text, created_by uuid, verified_at timestamp with time zone, verified_by uuid, scope_tag text[], source_url text, owner_kind text)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.hybrid_search(query_embedding => query_embedding, query_text => query_text, similarity_threshold => similarity_threshold, limit_count => limit_count, include_superseded => include_superseded, visibility_filter => visibility_filter, application_type => application_type, filter_kind => filter_kind, filter_domain => filter_domain, filter_subtopic => filter_subtopic, filter_date_from => filter_date_from, filter_date_to => filter_date_to);
$api$;
REVOKE EXECUTE ON FUNCTION api.hybrid_search(query_embedding vector, query_text text, similarity_threshold numeric, limit_count integer, include_superseded boolean, visibility_filter character varying, application_type text, filter_kind text, filter_domain text, filter_subtopic text, filter_date_from timestamp with time zone, filter_date_to timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.hybrid_search(query_embedding vector, query_text text, similarity_threshold numeric, limit_count integer, include_superseded boolean, visibility_filter character varying, application_type text, filter_kind text, filter_domain text, filter_subtopic text, filter_date_from timestamp with time zone, filter_date_to timestamp with time zone) TO authenticated, service_role;

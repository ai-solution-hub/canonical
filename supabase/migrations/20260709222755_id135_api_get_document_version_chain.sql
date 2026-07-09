-- ID-135 {135.24} — S457 /verify finding 1: api-schema exposure for
-- get_document_version_chain (the 500).
--
-- THE BUG: app/api/source-documents/[id]/versions/route.ts calls
-- `serviceClient.rpc('get_document_version_chain', { p_document_id: id })`.
-- `createServiceClient()` spreads `DB_OPTION` (lib/supabase/schema.ts), which
-- routes every `.rpc()`/`.from()` call at the `api` schema at runtime (the
-- {115} PostgREST schema-isolation cutover unexposed `public` entirely).
-- `public.get_document_version_chain` has existed since the squash baseline
-- (20260617130000_squash_baseline.sql:2477; re-homed onto q_a_pairs at
-- 20260703160000_id131_govfacet_b_rpcs.sql §1 — signature/shape unchanged),
-- but the api_views_and_rpcs exposure step (DR-032: exposure ships in the
-- SAME migration as the public fn) was never applied for this one. Live
-- staging repro (rbwqewalexrzgxtvcqrh) before this migration:
--   POST {url}/rest/v1/rpc/get_document_version_chain, Content-Profile: api
--   -> 404 PGRST202 "Could not find the function api.get_document_version_
--      chain(p_document_id) in the schema cache" (hint: "Perhaps you meant
--      to call the function api.get_content_win_rate") — the route's `error`
--      branch turns this into a generic 500.
--
-- THE FIX: a thin `api.get_document_version_chain` SQL wrapper, mirroring
-- `api.get_content_win_rate` (20260617130000_squash_baseline.sql:513-518)
-- and the more recent `api.get_procurement_rollup`
-- (20260708140000_id130_procurement_rollup_api_rpc.sql) convention verbatim:
-- LANGUAGE sql, SECURITY INVOKER, SET search_path = public, extensions,
-- `SELECT * FROM public.<fn>(...)` body. STABLE is carried over from the
-- wrapped public fn (also LANGUAGE sql STABLE) since the wrapper is exactly
-- as read-only/stable as its target.
--
-- DR-035 (born-locked functions, 20260707190500_id61_dr035_default_
-- privileges.sql): the `dr035_born_locked_functions` ddl_command_end event
-- trigger fires on every CREATE FUNCTION in public/api and auto-REVOKEs
-- EXECUTE FROM PUBLIC, anon — so the explicit REVOKEs below are redundant
-- defense-in-depth (kept for readability/parity with sibling migrations);
-- the GRANTs to authenticated/service_role are NOT automatic and are
-- load-bearing (zero-anon-EXECUTE honoured throughout — no anon grant
-- anywhere in this file).
--
-- No public.* change: public.get_document_version_chain's signature, body,
-- and grants (authenticated/service_role only — squash baseline +
-- {131.13} rewrite) are untouched by this migration.
--
-- Caller once this lands: app/api/source-documents/[id]/versions/route.ts
-- (GET, versions list — the /verify-repro'd 500). lib/mcp/tools/content.ts's
-- get_document_versions MCP tool calls the same *named* RPC through its own
-- Supabase client — whether that client also routes via the api schema (and
-- thus was equally broken) is out of scope for this migration; the route
-- above is the finding's named repro.
-- ============================================================================
CREATE OR REPLACE FUNCTION "api"."get_document_version_chain"("p_document_id" "uuid") RETURNS TABLE("id" "uuid", "filename" "text", "original_filename" "text", "mime_type" character varying, "file_size" integer, "content_hash" "text", "version" integer, "parent_id" "uuid", "storage_path" "text", "status" character varying, "uploaded_by" "uuid", "created_at" timestamp with time zone, "content_item_count" bigint)
    LANGUAGE "sql" STABLE
    SECURITY INVOKER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM "public"."get_document_version_chain"(p_document_id => p_document_id);
$$;

COMMENT ON FUNCTION "api"."get_document_version_chain"("p_document_id" "uuid") IS 'ID-135 {135.24} S457 /verify finding 1 — thin SECURITY INVOKER wrapper over public.get_document_version_chain, exposed for PostgREST .rpc() reachability (DR-032, companion api exposure; the public fn shipped without it at {131.13} — this migration closes that gap). Caller: app/api/source-documents/[id]/versions/route.ts GET (was PGRST202 -> 500, now 200).';

REVOKE ALL ON FUNCTION "api"."get_document_version_chain"("p_document_id" "uuid") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "api"."get_document_version_chain"("p_document_id" "uuid") FROM "anon";
GRANT EXECUTE ON FUNCTION "api"."get_document_version_chain"("p_document_id" "uuid") TO "authenticated", "service_role";

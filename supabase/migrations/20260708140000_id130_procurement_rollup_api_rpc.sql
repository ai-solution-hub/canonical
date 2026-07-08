-- ID-130 {130.29} — sanctioned api-schema read path for the procurement rollup.
--
-- THE BUG (owner ruling oq-e580d5654711384e, option a; {130.20} investigation, S452):
-- app/api/procurement/[id]/route.ts's GET handler reads the materialised rollup by
-- doing `.from('procurement_workspaces').select(...)` through the app's api-schema
-- client (lib/supabase/schema.ts DB_OPTION routes every PostgREST call at the `api`
-- schema post-{115} cutover). `procurement_workspaces` has NO api.* view
-- (INTERNAL_ONLY by design — see 20260625140000_id130_winrate.sql's header note) so
-- that select 404s on EVERY request; the roll-up silently renders null on the detail
-- page. The {130.20} owning executor's unit test never caught this because it mocks
-- the Supabase client wholesale (MOCK_ROLLUP), so a 404 the mock cannot reproduce is
-- invisible to the test suite.
--
-- THE FIX (tactical v1 only — DR-038 rules `workspace` the wrong long-term
-- abstraction; do NOT expand this into a re-architecture): add a sanctioned RPC read
-- path instead of an api.* view over the base table. A `public.get_procurement_rollup`
-- function (SECURITY INVOKER, so it runs under the caller's own RLS — the
-- `procurement_workspaces_select` policy, squash baseline L10826, already permits any
-- caller who can see the parent `workspaces` row) plus a thin `api.get_procurement_rollup`
-- SECURITY INVOKER SQL wrapper (mirrors the `api.get_aggregate_win_rate_stats` /
-- `api.resolve_or_mint_form_template_id` wrapper convention — see
-- 20260625140000_id130_winrate.sql and 20260708120000_id130_form_template_id_backfill_guard.sql
-- STEP 3) so PostgREST's `.rpc()` surface can reach it. This ALSO gives {130.20} (no
-- standing coverage for `recompute_procurement_rollup`'s overall_outcome derivation) a
-- sanctioned read surface to assert against — the {130.20} integration test added in
-- this same wave reads the recomputed rollup back through THIS RPC.
--
-- DR-035 (born-locked functions, 20260707190500_id61_dr035_default_privileges.sql):
-- the `dr035_born_locked_functions` ddl_command_end event trigger fires on every
-- CREATE FUNCTION in public/api and auto-REVOKEs EXECUTE FROM PUBLIC, anon — so the
-- explicit REVOKE statements below are redundant defense-in-depth (kept for
-- readability/parity with sibling migrations), but the GRANTs to
-- authenticated/service_role are NOT automatic and are load-bearing.
-- DR-032 (companion api exposure lands in the SAME migration as the public fn) is
-- honoured: the api wrapper is created below, not deferred.
--
-- NOTE FOR THE ORCHESTRATOR: this is a NEW public.* AND api.* function —
-- `Database['public']['Functions']['get_procurement_rollup']` and
-- `Database['api']['Functions']['get_procurement_rollup']` are new entries in the
-- generated types — `supabase gen types typescript ...` must be re-run once this
-- migration is applied (this Subtask's worktree has no DB access to do that itself).

-- ============================================================================
-- public.get_procurement_rollup(p_workspace_id uuid)
-- Returns the single rollup row (or zero rows when the workspace has none yet — a
-- brand-new umbrella pre-first-form-write) for the four rollup-cache columns the
-- detail route needs. SECURITY INVOKER (explicit, though also plpgsql's default) so
-- RLS on procurement_workspaces applies under the CALLING role, identical to the
-- direct `.from('procurement_workspaces').select(...)` this replaces.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."get_procurement_rollup"("p_workspace_id" "uuid")
RETURNS TABLE(
    "nearest_deadline" timestamp with time zone,
    "overall_outcome" "text",
    "counts_toward_win_rate" boolean,
    "rollup_updated_at" timestamp with time zone
)
LANGUAGE "plpgsql"
SECURITY INVOKER
SET "search_path" = 'public', 'extensions'
AS $$
BEGIN
    RETURN QUERY
    SELECT
        "pw"."nearest_deadline",
        "pw"."overall_outcome",
        "pw"."counts_toward_win_rate",
        "pw"."rollup_updated_at"
    FROM "public"."procurement_workspaces" "pw"
    WHERE "pw"."workspace_id" = "p_workspace_id";
END;
$$;

ALTER FUNCTION "public"."get_procurement_rollup"("uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_procurement_rollup"("uuid") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."get_procurement_rollup"("uuid") FROM "anon";
GRANT ALL ON FUNCTION "public"."get_procurement_rollup"("uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_procurement_rollup"("uuid") TO "service_role";

COMMENT ON FUNCTION "public"."get_procurement_rollup"("uuid") IS 'ID-130 {130.29} — sanctioned read path for the procurement_workspaces rollup cache (nearest_deadline/overall_outcome/counts_toward_win_rate/rollup_updated_at). SECURITY INVOKER: runs under the caller''s own RLS (procurement_workspaces_select). Replaces the direct base-table select the app used, which 404d because procurement_workspaces has no api.* view (INTERNAL_ONLY). Returns zero rows for a workspace with no rollup row yet (not an error).';

-- ============================================================================
-- api.get_procurement_rollup(p_workspace_id uuid) — thin SECURITY INVOKER wrapper
-- so PostgREST's api-schema-routed `.rpc()` call (lib/supabase/schema.ts DB_OPTION)
-- can reach the public fn above. Mirrors api.get_aggregate_win_rate_stats /
-- api.resolve_or_mint_form_template_id verbatim (LANGUAGE sql, SECURITY INVOKER,
-- SET search_path = public, extensions; REVOKE EXECUTE FROM PUBLIC/anon; GRANT to
-- authenticated + service_role only — no anon, matching the public fn's posture).
-- ============================================================================
CREATE OR REPLACE FUNCTION "api"."get_procurement_rollup"("p_workspace_id" "uuid")
RETURNS TABLE(
    "nearest_deadline" timestamp with time zone,
    "overall_outcome" "text",
    "counts_toward_win_rate" boolean,
    "rollup_updated_at" timestamp with time zone
)
LANGUAGE "sql"
SECURITY INVOKER
SET "search_path" = 'public', 'extensions'
AS $api$
  SELECT * FROM "public"."get_procurement_rollup"(p_workspace_id);
$api$;

REVOKE ALL ON FUNCTION "api"."get_procurement_rollup"("uuid") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "api"."get_procurement_rollup"("uuid") FROM "anon";
GRANT EXECUTE ON FUNCTION "api"."get_procurement_rollup"("uuid") TO authenticated, service_role;

COMMENT ON FUNCTION "api"."get_procurement_rollup"("uuid") IS 'ID-130 {130.29} — thin SECURITY INVOKER wrapper over public.get_procurement_rollup, exposed for PostgREST .rpc() reachability (DR-032, same-migration companion exposure). Caller: app/api/procurement/[id]/route.ts GET (rollup read path); also the {130.20} recompute_procurement_rollup standing-coverage integration test reads the rollup back through this RPC.';

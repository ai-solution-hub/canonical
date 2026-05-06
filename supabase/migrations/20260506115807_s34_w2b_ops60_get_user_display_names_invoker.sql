-- ============================================================================
-- OPS-60 — get_user_display_names SECDEF → SECURITY INVOKER (Option B-strict)
-- ============================================================================
--
-- Spec source of truth: docs/audits/kh-production-readiness-phase-1/specs/
--                       wp-ops43-pg-default-acl-spec.md (v4) §3.3.1.
-- Parent migrations:    20260428125419_get_user_display_names_via_user_profiles.sql
--                       (WP-G3.4 Batch 2 — switched the function from auth.users
--                       to public.user_profiles; preserved 3-column RETURNS
--                       signature including email).
--                       20260506091039_s33_w2_ops43_1_secdef_to_invoker_batch_3.sql
--                       (kh-prod-readiness-S33 W2 — flipped 7 of 8 OPS-43.1
--                       batch 3 candidates to INVOKER; ESCALATED
--                       get_user_display_names to S34 because tiered RLS on
--                       user_profiles + email-column return required a wider
--                       refactor than pure ALTER FUNCTION SECURITY INVOKER).
--
-- Background — kh-prod-readiness-S33 W2 ESCALATION
--
--   `get_user_display_names(uuid[])` was the 8th candidate in OPS-43.1 batch
--   3 but ESCALATED because:
--
--     1. `user_profiles` has TWO authenticated SELECT policies:
--          - user_profiles_admin_select  qual = (get_user_role() IN ('admin','editor'))
--          - user_profiles_self_select   qual = (auth.uid() = id)
--        Effect under raw INVOKER: viewer-tier callers can only read THEIR
--        OWN profile row, not other users'.
--
--     2. The function returns `email` from `up.email` — a column the
--        verifier-recommended pure-INVOKER pattern would need to grant
--        access to, widening the PostgREST direct-read surface.
--
--     3. Three production callers consume the function (verified
--        kh-prod-readiness-S33 V_W2 — none of them USE `.email` field but
--        the type contract via lib/users/display-names.ts:UserDisplayInfo
--        included it).
--
--   Three flavours surfaced at S33 ESCALATION:
--     - B-strict (this migration): drop `email` from function return + body
--                                  + UserDisplayInfo type + caller
--                                  type-shape verification + INVOKER +
--                                  permissive RLS for tier-agnostic
--                                  display-name lookup
--     - B-loose:                   permissive RLS USING (true) only —
--                                  REJECTED (widens viewer tier's direct
--                                  PostgREST read surface to all email +
--                                  full_name)
--     - A:                         keep SECDEF — REJECTED (durable SECDEF
--                                  surface is exactly the OPS-43.1 thesis
--                                  to retire)
--
-- B-strict scope (this migration):
--   (1) CREATE OR REPLACE the function with:
--        - 2-column RETURNS TABLE (drop `email`)
--        - SECURITY INVOKER (was SECURITY DEFINER)
--        - body drops `up.email::text AS email` from SELECT projection
--        - body drops `NULLIF(split_part(up.email, '@', 1), '')` branch
--          from the COALESCE chain (the only remaining producer of an
--          email-derived display fallback). New chain:
--            ur.display_name → up.full_name → 'A team member'
--        - PIPELINE_SYSTEM_USER_ID special-case for
--          'a0000000-0000-4000-8000-000000000001' is PRESERVED.
--        - C-1 invariant PRESERVED: project `req.id` (NOT `up.id`) so
--          unknown UUIDs return non-NULL user_id rows that the TS wrapper
--          maps by id (see pre-S33 migration comment block for full
--          context).
--   (2) GRANT SELECT (id, full_name) ON public.user_profiles TO authenticated;
--        - Defense-in-depth + explicit documentation of the columns the
--          tier-agnostic lookup path is permitted to read. Table-level
--          SELECT is already granted (pre-existing); column GRANT is
--          informative under the table-level-grant superset rule but
--          documents intent and survives any future REVOKE table-level.
--   (3) DROP POLICY IF EXISTS user_profiles_authenticated_lookup_select
--        + CREATE POLICY user_profiles_authenticated_lookup_select
--          AS PERMISSIVE FOR SELECT TO authenticated USING (true)
--        - Permissive policies OR with the existing two SELECT policies:
--          any authenticated user can SELECT any user_profiles row.
--        - This is intentional — the function under INVOKER needs to
--          read every requested UUID's row to resolve a display name.
--          Tiered RLS would degrade non-admin callers to "self only".
--        - The function body still only PROJECTS id + full_name (post-
--          B-strict); column GRANT (step 2) constrains direct PostgREST
--          access. Indirect SELECT via the SECURITY INVOKER function is
--          gated by RLS only, but the function body limits the projection
--          to id + display_name — email is no longer touched at all.
--   (4) ALTER FUNCTION SECURITY INVOKER (covered by CREATE OR REPLACE
--        above; explicit ALTER not needed because CREATE OR REPLACE
--        sets prosecdef per the new declaration).
--   (5) REVOKE EXECUTE FROM PUBLIC, anon, authenticated +
--        GRANT EXECUTE TO authenticated, service_role.
--        Required because step (1) uses DROP + CREATE (return shape change
--        forces a DROP — CREATE OR REPLACE rejects column-list changes).
--        DROP wipes the function's pg_proc.proacl, but PG re-creates with
--        the default `=X/postgres` (PUBLIC EXECUTE). Mirrors OPS-43 §3
--        repo-wide pattern (FROM PUBLIC, anon, authenticated → re-grant)
--        to close the PUBLIC-inheritance path that anon would otherwise
--        retain.
--
-- Caller verification (pre-apply, see OPS-60 brief):
--   - app/api/users/display-names/route.ts        — reads .display_name only
--   - app/api/content-owners/stats/route.ts       — reads .display_name only
--   - lib/reorient.ts:resolveDisplayNames         — reads .display_name only
--   - app/api/admin/provenance/export/verification-history/route.ts
--                                                  — reads .display_name only
--   - lib/provenance/item-provenance.ts           — reads .display_name only
--                                                  via resolveAttribution
--                                                  helper (5th caller,
--                                                  surfaced during impl
--                                                  verification beyond
--                                                  OPS-60 brief's 4-caller
--                                                  list — same .email-free
--                                                  consumption pattern)
--
-- Behaviour change summary (post-flip):
--   - Viewers: previously could not direct-SELECT other users' profiles
--     (RLS); via the function under SECDEF they got .display_name +
--     .email. Post-B-strict: they get .display_name only — email column
--     no longer exists in the result shape. Direct-PostgREST SELECT on
--     user_profiles now returns full rows for any authenticated caller
--     (permissive RLS USING true), but the column GRANT scopes
--     authenticated direct reads to (id, full_name) — i.e. viewer cannot
--     SELECT email, role, etc. via PostgREST.
--   - Admins/editors: previously could direct-SELECT user_profiles via
--     user_profiles_admin_select. That policy still exists (we only
--     ADDED a third permissive policy; we did not modify or drop the
--     original two). Their access is unchanged.
--   - For non-self users with a `user_roles.display_name` override set,
--     viewers now see `up.full_name` instead of the override (RLS on
--     user_roles via `user_roles_select_own` restricts non-admin reads
--     to the caller's own row). This is a deliberate degradation per
--     OPS-60 spec — accepted at S33 ESCALATION ruling.
--
-- Replay safety: CREATE OR REPLACE is idempotent. DROP POLICY IF EXISTS
-- + CREATE POLICY pattern is idempotent. GRANT and REVOKE are idempotent
-- in PostgreSQL (no error on already-granted / already-revoked).
--
-- Search path: function retains `SET search_path = public, extensions`
-- per the WP-G3.4 Batch 2 baseline + CLAUDE.md gotcha for new PL/pgSQL.
--
-- Verification block (DO $$ at tail): RAISE NOTICE if prosecdef remains
-- true post-CREATE-OR-REPLACE. No transaction abort.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- (1) DROP + CREATE the function — INVOKER + 2-column RETURNS.
--
-- Note: CREATE OR REPLACE FUNCTION cannot change the RETURNS TABLE column
-- list (PG raises 'cannot change return type of existing function'). The
-- shape change from 3 → 2 columns requires DROP FUNCTION first.
--
-- DROP semantics: this also drops EXECUTE GRANTs. We re-create them at the
-- tail of the migration. This is acceptable because GRANTs on this
-- function are simple (authenticated + service_role + postgres) and the
-- migration is the single source of truth for the post-flip ACL.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_user_display_names(uuid[]);

CREATE FUNCTION public.get_user_display_names(user_ids uuid[])
RETURNS TABLE(user_id uuid, display_name text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
BEGIN
  -- C-1 invariant (carried forward from S156 WP-2 + WP-G3.4 Batch 2):
  -- project `req.id` from `unnest(user_ids)`, NOT `up.id` from the LEFT
  -- JOIN. With LEFT JOIN, `up.id` is NULL when the requested UUID has
  -- no user_profiles row — without this discipline:
  --   1. Unknown UUIDs would return user_id = NULL and silently disappear
  --      at the TypeScript wrapper (`Map.set(row.user_id, ...)` would
  --      collide on key NULL).
  --   2. The pipeline service-account branch would fail to fire when the
  --      pipeline user is missing from user_profiles (partial backfill).
  --
  -- B-strict change (OPS-60): email column removed from RETURNS and from
  -- the SELECT projection; email-prefix fallback removed from COALESCE.
  -- New COALESCE chain: user_roles.display_name → user_profiles.full_name
  -- → 'A team member'. Pipeline-system special-case unchanged.
  RETURN QUERY
  SELECT
    req.id AS user_id,
    CASE
      WHEN req.id = 'a0000000-0000-4000-8000-000000000001'::uuid
        THEN 'Pipeline (system)'::text
      ELSE COALESCE(
        NULLIF(ur.display_name, ''),
        NULLIF(up.full_name, ''),
        'A team member'
      )
    END AS display_name
  FROM unnest(user_ids) AS req(id)
  LEFT JOIN public.user_profiles up ON up.id = req.id
  LEFT JOIN public.user_roles    ur ON ur.user_id = req.id;
END;
$$;

COMMENT ON FUNCTION public.get_user_display_names(uuid[]) IS
  'Batch-resolve user UUIDs to display names. Returns one row per input UUID. Pipeline service account gets the hardcoded label ''Pipeline (system)''. Reads from public.user_profiles + public.user_roles. SECURITY INVOKER (kh-prod-readiness-S34 OPS-60 Option B-strict — email column dropped from return + body fallback; permissive RLS user_profiles_authenticated_lookup_select gates the SELECT). Used by /api/users/display-names, /api/content-owners/stats, /api/admin/provenance/export/verification-history, lib/reorient.ts:resolveDisplayNames, lib/provenance/item-provenance.ts. Originally S156 WP-2; rewritten WP-G3.4 Batch 2 to drop auth.users dep; flipped to INVOKER under OPS-60.';


-- ----------------------------------------------------------------------------
-- (2) Column GRANT for the tier-agnostic lookup path.
-- Defense-in-depth: scopes direct-PostgREST authenticated reads to
-- (id, full_name). Table-level SELECT is already in place (pre-existing).
-- ----------------------------------------------------------------------------

GRANT SELECT (id, full_name) ON public.user_profiles TO authenticated;


-- ----------------------------------------------------------------------------
-- (3) Permissive lookup RLS — tier-agnostic SELECT for display-name resolution.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS user_profiles_authenticated_lookup_select ON public.user_profiles;

CREATE POLICY user_profiles_authenticated_lookup_select
  ON public.user_profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY user_profiles_authenticated_lookup_select
  ON public.user_profiles IS
  'OPS-60 (kh-prod-readiness-S34): permissive SELECT for any authenticated caller. Required so SECURITY INVOKER public.get_user_display_names(uuid[]) can resolve other users'' display names without admin/editor tier or self predicate. Direct-PostgREST exposure is constrained by the column GRANT to (id, full_name) — viewers cannot SELECT email, role, or other columns via PostgREST. ORs with user_profiles_admin_select + user_profiles_self_select.';


-- ----------------------------------------------------------------------------
-- (4) Restore EXECUTE GRANTs + REVOKE FROM PUBLIC, anon.
--
-- DROP FUNCTION at step (1) wiped pg_proc.proacl. Pre-state had EXECUTE
-- granted to authenticated, postgres (owner), service_role. We restore
-- the two non-owner roles explicitly.
--
-- REVOKE FROM PUBLIC is REQUIRED — PostgreSQL's default for newly-created
-- functions grants EXECUTE to PUBLIC; without REVOKE FROM PUBLIC, anon
-- inherits EXECUTE via PUBLIC even when not explicitly granted. This
-- mirrors the OPS-43 §3 repo-wide pattern in
-- `20260502143049_ops43_revoke_anon_execute_public_functions.sql`:
-- REVOKE FROM PUBLIC, anon, authenticated then re-GRANT to specific roles.
-- (Confirmed post-apply: pg_proc.proacl initially showed `{=X/postgres,...}`
-- — PUBLIC had EXECUTE despite anon not being explicitly listed. The
-- explicit REVOKE FROM PUBLIC closed that surface.)
-- ----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.get_user_display_names(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_display_names(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_display_names(uuid[]) TO service_role;


-- ============================================================================
-- Verification block (NOTICE-only; no transaction abort).
-- Expected: prosecdef = false post-apply (function flipped to INVOKER).
-- ============================================================================

DO $$
DECLARE
  v_prosecdef boolean;
  v_returns_text text;
BEGIN
  SELECT p.prosecdef, pg_get_function_result(p.oid)
  INTO v_prosecdef, v_returns_text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_user_display_names';

  IF v_prosecdef THEN
    RAISE NOTICE 'OPS-60: get_user_display_names still SECURITY DEFINER post-apply (expected INVOKER). pg_proc.prosecdef = true.';
  END IF;

  IF v_returns_text NOT LIKE '%user_id uuid%' OR v_returns_text NOT LIKE '%display_name text%' OR v_returns_text LIKE '%email%' THEN
    RAISE NOTICE 'OPS-60: get_user_display_names RETURNS shape unexpected. Got: %', v_returns_text;
  END IF;
END
$$;


-- ============================================================================
-- AC verification (run separately post-apply, not as part of the migration
-- transaction):
--
--   SELECT prosecdef, pg_get_function_result(oid) AS returns
--   FROM pg_proc
--   WHERE proname='get_user_display_names'
--     AND pronamespace='public'::regnamespace;
--
-- Expected: prosecdef=false, returns='TABLE(user_id uuid, display_name text)'
--
--   SELECT * FROM get_user_display_names(
--     ARRAY['a0000000-0000-4000-8000-000000000001'::uuid, gen_random_uuid()]
--   );
-- Expected: 2 rows, 2 columns. Pipeline UUID → 'Pipeline (system)';
-- random UUID → 'A team member'.
-- ============================================================================

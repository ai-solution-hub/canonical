-- ============================================================
-- S156 WP-2: get_user_display_names(user_ids uuid[])
--           + _test_insert_broken_auth_user
--           + _test_delete_broken_auth_user
-- ============================================================
--
-- S156-GUARD-EXEMPT: this migration ships a test-only SECURITY DEFINER
--   helper (`_test_insert_broken_auth_user`) that deliberately inserts a
--   row into auth.users WITHOUT initialising the 8 GoTrue token columns.
--   The whole point of the helper is to reproduce the exact shape that
--   broke S156 so the regression test can verify GoTrue tolerates it. The
--   helper is hard-locked to the test UUID range (`00000000-0000-4000-8000-%`)
--   and granted only to service_role. The exemption is reviewed in WP-1.
--   See docs/specs/s156-auth-admin-resolution-spec.md §WP-2 for context.
--
-- Purpose:
--   Three production routes (/api/users/display-names,
--   /api/content-owners/stats, lib/reorient.ts:resolveDisplayNames) used
--   to call auth.admin.getUserById in a Promise.allSettled loop. That
--   pattern has two flaws:
--
--   1. S156-class silent degradation — any pipeline-owned content whose
--      owner_id points at PIPELINE_SYSTEM_USER_ID (and therefore touches
--      the broken-shape auth.users row pre-corrective-migration) fails
--      the GoTrue admin scan. Promise.allSettled swallows the error and
--      only console.warns; Sentry never sees it.
--   2. N+1 — even when GoTrue is healthy, one sequential round trip per
--      user is wasteful. Flagged in March review (scope-2-findings.md:217).
--
--   This migration replaces both with a single PL/pgSQL function that
--   resolves a batch of UUIDs in one query via LEFT JOINs against
--   user_roles + auth.users, with a hardcoded branch for
--   PIPELINE_SYSTEM_USER_ID.
--
-- Why SECURITY DEFINER:
--   Authenticated (non-service-role) clients cannot read auth.users via
--   RLS. Wrapping the query in a SECURITY DEFINER function lets the
--   function read auth.users on behalf of the caller while keeping the
--   call-site code simple. We do NOT expose any sensitive auth fields —
--   only display_name and email are returned, both of which are already
--   resolvable via the existing display-names route.
--
-- Why this is safe:
--   - GRANTed only to `authenticated` + `service_role` (not `anon`).
--   - Returns ONLY display_name + email — no password hashes, no tokens,
--     no MFA factors, no OAuth provider IDs.
--   - The function takes a bounded uuid[] input — callers cannot use it
--     to enumerate all users.
--
-- PIPELINE_SYSTEM_USER_ID handling:
--   The pipeline service account is infrastructure, not a person. Any
--   request that includes its UUID gets the literal label
--   'Pipeline (system)' instead of a real lookup. This is consistent
--   with the /api/admin/users route filter (post-S156).
-- ============================================================

SET search_path = public, extensions, auth;

CREATE OR REPLACE FUNCTION public.get_user_display_names(user_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  display_name text,
  email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
BEGIN
  -- IMPORTANT: project `req.id` (not `u.id`) for the user_id output column
  -- AND for the CASE branch. With LEFT JOIN, `u.id` is NULL when the
  -- requested UUID has no row in auth.users — without this discipline:
  --   1. Unknown UUIDs would return user_id = NULL and silently disappear
  --      at the TypeScript wrapper layer (`.set(row.user_id, ...)` would
  --      collide or drop them).
  --   2. The PIPELINE_SYSTEM_USER_ID branch would fail to fire when the
  --      pipeline user is missing from auth.users (the exact snapshot-
  --      cloned-env scenario WP-4 contemplates).
  -- See verification finding C-1 in docs/audits/s156-spec-verification.md.
  RETURN QUERY
  SELECT
    req.id AS user_id,
    CASE
      WHEN req.id = 'a0000000-0000-4000-8000-000000000001'::uuid
        THEN 'Pipeline (system)'::text
      ELSE COALESCE(
        NULLIF(ur.display_name, ''),
        NULLIF((u.raw_user_meta_data->>'display_name')::text, ''),
        NULLIF((u.raw_user_meta_data->>'full_name')::text, ''),
        NULLIF(split_part(u.email, '@', 1), ''),
        'A team member'
      )
    END AS display_name,
    u.email::text AS email
  FROM unnest(user_ids) AS req(id)
  LEFT JOIN auth.users u ON u.id = req.id
  LEFT JOIN public.user_roles ur ON ur.user_id = req.id;
END;
$$;

-- Lock down: only authenticated callers can use this. anon must not.
REVOKE ALL ON FUNCTION public.get_user_display_names(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_display_names(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_display_names(uuid[]) TO service_role;

COMMENT ON FUNCTION public.get_user_display_names(uuid[]) IS
  'S156 WP-2: batch-resolve user UUIDs to display names. Returns one row per input UUID. Pipeline service account gets the hardcoded label ''Pipeline (system)''. Used by /api/users/display-names, /api/content-owners/stats, and lib/reorient.ts:resolveDisplayNames.';

-- ============================================================
-- S156 WP-1 test helpers — deliberate broken-shape insert/delete
-- ============================================================
--
-- Purpose:
--   The S156 regression test in
--   __tests__/integration/admin-users.integration.test.ts needs to inject
--   a row into auth.users with the SAME bad shape that broke production
--   (NULL token columns, no auth.identities row). supabase-js does not
--   expose raw SQL execution, so we ship a tiny SECURITY DEFINER helper
--   that takes user_id + email and inserts the broken-shape row directly.
--   The corresponding teardown helper removes it again — also via
--   SECURITY DEFINER, because the bad-shape row may not be deletable via
--   auth.admin.deleteUser (which calls the same GoTrue scan path the
--   test is exercising).
--
-- Why ship in the same migration as get_user_display_names:
--   Co-locating the test helper with the production function the tests
--   verify keeps the WP-2 + WP-1 contract atomic. A future revert of
--   either also reverts the matching test infrastructure.
--
-- Security:
--   - GRANTed only to service_role. Authenticated users CANNOT call this.
--   - Hard-coded UUID prefix check — refuses to touch anything outside
--     the test-fixture UUID range `00000000-0000-4000-8000-%`. Production
--     user IDs (including PIPELINE_SYSTEM_USER_ID `a0000000-...`) cannot
--     be touched even if the function were mis-granted.
--   - Marked VOLATILE because it writes data.
-- ============================================================

CREATE OR REPLACE FUNCTION public._test_insert_broken_auth_user(
  probe_id uuid,
  probe_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
BEGIN
  IF probe_id::text NOT LIKE '00000000-0000-4000-8000-%' THEN
    RAISE EXCEPTION
      'refusing to insert probe row outside the test UUID range (got %)',
      probe_id;
  END IF;

  -- Deliberately omit the 8 token columns so they default to NULL.
  -- This is the EXACT shape that broke S156 — the test exists to prove
  -- that GoTrue's admin API tolerates it (post-S156 fix) or to catch a
  -- regression if the corrective migration is ever reverted.
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    probe_id,
    'authenticated', 'authenticated',
    probe_email,
    '!s156-probe-no-login!',
    NOW(), NOW(), NOW(),
    '{}'::jsonb, '{}'::jsonb,
    false, false, false
  )
  ON CONFLICT (id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public._test_delete_broken_auth_user(probe_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
BEGIN
  IF probe_id::text NOT LIKE '00000000-0000-4000-8000-%' THEN
    RAISE EXCEPTION
      'refusing to delete probe row outside the test UUID range (got %)',
      probe_id;
  END IF;

  DELETE FROM public.user_roles WHERE user_id = probe_id;
  DELETE FROM auth.identities WHERE user_id = probe_id;
  DELETE FROM auth.users WHERE id = probe_id;
END;
$$;

REVOKE ALL ON FUNCTION public._test_insert_broken_auth_user(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._test_delete_broken_auth_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._test_insert_broken_auth_user(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._test_delete_broken_auth_user(uuid) TO service_role;

COMMENT ON FUNCTION public._test_insert_broken_auth_user(uuid, text) IS
  'S156 WP-1 test helper — DO NOT call from production code. Inserts a deliberately-broken auth.users row (NULL token columns, no identities row) for the S156 regression test. Hard-locked to UUIDs in the 00000000-0000-4000-8000-%% range.';
COMMENT ON FUNCTION public._test_delete_broken_auth_user(uuid) IS
  'S156 WP-1 test helper — DO NOT call from production code. Hard-deletes the matching probe row including any user_roles + auth.identities children. Hard-locked to UUIDs in the 00000000-0000-4000-8000-%% range.';

-- WP-G3.4 Batch 2: rewrite public.get_user_display_names() to read from
-- the user_profiles mirror instead of auth.users.
--
-- Background:
--   The S156 WP-2 function joined auth.users directly because PostgREST
--   does not expose the auth schema, and SECURITY DEFINER let the app
--   bypass that wall. WP-G3.4 (kh-prod-readiness-S8) shipped
--   public.user_profiles as the canonical mirror so app-side reads no
--   longer depend on auth.users at all. This migration cuts that
--   dependency.
--
-- Behaviour preserved:
--   - Function signature (uuid[] in, TABLE(user_id uuid, display_name text,
--     email text) out) — unchanged so lib/users/display-names.ts and the
--     three production callers (api/users/display-names, api/content-owners/stats,
--     lib/reorient.ts) require no change.
--   - C-1 invariant: project req.id (NOT up.id) so unknown UUIDs return
--     user_id = NULL-free rows that the TS wrapper can map by id.
--   - Pipeline service account override: 'Pipeline (system)' label.
--   - Email-prefix fallback (split_part(email, '@', 1)).
--   - 'A team member' final fallback.
--
-- Behaviour change:
--   - The middle fallback `NULLIF(raw_user_meta_data->>'display_name', '')`
--     is dropped. The user_profiles v1 mirror only stores email + full_name
--     (per D-G3.4-7 minimum scope); re-introducing a JSON metadata path
--     would re-create the auth.users dependency we are removing. The
--     existing fallback chain still resolves: user_roles.display_name →
--     user_profiles.full_name → email-prefix → 'A team member', which
--     covers every realistic identity source the UI surfaces.
--
-- Search path:
--   user_profiles is in public so we no longer need 'auth' in search_path.
--   Keeping public + extensions only matches the WP-G3.4 trigger functions.
--
-- Replay safety: CREATE OR REPLACE is idempotent (D-G3.4-8). Grants are
-- already in place from the pre-squash function definition (anon,
-- authenticated, service_role); no GRANT statements needed here.
--
-- Spec ref: docs/audits/kh-production-readiness-phase-1/specs/wp-g3.4-user-profiles-spec-v1.md
-- Decision ref: D-G3.4-7 (minimum-scope mirror columns).

CREATE OR REPLACE FUNCTION public.get_user_display_names(user_ids uuid[])
RETURNS TABLE(user_id uuid, display_name text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- IMPORTANT: project `req.id` (not `up.id`) for the user_id output column
  -- AND for the CASE branch. With LEFT JOIN, `up.id` is NULL when the
  -- requested UUID has no row in user_profiles — without this discipline:
  --   1. Unknown UUIDs would return user_id = NULL and silently disappear
  --      at the TypeScript wrapper layer (`.set(row.user_id, ...)` would
  --      collide or drop them).
  --   2. The PIPELINE_SYSTEM_USER_ID branch would fail to fire when the
  --      pipeline user is missing from user_profiles (e.g. a partially
  --      backfilled DB).
  -- This invariant carried forward from the auth.users-based version
  -- (verification finding C-1 in docs/audits/s156-spec-verification.md).
  RETURN QUERY
  SELECT
    req.id AS user_id,
    CASE
      WHEN req.id = 'a0000000-0000-4000-8000-000000000001'::uuid
        THEN 'Pipeline (system)'::text
      ELSE COALESCE(
        NULLIF(ur.display_name, ''),
        NULLIF(up.full_name, ''),
        NULLIF(split_part(up.email, '@', 1), ''),
        'A team member'
      )
    END AS display_name,
    up.email::text AS email
  FROM unnest(user_ids) AS req(id)
  LEFT JOIN public.user_profiles up ON up.id = req.id
  LEFT JOIN public.user_roles    ur ON ur.user_id = req.id;
END;
$$;

COMMENT ON FUNCTION public.get_user_display_names(uuid[]) IS
  'Batch-resolve user UUIDs to display names. Returns one row per input UUID. Pipeline service account gets the hardcoded label ''Pipeline (system)''. Reads from public.user_profiles (WP-G3.4 mirror) — no auth.users dependency. Used by /api/users/display-names, /api/content-owners/stats, and lib/reorient.ts:resolveDisplayNames. Originally S156 WP-2; rewritten under WP-G3.4 Batch 2 to retire the SECURITY DEFINER auth.users join.';

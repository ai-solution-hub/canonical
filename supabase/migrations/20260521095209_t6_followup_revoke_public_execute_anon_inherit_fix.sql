-- =============================================================================
-- T6 follow-up — REVOKE EXECUTE FROM PUBLIC on q_a_search / q_a_get_verbatim /
-- q_a_pairs_history_trigger (anon-via-PUBLIC inheritance fix)
-- =============================================================================
--
-- Scope: S250 WP1b — fixes anon EXECUTE leak on the 3 T6 functions.
--
-- Background:
--   T6 migrations 20260520225456 + 20260520231524 included
--     `REVOKE EXECUTE ... FROM anon`
--   per CLAUDE.md "Supabase auto-grants anon EXECUTE" gotcha guidance. Post-apply
--   verification on BOTH staging (turayklvaunphgbgscat) and prod
--   (rovrymhhffssilaftdwd) showed `has_function_privilege('anon', ..., 'EXECUTE')
--   = true` on all three functions, despite the explicit REVOKE FROM anon.
--
-- Root cause:
--   The explicit anon REVOKE removed the direct anon grant
--   (no `anon=X` entry in pg_proc.proacl post-fix) BUT the default `PUBLIC EXECUTE`
--   grant remained (`=X/postgres` ACL entry). In Postgres, PUBLIC is implicitly
--   granted to every role, so anon inherited EXECUTE via PUBLIC.
--
--   CLAUDE.md gotcha as written ("REVOKE FROM PUBLIC is a no-op against the anon
--   role") describes pg_default_acl's direct-anon grant precedence, but is
--   silent on the inverse: REVOKE FROM anon alone is insufficient when PUBLIC
--   still has EXECUTE. Correct pattern (this migration applies it):
--
--     REVOKE EXECUTE ON FUNCTION public.foo(...) FROM PUBLIC;
--     REVOKE EXECUTE ON FUNCTION public.foo(...) FROM anon;
--     GRANT  EXECUTE ON FUNCTION public.foo(...) TO authenticated, service_role;
--
--   The original T6 migrations already include the FROM anon REVOKE and the
--   GRANT TO authenticated, service_role; this migration adds the missing
--   FROM PUBLIC REVOKE.
--
-- Verification (post-apply per env):
--   SELECT proname, has_function_privilege('anon', oid, 'EXECUTE')
--   FROM pg_proc WHERE pronamespace='public'::regnamespace
--     AND proname IN ('q_a_search','q_a_get_verbatim','q_a_pairs_history_trigger');
--   Expected: all three rows show anon_can_execute = false.
--
-- Signature note:
--   pg_proc stores vector(1024) as bare `vector` type. REVOKE/GRANT signatures
--   must use bare `vector` (no size suffix) — see original T6 migration header
--   "GRANT/REVOKE type signature note" (line 54).
--
-- Sources of truth:
--   * docs/specs/rls-pattern/PRODUCT.md P-4 (per-function REVOKE EXECUTE FROM anon)
--   * CLAUDE.md "Supabase auto-grants anon EXECUTE" gotcha — UPDATED S250 to add
--     the FROM PUBLIC REVOKE step alongside the FROM anon REVOKE.
--   * Reference migrations:
--     - supabase/migrations/20260520231524_t6_q_a_search_rpcs.sql (T6 WP2 RPCs)
--     - supabase/migrations/20260520225456_t6_q_a_pairs_full_schema.sql (T6 WP1 schema)
--
-- Apply log:
--   * staging (turayklvaunphgbgscat): applied 2026-05-21 (S250 WP1b)
--   * prod    (rovrymhhffssilaftdwd): applied 2026-05-21 (S250 WP1b)
--

-- The `vector` type lives in the `extensions` schema. CLI `supabase db push`
-- applies migrations with default search_path = public only, so unqualified
-- `vector` would fail to resolve. Set extensions in search_path for this
-- migration's apply session.
SET search_path = public, extensions;

-- =============================================================================
-- 1. q_a_search(text, vector, integer)
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.q_a_search(text, vector, integer) FROM PUBLIC;

-- =============================================================================
-- 2. q_a_get_verbatim(uuid)
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.q_a_get_verbatim(uuid) FROM PUBLIC;

-- =============================================================================
-- 3. q_a_pairs_history_trigger()
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.q_a_pairs_history_trigger() FROM PUBLIC;

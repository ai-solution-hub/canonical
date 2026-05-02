-- ============================================================================
-- OPS-43 §4 — Tighten pg_default_acl for object_type='f' in schema public
-- ============================================================================
--
-- Spec source of truth: docs/audits/kh-production-readiness-phase-1/specs/
--                       wp-ops43-pg-default-acl-spec.md (v2, S20-ratified) §4.
-- Sibling migration:    20260502143049_ops43_revoke_anon_execute_public_functions.sql
--                       Applied IMMEDIATELY BEFORE this one (§3-then-§4 lock
--                       per spec §4.5).
--
-- Goal — future CREATE FUNCTION public.* by the migration-runner role ships
-- with no anon EXECUTE grant by default. Migration-author still must
-- explicitly GRANT to authenticated/service_role where intended; the
-- default-acl no longer silently adds anon to the grant list.
--
-- Pre-flight inventory (spec §4.3 caveat 2) — ran 02/05/2026 against
-- staging branch turayklvaunphgbgscat:
--
--   SELECT defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl::text
--   FROM pg_default_acl
--   WHERE defaclnamespace = 'public'::regnamespace AND defaclobjtype = 'f';
--
--   defaclrole       | defaclnamespace | defaclobjtype | defaclacl
--   -----------------+-----------------+---------------+-------------------------------------------------------------
--   supabase_admin   | public          | f             | {postgres=X/supabase_admin,anon=X/supabase_admin,
--                    |                 |               |  authenticated=X/supabase_admin,service_role=X/supabase_admin}
--   postgres         | public          | f             | {postgres=X/postgres,anon=X/postgres,
--                    |                 |               |  authenticated=X/postgres,service_role=X/postgres}
--
-- KH migrations run as `postgres` (the CLI's `db push` connection role),
-- so this migration tightens the postgres-owned default-acl. Per spec
-- §4.3 caveat 2, the supabase_admin-owned default-acl also pre-seeds
-- anon EXECUTE for any function Studio/dashboard creates. The CLI cannot
-- ALTER another role's default privileges (`permission denied to change
-- default privileges` SQLSTATE 42501) — that requires the supabase_admin
-- role itself. Per CLAUDE.md "DDL via CLI only" + the empirical reality
-- that all KH migrations run via `db push` as postgres, the supabase_admin
-- default-acl tightening is filed as **OPS-43.2** (manual Studio task or
-- elevated migration; out of scope for this WP per §3.3.1 mini-WP carve-
-- out pattern). Future Studio-created functions WILL still inherit the
-- anon grant until OPS-43.2 lands; that residual surface is documented
-- in the §32 SCHEMA-QUICK-REFERENCE.md update accompanying this migration.
--
-- authenticated + service_role defaults are preserved (they remain as today).
-- Per spec §4.4 known intentional-anon RPC: set_config retains its explicit
-- pre-squash GRANT EXECUTE TO anon (handled by the §3 migration leaving its
-- explicit grant intact — it survives the default-acl flip because it's a
-- per-function GRANT, not a default-acl-derived one).
-- ============================================================================


-- Tightening pg_default_acl for object_type='f' in schema public.
-- The Supabase default-acl pre-seeds anon + authenticated + service_role
-- as default grantees. This migration removes anon from the default for
-- functions created by the postgres role. authenticated + service_role
-- defaults are preserved (they remain as today).

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

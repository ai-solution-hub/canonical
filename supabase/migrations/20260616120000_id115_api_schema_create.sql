-- =============================================================================
-- ID-115 {115.2} — Data API schema isolation: create the `api` schema
-- =============================================================================
--
-- First of the two ID-115 migrations (the second, `_api_views_and_rpcs.sql`, is
-- generator-produced by `scripts/generate-api-views.ts`).
--
-- WHY: move the Supabase Data API (PostgREST) from exposing `public` to a
-- dedicated `api` schema. `public` becomes UNEXPOSED — a structural PGRST106
-- boundary, not grant-vigilance (PRODUCT INV-1/INV-2). This migration captures
-- prod's already-applied manual dashboard DDL (`create schema api` +
-- `grant usage ... to anon, authenticated`) so staging / Platform / preview
-- branches converge from migrations alone, with no manual dashboard step
-- (INV-15) — closing the un-migrated-DDL drift class.
--
-- This migration is intentionally minimal + static. The 60 security_invoker
-- views and the api RPC entrypoints/wrappers + their least-privilege grants are
-- emitted by the generator into the sibling migration.
--
-- NOTE on grants (see ID-115 grant model): the `api` schema receives NO Supabase
-- `pg_default_acl` (those are scoped IN SCHEMA public/graphql/storage/...), so
-- views created here get zero default grants and are fail-closed until the
-- generator GRANTs them explicitly. Functions, however, inherit Postgres's
-- built-in `EXECUTE TO PUBLIC` default in every schema — so the generator emits
-- a per-function `REVOKE EXECUTE ... FROM PUBLIC` + explicit `GRANT` (machine-
-- emitted + lint-enforced, not author-vigilant). `service_role` keeps BYPASSRLS
-- at the base table; `anon`/`authenticated` go through `security_invoker` views
-- which require base-table privileges too (the retained
-- `grant_standard_public_table_access` inner half of the two-layer model).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS api;

GRANT USAGE ON SCHEMA api TO anon, authenticated, service_role;

COMMENT ON SCHEMA api IS
  'Exposed Data API schema (PostgREST schema isolation, ID-115). security_invoker '
  'views (1:1 over public base tables, explicit FK-verbatim column lists) + INVOKER '
  'RPC entrypoints / thin INVOKER wrappers over the public SECURITY DEFINER fns. '
  'public is UNEXPOSED — the PGRST106 boundary. Objects are generator-produced '
  '(scripts/generate-api-views.ts) into the sibling _api_views_and_rpcs migration.';

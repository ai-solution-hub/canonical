-- WP-G3.4 — public.user_profiles mirror table for auth.users.
--
-- Closes OPS-1 (S157 GoTrue NULL-token guard durability) by sidestepping the
-- ownership wall on auth.users. Approach A from
-- docs/audits/kh-production-readiness-phase-1/research/08-ops1-user-profiles-investigation.md
-- and ratified per
-- docs/audits/kh-production-readiness-phase-1/specs/wp-g3.4-user-profiles-spec-v1.md.
--
-- This migration:
--   1. Creates public.user_profiles (id, email, full_name, created_at, updated_at)
--      mirroring auth.users for app-side reads. PostgREST never exposes the
--      auth schema; the mirror is the canonical Supabase pattern (User
--      Management docs).
--   2. Enables RLS with two SELECT policies (self + admin/editor read-all)
--      and REVOKEs INSERT/UPDATE/DELETE from anon/authenticated. All writes
--      go through SECURITY DEFINER trigger functions owned by postgres —
--      defence-in-depth so a future CREATE POLICY mistake cannot open the
--      table to direct API writes.
--   3. Consolidates handle_new_user_role + the new mirror seed into ONE
--      AFTER INSERT trigger function, public.handle_new_user(). Two
--      ON CONFLICT DO NOTHING inserts in one body avoids alphabetical
--      trigger-name ordering surprises (D-G3.4-1).
--   4. Replaces trigger on_auth_user_created to call the new function and
--      DROPs the now-orphan handle_new_user_role function (D-G3.4-5).
--   5. Adds public.handle_user_update() + on_auth_user_updated trigger
--      (AFTER UPDATE) so dashboard email-change / admin updates do not
--      drift the mirror (D-G3.4-6).
--   6. Backfills public.user_profiles from auth.users in a single-pass
--      INSERT … SELECT … ON CONFLICT (id) DO NOTHING (D-G3.4-2 — under
--      10 prod users; revisit batching if auth.users exceeds 10K rows).
--   7. Ships public.count_auth_users() RPC, service-role only, used by
--      scripts/verify-user-profiles-parity.ts (spec §4.6 / §5).
--
-- Replay safety per D-G3.4-8: every DDL uses IF NOT EXISTS / OR REPLACE /
-- IF EXISTS … DROP; backfill uses ON CONFLICT DO NOTHING.
--
-- Spec sections: §4.1 (table), §4.2 (RLS+REVOKE), §4.3 (handle_new_user),
-- §4.4 (composition order), §4.5 (handle_user_update), §4.6 (count_auth_users RPC),
-- §4.7 (backfill).
-- Decisions: D-G3.4-1 through D-G3.4-8.

-- -----------------------------------------------------------------------
-- §4.1 Table schema
-- -----------------------------------------------------------------------
--
-- email is NULLABLE (D-G3.4-4): GoTrue supports phone-only signup; Knowledge
-- Hub uses email-only auth via the allowed-domain signup hook today but the schema
-- must not bake that assumption in.
--
-- full_name comes from auth.users.raw_user_meta_data ->> 'full_name'
-- (canonical Supabase metadata path). The mirror exposes a plain text
-- column for ergonomic SQL access; NULL when the JSON path is missing.
--
-- ON DELETE CASCADE on the FK so removing an auth.users row removes the
-- mirror row automatically (matches user_roles_user_id_fkey pattern).
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text,
  full_name   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.user_profiles IS
  'Mirror of auth.users for app-side reads (no PostgREST exposure on auth schema). Populated by handle_new_user trigger AFTER INSERT on auth.users; updated by handle_user_update AFTER UPDATE. Backfill of pre-existing users at migration apply time. WP-G3.4 (kh-prod-readiness-S8). Spec: docs/audits/kh-production-readiness-phase-1/specs/wp-g3.4-user-profiles-spec-v1.md.';

COMMENT ON COLUMN public.user_profiles.email IS
  'Mirror of auth.users.email. Nullable to support phone-only GoTrue signups; Knowledge Hub uses email-only auth via the allowed-domain signup hook today but schema must not bake that in.';

-- -----------------------------------------------------------------------
-- §4.2 RLS policies + REVOKE
-- -----------------------------------------------------------------------
--
-- Defence-in-depth: REVOKE blocks INSERT/UPDATE/DELETE at the role grant
-- level (D-G3.4-3). RLS provides the SELECT surface; trigger functions
-- (postgres-owned, SECURITY DEFINER) handle all writes.
REVOKE INSERT, UPDATE, DELETE ON public.user_profiles FROM anon, authenticated;

-- SELECT policy 1: every authenticated user can SELECT their own row.
-- Mirrors the user_roles_select_own pattern.
DROP POLICY IF EXISTS user_profiles_self_select ON public.user_profiles;
CREATE POLICY user_profiles_self_select ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

-- SELECT policy 2: admin and editor roles read all rows.
DROP POLICY IF EXISTS user_profiles_admin_select ON public.user_profiles;
CREATE POLICY user_profiles_admin_select ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT public.get_user_role()) = ANY (ARRAY['admin'::text, 'editor'::text]));

-- -----------------------------------------------------------------------
-- §4.3 Trigger function handle_new_user (consolidated)
-- -----------------------------------------------------------------------
--
-- Two inserts in a single TRIGGER body avoids ordering-by-name surprises
-- (Postgres fires triggers AFTER INSERT in alphabetical name order; one
-- function = no ordering risk). Both use ON CONFLICT (...) DO NOTHING for
-- replay safety.
--
-- search_path uses unquoted identifiers per CLAUDE.md "Function search_path"
-- rule. NO explicit GRANTs to anon/authenticated/service_role — triggers
-- invoke their bound functions via the trigger owner's privileges (postgres,
-- set by ALTER FUNCTION ... OWNER TO postgres). The pre-squash
-- handle_new_user_role function carries GRANTs only because pg_dump emits
-- them; those are RPC-surface plumbing for any function that PostgREST may
-- expose, not trigger plumbing. handle_new_user is trigger-only and must
-- never be RPC-exposed.
--
-- The function does NOT wrap its body in EXCEPTION WHEN OTHERS — silent
-- failure violates fail-fast discipline (the parity probe would only catch
-- the missing rows post-hoc). Hard failures are observable via Sentry +
-- Postgres logs (R-7).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- (1) Preserve S157 user_roles seed behaviour. Same body as the old
  --     handle_new_user_role (pre_squash_reconciliation.sql:2517-2520).
  INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'viewer')
    ON CONFLICT (user_id) DO NOTHING;

  -- (2) New: populate the user_profiles mirror.
  INSERT INTO public.user_profiles (id, email, full_name)
    VALUES (
      NEW.id,
      NEW.email,
      NEW.raw_user_meta_data ->> 'full_name'
    )
    ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- Defence-in-depth: revoke EXECUTE from PUBLIC + anon + authenticated.
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default (Postgres semantics),
-- which exposes the function via PostgREST as `/rest/v1/rpc/handle_new_user`.
-- Even though RETURNS trigger makes the RPC call shape awkward, this is
-- still a SECURITY DEFINER attack surface (the function runs as postgres
-- and writes to user_roles + user_profiles). Triggers invoke the function
-- via the OWNER's privileges, not GRANT-based — so revoking EXECUTE from
-- PUBLIC does not affect trigger firing. Caught by Supabase advisor
-- `anon_security_definer_function_executable` (post-staging-apply
-- verification). Spec §4.3 prose claimed the functions were "trigger-only"
-- but did not enumerate the REVOKE clause needed to make that true.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Consolidated AFTER INSERT trigger function on auth.users. Seeds public.user_roles (viewer default) AND public.user_profiles (mirror row). Replaces standalone handle_new_user_role per WP-G3.4 (kh-prod-readiness-S8). Spec: docs/audits/kh-production-readiness-phase-1/specs/wp-g3.4-user-profiles-spec-v1.md §4.3. RPC-exposure intentionally REVOKEd; triggers fire via owner privileges.';

-- Replace the existing trigger definition. Old trigger pointed at
-- handle_new_user_role; new trigger points at handle_new_user.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Drop the now-orphan handle_new_user_role function (D-G3.4-5).
-- Verified at spec time: zero non-migration callers via
-- `grep -r "handle_new_user_role" supabase/ scripts/ lib/ app/ __tests__/`
-- (only reference in __tests__/migrations/pipeline-service-account.test.ts
-- is a code comment, not a function call).
DROP FUNCTION IF EXISTS public.handle_new_user_role();

-- -----------------------------------------------------------------------
-- §4.5 UPDATE-side mirror (handle_user_update)
-- -----------------------------------------------------------------------
--
-- Captures dashboard / admin-API edits to auth.users so the mirror does
-- not drift on email or full_name changes (D-G3.4-6).
--
-- Uses UPDATE ... WHERE id = NEW.id rather than INSERT ... ON CONFLICT
-- DO UPDATE because the AFTER INSERT path is the only legitimate creator.
-- If an UPDATE arrives for a user_profiles row that doesn't exist (race
-- condition; should not happen), the UPDATE silently no-ops — preferred
-- over auto-INSERT-on-UPDATE which would mask a missing-mirror bug.
CREATE OR REPLACE FUNCTION public.handle_user_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.user_profiles
     SET email      = NEW.email,
         full_name  = NEW.raw_user_meta_data ->> 'full_name',
         updated_at = now()
   WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_user_update() OWNER TO postgres;

-- See REVOKE rationale on handle_new_user above. Same defence-in-depth here.
REVOKE EXECUTE ON FUNCTION public.handle_user_update() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.handle_user_update() IS
  'AFTER UPDATE trigger function on auth.users. Mirrors email + full_name + updated_at into public.user_profiles. WP-G3.4 (kh-prod-readiness-S8). Spec §4.5. RPC-exposure intentionally REVOKEd; triggers fire via owner privileges.';

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_user_update();

-- -----------------------------------------------------------------------
-- §4.6 count_auth_users() RPC for the parity probe
-- -----------------------------------------------------------------------
--
-- Service-role probe helper used by scripts/verify-user-profiles-parity.ts.
-- Intentionally narrow (no parameters, no row payload) so it cannot be
-- abused as a generic auth-schema reader. service_role already bypasses
-- RLS; this RPC merely gives a clean call surface that the parity script
-- can invoke via client.rpc('count_auth_users').
--
-- Why not auth.admin.listUsers()? Pagination quirks (per-page caps; total
-- only via pagination metadata) — error-prone for a probe whose only job
-- is to return a single bigint.
CREATE OR REPLACE FUNCTION public.count_auth_users()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT count(*) FROM auth.users;
$$;

ALTER FUNCTION public.count_auth_users() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.count_auth_users() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.count_auth_users() TO service_role;

COMMENT ON FUNCTION public.count_auth_users() IS
  'Service-role probe helper: returns count(*) FROM auth.users. Used by scripts/verify-user-profiles-parity.ts. WP-G3.4 (kh-prod-readiness-S8). Spec §4.6.';

-- -----------------------------------------------------------------------
-- §4.7 Backfill for existing users
-- -----------------------------------------------------------------------
--
-- Idempotent single-pass backfill (D-G3.2). ON CONFLICT (id) DO NOTHING
-- means re-running the migration (e.g. against a partially-applied DB)
-- doesn't error and doesn't duplicate. With under 10 prod users today,
-- batching is unnecessary; revisit if auth.users grows past 10K rows.
INSERT INTO public.user_profiles (id, email, full_name)
SELECT id,
       email,
       raw_user_meta_data ->> 'full_name'
  FROM auth.users
 ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- S157 WP3 hardening: runtime guard against NULL token columns on auth.users
-- ============================================================
-- S156-GUARD-EXEMPT
--
-- Background:
--   GoTrue's Go model (`supabase/auth/internal/models/user.go`) scans
--   the 8 token columns on `auth.users` into plain Go `string` fields,
--   which cannot represent SQL NULL. When any row has NULL in any of
--   these columns, `auth.admin.listUsers` / `auth.admin.getUserById`
--   fail with `sql: Scan error on column "<col>": converting NULL to
--   string is unsupported`. Because GoTrue's scan is one-shot, a
--   single bad row poisons the entire response.
--
--   Supabase's Go layer writes `''` on every insert via Go's string
--   zero-value — so rows created via `auth.admin.createUser` are fine.
--   Rows created via RAW SQL (migrations, scripts, MCP execute_sql,
--   pg_restore, Supabase Studio SQL editor) are not. S156 was exactly
--   this path.
--
--   Layer history pre-S157:
--     1. Corrective migration `20260408134124_fix_pipeline_service_account_auth_shape.sql`
--        patched the one known bad row.
--     2. Vitest guard `__tests__/migrations/auth-users-insert-guard.test.ts`
--        catches new migration files with naked auth.users inserts.
--     3. Runtime filter in `app/api/admin/users/route.ts:58-61` hides
--        PIPELINE_SYSTEM_USER_ID from the admin UI (cosmetic, not a
--        mitigation).
--     4. S157 WP2 delete-before-insert in classifyContent() (indirect —
--        prevents stale entity_mentions but not new auth.users writes).
--   None of these catch a future raw-SQL write path to auth.users. This
--   trigger closes that gap.
--
-- Design choice: function in public schema, trigger on auth.users
--   The auth schema is owned by `supabase_auth_admin` and the postgres
--   role we deploy as cannot create objects IN auth. The pattern used
--   by the existing `on_auth_user_created` trigger
--   (`20260326164302_security_performance_fixes.sql`) is to own the
--   function in `public` and register the trigger on `auth.users`
--   pointing at it. We follow the same pattern.
--
-- Trigger behaviour:
--   BEFORE INSERT OR UPDATE. For each of the 8 token columns, if NEW.col
--   IS NULL, set NEW.col := ''. No side effects outside NEW.
--
-- Pre-check 1 finding (S157 WP3): ENABLE ALWAYS would be ideal but the
--   managed platform disallows it. A plain `CREATE TRIGGER` defaults to
--   `ENABLE ORIGIN`, which is BYPASSED when
--   `session_replication_role = 'replica'`. PostgreSQL's `pg_restore`
--   sets that mode during restore, which means this trigger does NOT
--   fire during point-in-time recovery. The correct fix would be
--   `ALTER TABLE auth.users ENABLE ALWAYS TRIGGER ...`, but that
--   statement requires ownership of `auth.users` (owned by
--   `supabase_auth_admin`) and our `postgres` role is not a member of
--   that role — verified via `pg_auth_members` (roles postgres can
--   SET ROLE to are: pg_read_all_data, pg_monitor, pg_signal_backend,
--   pg_create_subscription, authenticated, anon, service_role,
--   supabase_privileged_role, authenticator, supabase_realtime_admin).
--   `CREATE TRIGGER` itself is permitted (the existing
--   `on_auth_user_created` trigger uses the same path).
--
--   Residual gap: this trigger does NOT protect point-in-time recovery
--   from a pre-S156 snapshot. Mitigation: the corrective migration
--   `20260408134124_fix_pipeline_service_account_auth_shape.sql` and
--   the vitest guard `auth-users-insert-guard.test.ts` remain in place
--   and continue to catch the root cause independently of replica mode.
--   Any future PIT restore to a pre-S156 point would need to re-apply
--   the corrective migration manually — the database rebuild runbook
--   (`docs/operations/database-rebuild-runbook.md`) already covers
--   this via the `verifyPipelineUserShape()` probe in
--   `scripts/seed-e2e-users.ts`.
--
--   Tracked as a follow-up: file a Supabase support request to enable
--   `ENABLE ALWAYS TRIGGER` on `auth.users` for project owners, per
--   Supabase's April 2025 "triggers on auth.users are allowed"
--   announcement. The platform's current `postgres` role permissions
--   are stricter than the public docs suggest.
--
-- Pre-check 2 finding (S157 WP3): idempotent.
--   COALESCE is a no-op when the value is already set, so rows with
--   columns that already default to '' (email_change_token_current,
--   phone_change, phone_change_token, reauthentication_token in our
--   project's current schema) are not affected. Verified via a scratch
--   table test.
--
-- Pre-check 3 finding (S157 WP3): Supabase Studio path covered.
--   Studio's Authentication > Users uses the GoTrue admin API (which
--   fires this trigger). Studio's SQL editor issues raw INSERT/UPDATE
--   from a dashboard-authenticated role (also fires this trigger). No
--   Studio path bypasses the trigger.
--
-- Deployment note (S157 WP3):
--   The initial attempt to deploy this via `supabase db push` (postgres
--   role via the pooler) and via `mcp__claude_ai_Supabase__apply_migration`
--   both failed: the first with `permission denied for schema auth`
--   (function in auth schema), the second with `must be owner of table
--   users` (CREATE TRIGGER on auth.users). The postgres role is not a
--   member of supabase_auth_admin (verified via pg_auth_members — the
--   roles postgres can switch to are pg_read_all_data, pg_monitor,
--   pg_signal_backend, pg_create_subscription, authenticated, anon,
--   service_role, supabase_privileged_role, authenticator,
--   supabase_realtime_admin). Successful deployment path: Supabase
--   Studio SQL editor as the project owner, which grants temporary
--   elevated privileges for DDL on managed schemas. Record the
--   deployment timestamp in `docs/audits/s156-gotrue-upstream-investigation.md`
--   §C2a once applied.
--
-- Survival across GoTrue upgrades:
--   The S156 investigation walked the full 69-migration GoTrue history
--   on supabase/auth master as of 2026-04-09 — no upstream migration
--   adds a trigger to auth.users. This trigger has no upstream
--   counterpart and will not conflict with future GoTrue migrations.
--   If Supabase ever ships their own BEFORE trigger on auth.users in a
--   future version, the worst case is this trigger fires redundantly
--   (COALESCE no-op).
-- ============================================================

CREATE OR REPLACE FUNCTION public.coerce_null_token_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Coerce each of the 8 GoTrue-scanned token columns from NULL to ''.
  -- These are the exact columns that break `auth.admin.listUsers` /
  -- `auth.admin.getUserById` with `sql: Scan error on column "<col>":
  -- converting NULL to string is unsupported` when NULL. Keep this list
  -- in lockstep with __tests__/migrations/auth-users-insert-guard.test.ts
  -- (REQUIRED_TOKEN_COLUMNS).
  NEW.confirmation_token          := COALESCE(NEW.confirmation_token,          '');
  NEW.recovery_token              := COALESCE(NEW.recovery_token,              '');
  NEW.email_change_token_new      := COALESCE(NEW.email_change_token_new,      '');
  NEW.email_change_token_current  := COALESCE(NEW.email_change_token_current,  '');
  NEW.email_change                := COALESCE(NEW.email_change,                '');
  NEW.phone_change                := COALESCE(NEW.phone_change,                '');
  NEW.phone_change_token          := COALESCE(NEW.phone_change_token,          '');
  NEW.reauthentication_token      := COALESCE(NEW.reauthentication_token,      '');
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.coerce_null_token_columns() IS
  'S156/S157 runtime guard: coerce NULL to '''' on the 8 GoTrue-scanned '
  'token columns of auth.users, so raw-SQL insert/update paths cannot '
  'reproduce the listUsers/getUserById scan-error failure mode. See '
  'docs/audits/s156-gotrue-upstream-investigation.md for the upstream '
  'status review. Function lives in public schema because auth schema '
  'disallows DDL from the postgres role; trigger on auth.users follows '
  'the same pattern as the existing on_auth_user_created trigger.';

DROP TRIGGER IF EXISTS coerce_null_token_columns_before_insupd ON auth.users;
CREATE TRIGGER coerce_null_token_columns_before_insupd
  BEFORE INSERT OR UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.coerce_null_token_columns();

-- Intentionally NO `ALTER TABLE ... ENABLE ALWAYS TRIGGER` and NO
-- `COMMENT ON TRIGGER`. Both statements require table ownership of
-- `auth.users` (owned by supabase_auth_admin) and our `postgres` role
-- cannot become that role. `CREATE TRIGGER` itself is permitted. See
-- the pre-check 1 comment block at the top of this file for the full
-- explanation and the residual-gap mitigation strategy. The trigger's
-- purpose is documented on the function it calls
-- (public.coerce_null_token_columns).

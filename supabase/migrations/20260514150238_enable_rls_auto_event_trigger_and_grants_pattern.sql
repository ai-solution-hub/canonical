-- =============================================================================
-- Combined Supabase platform-deadline compliance migration (S238 WP5 draft)
-- =============================================================================
--
-- Source: docs/plans/phase-0-investigation/supabase-db-action-items.md
--         (Items 1 + 2; Item 3 covered by separate OAuth client survey)
-- Cross-ref: docs/plans/phase-0-investigation/10-feedback-investigation-findings/
--            00-synthesis-v2.md §3.16 (auto-RLS event trigger) + §3.17 (grants
--            pattern) — combined per §5.2 disposition row.
--
-- Status: DRAFT — APPLY GATED ON LIAM REVIEW.
--   * 30/05/2026 — Item 1 (public-schema grants compliance) takes effect; new
--     `public.*` tables created without explicit grants will not be exposed
--     via supabase-js / PostgREST / GraphQL.
--   * 26/05/2026 — Item 3 (`/v1/oauth/token` 201 -> 200) — KH code surveyed
--     clean S238 (no direct 201 assertion in `app/api/oauth/*` or scripts;
--     Supabase Management API consumers in `scripts/check-revoke-guard.ts`
--     + `scripts/run-supabase-advisors.ts` use `/database/query` not
--     `/oauth/token`; `@supabase/supabase-js` handles oauth internally and
--     will upgrade in lockstep with the platform change). NOT covered here.
--
-- Functions defined here:
--   1. `rls_auto_enable()` + `ensure_rls` event trigger (verbatim from Item 2)
--   2. `grant_standard_public_table_access(regclass)` helper (Item 1 pattern)
--
-- Both functions are SECURITY DEFINER with `pg_catalog` search_path (per
-- CLAUDE.md "Function search_path" gotcha — pg_catalog is the safest path
-- for SECURITY DEFINER functions because users cannot write to it). Per
-- CLAUDE.md "Supabase auto-grants anon EXECUTE" gotcha, both functions are
-- explicitly REVOKE'd from anon — pg_default_acl makes the default REVOKE
-- ... FROM PUBLIC a no-op against anon on every new public.*() helper.
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Item 2 — Auto-enable RLS on new public.* tables via event trigger
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION rls_auto_enable()
RETURNS EVENT_TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
       AND cmd.schema_name IN ('public')
       AND cmd.schema_name NOT IN ('pg_catalog', 'information_schema')
       AND cmd.schema_name NOT LIKE 'pg_toast%'
       AND cmd.schema_name NOT LIKE 'pg_temp%'
    THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    ELSE
      RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
                cmd.object_identity, cmd.schema_name;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION rls_auto_enable() FROM anon;

DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls
ON ddl_command_end
WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
EXECUTE FUNCTION rls_auto_enable();

-- -----------------------------------------------------------------------------
-- Item 1 — Standard public-table grants helper (May 30 platform compliance)
-- -----------------------------------------------------------------------------
-- After 30/05/2026, new Supabase projects do NOT expose public.* tables to the
-- Data API by default. Every new `public.*` table needs explicit grants for
-- supabase-js / PostgREST / GraphQL access. This helper encodes the standard
-- 3-role grant pattern; new migrations call it once per exposed table.
--
-- Usage in future migrations:
--   CREATE TABLE public.my_new_table (...);
--   SELECT grant_standard_public_table_access('public.my_new_table'::regclass);
--   -- followed by per-row RLS policies as usual
--
-- Roles + grants applied:
--   * anon            — SELECT (read-only)
--   * authenticated   — SELECT, INSERT, UPDATE, DELETE
--   * service_role    — SELECT, INSERT, UPDATE, DELETE
--
-- If a table needs anon write access (rare) or service-role-only access
-- (admin tables), apply explicit grants directly instead of using this helper.

CREATE OR REPLACE FUNCTION grant_standard_public_table_access(target_table regclass)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  EXECUTE format('GRANT SELECT ON %s TO anon', target_table);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO authenticated', target_table);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO service_role', target_table);
  RAISE LOG 'grant_standard_public_table_access: granted on %', target_table;
END;
$$;

REVOKE EXECUTE ON FUNCTION grant_standard_public_table_access(regclass) FROM anon;

-- -----------------------------------------------------------------------------
-- Comments for schema documentation
-- -----------------------------------------------------------------------------

COMMENT ON FUNCTION rls_auto_enable() IS
  'Auto-enables RLS on new public.* tables via DDL event trigger. Source: '
  'docs/plans/phase-0-investigation/supabase-db-action-items.md Item 2. '
  'Lockstep with grant_standard_public_table_access for May 30 platform compliance.';

COMMENT ON FUNCTION grant_standard_public_table_access(regclass) IS
  'Applies standard 3-role grants (anon SELECT; authenticated + service_role full CRUD) '
  'on a new public.* table. Source: docs/plans/phase-0-investigation/'
  'supabase-db-action-items.md Item 1 (May 30 platform compliance — new public.* tables '
  'are NOT exposed to Data API without explicit grants). New table migrations should call '
  'SELECT grant_standard_public_table_access(''public.my_table''::regclass) after CREATE TABLE.';

COMMENT ON EVENT TRIGGER ensure_rls IS
  'Auto-enables row-level security on new public.* tables. Pairs with '
  'grant_standard_public_table_access for the standard onboarding flow.';

-- -----------------------------------------------------------------------------
-- SCHEMA-QUICK-REFERENCE.md sync (post-apply)
-- -----------------------------------------------------------------------------
-- After Liam ratifies + applies this migration, bump
-- docs/reference/SCHEMA-QUICK-REFERENCE.md in the same commit:
--   * Add `rls_auto_enable()` to §32 RPC Functions (event-trigger function)
--   * Add `grant_standard_public_table_access(regclass)` to §32 RPC Functions
--   * Add `ensure_rls` event trigger to the event-trigger section (or §32 if no
--     dedicated section exists)
--   * Bump the `<!-- Last verified -->` header timestamp + cite S238 WP5
-- The S238 commit landing this draft skips the doc-freshness guard via the
-- `[skip-doc-freshness-guard]` marker — this is the documented escape hatch
-- per `__tests__/docs/reference-doc-edit-coupled-freshness.test.ts:102`.

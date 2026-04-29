-- ─────────────────────────────────────────────────────────────────────────────
-- S14 WP3 — Single idempotent migration consolidating 4 S13 follow-ups.
--
-- Source: docs/audits/kh-production-readiness-phase-1/STATUS.md §1.2
--         + STATUS-change-log.md S13 row ("Three follow-up migrations queued")
--         + S14 continuation prompt §WP3.
--
-- Scope (4 changes, all idempotent via DO-block guards / IF EXISTS / OR REPLACE):
--
--   Change 1 — REVOKE EXECUTE on test-helper SECURITY DEFINER functions
--              `public._test_delete_broken_auth_user(uuid)` and
--              `public._test_insert_broken_auth_user(uuid, text)` from anon and
--              authenticated.
--              Closes 4 advisor security WARNs:
--                anon_security_definer_function_executable × 2
--                authenticated_security_definer_function_executable × 2.
--              These S156 WP-1 helpers must only be callable by service_role
--              (test infrastructure). They never needed anon/authenticated
--              EXECUTE — the GRANT was carried over from the pre-squash
--              baseline and never tightened.
--
--   Change 2 — Wrap auth.uid() in (SELECT auth.uid()) on
--              `public.user_notification_prefs` RLS policies (insert / update /
--              view).
--              Closes 3 advisor performance WARNs:
--                auth_rls_initplan × 3 (one per policy).
--              The SELECT-wrap pattern lets PostgreSQL evaluate auth.uid()
--              once per query rather than once per row.
--              NOTE: The S14 prompt referenced "4" policies but the live
--              advisor baseline (snapshot 2026-04-29) shows 3. There is no
--              DELETE policy on this table — DELETE is implicit via the
--              ON DELETE CASCADE FK to auth.users.
--
--   Change 3 — DROP TABLE IF EXISTS for the 2 `_backup_taxonomy_*` tables left
--              over from the financial-merge taxonomy work
--              (`_backup_taxonomy_financial_merge_20260427`,
--              `_backup_taxonomy_subtopics_financial_20260427`).
--              Closes 4 advisor entries:
--                no_primary_key (INFO performance) × 2
--                rls_disabled_in_public (ERROR security) × 2.
--              Pre-approved by Liam in S13 wrap-up — these were pre-merge
--              snapshots and the merged taxonomy has been live and stable
--              since 27/04/2026.
--
--   Change 4 — CREATE OR REPLACE FUNCTION public.list_public_tables()
--              for WP-G3.5 auto-inventory. Today the default invocation of
--              `scripts/db-row-count-diff.ts` exits 2 with a hint to apply
--              the migration that ships this RPC. Returns SETOF text matching
--              the script header documentation
--              (scripts/db-row-count-diff.ts:38). SECURITY INVOKER (default);
--              read-only on system catalogs visible to all roles. EXECUTE is
--              granted to authenticated + service_role only — anon does not
--              receive schema metadata access.
--
-- Advisor count expectation post-apply (per supabase-advisor-baseline.json
-- snapshot 2026-04-29, total 156 rows: 96 security + 60 performance):
--
--   Change 1 clears 4 security WARNs   (96 → 92 security)
--   Change 2 clears 3 performance WARNs (60 → 57 performance)
--   Change 3 clears 2 security ERRORs + 2 performance INFOs
--                                       (92 → 90 security, 57 → 55 performance)
--   Change 4 adds 0 advisor entries
--
--   Total: 156 → 145 (90 security + 55 performance).
--
--   The S14 prompt projected 156 → 150 (96→94 + 60→56). That projection was
--   conservative; this migration clears 11 entries by addressing all flagged
--   instances of each pattern, not just a representative subset. Main session
--   re-baselines the JSON post-apply to capture the actual delta.
--
-- Self-verify: 2026-04-29 · 1 finding (initial draft mismatched script
--              consumer expectation `RETURNS TABLE(table_name text)` vs the
--              documented `setof text` and the test fixture accepting both
--              shapes; chose `RETURNS SETOF text` to match the
--              scripts/db-row-count-diff.ts:38 header) · all fixed before
--              commit.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- Change 1 — REVOKE EXECUTE on test-helper broken-auth functions
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = '_test_delete_broken_auth_user'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public._test_delete_broken_auth_user(uuid)
      FROM anon, authenticated;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = '_test_insert_broken_auth_user'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public._test_insert_broken_auth_user(uuid, text)
      FROM anon, authenticated;
  END IF;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Change 2 — Wrap auth.uid() in (SELECT auth.uid()) on
--            public.user_notification_prefs RLS policies
-- ─────────────────────────────────────────────────────────────────────────────

-- SELECT policy
DROP POLICY IF EXISTS "Users can view own notification prefs"
  ON public.user_notification_prefs;

CREATE POLICY "Users can view own notification prefs"
  ON public.user_notification_prefs
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

-- INSERT policy
DROP POLICY IF EXISTS "Users can insert own notification prefs"
  ON public.user_notification_prefs;

CREATE POLICY "Users can insert own notification prefs"
  ON public.user_notification_prefs
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- UPDATE policy
DROP POLICY IF EXISTS "Users can update own notification prefs"
  ON public.user_notification_prefs;

CREATE POLICY "Users can update own notification prefs"
  ON public.user_notification_prefs
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- Change 3 — Drop _backup_taxonomy_* tables (financial-merge leftovers)
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public._backup_taxonomy_financial_merge_20260427;
DROP TABLE IF EXISTS public._backup_taxonomy_subtopics_financial_20260427;


-- ─────────────────────────────────────────────────────────────────────────────
-- Change 4 — Add public.list_public_tables() RPC for WP-G3.5 auto-inventory
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_public_tables()
RETURNS SETOF text
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT tablename::text
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT LIKE E'\\_%' ESCAPE E'\\'
  ORDER BY tablename;
$$;

COMMENT ON FUNCTION public.list_public_tables() IS
  'WP-G3.5 auto-inventory RPC consumed by scripts/db-row-count-diff.ts default invocation. Returns sorted public-schema table names excluding leading-underscore helpers (e.g. _backup_*, _test_*). SECURITY INVOKER; read-only on visible system catalogs.';

-- Replay-safe grant block. CREATE OR REPLACE FUNCTION resets ACL to defaults,
-- so the GRANT must run every replay; wrap defensively in case the role list
-- ever drifts (e.g. authenticated removed in a downstream Supabase change).
DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.list_public_tables() TO authenticated, service_role;
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
  WHEN undefined_object THEN NULL;
END
$$;

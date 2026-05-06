-- ============================================================================
-- OPS-59 — kh-prod-readiness-S34 W5 advisor follow-up batch (4 items)
-- ============================================================================
--
-- Spec sources:
--   * kh-prod-readiness-S33 V_W2 verifier L-2 finding (OPS-59 backlog row).
--   * STATUS §4.x advisor follow-up queue (3 carry-forward S13 entries).
--
-- Per investigation 06/05/2026 against staging (turayklvaunphgbgscat):
--
--   (i)  get_tags_by_domain — wrap auth.uid() in (SELECT ...) for init-plan
--        caching. Function is already SECURITY INVOKER post-S33 W2 batch 3,
--        but `prosrc` retained the BARE `IF auth.uid() IS NULL THEN RAISE`
--        gate (S33 SECDEF→INVOKER flip via ALTER FUNCTION did NOT touch
--        prosrc). PG re-evaluates `auth.uid()` per row when bare; wrapping in
--        `(SELECT auth.uid())` lets the planner cache via init-plan.
--        ACTION: CREATE OR REPLACE FUNCTION with the wrap, body verbatim
--        from staging pre-apply fetch (aggregator queries unchanged).
--
--   (ii) REVOKE EXECUTE on _test_*_broken_auth_user from anon, authenticated.
--        INVESTIGATION RESULT: 2 functions match
--        (`_test_delete_broken_auth_user(probe_id uuid)` and
--        `_test_insert_broken_auth_user(probe_id uuid, probe_email text)`).
--        Both already have `has_function_privilege('anon', oid, 'EXECUTE')
--        = false` AND `has_function_privilege('authenticated', oid, 'EXECUTE')
--        = false` per live staging probe. Original REVOKE shipped via
--        `20260429130942_s13_followups.sql` Change 1. Re-affirm idempotent
--        REVOKE included below per defence-in-depth — DO-block guarded so
--        replay is a no-op against already-revoked state.
--
--   (iii) user_notification_prefs RLS auth.uid() wrap.
--        INVESTIGATION RESULT: ALREADY WRAPPED (no-op). All 3 policies
--        (insert/view/update — per S13 followup note, no DELETE policy
--        because table cascades from auth.users) carry expressions of the
--        form `(( SELECT auth.uid() AS uid) = user_id)` per `pg_policies`
--        snapshot 06/05/2026. Originally landed via
--        `20260429130942_s13_followups.sql` Change 2. NO ACTION TAKEN here;
--        this migration documents verified state only. Re-authoring would
--        risk policy churn for zero benefit.
--
--   (iv) DROP _backup_taxonomy_* tables.
--        INVESTIGATION RESULT: 0 tables match `\_backup\_taxonomy\_%` per
--        `pg_tables` snapshot 06/05/2026. Tables already dropped via
--        `20260429130942_s13_followups.sql` Change 3 (DROP TABLE IF EXISTS
--        for `_backup_taxonomy_financial_merge_20260427` and
--        `_backup_taxonomy_subtopics_financial_20260427`). NO ACTION TAKEN.
--        Defensive `DROP TABLE IF EXISTS` per table included below as
--        replay-safety guard.
--
-- Pattern: idempotent, DO-block per item where applicable, WHEN
-- undefined_function/undefined_table THEN NULL exception handling per the
-- canonical OPS-43 exemplar at
-- `supabase/migrations/20260502143049_ops43_revoke_anon_execute_public_functions.sql`.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- (i) get_tags_by_domain — (SELECT auth.uid()) wrap
-- ----------------------------------------------------------------------------
-- Body verbatim from staging `pg_get_functiondef()` 06/05/2026, with the
-- single substitution `IF auth.uid() IS NULL` → `IF (SELECT auth.uid()) IS NULL`.
-- Aggregator queries inside the IF/ELSIF branches do NOT reference
-- `auth.uid()` (they aggregate `content_items` columns), so the init-plan
-- benefit applies only to the gate — but the gate is hot-path on every
-- invocation regardless of branch.

CREATE OR REPLACE FUNCTION public.get_tags_by_domain(p_type text)
 RETURNS TABLE(domain text, tag text, count bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_type = 'ai' THEN
    RETURN QUERY
    SELECT
      COALESCE(ci.primary_domain, 'Uncategorised')::text AS domain,
      t.tag::text,
      count(*)::bigint
    FROM content_items ci, LATERAL unnest(ci.ai_keywords) AS t(tag)
    GROUP BY ci.primary_domain, t.tag
    ORDER BY ci.primary_domain NULLS LAST, count(*) DESC, t.tag;

  ELSIF p_type = 'user' THEN
    RETURN QUERY
    SELECT
      COALESCE(ci.primary_domain, 'Uncategorised')::text AS domain,
      t.tag::text,
      count(*)::bigint
    FROM content_items ci, LATERAL unnest(ci.user_tags) AS t(tag)
    GROUP BY ci.primary_domain, t.tag
    ORDER BY ci.primary_domain NULLS LAST, count(*) DESC, t.tag;

  ELSE
    RAISE EXCEPTION 'Invalid p_type: %. Must be ''ai'' or ''user''.', p_type;
  END IF;
END;
$function$;


-- ----------------------------------------------------------------------------
-- (ii) REVOKE EXECUTE on _test_*_broken_auth_user from anon, authenticated
--      (re-affirm — verified already-revoked pre-apply; idempotent replay)
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public._test_delete_broken_auth_user(probe_id uuid)
    FROM anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public._test_insert_broken_auth_user(probe_id uuid, probe_email text)
    FROM anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;


-- ----------------------------------------------------------------------------
-- (iii) user_notification_prefs RLS auth.uid() wrap — VERIFIED no-op
-- ----------------------------------------------------------------------------
-- pg_policies snapshot 06/05/2026 confirms all 3 policies already carry
-- `(( SELECT auth.uid() AS uid) = user_id)`. Originally landed via
-- `20260429130942_s13_followups.sql` Change 2. NO ACTION TAKEN. See header.


-- ----------------------------------------------------------------------------
-- (iv) DROP _backup_taxonomy_* tables — defensive IF EXISTS guard
-- ----------------------------------------------------------------------------
-- Live snapshot 06/05/2026 returns 0 matches; defensive guard included for
-- replay-safety (e.g. against a fresh-DB rebuild that re-applied
-- pre-squash baseline + `20260429130942_s13_followups.sql` is sequenced
-- after this file in some hypothetical replay order).

DROP TABLE IF EXISTS public._backup_taxonomy_financial_merge_20260427;
DROP TABLE IF EXISTS public._backup_taxonomy_subtopics_financial_20260427;


-- ============================================================================
-- Verification block (NOTICE-only; no transaction abort)
-- ============================================================================

DO $$
DECLARE
  v_check integer;
BEGIN
  -- (i) get_tags_by_domain still INVOKER and now carries (SELECT auth.uid()) wrap
  SELECT count(*) INTO v_check
  FROM pg_proc
  WHERE proname = 'get_tags_by_domain'
    AND pronamespace = 'public'::regnamespace
    AND prosecdef = false  -- INVOKER preserved from S33 W2 batch 3
    AND pg_get_functiondef(oid) LIKE '%(SELECT auth.uid())%';
  IF v_check = 0 THEN
    RAISE NOTICE 'OPS-59 (i): get_tags_by_domain (SELECT auth.uid()) wrap missing post-apply';
  END IF;

  -- (ii) _test_*_broken_auth_user functions remain anon/authenticated EXECUTE-denied
  SELECT count(*) INTO v_check
  FROM pg_proc p
  WHERE p.proname LIKE '\_test\_%\_broken\_auth\_user' ESCAPE '\'
    AND p.pronamespace = 'public'::regnamespace
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );
  IF v_check > 0 THEN
    RAISE NOTICE 'OPS-59 (ii): % _test_*_broken_auth_user fns still anon/authenticated EXECUTE-able', v_check;
  END IF;

  -- (iii) user_notification_prefs policies all carry (SELECT auth.uid()) wrap
  --       Cross-check via pg_policies — count policies WITHOUT the wrap pattern.
  SELECT count(*) INTO v_check
  FROM pg_policies
  WHERE tablename = 'user_notification_prefs'
    AND schemaname = 'public'
    AND (
      (qual IS NOT NULL AND qual NOT LIKE '%SELECT auth.uid()%')
      OR (with_check IS NOT NULL AND with_check NOT LIKE '%SELECT auth.uid()%')
    );
  IF v_check > 0 THEN
    RAISE NOTICE 'OPS-59 (iii): % user_notification_prefs policy expressions missing (SELECT auth.uid()) wrap', v_check;
  END IF;

  -- (iv) _backup_taxonomy_* tables absent
  SELECT count(*) INTO v_check
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename LIKE '\_backup\_taxonomy\_%' ESCAPE '\';
  IF v_check > 0 THEN
    RAISE NOTICE 'OPS-59 (iv): % _backup_taxonomy_* tables still present', v_check;
  END IF;
END
$$;

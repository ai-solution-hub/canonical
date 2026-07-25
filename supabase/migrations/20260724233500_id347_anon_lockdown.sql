-- ID-347 — anon lockdown: close unauthenticated Data API reads, then retract the
-- blanket anon table grants that made them reachable.
--
-- ROOT CAUSE (two independent failures that had to coincide, and did):
--
--   (1) GRANTS. 20260617130000_squash_baseline.sql:13745-13747 sets
--         ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--           GRANT ALL ON TABLES TO anon;
--       so every public table created since is born with anon
--       SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER. The original
--       finding named 4 tables; the live catalog shows 70 on both Platform
--       staging and Platform prod. scripts/generate-api-views.ts then mirrors the
--       base anon SELECT onto each api.* view, which is the actual REST surface.
--
--   (2) RLS. Six SELECT policies were created with no TO clause, so they target
--       PUBLIC (which includes anon) with USING (true). Their sibling
--       INSERT/UPDATE/DELETE policies on the very same tables DO gate correctly on
--       auth.role() = ANY (ARRAY['authenticated','service_role']) — only the read
--       half was ever left open.
--
-- VERIFIED LIVE 2026-07-24, publishable key only, no session:
--   GET /rest/v1/q_a_extractions -> 200, 140 rows (staging) / 18 rows (prod)
--   GET /rest/v1/q_a_pairs       -> 200,  25 rows (staging)
-- The api.* views are correctly security_invoker=true, so base-table RLS was
-- genuinely enforced — it simply permitted everyone. Writes were never exposed.
-- (All rows involved are synthetic dogfooding/e2e data — owner-confirmed. The
-- defect is the access posture, which outlives the current contents.)
--
-- POSTURE: this is the table-level analogue of DR-035 (function EXECUTE
-- REVOKE-by-default), and it is what Supabase changelog #45329 (2026-04-28) makes
-- the platform default for existing projects on 2026-10-30. Adopting early.
--
-- Idempotent and re-runnable. It rides the migration chain, so a from-zero replay
-- applies it automatically — no post-refresh manual step (S493, proven by rebuilding
-- Platform prod from the chain: anon table grants 509 -> 0; this is what retired the
-- former DR-049 mandate to re-run the ACL sweep by hand).

-- =============================================================================
-- 1. RLS — close the read half on the six PUBLIC/USING(true) policies
-- =============================================================================
-- Scoped to authenticated + service_role, mirroring each table's own existing
-- write policies. service_role has rolbypassrls, so naming it is documentation
-- rather than mechanism. No behaviour change for signed-in users: the app is
-- login-gated end to end (lib/routes.ts PUBLIC_ROUTES is /login, /auth/callback,
-- /oauth/consent, and all three use GoTrue only — never PostgREST).

DROP POLICY IF EXISTS q_a_pairs_select ON public.q_a_pairs;
CREATE POLICY q_a_pairs_select ON public.q_a_pairs
  FOR SELECT TO authenticated, service_role USING (true);

DROP POLICY IF EXISTS q_a_extractions_select ON public.q_a_extractions;
CREATE POLICY q_a_extractions_select ON public.q_a_extractions
  FOR SELECT TO authenticated, service_role USING (true);

DROP POLICY IF EXISTS change_reports_select ON public.change_reports;
CREATE POLICY change_reports_select ON public.change_reports
  FOR SELECT TO authenticated, service_role USING (true);

DROP POLICY IF EXISTS application_types_select_all ON public.application_types;
CREATE POLICY application_types_select_all ON public.application_types
  FOR SELECT TO authenticated, service_role USING (true);

DROP POLICY IF EXISTS form_types_select_all ON public.form_types;
CREATE POLICY form_types_select_all ON public.form_types
  FOR SELECT TO authenticated, service_role USING (true);

DROP POLICY IF EXISTS form_outcome_types_select_all ON public.form_outcome_types;
CREATE POLICY form_outcome_types_select_all ON public.form_outcome_types
  FOR SELECT TO authenticated, service_role USING (true);

-- =============================================================================
-- 2. Default privileges — stop minting anon-granted objects
-- =============================================================================
-- Not a no-op: pg_default_acl carries a real anon entry for TABLES in public,
-- installed by the squash baseline. Without this, the next CREATE TABLE
-- re-opens the hole the sweep below closes.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA api
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA api
  REVOKE ALL ON SEQUENCES FROM anon;

-- =============================================================================
-- 3. One-off sweep — retract the grants already issued
-- =============================================================================
-- api.* is the surface PostgREST actually serves ([api] schemas=["api"] in
-- config.toml), and its grants are explicit GRANT statements from
-- scripts/generate-api-views.ts — NOT inherited from the base tables, so it has
-- to be revoked separately rather than falling out of the public sweep.
--
-- api.set_config is a FUNCTION and is deliberately untouched: it remains the
-- single intentional anon entrypoint (INV-20), matching the dashboard's own
-- "only api.set_config is exposed" reading.

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES    IN SCHEMA api    FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA api    FROM anon;

-- Deliberately NOT included, tracked on id-347 as follow-up hardening:
--   * REVOKE TRUNCATE/REFERENCES/TRIGGER ... FROM authenticated. TRUNCATE is not
--     subject to RLS, but PostgREST exposes no TRUNCATE verb and authenticated
--     holds no direct DB connection, so the reachable risk is nil today.
--   * Retargeting the other ~40 no-TO-clause policies from PUBLIC to
--     authenticated. Those are already correctly row-scoped (e.g.
--     user_roles_select_own gates on auth.uid()); retargeting is tidiness, not a
--     fix, and each needs its own read-path check.

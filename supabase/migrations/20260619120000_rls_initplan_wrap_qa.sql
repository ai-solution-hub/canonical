-- ID-116.2 — auth_rls_initplan: wrap per-row auth.role() calls in (select …) initplan form.
--
-- Performance-only change. The Postgres planner evaluates a bare `auth.role()` in an RLS
-- predicate once PER ROW; wrapping it as `(select auth.role())` lets the planner hoist it
-- to a single InitPlan evaluated ONCE per query. The predicate set, command, roles, and
-- USING vs WITH CHECK placement are byte-for-byte identical to the squash baseline
-- (supabase/migrations/20260617130000_squash_baseline.sql) — only the auth-fn call site
-- gains the (select …) wrapper.
--
-- Addresses 8 supabase advisor `auth_rls_initplan` WARNs (verified against
-- canonical-platform on 19/06/2026):
--   change_reports     : delete, insert
--   q_a_extractions    : delete, insert, update
--   q_a_pairs          : delete, insert, update
--
-- Idempotent: DROP POLICY IF EXISTS then CREATE for each.

-- change_reports ------------------------------------------------------------

DROP POLICY IF EXISTS "change_reports_delete" ON "public"."change_reports";
CREATE POLICY "change_reports_delete" ON "public"."change_reports" FOR DELETE USING (((select "auth"."role"()) = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));

DROP POLICY IF EXISTS "change_reports_insert" ON "public"."change_reports";
CREATE POLICY "change_reports_insert" ON "public"."change_reports" FOR INSERT WITH CHECK (((select "auth"."role"()) = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));

-- q_a_extractions -----------------------------------------------------------

DROP POLICY IF EXISTS "q_a_extractions_delete" ON "public"."q_a_extractions";
CREATE POLICY "q_a_extractions_delete" ON "public"."q_a_extractions" FOR DELETE USING (((select "auth"."role"()) = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));

DROP POLICY IF EXISTS "q_a_extractions_insert" ON "public"."q_a_extractions";
CREATE POLICY "q_a_extractions_insert" ON "public"."q_a_extractions" FOR INSERT WITH CHECK (((select "auth"."role"()) = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));

DROP POLICY IF EXISTS "q_a_extractions_update" ON "public"."q_a_extractions";
CREATE POLICY "q_a_extractions_update" ON "public"."q_a_extractions" FOR UPDATE USING (((select "auth"."role"()) = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));

-- q_a_pairs -----------------------------------------------------------------

DROP POLICY IF EXISTS "q_a_pairs_delete" ON "public"."q_a_pairs";
CREATE POLICY "q_a_pairs_delete" ON "public"."q_a_pairs" FOR DELETE USING (((select "auth"."role"()) = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));

DROP POLICY IF EXISTS "q_a_pairs_insert" ON "public"."q_a_pairs";
CREATE POLICY "q_a_pairs_insert" ON "public"."q_a_pairs" FOR INSERT WITH CHECK (((select "auth"."role"()) = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));

DROP POLICY IF EXISTS "q_a_pairs_update" ON "public"."q_a_pairs";
CREATE POLICY "q_a_pairs_update" ON "public"."q_a_pairs" FOR UPDATE USING (((select "auth"."role"()) = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));

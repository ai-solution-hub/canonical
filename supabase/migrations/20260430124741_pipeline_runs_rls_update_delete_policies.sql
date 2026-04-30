-- Backfill UPDATE + DELETE policies for pipeline_runs.
--
-- Context: pipeline_runs ENABLE ROW LEVEL SECURITY was paired with INSERT +
-- SELECT policies in 20260416102457_pre_squash_reconciliation.sql:6175-6182,
-- but UPDATE and DELETE were never added. Auth-scoped admin clients silently
-- 0-row denied (PostgREST 200 / 0 rows) — this masked a latent bug in
-- app/api/admin/taxonomy-sync/{route,status}.ts where admin-triggered sync
-- runs left pipeline_runs.status='running' forever (UPDATE silently dropped).
-- S213 added a service_role chokepoint workaround in
-- lib/pipeline/{start-run,update-progress}.ts +
-- lib/ingest/markdown-orchestrator.ts:finaliseRun; this migration ratifies
-- the admin-policy intent so admin route handlers + future admin maintenance
-- work through the auth-scoped client without further chokepoint plumbing.
-- service_role writers (cron handlers, MCP tools, Python pipeline_log.py,
-- batch routes) continue to bypass RLS structurally.
--
-- Naming + style: matches existing pipeline_runs_insert at
-- pre_squash_reconciliation.sql:6178 — TO "authenticated", admin gate via
-- public.get_user_role(). Closes OPS-44.

CREATE POLICY "pipeline_runs_update" ON "public"."pipeline_runs"
  FOR UPDATE TO "authenticated"
  USING (("public"."get_user_role"() = 'admin'::"text"))
  WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));

CREATE POLICY "pipeline_runs_delete" ON "public"."pipeline_runs"
  FOR DELETE TO "authenticated"
  USING (("public"."get_user_role"() = 'admin'::"text"));

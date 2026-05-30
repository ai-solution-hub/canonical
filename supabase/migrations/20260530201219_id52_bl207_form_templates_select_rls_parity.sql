-- bl-207 — form_templates SELECT RLS parity (hygiene, not a tenant fix).
--
-- Replaces the all-permissive `templates_select USING (true)` (carried unchanged
-- through the templates -> form_templates rename in 20260520120828) with the
-- workspace-delegation EXISTS pattern used by the ID-52-era satellite tables
-- (procurement_workspaces_select, intelligence_workspaces_select).
--
-- VERIFIED NO-OP on effective access (S286, both staging turayklvaunphgbgscat
-- and prod rovrymhhffssilaftdwd, identical state at apply time):
--   * workspaces_select is itself USING (true), so the EXISTS predicate is
--     always true for any existing workspace;
--   * form_templates.workspace_id is NOT NULL and FKs to workspaces(id);
--   * orphan_ft_rows = 0 (no row references a missing workspace);
--   * total_ft_rows = 0 (table empty in both envs at apply time).
-- => No row readable before becomes unreadable. This brings form_templates into
--    structural parity with its siblings and removes the USING(true) audit
--    outlier; it does NOT add per-user tenant isolation (KH has no
--    workspace-membership table — workspace is an intra-client domain unit, not
--    a tenant boundary). True isolation would require a membership predicate
--    applied uniformly across workspaces_select and all satellites — out of
--    bl-207 scope.
--
-- No new PL/pgSQL function is introduced, so no SET search_path clause is needed.

DROP POLICY IF EXISTS "templates_select" ON public.form_templates;

CREATE POLICY form_templates_select ON public.form_templates
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = form_templates.workspace_id
    )
  );

-- id-417 {417.3}: the coordinated DDL pass — the last held-back retire group,
-- executed as one batch with its generator/export/app-surface trims.
--
--   change_reports          — IMS-era weekly-digest feature. Page, export lib
--                             and MCP tool were deleted in the S529/S530
--                             waves; this drops the storage half, including
--                             the two user_notification_prefs toggle columns
--                             that configured it.
--   classification_disputes — S528 round-1 board ruling C6b.
--   coverage_targets        — DR-034 retired the content_items-era coverage
--                             feature; 0 rows on both Platform DBs.
--
-- api.user_notification_prefs binds the dropped columns, so it is recreated
-- minus them in the same batch (DR-032: the exposure companion never ships
-- as a follow-up).
--
-- processing_queue_select_own: SELECT on processing_queue was admin-only
-- while processing_queue_insert_editor_admin invites editor INSERTs — a
-- creator could enqueue a job it could never poll, which 404'd the restored
-- /api/jobs/[id]/status route and broke template-fill's INSERT..RETURNING
-- for editors. Enqueue paths stamp created_by (enqueueQueueJob does; the
-- template-fill route now does too).

DROP VIEW IF EXISTS api.change_reports;
DROP VIEW IF EXISTS api.classification_disputes;
DROP VIEW IF EXISTS api.coverage_targets;

DROP TABLE IF EXISTS public.change_reports;
DROP TABLE IF EXISTS public.classification_disputes;
DROP TABLE IF EXISTS public.coverage_targets;

DROP VIEW IF EXISTS api.user_notification_prefs;

ALTER TABLE public.user_notification_prefs
  DROP COLUMN IF EXISTS auto_generate_change_reports,
  DROP COLUMN IF EXISTS email_weekly_change_report;

CREATE VIEW api.user_notification_prefs
WITH (security_invoker = true) AS
SELECT
  user_id,
  email_review_assigned,
  email_owned_content_flagged,
  created_at,
  updated_at
FROM public.user_notification_prefs;

GRANT SELECT, INSERT, UPDATE, DELETE ON api.user_notification_prefs
  TO authenticated, service_role;

CREATE POLICY processing_queue_select_own ON public.processing_queue
  FOR SELECT TO authenticated
  USING (created_by = (SELECT auth.uid()));

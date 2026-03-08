-- Fix two RLS policy issues:
-- 1. notifications_insert: WITH CHECK (true) allows any authenticated user to
--    insert notifications for any user_id. Restrict to user_id = auth.uid().
-- 2. ingestion_quality_log: duplicate permissive DELETE policies
--    (ingestion_quality_log_delete and quality_log_delete) both allow admin-only
--    delete. Drop the inconsistently-named duplicate.

-- =============================================================================
-- 1. Fix notifications_insert — restrict to own user_id
-- =============================================================================

DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;

CREATE POLICY "notifications_insert"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = ( SELECT auth.uid() AS uid ));

-- =============================================================================
-- 2. Drop duplicate DELETE policy on ingestion_quality_log
--    Keep quality_log_delete (matches naming convention of other policies on
--    this table: quality_log_select, quality_log_insert, quality_log_update).
-- =============================================================================

DROP POLICY IF EXISTS "ingestion_quality_log_delete" ON public.ingestion_quality_log;

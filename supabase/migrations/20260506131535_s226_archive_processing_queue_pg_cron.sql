-- §5.4.4 markdown-batch migration: archive pg_cron job for processing_queue
-- 30-day retention.
-- Per .planning/.archive/.specs/§5.4.4-ep2-markdown-batch-migration-spec.md §7.8a +
-- §10 D-5 ratified (30 days retention; inherits infra spec §9 R4 weekly
-- archive + matches §5.4.1 D-5 + §5.4.2 D-5 ratified defaults).
--
-- Schedule: weekly on Sunday at 03:00 UTC (`0 3 * * 0` cron expression).
-- Removes terminal-state rows older than 30 days; pending and processing
-- rows are NEVER pruned (the archive job is read-only on the live working
-- set).
--
-- Rollback: SELECT cron.unschedule('archive-processing-queue');

SELECT cron.schedule(
  'archive-processing-queue',
  '0 3 * * 0',
  $$DELETE FROM processing_queue
    WHERE status IN ('completed', 'failed', 'cancelled', 'dead_lettered')
      AND completed_at < NOW() - INTERVAL '30 days'$$
);

-- Re-affirm marker (S226 close-out): spec path in line 3 comment now points at .planning/.archive/.specs/ (no DDL change).

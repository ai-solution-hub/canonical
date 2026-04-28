-- W4 Phase 1 — activity_history.correlation_id (structured-logging-spec
--   §10 decision 2 + §11 v1.1 patch).
--
-- Adds a nullable text column carrying the per-request correlation ID
-- (`x-request-id` / Pino logger requestId / Sentry tag) onto the
-- `activity_history` audit-trail table. With this column populated by the
-- application write path (handler stamps from
-- `getRequestContext()?.requestId`), a single ID traces a user action
-- from API entry through Pino log lines and Sentry events to the audit
-- row.
--
-- Idempotency contract — this migration is safe to re-run and safe to
-- apply against a database where `activity_history` does not yet exist:
--
--   1. Wrapped in a `DO` block that tests `to_regclass('public.activity_history')`
--      so the entire body is a no-op when the table is absent. The spec
--      describes `activity_history` as the audit-trail target; the
--      Knowledge Hub schema today persists audits via `content_history`,
--      `bid_response_history`, and `verification_history`, none named
--      `activity_history`. When/if the canonical audit table is created
--      under that name, this migration's body becomes effective on the
--      next replay (idempotent guards fire on already-applied attempts).
--
--   2. `ALTER TABLE … ADD COLUMN IF NOT EXISTS correlation_id text` skips
--      a re-add if a prior migration already created the column.
--
--   3. `CREATE INDEX IF NOT EXISTS idx_activity_history_correlation_id`
--      guards the index from duplicate creation.
--
-- The column is nullable because backfill is impossible — pre-Phase-1
-- rows were written without a request context and there is no archival
-- mapping to retroactively assign one. Phase 1 onwards every new write
-- path (when the table exists) MUST stamp the column from
-- `getRequestContext()?.requestId`.

DO $migration$
BEGIN
  IF to_regclass('public.activity_history') IS NOT NULL THEN
    -- Add the column. Idempotent — IF NOT EXISTS prevents
    -- re-application errors.
    EXECUTE 'ALTER TABLE public.activity_history
             ADD COLUMN IF NOT EXISTS correlation_id text';

    -- B-tree index for lookup-by-requestId; supports the canonical
    -- "what activity rows belong to this request" query.
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_activity_history_correlation_id
             ON public.activity_history (correlation_id)
             WHERE correlation_id IS NOT NULL';

    COMMENT ON COLUMN public.activity_history.correlation_id IS
      'Per-request correlation ID (x-request-id / Pino requestId / Sentry tag). Stamped by application write paths from getRequestContext()?.requestId. Nullable — pre-W4 rows lack the context.';
  END IF;
END
$migration$;

-- S223 W3-A — §5.4 background-queue infra: claim_next_job backoff window
-- + reap_stuck_jobs RPC (AC-5 attempts++ closure).
--
-- Spec: docs/specs/background-queue-infra-spec.md v1
--   - §5.2 (lines 732-748): linear-with-jitter backoff (D-7 ratified).
--     The implementation pattern requires `claim_next_job` to gate on
--     `AND updated_at <= NOW()` so the future-dated `updated_at` written
--     by `lib/queue/failure.ts` (S222 W2-B) becomes load-bearing.
--   - §5.3 (lines 750-769): visibility-timeout reaper, D-8 ratified at
--     5-minute default. Spec SQL contract is
--     `UPDATE processing_queue SET status='pending', attempts=attempts+1
--      WHERE status='processing' AND started_at < NOW() - INTERVAL '<n> seconds'`.
--   - §8 AC-2 (lines 1055-1059): transient retry round-trip — the new
--     WHERE clause is what gates the second-tick re-claim against the
--     backoff visibility window.
--   - §8 AC-5 (lines 1077-1081): stuck-job reap — explicitly asserts
--     `attempts=1` post-reap, which the TS reaper at
--     `lib/queue/visibility-timeout.ts` cannot express through
--     supabase-js (raw `attempts = attempts + 1` is not supported in
--     the column-update payload — S222 V_W2 L-1).
--
-- Path (b) decision (per W3-A brief):
--   We rewrite `claim_next_job` for the WHERE-clause gate AND ship the
--   `reap_stuck_jobs(p_timeout_seconds int)` RPC so AC-5's `attempts++`
--   contract lands in the same migration. The TS helper at
--   `lib/queue/visibility-timeout.ts` is updated in a follow-up commit
--   to call the RPC; this migration is the schema enabler.
--
-- Two changes:
--   1. CREATE OR REPLACE FUNCTION public.claim_next_job() — adds
--      `AND updated_at <= NOW()` to the inner SELECT WHERE clause.
--      Body otherwise identical to the pre-squash baseline at
--      20260416102457_pre_squash_reconciliation.sql:372-385.
--   2. CREATE OR REPLACE FUNCTION public.reap_stuck_jobs(p_timeout_seconds int)
--      — wraps the spec §5.3 UPDATE as a PL/pgSQL helper returning the
--      reaped row count. Caller passes the visibility-timeout window in
--      seconds (TS default = 5 * 60 per spec D-8).
--
-- ACL contract (per docs/reference/SCHEMA-QUICK-REFERENCE.md §32 ACL
-- conventions + feedback_supabase_pg_default_acl_anon_execute):
--   CREATE OR REPLACE on existing `claim_next_job` re-runs the
--   `pg_default_acl` auto-grant to anon, so the explicit REVOKE shipped
--   in 20260502143049_ops43_revoke_anon_execute_public_functions.sql:186
--   must be re-affirmed here. Same applies to the new `reap_stuck_jobs`
--   RPC. Pattern: `REVOKE EXECUTE ... FROM PUBLIC, anon` (PUBLIC is the
--   pre-squash grant materialised in proacl; without it the REVOKE is a
--   no-op against PUBLIC inheritance — see §32.1 author checklist).

-- ----------------------------------------------------------------------------
-- 1. claim_next_job — add backoff visibility-window gate
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_next_job()
RETURNS SETOF public.processing_queue
LANGUAGE sql
SET search_path = public, extensions
AS $$
  UPDATE public.processing_queue
  SET status = 'processing', started_at = NOW()
  WHERE id = (
    SELECT id FROM processing_queue
    WHERE status = 'pending' AND updated_at <= NOW()
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

ALTER FUNCTION public.claim_next_job() OWNER TO postgres;

-- Re-affirm REVOKE post-CREATE OR REPLACE — `pg_default_acl` re-grants anon.
REVOKE EXECUTE ON FUNCTION public.claim_next_job() FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 2. reap_stuck_jobs — visibility-timeout reaper RPC (AC-5)
-- ----------------------------------------------------------------------------
--
-- Spec §5.3 SQL contract:
--   UPDATE processing_queue
--   SET status = 'pending', attempts = attempts + 1
--   WHERE status = 'processing'
--     AND started_at < NOW() - INTERVAL '<visibility_timeout> seconds';
--
-- Returns the count of reaped rows so the cron worker can emit the
-- `Reaped stuck queue job` Sentry warning per spec §6.1.3.

CREATE OR REPLACE FUNCTION public.reap_stuck_jobs(p_timeout_seconds integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  reaped_count integer;
BEGIN
  WITH reaped AS (
    UPDATE public.processing_queue
    SET status = 'pending',
        attempts = attempts + 1
    WHERE status = 'processing'
      AND started_at < NOW() - make_interval(secs => p_timeout_seconds)
    RETURNING id
  )
  SELECT count(*)::integer INTO reaped_count FROM reaped;
  RETURN reaped_count;
END;
$$;

ALTER FUNCTION public.reap_stuck_jobs(integer) OWNER TO postgres;

-- Same REVOKE pattern — pipeline service-role only (cron route uses
-- createServiceClient, not user-scoped client).
REVOKE EXECUTE ON FUNCTION public.reap_stuck_jobs(integer) FROM PUBLIC, anon;

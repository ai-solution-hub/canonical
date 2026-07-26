-- ID-372 {372.2} — claim_next_job job-type scoping: optional p_job_types
-- (include list) + p_exclude_job_types (exclude list) so each queue
-- consumer claims ONLY job types it can actually process.
--
-- WHY THIS MIGRATION EXISTS — MEASURED PRODUCTION-CLASS DEFECT, NOT A
-- TEST NICETY. processing_queue has TWO consumers with DISJOINT type
-- coverage and (until now) no type scoping at all:
--
--   * app/api/cron/process-queue/route.ts (Vercel cron, every minute on
--     the production deployment; also driven in-process by the queue
--     integration suites) — runJobByType handles form_draft_all +
--     batch_reclassify and PERMANENTLY FAILS every other type
--     (`no_handler_registered`, lib/queue/dispatch.ts default case).
--   * scripts/bid_worker.py (Coolify poller, every 2 s, deployed against
--     Platform prod AND Platform staging, plus the client boxes) —
--     process_job handles template_fill + analyse_form and marks every
--     other type failed (`Unknown job type: <type>`).
--
-- Each consumer therefore DESTROYS the other's jobs whenever it wins the
-- claim race. Measured on Platform staging (26/07/2026): 24 form_draft_all
-- rows at status='failed', error_message 'Unknown job type:
-- form_draft_all', first 2026-07-17 17:28 (the staging bid-worker's
-- standup window), last 2026-07-26 22:33 — killed DURING a CI integration
-- run. This is the root cause of the integration lane's 15-day rotating
-- redness (id-372): the 2 s poller beats both the minute cron and the
-- test-driven ticks to every freshly-enqueued row. Both production DBs
-- read ZERO such rows at authoring time — the prod exposure is latent
-- (any real form_draft_all enqueued on a worker-watched DB would be
-- falsely failed within ~2 s), not yet realised.
--
-- FIX SHAPE — same adjudicated pattern as 20260725143717's
-- p_idempotency_key_prefix ({128.21} direction (c)): trailing OPTIONAL
-- parameters, DEFAULT NULL, NULL = byte-for-byte today's behaviour, and
-- the no-arg call keeps working so nothing breaks at apply time. The two
-- consumers then OPT IN:
--
--   * bid_worker.py passes p_job_types = ['template_fill','analyse_form']
--     (claim ONLY what it processes — WORKER_JOB_TYPES, mirrored in
--     lib/queue/worker-job-types.ts with a Python↔TS parity test).
--   * process-queue route passes p_exclude_job_types = WORKER_JOB_TYPES
--     (an EXCLUDE list, not an include list, deliberately: the route's
--     PermanentJobError default case is the queue's loud dead-letter for
--     types nobody registered a handler for. An include list would need
--     hand-maintaining as types are added, and a forgotten entry would
--     leave rows invisibly pending forever — the exclude shape preserves
--     the fail-loud posture with a 2-entry stable list.)
--
-- FAILS CLOSED, matching the prefix param's semantics: an EMPTY include
-- array claims nothing (never widens to a global claim); an empty exclude
-- array excludes nothing (harmless no-op). `= ANY(...)` on a NULL
-- idempotency-free column is not a concern here — job_type is NOT NULL by
-- schema.
--
-- WHY DROP + CREATE, NOT CREATE OR REPLACE: PostgreSQL identifies a
-- function by name + INPUT PARAMETER TYPE LIST, so OR REPLACE cannot widen
-- the list in place — it would mint a second overload and make PostgREST
-- `.rpc()` resolution ambiguous (same reasoning as 20260725143717 and
-- 20260717150000). The api.* SECURITY INVOKER wrapper is dependency-
-- tracked against the public fn, so it drops FIRST and ships in the same
-- migration (DR-032; scripts/generate-api-views.ts lists claim_next_job in
-- SURFACE_RPCS, so the next regen reproduces this wrapper unchanged).
--
-- TYPES REGEN: NOT deferred this time — database.types.ts already carries
-- claim_next_job Args (the {128.21} regen landed), so the parity gate
-- would go red repo-wide on apply. The regenerated types ship in the same
-- PR as this migration; apply-to-staging and the PR merge are sequenced
-- back-to-back to keep the parity window to minutes.
--
-- STAMP (DR-081b — allocated against the REMOTE applied set, non-round,
-- time-anchored): 20260726231847 is strictly greater than every version in
-- both sets checked at authoring time —
--   * local `supabase/migrations/` max = 20260726120000
--   * Platform staging remote      max = 20260726120000
-- Platform prod application is deliberately deferred with the prod worker
-- redeploy (no realised prod damage; apply the pair together).
--
-- UK English throughout (DD/MM/YYYY). Authored 26/07/2026 (S498).

SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Drop the api.* wrapper first (pg_depend dependency on the public fn).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.claim_next_job(text);

-- ---------------------------------------------------------------------------
-- Drop the old single-arg public signature (20260725143717's).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.claim_next_job(text);

-- ---------------------------------------------------------------------------
-- public.claim_next_job — widened: + p_job_types / p_exclude_job_types.
-- Body otherwise identical to 20260725143717 (status + backoff-window
-- gate, FIFO by created_at, FOR UPDATE SKIP LOCKED single-row claim,
-- prefix scoping).
-- ---------------------------------------------------------------------------
CREATE FUNCTION "public"."claim_next_job"(
    "p_idempotency_key_prefix" "text" DEFAULT NULL::"text",
    "p_job_types" "text"[] DEFAULT NULL::"text"[],
    "p_exclude_job_types" "text"[] DEFAULT NULL::"text"[]
) RETURNS SETOF "public"."processing_queue"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  UPDATE public.processing_queue
  SET status = 'processing', started_at = NOW()
  WHERE id = (
    SELECT id FROM processing_queue
    WHERE status = 'pending' AND updated_at <= NOW()
      AND (
        -- Omitted / NULL: every eligible row (today's exact behaviour).
        p_idempotency_key_prefix IS NULL
        -- Supplied: exact literal prefix match; an empty prefix claims
        -- nothing (fails closed).
        OR (
          p_idempotency_key_prefix <> ''
          AND starts_with(idempotency_key, p_idempotency_key_prefix)
        )
      )
      -- Include list: NULL = all types; empty array claims nothing
      -- (fails closed, consistent with the prefix param).
      AND (p_job_types IS NULL OR job_type = ANY(p_job_types))
      -- Exclude list: NULL / empty = excludes nothing.
      AND (
        p_exclude_job_types IS NULL
        OR NOT (job_type = ANY(p_exclude_job_types))
      )
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

ALTER FUNCTION "public"."claim_next_job"("text", "text"[], "text"[]) OWNER TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_next_job"("text", "text"[], "text"[]) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."claim_next_job"("text", "text"[], "text"[]) TO "service_role";

-- ---------------------------------------------------------------------------
-- api.* SECURITY INVOKER wrapper — same migration per DR-032 (PostgREST
-- resolves .rpc() through api.<fn> only; a stale wrapper would strand
-- every supabase-js caller). Mirrors generate-api-views.ts's emitted shape.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "api"."claim_next_job"(
    "p_idempotency_key_prefix" "text" DEFAULT NULL::"text",
    "p_job_types" "text"[] DEFAULT NULL::"text"[],
    "p_exclude_job_types" "text"[] DEFAULT NULL::"text"[]
) RETURNS SETOF "public"."processing_queue"
    LANGUAGE "sql" SECURITY INVOKER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.claim_next_job(
    p_idempotency_key_prefix => p_idempotency_key_prefix,
    p_job_types => p_job_types,
    p_exclude_job_types => p_exclude_job_types
  );
$$;

ALTER FUNCTION "api"."claim_next_job"("text", "text"[], "text"[]) OWNER TO "postgres";

GRANT EXECUTE ON FUNCTION "api"."claim_next_job"("text", "text"[], "text"[]) TO "authenticated";
GRANT EXECUTE ON FUNCTION "api"."claim_next_job"("text", "text"[], "text"[]) TO "service_role";

COMMENT ON FUNCTION "public"."claim_next_job"("text", "text"[], "text"[]) IS 'ID-372 {372.2} — widened from 20260725143717 with OPTIONAL p_job_types (include list; empty claims nothing) + p_exclude_job_types (exclude list; empty excludes nothing). Omitted/NULL preserves the prior behaviour exactly. Consumers claim only job types they process: bid_worker.py passes p_job_types=WORKER_JOB_TYPES; the process-queue cron passes p_exclude_job_types=WORKER_JOB_TYPES (lib/queue/worker-job-types.ts) so its PermanentJobError default stays the loud dead-letter for genuinely unhandled types.';

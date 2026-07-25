-- ID-128 {128.21} — claim_next_job test isolation: optional
-- p_idempotency_key_prefix so CI queue integration test-doubles can claim
-- ONLY the rows they seeded, instead of racing the live Platform-staging
-- queue for real pending jobs.
--
-- WHY THIS MIGRATION EXISTS — EMPIRICAL FINDING, NOT A HYPOTHETICAL.
-- `public.claim_next_job()` takes no arguments and claims the globally
-- oldest eligible `processing_queue` row. Both queue integration suites
-- run against the SHARED Platform staging DB, so their claims compete with
-- real production work:
--
--   * `__tests__/integration/queue/lifecycle.integration.test.ts` drives
--     the real cron route (`app/api/cron/process-queue/route.ts`), whose
--     claim LOOP drains every pending row in one tick — then hands each
--     claimed row to a `vi.spyOn(runJobByType)` test-double and writes
--     `status='completed'` with the double's fake result.
--   * `__tests__/integration/queue/concurrency.integration.test.ts` calls
--     the RPC directly from two clients (4 call sites).
--
-- NINE REAL PRODUCTION JOBS WERE ALREADY DESTROYED THIS WAY. On Platform
-- staging, nine `form_draft_all` rows carrying genuine production
-- idempotency keys (`form_draft_all:<uuid>:<date>:<hash>` — never a test
-- prefix) sit at `status='completed'` with
-- `result = {"ok": true, "completed_via": "AC-1 happy-path test-double"}`,
-- across two separate incidents (5 rows completed 2026-06-25 19:54:13-14,
-- 4 rows completed 2026-07-08 00:21:43-44; each ~30-45 min after its own
-- created_at, several within the same second — the signature of one cron
-- tick's drain loop). Their real work was never performed; only the
-- terminal state was falsified. This is silent data corruption of the
-- production queue by the test suite, not merely a flaky test.
--
-- FIX SHAPE ADJUDICATED — direction (c), "prefix-scoped seed ids honoured
-- by claim", of the three directions recorded on {128.21}. Rejected:
--   (a) job-type-scoped claiming. `processing_queue_job_type_check`
--       constrains job_type to a CLOSED set of 13 real production types
--       (embed, classify, extract_qa, summarise, validate, reprocess,
--       template_fill, template_analyse, bid_draft_all, form_draft_all,
--       batch_reclassify, markdown_batch, analyse_form). Scoping by type
--       would mean widening that CHECK with a synthetic `test` job type —
--       minting a fake production job type in the domain model — and the
--       suites' behaviour is keyed on REAL types (AC-4 asserts the
--       PermanentJobError the dispatch shell raises for job_type='embed'),
--       so re-typing the seeds would change what is under test.
--   (b) isolated queue/DB namespace. Disproportionate for two test files,
--       and {128.10}'s ephemeral-branch work is already the structural
--       answer to shared-DB contention for the nightly lane.
-- Direction (c) needs no test-data reshaping at all: BOTH suites already
-- tag every seeded row's `idempotency_key` with a per-run TEST_PREFIX
-- (`[S223-LIFECYCLE-<ts>-<rand>]` / `[S223-CONCURRENCY-<ts>-<rand>]`) and
-- already scrub by that prefix in afterAll. This migration simply lets the
-- claim honour the prefix that is already there.
--
-- DEFAULT BEHAVIOUR IS UNCHANGED — the hard constraint from the {128.21}
-- test strategy. `p_idempotency_key_prefix` is trailing and DEFAULT NULL;
-- when it is NULL the added predicate short-circuits and the claim is the
-- byte-for-byte original statement. Both production consumers call the RPC
-- with NO arguments and are untouched:
--   * `app/api/cron/process-queue/route.ts` (Vercel Cron — hits the bare
--     URL, so its optional query param is absent and the call stays
--     `supabase.rpc('claim_next_job')` with no args object);
--   * `scripts/bid_worker.py:769` (`supabase.rpc("claim_next_job", {})`).
--
-- FAILS CLOSED, NOT OPEN. An empty-string prefix claims NOTHING rather
-- than everything, so a misconfigured caller can never silently widen back
-- to a global claim. `starts_with()` (PostgreSQL 11+, verified live on the
-- staging PG 17.6 catalog) is used in preference to `LIKE prefix || '%'`
-- because it does exact literal prefix matching with NO wildcard
-- semantics — there is no `%`/`_` metacharacter or ESCAPE question, and a
-- caller-supplied prefix can never be crafted into a wider pattern.
-- `idempotency_key` is NULLABLE; `starts_with(NULL, x)` is NULL, so an
-- un-keyed row (never test-seeded) is correctly invisible to a scoped
-- claim while remaining visible to the default claim.
--
-- ONE-WAY BY DESIGN. This scopes the TEST claim away from live rows. It
-- deliberately does NOT stop the live worker from claiming a test row —
-- that would require changing the no-arg default, which the {128.21} test
-- strategy forbids outright. The remaining exposure is the benign
-- direction (a live tick may drain a test row, failing the test loudly)
-- rather than the harmful one (a test silently completing real work).
--
-- WHY DROP + CREATE, NOT CREATE OR REPLACE: identical reasoning to
-- 20260717150000_id128_writer_fence_test_isolation.sql — PostgreSQL
-- identifies a function by name + INPUT PARAMETER TYPE LIST, so CREATE OR
-- REPLACE cannot widen that list in place; it would create a SECOND,
-- overloaded `claim_next_job` alongside the zero-arg original. Two
-- same-named overloads of differing arity in `public`/`api` would make
-- PostgREST `.rpc()` name resolution ambiguous. DROP order matters: the
-- `api.*` SECURITY INVOKER wrapper is LANGUAGE SQL and is dependency-
-- tracked in pg_depend against the `public.*` function it calls, so it is
-- dropped FIRST.
--
-- GRANTS: preserved exactly as found on the live catalog
-- (`{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`
-- on BOTH `public.claim_next_job` and `api.claim_next_job` — `anon`
-- already absent). Per supabase/CLAUDE.md the DR-035 `born-locked
-- functions` event trigger revokes PUBLIC/anon EXECUTE automatically; the
-- explicit GRANTs below only restore the two roles that were present.
--
-- api WRAPPER SHIPS IN THE SAME MIGRATION per DR-032 — PostgREST resolves
-- `.rpc()` through `api.<fn>` (config.toml `schemas = ["api"]`), never
-- `public.<fn>` directly, so a widened public function with a stale
-- zero-arg api wrapper would be unreachable from every supabase-js caller.
-- `scripts/generate-api-views.ts` already lists `claim_next_job` in
-- SURFACE_RPCS and emits one entrypoint per pg_proc overload, so the next
-- regen reproduces this widened wrapper without an edit to the generator.
--
-- TYPES REGEN: deliberately DEFERRED, exactly as {128.20} deferred
-- `p_fence_name` — no typed PRODUCTION caller passes the new argument, so
-- nothing needs the regenerated `database.types.ts` to compile. The two
-- callers that DO pass it (the cron route's scoped branch and the
-- concurrency suite) carry a narrow, commented local cast pointing back
-- here.
--
-- AUTHORED, NOT APPLIED. This file is committed to the working tree only.
-- Remote application to Platform staging/prod is owner-gated and belongs
-- to the migration-application workstream, not to this Subtask.
--
-- STAMP (DR-081b — allocate against the REMOTE applied set, non-round,
-- time-anchored): 20260725143717 is strictly greater than every version in
-- all three sets checked at authoring time —
--   * local `supabase/migrations/`  max = 20260724233500
--   * Platform staging remote       max = 20260724233144
--   * Platform prod remote          max = 20260717164512
-- (Note the pre-existing staging/local divergence on the id347_anon_lockdown
-- pair, 233144 remote vs 233500 local — flagged to the migration-history
-- workstream; this stamp clears BOTH regardless of how that resolves.)
--
-- UK English throughout (DD/MM/YYYY). Authored 25/07/2026.

SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Drop the api.* wrapper first (pg_depend dependency on the public fn).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.claim_next_job();

-- ---------------------------------------------------------------------------
-- Drop the old zero-arg public signature.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.claim_next_job();

-- ---------------------------------------------------------------------------
-- public.claim_next_job — widened: optional p_idempotency_key_prefix.
-- Body otherwise identical to the definition carried by
-- 20260617130000_squash_baseline.sql (status + backoff-window gate, FIFO
-- by created_at, FOR UPDATE SKIP LOCKED single-row claim).
-- ---------------------------------------------------------------------------
CREATE FUNCTION "public"."claim_next_job"(
    "p_idempotency_key_prefix" "text" DEFAULT NULL::"text"
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
        -- Omitted / NULL: today's exact behaviour — every eligible row.
        p_idempotency_key_prefix IS NULL
        -- Supplied: exact literal prefix match, and NEVER a global claim
        -- for an empty prefix (fails closed).
        OR (
          p_idempotency_key_prefix <> ''
          AND starts_with(idempotency_key, p_idempotency_key_prefix)
        )
      )
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

ALTER FUNCTION "public"."claim_next_job"("text") OWNER TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_next_job"("text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."claim_next_job"("text") TO "service_role";

COMMENT ON FUNCTION "public"."claim_next_job"("text") IS 'ID-128 {128.21} — widened from the 20260617130000 squash baseline with an OPTIONAL p_idempotency_key_prefix. Omitted/NULL claims the globally oldest eligible pending row exactly as before, so both production consumers (app/api/cron/process-queue/route.ts, scripts/bid_worker.py) are unaffected. A caller-supplied prefix restricts the claim to rows whose idempotency_key literally starts with it (starts_with, no LIKE wildcard semantics), which is how the queue integration suites claim ONLY their own per-run-prefixed seed rows instead of racing live jobs on the shared staging DB. An empty-string prefix claims nothing (fails closed, never widens to a global claim).';

-- ---------------------------------------------------------------------------
-- api wrapper (DR-032 — companion exposure ships in the SAME migration).
-- Recreated rather than CREATE OR REPLACE for the same signature-widening
-- reason as the public function above.
-- ---------------------------------------------------------------------------
CREATE FUNCTION api.claim_next_job(p_idempotency_key_prefix text DEFAULT NULL::text)
  RETURNS SETOF public.processing_queue
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.claim_next_job(p_idempotency_key_prefix => p_idempotency_key_prefix);
$api$;

ALTER FUNCTION api.claim_next_job("text") OWNER TO "postgres";

GRANT EXECUTE ON FUNCTION api.claim_next_job(text) TO authenticated, service_role;

-- ID-138 {138.9} REDESIGN — pooling-safe writer-fence lease (replaces the
-- session-scoped advisory-lock primitive from 20260703160400_id138_writer_fence.sql).
--
-- WHY THIS MIGRATION EXISTS — S445 EMPIRICAL DEFECT (live staging):
-- the {138.9} advisory-lock primitive (corpus_writer_fence_try_acquire/
-- _release, pg_try_advisory_lock/pg_advisory_unlock) is NOT mutually
-- exclusive through PostgREST. Two "concurrent" supabase-js .rpc() acquire
-- calls were observed landing on the SAME pooled backend Postgres session —
-- pg_try_advisory_lock is REENTRANT for the SAME session, so BOTH calls
-- returned true (mutual exclusion silently defeated). Session-scoped
-- advisory locks are the wrong primitive behind a connection pooler /
-- PostgREST, whose session affinity across two separate HTTP round trips
-- (one acquire call, a later release call) is never guaranteed — see the
-- original migration's KNOWN LIMITATION section, now empirically confirmed
-- rather than theoretical (ledger ID-138.9, S445 info-added block).
--
-- ONE-LINE DISPROOF — pg_advisory_xact_lock REJECTED:
-- pg_advisory_xact_lock is released automatically when its OWNING
-- TRANSACTION ends. Every supabase-js .rpc() call runs in its own implicit
-- transaction that commits when that single RPC call returns — so an
-- xact-scoped lock taken inside the "acquire" RPC is released the INSTANT
-- that RPC's transaction commits, i.e. BEFORE the caller's actual critical
-- section (the Storage PUT / bucket-or-volume write) even starts. It would
-- provide ZERO exclusion coverage for the acquire -> work -> release span
-- PostgREST callers need fenced. Disqualified without further testing.
--
-- MECHANISM CHOSEN — row-based holder-token/lease table (pooling-agnostic):
-- a single control-plane row per fence domain (`corpus_writer_fence_lease`)
-- carries the mutual-exclusion state itself, so it does not matter which
-- pooled backend session/connection a caller's HTTP request happens to land
-- on — the ROW is the source of truth, not the session. Acquire is a single
-- atomic `INSERT ... ON CONFLICT (fence_name) DO UPDATE ... WHERE
-- <row is free-or-expired> RETURNING`; Postgres takes a row-level lock as
-- part of the conflict check (the same lock strength as `SELECT ... FOR
-- UPDATE`), so two concurrent INSERTs targeting the SAME conflict key
-- serialise against each other regardless of which session/connection they
-- arrive on: the second waits for the first's statement to complete, then
-- re-evaluates the WHERE clause against the now-current row. This is the
-- documented, race-free "upsert as CAS" pattern (best-practice citation
-- below) and is exactly why this design is sound for BOTH pooled PostgREST
-- callers (the TS leg) and direct asyncpg connections (the Python leg) —
-- neither leg needs session affinity for anything, because no state ever
-- lives in a session.
--
-- BEST-PRACTICE CITATIONS APPLIED (`supabase-postgres-best-practices` skill,
-- consulted per {138.9} REDESIGN brief requirement #1):
--   - rules/data-upsert.md: "Use INSERT ... ON CONFLICT for atomic upserts"
--     — a check-then-insert/update pattern is a race condition; a single
--     atomic ON CONFLICT statement is not. This is the load-bearing
--     atomicity primitive behind corpus_writer_fence_lease_acquire below.
--   - rules/lock-short-transactions.md: "Correct" pattern holds a lock only
--     for the atomic conditional statement itself, never across external
--     work — the acquire function's row lock is held for the microseconds
--     of the single INSERT statement, NOT across the whole
--     acquire -> critical-section -> release span (that span is gated by
--     the ROW'S DATA, `expires_at`/`holder_token`, not by a held lock or
--     open transaction).
--   - rules/conn-pooling.md: PgBouncer/PostgREST transaction-mode pooling
--     returns the backend connection to the pool after each transaction —
--     precisely the mechanism behind the S445 defect (no session affinity
--     is guaranteed across two separate `.rpc()` calls), and the reason a
--     durable ROW, not connection/session state, must carry the mutex.
--   - rules/lock-advisory.md: advisory locks are the right tool ONLY when
--     the acquiring session holds a single live connection for the WHOLE
--     critical section (every example in that rule acquires and releases
--     within one uninterrupted script/session) — exactly the assumption
--     PostgREST breaks for the TS leg, which is why this Subtask moves off
--     advisory locks entirely rather than patching around the caveat.
--   - rules/schema-primary-keys.md: general guidance discourages random-UUID
--     primary keys on large/high-throughput tables (index fragmentation).
--     Deliberate, documented deviation: `fence_name text PRIMARY KEY` here
--     is a small, low-cardinality control-plane table (one row per fence
--     domain; ONE domain — 'id138_corpus_writer_fence' — exists today), not
--     a large table subject to insert-fragmentation concerns, so a
--     human-readable text key is the right choice (mirrors the existing
--     `_corpus_writer_fence_key()` domain-string convention).
--
-- FENCING-TOKEN SEMANTICS (why `holder_token` is REQUIRED, not optional):
-- every acquire call supplies a caller-generated `uuid` token; release must
-- present the SAME token to succeed. This means a STALE holder (one whose
-- lease has already expired and been re-acquired by someone else) can never
-- accidentally release the NEW holder's active lease — its release call's
-- token simply will not match the row's current `holder_token`, so it is a
-- silent no-op (logged as a WARNING), exactly mirroring the "release
-- returns false when not held" contract the original advisory-lock
-- primitive already exposed to callers (lib/corpus/writer-fence.ts /
-- writer_fence.py callers do not need to change their error-handling
-- shape, only how the token is threaded through).
--
-- TTL — default 3600s (1 hour), overridable per call via `p_ttl_seconds`:
-- the two failure directions are NOT symmetric. A TTL that is too SHORT
-- breaks the SAFETY invariant this whole primitive exists for — a
-- still-working, non-crashed holder could have its lease silently reclaimed
-- by a second writer, reproducing the exact "two writers touching the
-- bucket/volume at once" hazard this migration fixes. A TTL that is too
-- LONG only costs LIVENESS after a genuine crash (other writers see a
-- normal, already-designed-for `false`/busy result and abort-or-retry for
-- up to the TTL window, then recover automatically once it expires — no
-- operator action required). Given that asymmetry, the default skews
-- generous (1 hour) rather than aggressive. Callers with a known-SHORT
-- critical section (write-back {138.12} / upload {138.13} — a single
-- Storage PUT) SHOULD pass a shorter explicit `p_ttl_seconds` (e.g. 300) to
-- tighten their own crash-recovery window; the pull-sync materialise+walk
-- ({138.14}, which HOLDS the fence across the whole incremental walk) and
-- the id-45 ({45.7}) operator bulk-load may need the default or an even
-- longer explicit value. CRASHED-HOLDER RECOVERY: fully automatic — once
-- `expires_at` passes, the NEXT acquire attempt's `WHERE ... expires_at <
-- now()` clause is satisfied and the row is reclaimed; no manual
-- intervention needed. An operator emergency escape hatch (manual
-- `DELETE FROM corpus_writer_fence_lease` as the `postgres`/service role) is
-- documented in the runbook for the rare case an operator needs to clear a
-- lease before its TTL — this is a manual SQL action, deliberately NOT
-- exposed via any RPC (no client-triggerable "force-release" surface).
--
-- OLD ADVISORY-LOCK FUNCTIONS — DEPRECATED, NOT DROPPED: this migration
-- re-points BOTH callers (lib/corpus/writer-fence.ts, scripts/cocoindex_
-- pipeline/writer_fence.py) onto the new lease functions in the SAME
-- Subtask, so no known caller of corpus_writer_fence_try_acquire /
-- corpus_writer_fence_release (nor their api.* wrappers,
-- 20260703210000_id138_api_rpc_wrappers.sql) remains after this lands.
-- They are NOT dropped here regardless: dropping an already-APPLIED
-- (staging+prod) SECURITY DEFINER function is a separate, deliberate
-- cleanup step once the lease mechanism has baked in production — this
-- migration only marks them DEPRECATED via COMMENT ON FUNCTION (see below)
-- so anyone browsing \df+ / psql \d output sees the redirect immediately.
-- Grants on the old functions are left untouched (still callable, in case a
-- rollback of the TS/Python re-point is ever needed) — only their intent is
-- retired.
--
-- Authored, NOT applied: apply is an owner-gated coordinated GO alongside
-- the rest of the id138 serial. No db push, no types regen in this
-- Subtask.
--
-- UK English throughout (DD/MM/YYYY). Authored 04/07/2026.

SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- corpus_writer_fence_lease — one row per fence domain. Only
-- 'id138_corpus_writer_fence' (the single, fixed, corpus-wide domain key —
-- same "one shared barrier for the whole corpus" rationale as the original
-- migration's hashed advisory-lock key) exists today; the table is shaped to
-- carry additional fence domains later without a schema change.
-- ---------------------------------------------------------------------------
CREATE TABLE "public"."corpus_writer_fence_lease" (
    "fence_name" "text" PRIMARY KEY,
    "holder_token" "uuid" NOT NULL,
    "holder_label" "text",
    "acquired_at" timestamptz NOT NULL DEFAULT "now"(),
    "expires_at" timestamptz NOT NULL,
    CONSTRAINT "corpus_writer_fence_lease_expiry_after_acquire_check"
        CHECK ("expires_at" > "acquired_at")
);

ALTER TABLE "public"."corpus_writer_fence_lease" OWNER TO "postgres";

COMMENT ON TABLE "public"."corpus_writer_fence_lease" IS 'ID-138 {138.9} REDESIGN (S445) — row-based holder-token lease backing the corpus writer-fence. NEVER queried/mutated directly by any role other than postgres (the SECURITY DEFINER functions'' owner) — all access goes through corpus_writer_fence_lease_acquire/_release so the fencing-token check cannot be bypassed. See 20260704120000_id138_writer_fence_lease.sql header for the full mechanism writeup + best-practice citations.';

-- Defence in depth: RLS enabled with NO policies (default-deny for every
-- role except the table owner/superuser, which the SECURITY DEFINER
-- functions run as) + explicit REVOKE ALL, mirroring the existing
-- underscore-prefixed private-helper convention
-- (`_corpus_writer_fence_key()`) rather than the client-facing-table RLS
-- convention (policies + anon/authenticated grants) used elsewhere — this
-- table is control-plane-only, never client-queried.
ALTER TABLE "public"."corpus_writer_fence_lease" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."corpus_writer_fence_lease" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."corpus_writer_fence_lease" FROM "anon";
REVOKE ALL ON TABLE "public"."corpus_writer_fence_lease" FROM "authenticated";
REVOKE ALL ON TABLE "public"."corpus_writer_fence_lease" FROM "service_role";

-- ---------------------------------------------------------------------------
-- Private helper — single source of truth for the fence domain name, same
-- pattern as `_corpus_writer_fence_key()` in the original migration.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."_corpus_writer_fence_lease_name"()
    RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT 'id138_corpus_writer_fence'::text;
$$;

ALTER FUNCTION "public"."_corpus_writer_fence_lease_name"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."_corpus_writer_fence_lease_name"() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- corpus_writer_fence_lease_acquire — atomic CAS acquire. Never blocks: a
-- held, unexpired lease simply fails the WHERE clause and the statement
-- affects zero rows (no error) -> returns false immediately.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."corpus_writer_fence_lease_acquire"(
    "p_holder_token" "uuid",
    "p_holder" "text" DEFAULT NULL::"text",
    "p_ttl_seconds" integer DEFAULT 3600
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_fence_name text := public._corpus_writer_fence_lease_name();
  v_acquired   boolean;
BEGIN
  IF p_holder_token IS NULL THEN
    RAISE EXCEPTION 'corpus_writer_fence_lease_acquire: p_holder_token must not be NULL — fencing-token semantics require every acquire to carry a caller-generated token so a later release can be verified against the CURRENT holder, not just "whoever is asking"';
  END IF;

  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RAISE EXCEPTION 'corpus_writer_fence_lease_acquire: p_ttl_seconds must be a positive integer (got %)', p_ttl_seconds;
  END IF;

  INSERT INTO public.corpus_writer_fence_lease
    (fence_name, holder_token, holder_label, acquired_at, expires_at)
  VALUES
    (v_fence_name, p_holder_token, p_holder, now(), now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (fence_name) DO UPDATE
    SET holder_token = EXCLUDED.holder_token,
        holder_label = EXCLUDED.holder_label,
        acquired_at  = EXCLUDED.acquired_at,
        expires_at   = EXCLUDED.expires_at
    WHERE public.corpus_writer_fence_lease.expires_at < now()
  RETURNING true INTO v_acquired;

  v_acquired := COALESCE(v_acquired, false);

  IF v_acquired THEN
    RAISE LOG 'corpus_writer_fence_lease_acquire: ACQUIRED by % (token %, fence %, ttl %s)',
      COALESCE(p_holder, 'unnamed'), p_holder_token, v_fence_name, p_ttl_seconds;
  ELSE
    RAISE LOG 'corpus_writer_fence_lease_acquire: BUSY, refused % (fence %)',
      COALESCE(p_holder, 'unnamed'), v_fence_name;
  END IF;

  RETURN v_acquired;
END;
$$;

ALTER FUNCTION "public"."corpus_writer_fence_lease_acquire"("uuid", "text", integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."corpus_writer_fence_lease_acquire"("uuid", "text", integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_acquire"("uuid", "text", integer) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_acquire"("uuid", "text", integer) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_acquire"("uuid", "text", integer) TO "service_role";

COMMENT ON FUNCTION "public"."corpus_writer_fence_lease_acquire"("uuid", "text", integer) IS 'ID-138 {138.9} REDESIGN (S445) — TECH.md §2.6 R(ops), §3.4 O. Pooling-agnostic row-based lease acquire for the FIVE corpus writers (write-back {138.12}, upload {138.13}, pull-sync {138.14} incl. the cocoindex walk, id-45 {45.7} operator bulk-load). Atomic INSERT...ON CONFLICT...WHERE CAS — Postgres row-locks the conflicting key during the check, so concurrent callers on ANY connection/session (pooled PostgREST or direct asyncpg) serialise correctly; never blocks (a held+unexpired lease is a zero-row no-op, returned as false). p_holder_token is REQUIRED (fencing-token semantics — see migration header). Supersedes corpus_writer_fence_try_acquire (DEPRECATED — session-scoped advisory lock, not exclusive through pooled PostgREST, S445).';

-- ---------------------------------------------------------------------------
-- corpus_writer_fence_lease_release — releases ONLY if p_holder_token
-- matches the CURRENT row (fencing-token semantics: a stale holder's
-- release is a silent no-op, never able to release someone else's lease).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."corpus_writer_fence_lease_release"(
    "p_holder_token" "uuid",
    "p_holder" "text" DEFAULT NULL::"text"
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_fence_name text := public._corpus_writer_fence_lease_name();
  v_released   boolean;
BEGIN
  IF p_holder_token IS NULL THEN
    RAISE EXCEPTION 'corpus_writer_fence_lease_release: p_holder_token must not be NULL';
  END IF;

  DELETE FROM public.corpus_writer_fence_lease
  WHERE fence_name = v_fence_name
    AND holder_token = p_holder_token
  RETURNING true INTO v_released;

  v_released := COALESCE(v_released, false);

  IF v_released THEN
    RAISE LOG 'corpus_writer_fence_lease_release: RELEASED by % (token %, fence %)',
      COALESCE(p_holder, 'unnamed'), p_holder_token, v_fence_name;
  ELSE
    RAISE WARNING 'corpus_writer_fence_lease_release: NOT HELD by token % for % (fence %) — token mismatch (a NEWER holder now owns the lease) or the lease already expired/was never acquired; this is EXPECTED for a stale/crashed holder and is never a hard failure — see migration header fencing-token semantics',
      p_holder_token, COALESCE(p_holder, 'unnamed'), v_fence_name;
  END IF;

  RETURN v_released;
END;
$$;

ALTER FUNCTION "public"."corpus_writer_fence_lease_release"("uuid", "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."corpus_writer_fence_lease_release"("uuid", "text") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_release"("uuid", "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_release"("uuid", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_release"("uuid", "text") TO "service_role";

COMMENT ON FUNCTION "public"."corpus_writer_fence_lease_release"("uuid", "text") IS 'ID-138 {138.9} REDESIGN (S445) — TECH.md §2.6 R(ops), §3.4 O. Releases the corpus writer-fence lease iff p_holder_token matches the row''s CURRENT holder_token (fencing-token semantics — a stale/superseded holder''s release is a silent no-op, logged as a WARNING, never a hard failure). Supersedes corpus_writer_fence_release (DEPRECATED — session-scoped advisory unlock, S445).';

-- ---------------------------------------------------------------------------
-- api schema wrappers (DR-032 — companion exposure ships in the SAME
-- migration as the public fn; PostgREST resolves `.rpc()` to `api.<fn>`,
-- never `public.<fn>` directly, per config.toml `schemas = ["api"]"` and the
-- precedent set by 20260703210000_id138_api_rpc_wrappers.sql).
-- ---------------------------------------------------------------------------
CREATE FUNCTION api.corpus_writer_fence_lease_acquire(p_holder_token uuid, p_holder text DEFAULT NULL::text, p_ttl_seconds integer DEFAULT 3600)
  RETURNS boolean
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.corpus_writer_fence_lease_acquire(p_holder_token => p_holder_token, p_holder => p_holder, p_ttl_seconds => p_ttl_seconds);
$api$;
REVOKE EXECUTE ON FUNCTION api.corpus_writer_fence_lease_acquire(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.corpus_writer_fence_lease_acquire(uuid, text, integer) TO authenticated, service_role;

CREATE FUNCTION api.corpus_writer_fence_lease_release(p_holder_token uuid, p_holder text DEFAULT NULL::text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.corpus_writer_fence_lease_release(p_holder_token => p_holder_token, p_holder => p_holder);
$api$;
REVOKE EXECUTE ON FUNCTION api.corpus_writer_fence_lease_release(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.corpus_writer_fence_lease_release(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Deprecation markers on the SUPERSEDED advisory-lock functions (NOT
-- dropped — see migration header "OLD ADVISORY-LOCK FUNCTIONS" note).
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION "public"."corpus_writer_fence_try_acquire"("text") IS 'DEPRECATED (S445, {138.9} REDESIGN — see 20260704120000_id138_writer_fence_lease.sql): pg_try_advisory_lock is SESSION-scoped and therefore NOT mutually exclusive through pooled PostgREST connections — empirically confirmed live on staging (two "concurrent" .rpc() acquire calls landed on the SAME pooled backend session, where pg_try_advisory_lock is reentrant, so BOTH returned true). Superseded by corpus_writer_fence_lease_acquire (row-based holder-token lease, pooling-agnostic). DO NOT call this function for new code — kept, not dropped, pending a dedicated post-bake cleanup migration.';

COMMENT ON FUNCTION "public"."corpus_writer_fence_release"("text") IS 'DEPRECATED (S445, {138.9} REDESIGN — see 20260704120000_id138_writer_fence_lease.sql): session-scoped pg_advisory_unlock, superseded by corpus_writer_fence_lease_release (fencing-token release, pooling-agnostic). DO NOT call this function for new code — kept, not dropped, pending a dedicated post-bake cleanup migration.';

COMMENT ON FUNCTION api.corpus_writer_fence_try_acquire(text) IS 'DEPRECATED (S445, {138.9} REDESIGN): wraps the now-deprecated public.corpus_writer_fence_try_acquire. Use api.corpus_writer_fence_lease_acquire instead. Kept, not dropped — see 20260704120000_id138_writer_fence_lease.sql.';

COMMENT ON FUNCTION api.corpus_writer_fence_release(text) IS 'DEPRECATED (S445, {138.9} REDESIGN): wraps the now-deprecated public.corpus_writer_fence_release. Use api.corpus_writer_fence_lease_release instead. Kept, not dropped — see 20260704120000_id138_writer_fence_lease.sql.';

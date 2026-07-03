-- ID-138 {138.9} — cross-language writer-fence barrier primitive
-- TECH.md §2.6 R(ops) + §3.4 O (writer fencing); PLAN.md §2 ("Writer fencing
-- is a shared cross-language primitive — {138.9}: pg advisory-lock RPC + TS
-- + Python helpers"). S443 seam-correction: the fifth writer is id-45's
-- ({45.7}) operator bulk-load, NOT "ID-69" (id-69 stays closed; every "ID-69"
-- reference in TECH.md/PLAN.md reads as id-45-owned per the ratification
-- record, TECH.md §9).
--
-- FIVE bucket-or-volume writers must never interleave a corpus write:
-- write-back ({138.12}), upload ({138.13}), pull-sync ({138.14} — the
-- cocoindex incremental walk runs UNDER the pull-sync fence hold, no
-- separate acquisition), and the id-45 ({45.7}) operator bulk-load. This
-- migration is the SHARED primitive all four+one acquire; wiring each
-- writer's acquisition is that writer's own Subtask (this migration only
-- builds the barrier).
--
-- WHY A SINGLE GLOBAL DOMAIN KEY (not per-source-document): the hazard this
-- fences is bucket/volume-level interleaving (two writers racing on the
-- SAME on-disk LMDB engine store / bucket namespace), not a per-row
-- contention the DB's own row locks already serialise. One fixed key
-- ("the corpus-writer domain") is therefore correct — every writer contends
-- for the SAME barrier, over the whole corpus, regardless of which source
-- document it is touching.
--
-- WHY TRY-SEMANTICS (pg_try_advisory_lock), NEVER BLOCKING
-- (pg_advisory_lock): a blocking lock over a stateless HTTP RPC call (the
-- TS leg goes via supabase-js .rpc() -> PostgREST) would hold a PostgREST
-- backend connection PARKED for the whole wait — under any real contention
-- that exhausts PostgREST's connection pool fast, and a stuck writer process
-- (crash before release) would then hang every OTHER writer indefinitely
-- with no visible symptom beyond "requests time out". Try-semantics makes
-- "someone else is writing" an immediate, loud `false` the caller must
-- handle (abort or retry-with-backoff in its OWN orchestration) rather than
-- a silent hang — the brief's explicit instruction, and the only sound
-- choice given a mixed stateless-HTTP + long-lived-connection caller set.
--
-- KNOWN LIMITATION — PostgREST session affinity (documented here, in
-- lib/corpus/writer-fence.ts, and in the runbook): `pg_advisory_lock` /
-- `pg_advisory_unlock` are SESSION-scoped. supabase-js `.rpc()` calls are
-- mediated by PostgREST, which does NOT guarantee that two separate
-- `.rpc()` invocations (one acquire, a later release) land on the SAME
-- backend Postgres connection. If a release call lands on a different
-- connection than its paired acquire, `corpus_writer_fence_release` returns
-- `false` ("not held by this session") even though the TS caller logically
-- still holds the fence — the advisory lock then stays held on its
-- original connection until PostgREST recycles it. This is a genuine,
-- accepted limitation of building a session-scoped primitive on top of a
-- stateless RPC transport; it does NOT affect the Python leg (the asyncpg
-- caller holds ONE checked-out connection for the whole acquire -> critical
-- section -> release span by construction — see writer_fence.py). Mitigation
-- for the TS leg: keep the acquire -> work -> release window as SHORT as
-- possible (never span a long-running operation across it) and treat a
-- `false` release as a WARNING to investigate, not a hard failure. If
-- staging observes fence "stickiness" under real PostgREST connection
-- churn, the documented follow-up is to convert the TS leg to a lease-row
-- CAS model (a durable row, not a session-scoped OS-level lock) — flagged
-- in the runbook, not built here (this Subtask is the primitive as briefed).
--
-- Authored, NOT applied: apply is an owner-gated coordinated GO (migration
-- #5 overall / #4 of the id138 serial after M1-M4 — {138.5} -> {138.6} ->
-- {138.7} -> {138.9}). No db push, no types regen in this Subtask.
--
-- UK English throughout (DD/MM/YYYY). Authored 03/07/2026.

-- ---------------------------------------------------------------------------
-- Private helper — single source of truth for the domain key so acquire and
-- release can never drift onto different keys. Underscore-prefixed per the
-- existing _test_* / _source_document_cascade_erase convention: REVOKE ALL
-- FROM PUBLIC only (no anon/authenticated grant needed — it is only ever
-- called from within the two SECURITY DEFINER functions below, which run as
-- their owner `postgres`).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."_corpus_writer_fence_key"()
    RETURNS bigint
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  -- hashtext() is deterministic for a fixed input within one running
  -- instance (all callers hitting the SAME database agree on the SAME key);
  -- it need not be stable ACROSS Postgres major versions, only within one.
  SELECT hashtext('id138_corpus_writer_fence')::bigint;
$$;

ALTER FUNCTION "public"."_corpus_writer_fence_key"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."_corpus_writer_fence_key"() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- corpus_writer_fence_try_acquire — never blocks; returns false if another
-- writer already holds the fence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."corpus_writer_fence_try_acquire"(
    "p_holder" "text" DEFAULT NULL::"text"
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_key      bigint := public._corpus_writer_fence_key();
  v_acquired boolean;
BEGIN
  SELECT pg_try_advisory_lock(v_key) INTO v_acquired;

  IF v_acquired THEN
    RAISE LOG 'corpus_writer_fence_try_acquire: ACQUIRED by % (key %)',
      COALESCE(p_holder, 'unnamed'), v_key;
  ELSE
    RAISE LOG 'corpus_writer_fence_try_acquire: BUSY, refused % (key %)',
      COALESCE(p_holder, 'unnamed'), v_key;
  END IF;

  RETURN v_acquired;
END;
$$;

ALTER FUNCTION "public"."corpus_writer_fence_try_acquire"("text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."corpus_writer_fence_try_acquire"("text") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."corpus_writer_fence_try_acquire"("text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."corpus_writer_fence_try_acquire"("text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."corpus_writer_fence_try_acquire"("text") TO "service_role";

COMMENT ON FUNCTION "public"."corpus_writer_fence_try_acquire"("text") IS 'ID-138 {138.9} — TECH.md §2.6 R(ops), §3.4 O. Try-semantics mutual-exclusion barrier for the FIVE corpus writers (write-back {138.12}, upload {138.13}, pull-sync {138.14} incl. the cocoindex walk, id-45 {45.7} operator bulk-load). Never blocks: returns false immediately if another writer holds the fence (see file header for the try-vs-block rationale and the PostgREST session-affinity known limitation on the TS release path). p_holder is an optional caller label logged via RAISE LOG for observability only — it plays no role in the lock logic. Callers: lib/corpus/writer-fence.ts (supabase-js .rpc()) and scripts/cocoindex_pipeline/writer_fence.py (asyncpg raw pool, same key via _corpus_writer_fence_key()).';

-- ---------------------------------------------------------------------------
-- corpus_writer_fence_release — releases the fence on the CALLING session.
-- Returns false if this session did not hold it (expected outcome under the
-- PostgREST session-affinity caveat for TS callers — see file header).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."corpus_writer_fence_release"(
    "p_holder" "text" DEFAULT NULL::"text"
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_key      bigint := public._corpus_writer_fence_key();
  v_released boolean;
BEGIN
  SELECT pg_advisory_unlock(v_key) INTO v_released;

  IF v_released THEN
    RAISE LOG 'corpus_writer_fence_release: RELEASED by % (key %)',
      COALESCE(p_holder, 'unnamed'), v_key;
  ELSE
    RAISE WARNING 'corpus_writer_fence_release: NOT HELD by this session for % (key %) — see PostgREST session-affinity caveat, 20260703160400_id138_writer_fence.sql header',
      COALESCE(p_holder, 'unnamed'), v_key;
  END IF;

  RETURN v_released;
END;
$$;

ALTER FUNCTION "public"."corpus_writer_fence_release"("text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."corpus_writer_fence_release"("text") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."corpus_writer_fence_release"("text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."corpus_writer_fence_release"("text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."corpus_writer_fence_release"("text") TO "service_role";

COMMENT ON FUNCTION "public"."corpus_writer_fence_release"("text") IS 'ID-138 {138.9} — TECH.md §2.6 R(ops), §3.4 O. Releases the writer-fence advisory lock held by the CALLING session. Returns false if this session never held it — for the Python leg (single held asyncpg connection across acquire/release) this only happens on a genuine caller bug; for the TS/PostgREST leg it is a KNOWN, documented possibility (session affinity is not guaranteed across separate .rpc() calls, see file header) and callers must treat false as a warning to investigate, not assume the fence is unheld elsewhere. p_holder is an optional caller label logged via RAISE LOG/WARNING for observability only.';

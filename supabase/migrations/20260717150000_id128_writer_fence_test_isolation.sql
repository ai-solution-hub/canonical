-- ID-128 {128.20} — writer-fence-lease test isolation: optional p_fence_name
-- so integration tests can operate on a test-scoped row instead of the
-- SHARED production fence row.
--
-- WHY THIS MIGRATION EXISTS — S461 EMPIRICAL FINDING (task-executor,
-- CI run 29147882410, reproduced locally 2x): __tests__/integration/
-- id138-writer-fence.integration.test.ts asserted exclusive-acquire
-- semantics DIRECTLY against corpus_writer_fence_lease_acquire/_release —
-- the SAME shared production fence row keyed by
-- public._corpus_writer_fence_lease_name() ('id138_corpus_writer_fence')
-- that every real corpus writer (pull-sync, write-back, upload, id-45
-- bulk-load, cocoindex-nightly) also contends for. Any real writer holding
-- the lease at test time makes the test's exclusivity assertions fail
-- spuriously — the RPC itself was confirmed working exactly as designed
-- (takeover WHERE expires_at < now() verified live); there was no
-- production regression, just a racy test sharing a production resource.
--
-- FIX SHAPE ADJUDICATED (curator, option (a) of three raised — see ledger
-- {128.20} details for the full adjudication + rejected alternatives (b)
-- poll-acquire-with-takeover-wait, (c) skip/quiet-only the exclusivity
-- tests): add an OPTIONAL p_fence_name parameter to both RPCs, defaulting
-- SERVER-SIDE to the current public._corpus_writer_fence_lease_name()
-- value when omitted, so every existing production caller (TS
-- lib/corpus/writer-fence.ts, Python scripts/cocoindex_pipeline/
-- writer_fence.py) is byte-for-byte unaffected — neither leg passes
-- p_fence_name, so both keep hitting the SAME shared row they always have.
-- The companion test-file change (__tests__/integration/
-- id138-writer-fence.integration.test.ts) passes a per-run-random
-- p_fence_name so its exclusivity assertions operate on an isolated row,
-- fully decoupled from live staging activity.
--
-- WHY DROP + CREATE, NOT CREATE OR REPLACE: PostgreSQL's CREATE OR REPLACE
-- FUNCTION identifies a function by name + INPUT PARAMETER TYPE LIST; it
-- explicitly does NOT allow widening that type list in place — attempting
-- to add a new trailing parameter (even with a DEFAULT) via CREATE OR
-- REPLACE creates a NEW, DISTINCT overloaded function alongside the old
-- one, not an in-place replacement (verified against current PostgreSQL
-- docs before authoring this migration — see sql-createfunction.html
-- "Notes"). An overload here would be actively dangerous: PostgREST/
-- supabase-js callers resolve `.rpc()` by function NAME through the `api`
-- schema wrapper, and two same-named overloads with different arities
-- sitting in `public` would create exactly the kind of resolution
-- ambiguity this whole fence primitive exists to avoid. This migration
-- therefore explicitly DROPs the old 3-arg (acquire) / 2-arg (release)
-- signatures and CREATEs the new 4-arg / 3-arg signatures under the SAME
-- names, so there is only ever ONE corpus_writer_fence_lease_acquire and
-- ONE corpus_writer_fence_lease_release in existence at any time — old
-- callers passing 3 (resp. 2) positional/named args continue to work
-- unchanged because p_fence_name is trailing and DEFAULT NULL.
--
-- DROP ORDER: the `api.*` SECURITY INVOKER wrappers are LANGUAGE SQL and
-- their bodies are parsed (and dependency-tracked in pg_depend) at CREATE
-- time, so they must be dropped BEFORE the `public.*` functions they call,
-- or the public-function DROP fails with a dependency error.
--
-- p_fence_name RESOLUTION: `v_fence_name := COALESCE(p_fence_name,
-- public._corpus_writer_fence_lease_name())` — omitted/NULL keeps today's
-- exact behaviour (the one fixed production domain); a caller-supplied
-- value (e.g. a test-run UUID) targets an entirely separate row via the
-- SAME `fence_name text PRIMARY KEY` CAS mechanism described in
-- 20260704140000_id138_writer_fence_lease.sql — no new table, no new
-- concurrency primitive, just a wider key space on the existing row store.
--
-- SECURITY: p_fence_name is caller-supplied free text written into a
-- SECURITY DEFINER function's own control-plane table (never interpolated
-- into dynamic SQL — it flows through parameterised INSERT/DELETE
-- predicates only), so there is no injection surface; grants/RLS/REVOKE
-- posture on corpus_writer_fence_lease and both function pairs are
-- unchanged from 20260704140000_id138_writer_fence_lease.sql (RLS enabled,
-- no policies, REVOKE ALL FROM PUBLIC/anon/authenticated/service_role on
-- the table itself; EXECUTE on the functions stays authenticated +
-- service_role only, anon still excluded).
--
-- Authored AND applied via `supabase db push` in this Subtask (unlike the
-- "authored, not applied" precedent of 20260704140000 — that one was
-- gated on a coordinated multi-leg GO; this one is a narrow, additive,
-- backward-compatible widening with no caller re-point required, so there
-- is nothing to coordinate).
--
-- Types regen: deliberately DEFERRED, not part of this Subtask's file
-- ownership (matches the existing tracked RPC-Args-drift class, see
-- backlog bl-426 precedent) — the new p_fence_name arg is never referenced
-- by any typed production caller, and the rewritten integration test
-- already goes through the pre-existing `SupabaseClient<any>` escape hatch
-- for this file, so no caller needs the regenerated type to compile.
--
-- UK English throughout (DD/MM/YYYY). Authored 17/07/2026.

SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Drop the api.* wrappers first (dependency: LANGUAGE SQL bodies are
-- dependency-tracked against the public.* functions they call).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.corpus_writer_fence_lease_acquire(uuid, text, integer);
DROP FUNCTION IF EXISTS api.corpus_writer_fence_lease_release(uuid, text);

-- ---------------------------------------------------------------------------
-- Drop the old public.* signatures.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.corpus_writer_fence_lease_acquire(uuid, text, integer);
DROP FUNCTION IF EXISTS public.corpus_writer_fence_lease_release(uuid, text);

-- ---------------------------------------------------------------------------
-- corpus_writer_fence_lease_acquire — widened: optional p_fence_name,
-- defaulting to the fixed production domain. Body otherwise identical to
-- 20260704140000_id138_writer_fence_lease.sql.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "public"."corpus_writer_fence_lease_acquire"(
    "p_holder_token" "uuid",
    "p_holder" "text" DEFAULT NULL::"text",
    "p_ttl_seconds" integer DEFAULT 3600,
    "p_fence_name" "text" DEFAULT NULL::"text"
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_fence_name text := COALESCE(p_fence_name, public._corpus_writer_fence_lease_name());
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

ALTER FUNCTION "public"."corpus_writer_fence_lease_acquire"("uuid", "text", integer, "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."corpus_writer_fence_lease_acquire"("uuid", "text", integer, "text") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_acquire"("uuid", "text", integer, "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_acquire"("uuid", "text", integer, "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_acquire"("uuid", "text", integer, "text") TO "service_role";

COMMENT ON FUNCTION "public"."corpus_writer_fence_lease_acquire"("uuid", "text", integer, "text") IS 'ID-128 {128.20} (S461) — widened from 20260704140000_id138_writer_fence_lease.sql with an OPTIONAL p_fence_name, defaulting to public._corpus_writer_fence_lease_name() when omitted/NULL so every existing production caller (write-back {138.12}, upload {138.13}, pull-sync {138.14}, id-45 {45.7} bulk-load, cocoindex-nightly) is unaffected. A caller-supplied p_fence_name (e.g. a test-run UUID) targets an isolated row via the same atomic INSERT...ON CONFLICT...WHERE CAS. p_holder_token still REQUIRED (fencing-token semantics — see 20260704140000 migration header).';

-- ---------------------------------------------------------------------------
-- corpus_writer_fence_lease_release — widened symmetrically.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "public"."corpus_writer_fence_lease_release"(
    "p_holder_token" "uuid",
    "p_holder" "text" DEFAULT NULL::"text",
    "p_fence_name" "text" DEFAULT NULL::"text"
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_fence_name text := COALESCE(p_fence_name, public._corpus_writer_fence_lease_name());
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
    RAISE WARNING 'corpus_writer_fence_lease_release: NOT HELD by token % for % (fence %) — token mismatch (a NEWER holder now owns the lease) or the lease already expired/was never acquired; this is EXPECTED for a stale/crashed holder and is never a hard failure — see 20260704140000 migration header fencing-token semantics',
      p_holder_token, COALESCE(p_holder, 'unnamed'), v_fence_name;
  END IF;

  RETURN v_released;
END;
$$;

ALTER FUNCTION "public"."corpus_writer_fence_lease_release"("uuid", "text", "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."corpus_writer_fence_lease_release"("uuid", "text", "text") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_release"("uuid", "text", "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_release"("uuid", "text", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_release"("uuid", "text", "text") TO "service_role";

COMMENT ON FUNCTION "public"."corpus_writer_fence_lease_release"("uuid", "text", "text") IS 'ID-128 {128.20} (S461) — widened from 20260704140000_id138_writer_fence_lease.sql with an OPTIONAL p_fence_name, defaulting to public._corpus_writer_fence_lease_name() when omitted/NULL. Releases iff p_holder_token matches the CURRENT row for that fence (fencing-token semantics — a stale/superseded holder''s release is a silent no-op, logged as a WARNING, never a hard failure).';

-- ---------------------------------------------------------------------------
-- api schema wrappers (DR-032 — companion exposure ships in the SAME
-- migration; PostgREST resolves `.rpc()` to `api.<fn>`, never
-- `public.<fn>` directly, per config.toml `schemas = ["api"]` and the
-- precedent set by 20260703210000_id138_api_rpc_wrappers.sql). Recreated
-- (not CREATE OR REPLACE) for the same "DROP + CREATE is the only safe way
-- to widen an existing signature" reason as the public functions above.
-- ---------------------------------------------------------------------------
CREATE FUNCTION api.corpus_writer_fence_lease_acquire(p_holder_token uuid, p_holder text DEFAULT NULL::text, p_ttl_seconds integer DEFAULT 3600, p_fence_name text DEFAULT NULL::text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.corpus_writer_fence_lease_acquire(p_holder_token => p_holder_token, p_holder => p_holder, p_ttl_seconds => p_ttl_seconds, p_fence_name => p_fence_name);
$api$;
REVOKE EXECUTE ON FUNCTION api.corpus_writer_fence_lease_acquire(uuid, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.corpus_writer_fence_lease_acquire(uuid, text, integer, text) TO authenticated, service_role;

CREATE FUNCTION api.corpus_writer_fence_lease_release(p_holder_token uuid, p_holder text DEFAULT NULL::text, p_fence_name text DEFAULT NULL::text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.corpus_writer_fence_lease_release(p_holder_token => p_holder_token, p_holder => p_holder, p_fence_name => p_fence_name);
$api$;
REVOKE EXECUTE ON FUNCTION api.corpus_writer_fence_lease_release(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.corpus_writer_fence_lease_release(uuid, text, text) TO authenticated, service_role;

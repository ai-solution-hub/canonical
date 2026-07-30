-- id-405 — pin-stamp write collapse: `pin_entity_mentions`, a single-statement
-- jsonb_set RPC replacing the merge route's read + per-row UPDATE loop.
--
-- WHAT THIS REPLACES. `app/api/entities/merge/route.ts` (id-400 Inv-9 co-mint)
-- stamps `metadata.curation_pinned = true` on the surviving merge-winner rows so
-- the ingestion walk can never revert an admin merge (census #41 failure #1).
-- Until now it did that by SELECTing up to 1000 surviving mentions and issuing
-- one UPDATE per row. Three consequences this migration removes:
--
--   1. NOT ATOMIC — a fault mid-loop leaves a PARTIALLY pinned merge winner:
--      some surviving rows protected, others still revertible by the next walk.
--   2. NOT AUTHORITATIVE — `mentions_pinned` counted successful UPDATEs against a
--      read capped at 1000 rows, so a >1000-row winner silently under-reported
--      AND under-pinned.
--   3. UP TO 1000 ROUND TRIPS for one curation action.
--
-- After this migration the route makes ONE call and the returned count is the
-- statement's own ROW_COUNT — authoritative by construction, uncapped, and
-- all-or-nothing (a single UPDATE either commits every row or none).
--
-- ── EFFECTIVE-TYPE PREDICATE (a correctness fix, not just a rewrite) ─────────
--
-- The predicate below matches on COALESCE(entity_type_override, entity_type),
-- the codebase's standing "effective type" convention (get_entity_summary and
-- merge_entities' own dedup PARTITION BY both use it). The route's loop matched
-- the BASE `entity_type` column instead, which is the wrong column for exactly
-- the rows the pin exists to protect: `merge_entities` repoints a merged row by
-- setting `canonical_name = p_target_name` and `entity_type_override =
-- p_entity_type` — it NEVER rewrites the base `entity_type`. So any merge whose
-- target type differs from a source row's raw extracted type left that row
-- UNPINNED, i.e. still revertible on the next walk, while the response reported
-- a pin count that looked fine.
--
-- This is demonstrated, not hypothesised: the ID-70 integration fixture
-- (__tests__/integration/cocoindex/merge-entities-typed-return.integration.test.ts)
-- merges rows whose raw types are 'organisation'/'certification' into target
-- type 'framework'. Base-type matching pins 0 of the 2 survivors; effective-type
-- matching pins both.
--
-- Post-merge the two predicates coincide for every row the route pins (the route
-- passes the target itself inside p_source_names, so every surviving row under
-- the target carries entity_type_override = p_entity_type), which is what makes
-- the count authoritative rather than merely larger.
--
-- ── SECURITY POSTURE — matched to `merge_entities` (the RPC it follows) ──────
--
--   * SECURITY INVOKER (no DEFINER clause; `merge_entities` is prosecdef=false).
--     RLS therefore still adjudicates: entity_mentions' UPDATE policy is
--     `get_user_role() = ANY('{admin,editor}')` for `authenticated`, and the
--     service client (the production caller, admin-gated at the route) bypasses
--     RLS as it already does for the merge itself. The RPC grants NO reach that
--     a direct UPDATE on the table did not already grant.
--   * SET search_path = public, extensions (ID-115 discipline).
--   * GRANT EXECUTE TO authenticated, service_role — the same pair
--     `merge_entities` carries. No REVOKE FROM PUBLIC is hand-written: the
--     `dr035_born_locked_functions` event trigger
--     (20260707190500_id61_dr035_default_privileges.sql) strips PUBLIC/anon
--     EXECUTE from every new public/api function automatically (DR-035 {61.14}).
--   * The `api.*` SECURITY INVOKER wrapper ships in THIS migration (DR-032):
--     every supabase-js client threads DB_OPTION, so `.rpc()` resolves through
--     `api.<fn>` only — a public-only function would 404 at the route.
--     `pin_entity_mentions` is added to SURFACE_RPCS in
--     scripts/generate-api-views.ts in the same PR so the next whole-surface
--     regen reproduces this wrapper instead of leaving it a side channel
--     (the id138 hand-authored-wrapper lesson).
--
-- ── BACKFILL / STAMP ────────────────────────────────────────────────────────
--
-- No backfill (DR-093, pre-launch): rows already pinned by the old loop keep
-- their marker — the jsonb_set is idempotent over them — and the effective-type
-- gap is a go-forward fix on an internal dogfooding corpus (Platform staging
-- holds 9 entity_mentions rows, 0 pinned, 0 type-overridden at authoring time).
--
-- STAMP (DR-081b — allocated against the REMOTE applied set, non-round,
-- time-anchored): 20260730150743 is strictly greater than every version in both
-- sets checked at authoring time —
--   * local `supabase/migrations/` max = 20260729210500
--   * Platform staging remote      max = 20260729210500
-- Platform prod application is deferred (the merge route's pin step is a
-- staging/dogfooding path; apply with the next prod migration batch).
--
-- UK English throughout (DD/MM/YYYY). Authored 30/07/2026 (S515).

SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- public.pin_entity_mentions — ONE set-based UPDATE; returns the pinned count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."pin_entity_mentions"(
    "p_canonical_name" "text",
    "p_entity_type" "text"
) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_pinned integer := 0;
BEGIN
  -- Fail loud on a degenerate pair rather than silently pinning nothing and
  -- reporting an honest-looking 0 (mirrors merge_entities' input validation).
  IF p_canonical_name IS NULL OR p_canonical_name = '' THEN
    RAISE EXCEPTION 'Canonical name must not be empty';
  END IF;

  IF p_entity_type IS NULL OR p_entity_type = '' THEN
    RAISE EXCEPTION 'Entity type must not be empty';
  END IF;

  -- jsonb_set with create_missing = true: adds `curation_pinned` when absent,
  -- overwrites it when present, and preserves every other metadata key (the
  -- object-spread semantics the route's loop had). COALESCE covers the
  -- NULL-metadata row (the column is nullable, DEFAULT '{}').
  UPDATE entity_mentions em
  SET metadata = jsonb_set(
        COALESCE(em.metadata, '{}'::jsonb),
        '{curation_pinned}',
        'true'::jsonb,
        true
      )
  WHERE em.canonical_name = p_canonical_name
    AND COALESCE(em.entity_type_override, em.entity_type) = p_entity_type;

  GET DIAGNOSTICS v_pinned = ROW_COUNT;

  RETURN v_pinned;
END;
$$;

ALTER FUNCTION "public"."pin_entity_mentions"("text", "text") OWNER TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."pin_entity_mentions"("text", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."pin_entity_mentions"("text", "text") TO "service_role";

COMMENT ON FUNCTION "public"."pin_entity_mentions"("text", "text") IS 'id-405 — stamps metadata.curation_pinned = true on every entity_mentions row of one (canonical_name, EFFECTIVE entity type) pair in a single UPDATE, returning the row count. Replaces the read + per-row-UPDATE loop in app/api/entities/merge/route.ts: atomic (no partial pin), uncapped (the old read stopped at 1000), and count-authoritative. Effective type = COALESCE(entity_type_override, entity_type) because merge_entities repoints a merged row via entity_type_override and never rewrites the base entity_type — matching the base column left type-overridden survivors unpinned. The pin is honoured by the ingestion walk at three sites (stage_5.py write-back domain + cross-op survivor rule, flow.py em-declare carry-forward) — id-400 Inv-9.';

-- ---------------------------------------------------------------------------
-- api.pin_entity_mentions — SECURITY INVOKER wrapper, same migration (DR-032).
-- Mirrors scripts/generate-api-views.ts's emitted shape.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.pin_entity_mentions(p_canonical_name text, p_entity_type text);

CREATE FUNCTION "api"."pin_entity_mentions"(
    "p_canonical_name" "text",
    "p_entity_type" "text"
) RETURNS integer
    LANGUAGE "sql" SECURITY INVOKER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.pin_entity_mentions(
    p_canonical_name => p_canonical_name,
    p_entity_type => p_entity_type
  );
$$;

ALTER FUNCTION "api"."pin_entity_mentions"("text", "text") OWNER TO "postgres";

GRANT EXECUTE ON FUNCTION "api"."pin_entity_mentions"("text", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "api"."pin_entity_mentions"("text", "text") TO "service_role";

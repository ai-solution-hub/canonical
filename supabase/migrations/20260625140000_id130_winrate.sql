-- ID-130.7 — Win-rate engine rewrite (T-B7 win-rate half + T-B24 bid_outcome retire).
-- THE RISKIEST migration step: re-threads BOTH citation win-rate functions from the
-- decommissioned workspaces.domain_metadata->>'outcome' path onto the FORM altitude.
--
-- Depends on {130.5} spine (20260625120000): form_outcome_types CV (stage /
-- counts_toward_win_rate) + form_templates.outcome FK + form_questions.form_template_id FK.
-- Depends on {130.6} rollup fn (20260625130000) for the engagement-outcome derivation that
-- the parity test asserts (overall_outcome='lost' on a not_shortlisted PSQ).
--
-- BOUNDARY: win-rate engine rewrite ONLY. NO data backfill of ft.outcome for the 12 live
-- engagements ({130.8}); NO api.* view / generated-types regen ({130.9}). Until {130.8}
-- backfills ft.outcome the live output is VACUOUS (all-NULL) — the synthetic parity test
-- ({130.7} deliverable) is THIS subtask's gate, not a live snapshot.
--
-- NEW JOIN (both fns): citations cc → form_responses br (cc.citing_form_response_id)
--   → form_questions fq (br.question_id) → form_templates ft (fq.form_template_id),
--   LEFT JOIN form_outcome_types fot ON fot.key = ft.outcome.
-- The win-rate denominator is the CV flag fot.counts_toward_win_rate = true (won/lost
-- final-award by construction — the CV encodes the ratified {itt,tender,bid,rfp} set);
-- NEVER an inlined `form_type IN (...)` list. A separate shortlist pass-rate aggregate
-- (fot.stage='shortlist', numerator ft.outcome='shortlisted') is added.
--
-- bid_outcome alias RETIRED (T-B24) — the CTE now reads ft.outcome directly.
-- All column refs qualified (Unit-E 42P13 param-collision learning).

-- ============================================================================
-- PART 1 — public.get_content_win_rate (per-item). RETURN SHAPE UNCHANGED.
-- The 5 output columns (total/winning/losing/pending/win_rate) are identical, so a plain
-- CREATE OR REPLACE suffices — NO DROP-dance. Only the BODY re-threads to the form altitude
-- and the win-rate denominator moves from a literal outcome IN ('won','lost') match to the
-- CV flag fot.counts_toward_win_rate = true. Two consumers (lib/mcp/formatters/procurements.ts
-- formatContentEffectiveness; app/api/items/[id]/effectiveness/route.ts) read only these 5
-- columns and reference no internal alias — they are unaffected.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid")
    RETURNS TABLE("total_citations" bigint, "winning_citations" bigint, "losing_citations" bigint, "pending_citations" bigint, "win_rate" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  WITH "citation_outcomes" AS (
    SELECT
      "cc"."cited_content_item_id",
      "cc"."citing_form_response_id",
      "ft"."outcome"                    AS "outcome",
      "fot"."counts_toward_win_rate"    AS "counts_toward_win_rate"
    FROM "public"."citations" "cc"
    JOIN "public"."form_responses" "br" ON "br"."id" = "cc"."citing_form_response_id"
    JOIN "public"."form_questions" "fq" ON "fq"."id" = "br"."question_id"
    JOIN "public"."form_templates" "ft" ON "ft"."id" = "fq"."form_template_id"
    LEFT JOIN "public"."form_outcome_types" "fot" ON "fot"."key" = "ft"."outcome"
    WHERE "cc"."cited_kind" = 'content_item'
      AND "cc"."cited_content_item_id" = "p_content_item_id"
  )
  SELECT
    COUNT(*)::bigint AS "total_citations",
    COUNT(*) FILTER (WHERE "co"."outcome" = 'won')::bigint AS "winning_citations",
    COUNT(*) FILTER (WHERE "co"."outcome" = 'lost')::bigint AS "losing_citations",
    -- pending = NOT in the win-rate denominator (no counts_toward_win_rate=true outcome yet).
    COUNT(*) FILTER (WHERE COALESCE("co"."counts_toward_win_rate", false) = false)::bigint AS "pending_citations",
    CASE
      WHEN COUNT(*) FILTER (WHERE "co"."counts_toward_win_rate" = true) > 0 THEN
        ROUND(
          COUNT(*) FILTER (WHERE "co"."outcome" = 'won')::numeric /
          COUNT(*) FILTER (WHERE "co"."counts_toward_win_rate" = true)::numeric,
          2
        )
      ELSE 0
    END AS "win_rate"
  FROM "citation_outcomes" "co";
END;
$$;

ALTER FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") OWNER TO "postgres";

-- Re-emit public grants (CREATE OR REPLACE preserves the existing ACL, but re-stating is
-- idempotent and keeps the least-privilege posture explicit; public is not Data-API-exposed).
REVOKE ALL ON FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") TO "service_role";

COMMENT ON FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") IS 'ID-130 T-B7/T-B24 — per-content-item citation win-rate, re-threaded onto the FORM altitude. CTE joins citations → form_responses → form_questions → form_templates and LEFT JOINs form_outcome_types on ft.outcome; the win-rate denominator is the CV flag counts_toward_win_rate=true (no inlined form_type list). bid_outcome alias retired. Return shape unchanged (total/winning/losing/pending/win_rate).';

-- ============================================================================
-- PART 2 — public.get_aggregate_win_rate_stats (overall + per-domain). 42P13 DROP-DANCE.
-- The RETURNS TABLE GAINS columns (shortlist_total, shortlist_passed, shortlist_pass_rate)
-- → CREATE OR REPLACE CANNOT change a RETURNS TABLE output signature (SQLSTATE 42P13). The
-- api.get_aggregate_win_rate_stats wrapper depends on the public fn, so the ORDER IS LAW:
--   (1) DROP api.get_aggregate_win_rate_stats  (the dependent wrapper, FIRST)
--   (2) DROP FUNCTION public.get_aggregate_win_rate_stats
--   (3) CREATE the new public fn
--   (4) recreate the api.* wrapper
-- Verified (Unit-E 20260624130000 L54) the api wrapper is the SOLE dependent of the public
-- fn — no view / trigger / other function references it — so DROP without CASCADE is clean.
-- ============================================================================
DROP FUNCTION IF EXISTS "api"."get_aggregate_win_rate_stats"();
DROP FUNCTION IF EXISTS "public"."get_aggregate_win_rate_stats"();

CREATE FUNCTION "public"."get_aggregate_win_rate_stats"()
    RETURNS TABLE("scope" "text", "total_citations" bigint, "winning_citations" bigint, "losing_citations" bigint, "pending_citations" bigint, "win_rate" numeric, "unique_items_cited" bigint, "unique_procurements" bigint, "shortlist_total" bigint, "shortlist_passed" bigint, "shortlist_pass_rate" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY

  WITH "citation_detail" AS (
    SELECT
      "ci"."primary_domain",
      "cc"."cited_content_item_id",
      "cc"."citing_form_response_id",
      "ft"."workspace_id",
      "ft"."outcome"                    AS "outcome",
      "fot"."counts_toward_win_rate"    AS "counts_toward_win_rate",
      "fot"."stage"                     AS "outcome_stage"
    FROM "public"."citations" "cc"
    JOIN "public"."content_items" "ci" ON "ci"."id" = "cc"."cited_content_item_id"
    JOIN "public"."form_responses" "br" ON "br"."id" = "cc"."citing_form_response_id"
    JOIN "public"."form_questions" "fq" ON "fq"."id" = "br"."question_id"
    JOIN "public"."form_templates" "ft" ON "ft"."id" = "fq"."form_template_id"
    LEFT JOIN "public"."form_outcome_types" "fot" ON "fot"."key" = "ft"."outcome"
    WHERE "cc"."cited_kind" = 'content_item'
  ),
  "domain_stats" AS (
    SELECT
      "cd"."primary_domain" AS "scope",
      COUNT(*)::bigint AS "total_citations",
      COUNT(*) FILTER (WHERE "cd"."outcome" = 'won')::bigint AS "winning_citations",
      COUNT(*) FILTER (WHERE "cd"."outcome" = 'lost')::bigint AS "losing_citations",
      COUNT(*) FILTER (WHERE COALESCE("cd"."counts_toward_win_rate", false) = false)::bigint AS "pending_citations",
      CASE
        WHEN COUNT(*) FILTER (WHERE "cd"."counts_toward_win_rate" = true) > 0 THEN
          ROUND(
            COUNT(*) FILTER (WHERE "cd"."outcome" = 'won')::numeric /
            COUNT(*) FILTER (WHERE "cd"."counts_toward_win_rate" = true)::numeric,
            2
          )
        ELSE 0
      END AS "win_rate",
      COUNT(DISTINCT "cd"."cited_content_item_id")::bigint AS "unique_items_cited",
      COUNT(DISTINCT "cd"."workspace_id")::bigint AS "unique_procurements",
      -- Separate shortlist pass-rate (stage='shortlist'): total = shortlisted+not_shortlisted,
      -- passed = shortlisted. Excludes final-award citations entirely.
      COUNT(*) FILTER (WHERE "cd"."outcome_stage" = 'shortlist')::bigint AS "shortlist_total",
      COUNT(*) FILTER (WHERE "cd"."outcome" = 'shortlisted')::bigint AS "shortlist_passed",
      CASE
        WHEN COUNT(*) FILTER (WHERE "cd"."outcome_stage" = 'shortlist') > 0 THEN
          ROUND(
            COUNT(*) FILTER (WHERE "cd"."outcome" = 'shortlisted')::numeric /
            COUNT(*) FILTER (WHERE "cd"."outcome_stage" = 'shortlist')::numeric,
            2
          )
        ELSE 0
      END AS "shortlist_pass_rate"
    FROM "citation_detail" "cd"
    GROUP BY "cd"."primary_domain"
  ),
  "overall" AS (
    SELECT
      'overall'::"text" AS "scope",
      COUNT(*)::bigint AS "total_citations",
      COUNT(*) FILTER (WHERE "cd"."outcome" = 'won')::bigint AS "winning_citations",
      COUNT(*) FILTER (WHERE "cd"."outcome" = 'lost')::bigint AS "losing_citations",
      COUNT(*) FILTER (WHERE COALESCE("cd"."counts_toward_win_rate", false) = false)::bigint AS "pending_citations",
      CASE
        WHEN COUNT(*) FILTER (WHERE "cd"."counts_toward_win_rate" = true) > 0 THEN
          ROUND(
            COUNT(*) FILTER (WHERE "cd"."outcome" = 'won')::numeric /
            COUNT(*) FILTER (WHERE "cd"."counts_toward_win_rate" = true)::numeric,
            2
          )
        ELSE 0
      END AS "win_rate",
      COUNT(DISTINCT "cd"."cited_content_item_id")::bigint AS "unique_items_cited",
      COUNT(DISTINCT "cd"."workspace_id")::bigint AS "unique_procurements",
      COUNT(*) FILTER (WHERE "cd"."outcome_stage" = 'shortlist')::bigint AS "shortlist_total",
      COUNT(*) FILTER (WHERE "cd"."outcome" = 'shortlisted')::bigint AS "shortlist_passed",
      CASE
        WHEN COUNT(*) FILTER (WHERE "cd"."outcome_stage" = 'shortlist') > 0 THEN
          ROUND(
            COUNT(*) FILTER (WHERE "cd"."outcome" = 'shortlisted')::numeric /
            COUNT(*) FILTER (WHERE "cd"."outcome_stage" = 'shortlist')::numeric,
            2
          )
        ELSE 0
      END AS "shortlist_pass_rate"
    FROM "citation_detail" "cd"
  )
  SELECT * FROM "overall"
  UNION ALL
  SELECT * FROM "domain_stats"
  ORDER BY "scope";
END;
$$;

ALTER FUNCTION "public"."get_aggregate_win_rate_stats"() OWNER TO "postgres";

-- Re-emit the public grants the DROP cleared (squash baseline L12454-56 / Unit-E L136-38).
REVOKE ALL ON FUNCTION "public"."get_aggregate_win_rate_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_aggregate_win_rate_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_aggregate_win_rate_stats"() TO "service_role";

COMMENT ON FUNCTION "public"."get_aggregate_win_rate_stats"() IS 'ID-130 T-B7/T-B24 — overall + per-domain citation win-rate aggregator, re-threaded onto the FORM altitude. CTE joins citations → form_responses → form_questions → form_templates and LEFT JOINs form_outcome_types on ft.outcome; the win-rate denominator is the CV flag counts_toward_win_rate=true (no inlined form_type list). Adds a separate shortlist pass-rate aggregate (shortlist_total/shortlist_passed/shortlist_pass_rate; stage=shortlist, numerator shortlisted). bid_outcome alias retired. Caller app/api/analytics/win-rate.';

-- Recreate the api wrapper. Mirrors the generate-api-views.ts emitFunction() form VERBATIM
-- (LANGUAGE sql, SECURITY INVOKER, SET search_path = public, extensions; REVOKE EXECUTE FROM
-- PUBLIC; GRANT to the roles the PUBLIC original grants) so {130.9}'s `generate-api-views
-- --check` regenerates this byte-identically. The public fn grants authenticated+service_role
-- (no anon), so the wrapper grants authenticated+service_role only — matching ID-115
-- least-privilege (20260624120000 REVOKE … FROM anon). The api schema IS Data-API-exposed, so
-- the anon REVOKE here is load-bearing (unlike the public fns above).
CREATE FUNCTION "api"."get_aggregate_win_rate_stats"()
  RETURNS TABLE(scope text, total_citations bigint, winning_citations bigint, losing_citations bigint, pending_citations bigint, win_rate numeric, unique_items_cited bigint, unique_procurements bigint, shortlist_total bigint, shortlist_passed bigint, shortlist_pass_rate numeric)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.get_aggregate_win_rate_stats();
$api$;
REVOKE EXECUTE ON FUNCTION "api"."get_aggregate_win_rate_stats"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."get_aggregate_win_rate_stats"() TO authenticated, service_role;

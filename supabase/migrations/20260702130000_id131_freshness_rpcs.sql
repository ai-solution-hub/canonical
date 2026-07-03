-- ID-131 {131.12} G-GOV-FACET-A — freshness/review RPCs over record_lifecycle
-- TECH.md §"recalculate_all_freshness rewrite" (M5, BI-22 — PER-AXIS, D7);
-- §"Function disposition" REWRITE rows (recalculate_all_freshness,
-- get_freshness_breakdown, get_review_breakdown_stats); §"Parallelization
-- G-GOV-FACET". PRODUCT BI-18, BI-19, BI-20, BI-21, BI-22.
--
-- Rewrites the 3 facet-reading/writing RPCs as set-based operations over the
-- `record_lifecycle` governance/freshness facet ({131.6} M1a) instead of the
-- dying `content_items` table. Split from the M5 `id131_search_dedup_freshness_rpc`
-- migration set — this file owns ONLY the freshness/review-breakdown trio (the
-- dedup/search fn rewrites in the same TECH.md M5 row belong to sibling G-*
-- groups, e.g. G-SEARCH/G-DEDUP, not this one).
--
-- PER-AXIS discipline (D7, matches the M1a `record_lifecycle_freshness_axis_chk`):
--   * Freshness/expiry/review-cadence axis is `source_document`-ONLY.
--     `q_a_pairs` carry NO freshness/expiry/review-cadence columns on the facet
--     (the CHECK constraint rejects non-NULL values for any other owner_kind) —
--     `recalculate_all_freshness` and `get_freshness_breakdown` therefore scope
--     to `owner_kind = 'source_document'` and do NOT add q_a_pair owners as a
--     `lifecycle_type = 'evergreen'` set (a stale ledger-details line proposed
--     this; superseded by the ratified D7 per-axis design — see the {131.12}
--     journal correction).
--   * Review/governance axis (`governance_review_status`, `verified_at`, …)
--     spans BOTH owner_kinds (source_document + q_a_pair) — `get_review_breakdown_stats`
--     is rewritten to count across both, joined out to each kind's own
--     `publication_status` column (`source_documents.publication_status` /
--     `q_a_pairs.publication_status`).
--
-- M2 col-rename trap (TECH.md §Migration set row M2): this file does NOT
-- reference any of the M2-renamed extraction-table columns
-- (content_chunks/entity_mentions/entity_relationships/classification_disputes/
-- q_a_extractions `content_item_id`* family -> `source_document_id` family) —
-- the 3 rewritten functions read only `record_lifecycle`, `source_documents`,
-- `q_a_pairs`, and (unchanged) `ingestion_quality_log`. Confirmed by grep: no
-- `content_item_id`/`source_item_id`/`source_content_item_id` literal appears
-- below.
--
-- Known gaps carried forward (documented, not fixed here — out of {131.12}
-- scope; see the {131.12} journal for the full out-of-scope finding list):
--   * `get_review_breakdown_stats` 'flagged' branch still reads
--     `ingestion_quality_log.content_item_id`, which TECH.md's "FK & trigger
--     disposition" section explicitly defers ("Decide at decomposition") and
--     no migration has re-pointed yet — left as-is (will read 0 rows once
--     `content_items` is empty, pending that decision elsewhere).
--   * 'by_source_file' is a permanent empty object: `content_items.source_file`
--     was DROPPED at M3 (BI-11) with no typed-record replacement column.
--   * `by_content_type`/`by_source_document` are `source_document`-only:
--     `q_a_pairs` carries no `content_type` (BI-27, hybrid_search polymorphic
--     UNION table) and is not a "source document" in the by_source_document
--     sense.
--
-- New PL/pgSQL discipline: SET search_path inside every function body;
-- REVOKE/GRANT reissued defensively (fail-closed pattern, matches M1a/M1b —
-- signatures are unchanged so existing grants persist across CREATE OR REPLACE,
-- but grants are reasserted here for auditability). UK English throughout
-- (DD/MM/YYYY). Authored 02/07/2026.

-- ---------------------------------------------------------------------------
-- 1. recalculate_all_freshness() — set-based over record_lifecycle,
--    owner_kind = 'source_document' ONLY (D7). Joined to source_documents for
--    `updated_at` (Finding 3 — SD gained it in M3/{131.9}) and `archived_at`
--    (preserves the original content_items.archived_at IS NULL exclusion).
--    Return shape UNCHANGED (total_count, fresh_count, aging_count,
--    stale_count, expired_count) — callers: app/api/freshness/recalculate-all.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."recalculate_all_freshness"() RETURNS TABLE("total_count" integer, "fresh_count" integer, "aging_count" integer, "stale_count" integer, "expired_count" integer)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_now timestamptz := now();
  v_total int := 0;
  v_fresh int := 0;
  v_aging int := 0;
  v_stale int := 0;
  v_expired int := 0;
BEGIN
  -- Snapshot current freshness before recalculation (source_document owners,
  -- excluding archived owners — mirrors the original content_items.archived_at
  -- IS NULL guard).
  UPDATE record_lifecycle rl
  SET previous_freshness = rl.freshness
  FROM source_documents sd
  WHERE rl.owner_kind = 'source_document'
    AND rl.source_document_id = sd.id
    AND sd.archived_at IS NULL;

  -- bid_discovered: always fresh
  UPDATE record_lifecycle rl
  SET freshness = 'fresh', freshness_checked_at = v_now
  FROM source_documents sd
  WHERE rl.owner_kind = 'source_document'
    AND rl.source_document_id = sd.id
    AND sd.archived_at IS NULL
    AND rl.lifecycle_type = 'bid_discovered'
    AND (rl.freshness IS DISTINCT FROM 'fresh');

  -- date_bound: based on facet expiry_date (soft cold gradient — reconciled
  -- against the inline q_a_pairs.valid_to hard hot boundary, which this
  -- source_document-only sweep never touches, BI-20).
  UPDATE record_lifecycle rl
  SET freshness = CASE
    WHEN rl.expiry_date IS NULL THEN 'aging'
    WHEN rl.expiry_date < v_now THEN 'expired'
    WHEN rl.expiry_date < v_now + interval '1 month' THEN 'stale'
    WHEN rl.expiry_date < v_now + interval '3 months' THEN 'aging'
    ELSE 'fresh'
  END,
  freshness_checked_at = v_now
  FROM source_documents sd
  WHERE rl.owner_kind = 'source_document'
    AND rl.source_document_id = sd.id
    AND sd.archived_at IS NULL
    AND rl.lifecycle_type = 'date_bound';

  -- regulation: based on months since the owner's updated_at (source_documents
  -- gained updated_at at M3/{131.9}, Finding 3).
  UPDATE record_lifecycle rl
  SET freshness = CASE
    WHEN sd.updated_at IS NULL THEN 'stale'
    WHEN EXTRACT(EPOCH FROM (v_now - sd.updated_at)) / 2592000 < 6 THEN 'fresh'
    WHEN EXTRACT(EPOCH FROM (v_now - sd.updated_at)) / 2592000 < 9 THEN 'aging'
    WHEN EXTRACT(EPOCH FROM (v_now - sd.updated_at)) / 2592000 < 12 THEN 'stale'
    ELSE 'expired'
  END,
  freshness_checked_at = v_now
  FROM source_documents sd
  WHERE rl.owner_kind = 'source_document'
    AND rl.source_document_id = sd.id
    AND sd.archived_at IS NULL
    AND rl.lifecycle_type = 'regulation';

  -- evergreen + null lifecycle_type: based on months since the owner's updated_at.
  UPDATE record_lifecycle rl
  SET freshness = CASE
    WHEN sd.updated_at IS NULL THEN 'stale'
    WHEN EXTRACT(EPOCH FROM (v_now - sd.updated_at)) / 2592000 < 12 THEN 'fresh'
    WHEN EXTRACT(EPOCH FROM (v_now - sd.updated_at)) / 2592000 < 18 THEN 'aging'
    WHEN EXTRACT(EPOCH FROM (v_now - sd.updated_at)) / 2592000 < 24 THEN 'stale'
    ELSE 'expired'
  END,
  freshness_checked_at = v_now
  FROM source_documents sd
  WHERE rl.owner_kind = 'source_document'
    AND rl.source_document_id = sd.id
    AND sd.archived_at IS NULL
    AND (rl.lifecycle_type = 'evergreen' OR rl.lifecycle_type IS NULL);

  -- Count final states (source_document owners, excluding archived owners).
  SELECT COUNT(*) FILTER (WHERE rl.freshness = 'fresh'),
         COUNT(*) FILTER (WHERE rl.freshness = 'aging'),
         COUNT(*) FILTER (WHERE rl.freshness = 'stale'),
         COUNT(*) FILTER (WHERE rl.freshness = 'expired'),
         COUNT(*)
  INTO v_fresh, v_aging, v_stale, v_expired, v_total
  FROM record_lifecycle rl
  JOIN source_documents sd ON sd.id = rl.source_document_id
  WHERE rl.owner_kind = 'source_document'
    AND sd.archived_at IS NULL;

  RETURN QUERY SELECT v_total, v_fresh, v_aging, v_stale, v_expired;
END;
$$;

ALTER FUNCTION "public"."recalculate_all_freshness"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."recalculate_all_freshness"() IS 'ID-131 {131.12} G-GOV-FACET-A, BI-22 (PER-AXIS, D7): set-based freshness sweep over record_lifecycle for owner_kind=source_document ONLY, joined to source_documents for updated_at/archived_at. q_a_pairs are never freshness-swept (facet CHECK rejects freshness cols on non-source_document owners). Return shape preserved.';

REVOKE ALL ON FUNCTION "public"."recalculate_all_freshness"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recalculate_all_freshness"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_all_freshness"() TO "service_role";

-- ---------------------------------------------------------------------------
-- 2. get_freshness_breakdown() — over the facet, source_document-only (D7).
--    Return shape UNCHANGED (freshness text, count bigint).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."get_freshness_breakdown"() RETURNS TABLE("freshness" "text", "count" bigint)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT rl.freshness::text, COUNT(*)
  FROM record_lifecycle rl
  JOIN source_documents sd ON sd.id = rl.source_document_id
  WHERE rl.owner_kind = 'source_document'
    AND rl.freshness IS NOT NULL
    AND sd.archived_at IS NULL
  GROUP BY rl.freshness;
END;
$$;

ALTER FUNCTION "public"."get_freshness_breakdown"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."get_freshness_breakdown"() IS 'ID-131 {131.12} G-GOV-FACET-A, BI-22 (PER-AXIS, D7): freshness breakdown over record_lifecycle for owner_kind=source_document ONLY, joined to source_documents for archived_at. Return shape preserved.';

REVOKE ALL ON FUNCTION "public"."get_freshness_breakdown"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_freshness_breakdown"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_freshness_breakdown"() TO "service_role";

-- ---------------------------------------------------------------------------
-- 3. get_review_breakdown_stats() — review/governance axis, spans BOTH
--    owner_kinds (source_document + q_a_pair, BI-22/BI-20). Return shape
--    UNCHANGED (total, verified, flagged, draft, overdue, by_domain,
--    by_content_type, by_source_file, by_source_document) — caller:
--    app/api/review/stats/route.ts (not owned by this migration; the route's
--    two extra direct content_items queries for awaiting_publication /
--    unclassified_coverage are untouched here, out of {131.12} scope).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."get_review_breakdown_stats"() RETURNS json
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT json_build_object(
    -- Top-level counts — review/governance axis spans BOTH owner_kinds (BI-22).
    -- publication_status lives on each typed record (source_documents.publication_status
    -- / q_a_pairs.publication_status, NOT on the facet), so COALESCE across the
    -- two per-kind LEFT JOINs.
    'total', (
      SELECT COUNT(*)
      FROM record_lifecycle rl
      LEFT JOIN source_documents sd ON rl.owner_kind = 'source_document' AND sd.id = rl.source_document_id
      LEFT JOIN q_a_pairs qap ON rl.owner_kind = 'q_a_pair' AND qap.id = rl.q_a_pair_id
      WHERE COALESCE(sd.publication_status, qap.publication_status) = 'published'
    ),
    'verified', (
      SELECT COUNT(*)
      FROM record_lifecycle rl
      LEFT JOIN source_documents sd ON rl.owner_kind = 'source_document' AND sd.id = rl.source_document_id
      LEFT JOIN q_a_pairs qap ON rl.owner_kind = 'q_a_pair' AND qap.id = rl.q_a_pair_id
      WHERE COALESCE(sd.publication_status, qap.publication_status) = 'published'
        AND rl.verified_at IS NOT NULL
    ),
    -- 'flagged': UNCHANGED — ingestion_quality_log.content_item_id has not been
    -- re-pointed by any landed migration (TECH.md "FK & trigger disposition"
    -- defers this decision explicitly); left reading the dying column pending
    -- that decision elsewhere (out of {131.12} scope, documented above).
    'flagged', (
      SELECT COUNT(DISTINCT content_item_id)
      FROM ingestion_quality_log
      WHERE flag_type = 'review_needed'
        AND resolved = FALSE
        AND content_item_id IS NOT NULL
    ),
    'draft', (
      SELECT COUNT(*)
      FROM record_lifecycle rl
      LEFT JOIN source_documents sd ON rl.owner_kind = 'source_document' AND sd.id = rl.source_document_id
      LEFT JOIN q_a_pairs qap ON rl.owner_kind = 'q_a_pair' AND qap.id = rl.q_a_pair_id
      WHERE COALESCE(sd.publication_status, qap.publication_status) = 'draft'
    ),
    'overdue', (
      SELECT COUNT(*)
      FROM record_lifecycle rl
      LEFT JOIN source_documents sd ON rl.owner_kind = 'source_document' AND sd.id = rl.source_document_id
      WHERE (rl.owner_kind <> 'source_document' OR sd.archived_at IS NULL)
        AND rl.governance_review_status = 'review_overdue'
    ),

    -- Breakdown by domain — record_lifecycle.domain (denormalised, M3-trig sync,
    -- spans both owner_kinds).
    'by_domain', (
      SELECT COALESCE(json_object_agg(domain, json_build_object(
        'total', total,
        'verified', verified
      )), '{}'::json)
      FROM (
        SELECT
          COALESCE(rl.domain, 'Uncategorised') AS domain,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE rl.verified_at IS NOT NULL) AS verified
        FROM record_lifecycle rl
        LEFT JOIN source_documents sd ON rl.owner_kind = 'source_document' AND sd.id = rl.source_document_id
        LEFT JOIN q_a_pairs qap ON rl.owner_kind = 'q_a_pair' AND qap.id = rl.q_a_pair_id
        WHERE COALESCE(sd.publication_status, qap.publication_status) = 'published'
        GROUP BY COALESCE(rl.domain, 'Uncategorised')
      ) d
    ),

    -- Breakdown by content type — source_document-only (q_a_pairs carries no
    -- content_type, BI-27 hybrid_search polymorphic UNION table).
    'by_content_type', (
      SELECT COALESCE(json_object_agg(ct, json_build_object(
        'total', total,
        'verified', verified
      )), '{}'::json)
      FROM (
        SELECT
          COALESCE(sd.content_type, 'other') AS ct,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE rl.verified_at IS NOT NULL) AS verified
        FROM record_lifecycle rl
        JOIN source_documents sd ON sd.id = rl.source_document_id
        WHERE rl.owner_kind = 'source_document'
          AND sd.publication_status = 'published'
        GROUP BY COALESCE(sd.content_type, 'other')
      ) t
    ),

    -- by_source_file: permanent empty object — content_items.source_file was
    -- DROPPED at M3 (BI-11) with no typed-record replacement column. Key kept
    -- (not removed) because ReviewStatsResponseSchema (lib/validation/schemas.ts,
    -- not owned by this migration) requires it present.
    'by_source_file', '{}'::json,

    -- Breakdown by source_document — source_document owners are their own
    -- anchor now (no more many-content_items-per-source_document indirection).
    'by_source_document', (
      SELECT COALESCE(json_object_agg(doc_id, json_build_object(
        'total', total,
        'verified', verified,
        'name', doc_name
      )), '{}'::json)
      FROM (
        SELECT
          sd.id::text AS doc_id,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE rl.verified_at IS NOT NULL) AS verified,
          COALESCE(sd.filename, LEFT(sd.id::text, 8)) AS doc_name
        FROM record_lifecycle rl
        JOIN source_documents sd ON sd.id = rl.source_document_id
        WHERE rl.owner_kind = 'source_document'
          AND sd.publication_status = 'published'
        GROUP BY sd.id, sd.filename
      ) doc
    )
  );
$$;

ALTER FUNCTION "public"."get_review_breakdown_stats"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."get_review_breakdown_stats"() IS 'ID-131 {131.12} G-GOV-FACET-A, BI-22/BI-20: review/governance breakdown over record_lifecycle spanning BOTH owner_kinds (source_document + q_a_pair). by_content_type/by_source_document are source_document-only. by_source_file permanently empty (source_file dropped M3, BI-11). flagged branch still reads the un-repointed ingestion_quality_log.content_item_id (documented gap). Return shape preserved.';

REVOKE ALL ON FUNCTION "public"."get_review_breakdown_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_review_breakdown_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_review_breakdown_stats"() TO "service_role";

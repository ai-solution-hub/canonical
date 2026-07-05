-- ============================================================================
-- BL-398 (S450, owner-directed fix-and-delete): governance/freshness/review
-- reads must exclude tombstoned source_documents.
--
-- Context: ID-138 {138.5} M1 (DR-023) added source_documents.admission_status
-- ('admitted' | 'tombstoned', CHECK-constrained) to drive the GDPR erasure
-- lifecycle. Tombstoning is an UPDATE, not a DELETE (DR-025) — the register
-- row survives so citations degrade to it rather than orphaning, and the
-- record_lifecycle facet row survives untouched. That means every governance/
-- freshness/review surface that joins record_lifecycle -> source_documents
-- without an admission_status guard will keep surfacing tombstoned (erased)
-- content as if it were live.
--
-- Scope: the three governance/freshness/review RPCs below. Deliberately NOT
-- touched: tombstone_source_document() and reap_orphaned_source_documents()
-- (ID-138 {138.7}) — those are the erasure/audit surfaces and MUST continue
-- to see tombstoned rows (that's the whole point of a reaper/erasure fn), as
-- do the id-138 erasure tests.
--
-- CREATE OR REPLACE only — no signature changes, so the api.* passthrough
-- wrappers (api.get_freshness_breakdown / api.get_review_breakdown_stats /
-- api.get_content_owner_stats, all thin `SELECT * FROM public.fn()` bodies —
-- see supabase/migrations/20260706150000_id131_api_views_regen2.sql) need no
-- regen.
--
-- AUTHORED, NOT APPLIED by this Subtask — no `supabase db push`, no MCP
-- `apply_migration`. Author-only per dispatch brief; applies later in the
-- owner-gated GO sequence.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. get_freshness_breakdown() — latest body:
--    supabase/migrations/20260702130000_id131_freshness_rpcs.sql:177-191.
--    Adds the admission_status guard alongside the existing archived_at
--    guard. Return shape UNCHANGED (freshness text, count bigint).
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
    AND sd.admission_status <> 'tombstoned'
  GROUP BY rl.freshness;
END;
$$;

ALTER FUNCTION "public"."get_freshness_breakdown"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."get_freshness_breakdown"() IS 'BL-398 (S450): supersedes {131.12}. Freshness breakdown over record_lifecycle for owner_kind=source_document ONLY, joined to source_documents for archived_at + admission_status (tombstoned source_documents excluded — ID-138 {138.5} DR-023/DR-025 GDPR erasure lifecycle; the register row survives tombstoning but must not surface as reviewable/fresh content). Return shape preserved.';

REVOKE ALL ON FUNCTION "public"."get_freshness_breakdown"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_freshness_breakdown"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_freshness_breakdown"() TO "service_role";

-- ---------------------------------------------------------------------------
-- 2. get_review_breakdown_stats() — latest body:
--    supabase/migrations/20260703160000_id131_govfacet_b_rpcs.sql:155-287.
--    Review/governance axis spans BOTH owner_kinds (source_document +
--    q_a_pair). Every sub-select that joins source_documents gets the
--    tombstone exclusion:
--      - total / verified / draft / by_domain: LEFT JOIN sd (+ LEFT JOIN
--        qap) — guarded with `(sd.id IS NULL OR sd.admission_status <>
--        'tombstoned')` so q_a_pair-owner rows (sd.id IS NULL) are never
--        dropped by the guard.
--      - overdue: LEFT JOIN sd only — extends the existing
--        `(rl.owner_kind <> 'source_document' OR sd.archived_at IS NULL)`
--        guard with the admission_status check.
--      - by_content_type / by_source_file / by_source_document: source_
--        document-only (INNER JOIN sd) — plain `AND sd.admission_status <>
--        'tombstoned'`.
--    'flagged' is untouched: it reads ingestion_quality_log directly with
--    NO source_documents join (no join point to guard against).
--    Return shape UNCHANGED (total, verified, flagged, draft, overdue,
--    by_domain, by_content_type, by_source_file, by_source_document).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."get_review_breakdown_stats"() RETURNS json
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT json_build_object(
    -- Top-level counts — review/governance axis spans BOTH owner_kinds (BI-22).
    'total', (
      SELECT COUNT(*)
      FROM record_lifecycle rl
      LEFT JOIN source_documents sd ON rl.owner_kind = 'source_document' AND sd.id = rl.source_document_id
      LEFT JOIN q_a_pairs qap ON rl.owner_kind = 'q_a_pair' AND qap.id = rl.q_a_pair_id
      WHERE COALESCE(sd.publication_status, qap.publication_status) = 'published'
        AND (sd.id IS NULL OR sd.admission_status <> 'tombstoned')
    ),
    'verified', (
      SELECT COUNT(*)
      FROM record_lifecycle rl
      LEFT JOIN source_documents sd ON rl.owner_kind = 'source_document' AND sd.id = rl.source_document_id
      LEFT JOIN q_a_pairs qap ON rl.owner_kind = 'q_a_pair' AND qap.id = rl.q_a_pair_id
      WHERE COALESCE(sd.publication_status, qap.publication_status) = 'published'
        AND rl.verified_at IS NOT NULL
        AND (sd.id IS NULL OR sd.admission_status <> 'tombstoned')
    ),
    -- 'flagged': no source_documents join present — nothing to guard here
    -- (BL-398 out of scope; the ingestion_quality_log row itself is not
    -- tombstoned, only its backing source_document may be).
    'flagged', (
      SELECT COUNT(DISTINCT source_document_id)
      FROM ingestion_quality_log
      WHERE flag_type = 'review_needed'
        AND resolved = FALSE
        AND source_document_id IS NOT NULL
    ),
    'draft', (
      SELECT COUNT(*)
      FROM record_lifecycle rl
      LEFT JOIN source_documents sd ON rl.owner_kind = 'source_document' AND sd.id = rl.source_document_id
      LEFT JOIN q_a_pairs qap ON rl.owner_kind = 'q_a_pair' AND qap.id = rl.q_a_pair_id
      WHERE COALESCE(sd.publication_status, qap.publication_status) = 'draft'
        AND (sd.id IS NULL OR sd.admission_status <> 'tombstoned')
    ),
    'overdue', (
      SELECT COUNT(*)
      FROM record_lifecycle rl
      LEFT JOIN source_documents sd ON rl.owner_kind = 'source_document' AND sd.id = rl.source_document_id
      WHERE (rl.owner_kind <> 'source_document' OR (sd.archived_at IS NULL AND sd.admission_status <> 'tombstoned'))
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
          AND (sd.id IS NULL OR sd.admission_status <> 'tombstoned')
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
          AND sd.admission_status <> 'tombstoned'
        GROUP BY COALESCE(sd.content_type, 'other')
      ) t
    ),

    -- by_source_file: GAP-2b (owner-ruled, S443) — repointed onto the
    -- register's existing provenance path (source_documents.storage_path, the
    -- persisted rel_path value — flow.py:2160/2581). No new column.
    -- source_document-only (q_a_pairs have no file), published-filtered —
    -- modelled EXACTLY on the by_source_document block below.
    'by_source_file', (
      SELECT COALESCE(json_object_agg(file_path, json_build_object(
        'total', total,
        'verified', verified
      )), '{}'::json)
      FROM (
        SELECT
          sd.storage_path AS file_path,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE rl.verified_at IS NOT NULL) AS verified
        FROM record_lifecycle rl
        JOIN source_documents sd ON sd.id = rl.source_document_id
        WHERE rl.owner_kind = 'source_document'
          AND sd.publication_status = 'published'
          AND sd.admission_status <> 'tombstoned'
        GROUP BY sd.storage_path
      ) f
    ),

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
          AND sd.admission_status <> 'tombstoned'
        GROUP BY sd.id, sd.filename
      ) doc
    )
  );
$$;

COMMENT ON FUNCTION "public"."get_review_breakdown_stats"() IS 'BL-398 (S450): supersedes {131.13}. Every sub-select joining source_documents excludes admission_status=''tombstoned'' rows (ID-138 {138.5} DR-023/DR-025 GDPR erasure lifecycle) — LEFT JOIN branches (total/verified/draft/by_domain) guard with `(sd.id IS NULL OR sd.admission_status <> ''tombstoned'')` so q_a_pair-owner rows are never dropped; `overdue` extends its existing owner_kind/archived_at guard; source_document-only INNER-JOIN branches (by_content_type/by_source_file/by_source_document) add a plain guard. `flagged` has no source_documents join and is untouched (out of scope). Return shape preserved.';

REVOKE ALL ON FUNCTION "public"."get_review_breakdown_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_review_breakdown_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_review_breakdown_stats"() TO "service_role";

-- ---------------------------------------------------------------------------
-- 3. get_content_owner_stats() — latest body:
--    supabase/migrations/20260703160000_id131_govfacet_b_rpcs.sql:310-327.
--    Extends the existing `(rl.owner_kind <> 'source_document' OR
--    sd.archived_at IS NULL)` guard with the admission_status check, same
--    pattern as `overdue` above. Signature/shape preserved — no caller
--    change (live caller: app/api/content-owners/stats/route.ts, untouched —
--    pure RPC passthrough).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."get_content_owner_stats"() RETURNS TABLE("owner_id" "uuid", "total_items" integer, "fresh_count" integer, "aging_count" integer, "stale_count" integer, "expired_count" integer, "unverified_count" integer)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT
    rl.content_owner_id AS owner_id,
    count(*)::int AS total_items,
    count(*) FILTER (WHERE rl.freshness = 'fresh')::int AS fresh_count,
    count(*) FILTER (WHERE rl.freshness IN ('aging', 'ageing'))::int AS aging_count,
    count(*) FILTER (WHERE rl.freshness = 'stale')::int AS stale_count,
    count(*) FILTER (WHERE rl.freshness = 'expired')::int AS expired_count,
    count(*) FILTER (WHERE rl.verified_at IS NULL)::int AS unverified_count
  FROM record_lifecycle rl
  LEFT JOIN source_documents sd ON rl.owner_kind = 'source_document' AND sd.id = rl.source_document_id
  WHERE rl.content_owner_id IS NOT NULL
    AND (rl.owner_kind <> 'source_document' OR (sd.archived_at IS NULL AND sd.admission_status <> 'tombstoned'))
  GROUP BY rl.content_owner_id;
$$;

COMMENT ON FUNCTION "public"."get_content_owner_stats"() IS 'BL-398 (S450): supersedes {131.13}. content_owner_id spans BOTH owner_kinds (governance axis, BI-20); the source_document-only guard now also excludes admission_status=''tombstoned'' rows (ID-138 {138.5} DR-023/DR-025 GDPR erasure lifecycle) alongside the existing archived_at guard. Signature/shape preserved — no caller change.';

REVOKE ALL ON FUNCTION "public"."get_content_owner_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_content_owner_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_content_owner_stats"() TO "service_role";
-- api.get_content_owner_stats() is an unchanged passthrough wrapper
-- (`SELECT * FROM public.get_content_owner_stats()`) — signature preserved,
-- no regen needed here.

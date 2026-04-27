-- ----------------------------------------------------------------------------
-- S204 WP-E T0 — extend get_review_breakdown_stats() with `'overdue'` count
--
-- Adds a top-level `'overdue'` field to the json_build_object returned by
-- `get_review_breakdown_stats()`. Counts content_items rows that are not
-- archived AND have governance_review_status = 'review_overdue' (the marker
-- written by the daily 03:45 UTC cron at app/api/cron/review-cadence/route.ts
-- per §5.5 Phase 2).
--
-- All other RPC fields (total / verified / flagged / draft / by_domain /
-- by_content_type / by_source_file / by_source_document) are preserved
-- verbatim from the function defined in
-- supabase/migrations/20260416102457_pre_squash_reconciliation.sql:2049-2159.
--
-- Function attributes preserved verbatim:
--   - LANGUAGE sql STABLE SECURITY DEFINER
--   - SET search_path TO 'public', 'extensions'
--
-- Spec:  docs/specs/p0-document-control-lifecycle-spec.md §7
-- Plan:  docs/plans/p0-document-control-phase-3-ui-plan.md v1.1 §T0
-- Roadmap: §5.5 Phase 3
-- Unblocks: WP-E T1-T4 UI work (S205) — T2 count badge reads stats?.overdue
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."get_review_breakdown_stats"() RETURNS json
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT json_build_object(
    -- Top-level counts
    'total', (
      SELECT COUNT(*)
      FROM content_items
      WHERE archived_at IS NULL
        AND (governance_review_status IS NULL OR governance_review_status != 'draft')
    ),
    'verified', (
      SELECT COUNT(*)
      FROM content_items
      WHERE archived_at IS NULL
        AND verified_at IS NOT NULL
        AND (governance_review_status IS NULL OR governance_review_status != 'draft')
    ),
    'flagged', (
      SELECT COUNT(DISTINCT content_item_id)
      FROM ingestion_quality_log
      WHERE flag_type = 'review_needed'
        AND resolved = FALSE
        AND content_item_id IS NOT NULL
    ),
    'draft', (
      SELECT COUNT(*)
      FROM content_items
      WHERE archived_at IS NULL
        AND governance_review_status = 'draft'
    ),
    'overdue', (
      SELECT COUNT(*)
      FROM content_items
      WHERE archived_at IS NULL
        AND governance_review_status = 'review_overdue'
    ),

    -- Breakdown by domain
    'by_domain', (
      SELECT COALESCE(json_object_agg(domain, json_build_object(
        'total', total,
        'verified', verified
      )), '{}'::json)
      FROM (
        SELECT
          COALESCE(primary_domain, 'Uncategorised') AS domain,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE verified_at IS NOT NULL) AS verified
        FROM content_items
        WHERE archived_at IS NULL
          AND (governance_review_status IS NULL OR governance_review_status != 'draft')
        GROUP BY COALESCE(primary_domain, 'Uncategorised')
      ) d
    ),

    -- Breakdown by content type
    'by_content_type', (
      SELECT COALESCE(json_object_agg(ct, json_build_object(
        'total', total,
        'verified', verified
      )), '{}'::json)
      FROM (
        SELECT
          COALESCE(content_type, 'other') AS ct,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE verified_at IS NOT NULL) AS verified
        FROM content_items
        WHERE archived_at IS NULL
          AND (governance_review_status IS NULL OR governance_review_status != 'draft')
        GROUP BY COALESCE(content_type, 'other')
      ) t
    ),

    -- Breakdown by source_file
    'by_source_file', (
      SELECT COALESCE(json_object_agg(sf, json_build_object(
        'total', total,
        'verified', verified
      )), '{}'::json)
      FROM (
        SELECT
          source_file AS sf,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE verified_at IS NOT NULL) AS verified
        FROM content_items
        WHERE archived_at IS NULL
          AND source_file IS NOT NULL
          AND (governance_review_status IS NULL OR governance_review_status != 'draft')
        GROUP BY source_file
      ) s
    ),

    -- Breakdown by source_document (with document name from source_documents)
    'by_source_document', (
      SELECT COALESCE(json_object_agg(doc_id, json_build_object(
        'total', total,
        'verified', verified,
        'name', doc_name
      )), '{}'::json)
      FROM (
        SELECT
          ci.source_document_id::text AS doc_id,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE ci.verified_at IS NOT NULL) AS verified,
          COALESCE(sd.filename, LEFT(ci.source_document_id::text, 8)) AS doc_name
        FROM content_items ci
        LEFT JOIN source_documents sd ON sd.id = ci.source_document_id
        WHERE ci.archived_at IS NULL
          AND ci.source_document_id IS NOT NULL
          AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
        GROUP BY ci.source_document_id, sd.filename
      ) sd
    )
  );
$$;

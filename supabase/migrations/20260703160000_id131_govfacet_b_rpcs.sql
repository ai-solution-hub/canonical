-- ID-131 {131.13} G-GOV-FACET-B — RE-SCOPED SQL-only function-body rewrites
-- (Phase-1 Planner re-scope, Checker-PASS'd).
--
-- AUTHORED, NOT APPLIED. Same "GO-apply consequence bridge" pattern already
-- used across ID-131: the governance chain hit the api-view boundary
-- (config.toml schemas=["api"] -> PostgREST exposes only api.*;
-- public.record_lifecycle is PGRST106-unreachable to clients until {131.19}
-- regens the api views). SQL FUNCTION BODIES that run in-DB against public.*
-- are safe to author here; TS route re-points that read record_lifecycle /
-- call these rewritten RPCs are bundled into {131.19} and applied together at
-- the coordinated GO-apply.
--
-- Five dispositions in this file:
--   1. get_document_version_chain   — REWRITE (shape-preserving), see §1.
--   2. get_review_breakdown_stats   — REWRITE (GAP-2b by_source_file), §2.
--      Supersedes {131.12}'s shipped 20260702130000 version cleanly via
--      CREATE OR REPLACE — that migration is left immutable.
--   3. verification_history         — DEFERRED, NOT dropped. See note below.
--   4. ingestion_quality_log        — REWRITE (re-parent content_item_id ->
--      source_document_id), §3.
--   5. Owner/verification flag fns  — per-fn disposition (rewrite/drop/rewrite
--      by live-caller grep), §4-§6.
--
-- --- Disposition 3: verification_history — NOT dropped (escalation-lite) ---
-- The brief's own safety valve ("grep for live consumers; if ANY exist, do
-- NOT drop — re-point or ESCALATE") fired. Grep across TS found LIVE
-- consumers beyond the {131.19}-named governance bundle:
--   - app/api/admin/provenance/export/verification-history/route.ts (reads)
--   - components/item-detail/verification-history.tsx (reads + writes)
--   - scripts/export-user-data.ts (GDPR export, reads)
--   - scripts/cleanup-stale-test-artifacts.ts (test cleanup util, reads)
-- ...in addition to the already-named app/api/review/action + queue routes
-- (write + read paths). No function body in this migration set reads
-- verification_history (get_review_breakdown_stats reads
-- record_lifecycle.verified_at, not the audit table), so nothing here
-- REQUIRES the drop. Given the live write path in app/api/review/action and
-- the additional un-bundled consumers, this migration leaves
-- verification_history and its NOT-NULL content_item_id FK COMPLETELY
-- UNTOUCHED. Recorded as a finding for the Orchestrator: {131.19}'s scope
-- may need to expand to cover ALL of the above consumers (not just the named
-- governance ones) before any future drop is authored.
--
-- New PL/pgSQL discipline: SET search_path inside every function body;
-- REVOKE/GRANT reissued defensively. UK English throughout (DD/MM/YYYY).
-- Authored 03/07/2026.

-- ---------------------------------------------------------------------------
-- §1. get_document_version_chain — shape-preserving rewrite.
--    Already source_documents-anchored (recursive CTE walks
--    source_documents.parent_id, squash_baseline.sql:2477-2518). The ONLY
--    content_items touch is the content_item_count rollup subquery, which
--    breaks once content_items is eventually dropped (M6). Re-homed onto
--    q_a_pairs (the derived-record replacement) to PRESERVE the
--    RETURNS TABLE(... content_item_count bigint) signature — avoids a caller
--    change + an api pre-drop. Callers (both consume the TABLE generically,
--    confirmed by grep): app/api/source-documents/[id]/versions/route.ts:34,
--    lib/mcp/tools/content.ts:1852 (VersionRow.content_item_count: number).
--    Everything else identical to the squash body.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."get_document_version_chain"("p_document_id" "uuid") RETURNS TABLE("id" "uuid", "filename" "text", "original_filename" "text", "mime_type" character varying, "file_size" integer, "content_hash" "text", "version" integer, "parent_id" "uuid", "storage_path" "text", "status" character varying, "uploaded_by" "uuid", "created_at" timestamp with time zone, "content_item_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  -- Walk up the chain to find the root document
  WITH RECURSIVE chain AS (
    -- Start from the given document
    SELECT sd.* FROM source_documents sd WHERE sd.id = p_document_id
    UNION ALL
    -- Walk to parent
    SELECT sd.* FROM source_documents sd
    JOIN chain c ON sd.id = c.parent_id
  ),
  -- Also walk down the chain from root to find all descendants
  root AS (
    SELECT id FROM chain WHERE parent_id IS NULL
    LIMIT 1
  ),
  full_chain AS (
    SELECT sd.* FROM source_documents sd
    WHERE sd.id = (SELECT id FROM root)
    UNION ALL
    SELECT sd.* FROM source_documents sd
    JOIN full_chain fc ON sd.parent_id = fc.id
  )
  SELECT
    fc.id,
    fc.filename,
    fc.original_filename,
    fc.mime_type,
    fc.file_size,
    fc.content_hash,
    fc.version,
    fc.parent_id,
    fc.storage_path,
    fc.status,
    fc.uploaded_by,
    fc.created_at,
    (SELECT count(*) FROM q_a_pairs qap WHERE qap.source_document_id = fc.id) AS content_item_count
  FROM full_chain fc
  ORDER BY fc.version ASC;
$$;

COMMENT ON FUNCTION "public"."get_document_version_chain"("p_document_id" "uuid") IS 'ID-131 {131.13} G-GOV-FACET-B: content_item_count re-homed from content_items onto q_a_pairs (source_document_id). Signature/shape preserved — no caller change. Callers: app/api/source-documents/[id]/versions/route.ts, lib/mcp/tools/content.ts (get_document_versions tool).';

REVOKE ALL ON FUNCTION "public"."get_document_version_chain"("p_document_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_document_version_chain"("p_document_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_document_version_chain"("p_document_id" "uuid") TO "service_role";

-- ---------------------------------------------------------------------------
-- §2a. ingestion_quality_log re-parent — content_item_id -> source_document_id
--    (nullable, 0 rows, no data migration required). Re-points the dangling
--    FK from the dying content_items(id) onto source_documents(id).
--    Recommended over drop (multiple live TS readers/writers: app/api/quality,
--    app/api/review/*, components/item-detail/metadata-sidebar.tsx,
--    lib/mcp/tools/apps.ts, lib/ai/change-reports.ts, scripts/export-user-data.ts
--    — none touched here; column NAME is preserved-by-rename so those callers
--    keep working until {131.19} re-points their .eq('content_item_id', ...)
--    / .select(...) references, which IS required before this migration is
--    applied — flagged for {131.19}).
--    Indexes: Postgres auto-updates index DEFINITIONS on column rename;
--    renamed the index NAME purely for readability.
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."ingestion_quality_log"
  DROP CONSTRAINT "ingestion_quality_log_content_item_id_fkey";

ALTER TABLE "public"."ingestion_quality_log"
  RENAME COLUMN "content_item_id" TO "source_document_id";

ALTER TABLE "public"."ingestion_quality_log"
  ADD CONSTRAINT "ingestion_quality_log_source_document_id_fkey"
  FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE CASCADE;

ALTER INDEX "idx_quality_log_content_item" RENAME TO "idx_quality_log_source_document";

COMMENT ON COLUMN "public"."ingestion_quality_log"."source_document_id" IS 'ID-131 {131.13} G-GOV-FACET-B: re-parented from content_item_id (content_items dying). FK now targets source_documents(id) ON DELETE CASCADE. Renamed column, NOT a new column — {131.19} must re-point all TS readers/writers before this migration applies.';

-- ---------------------------------------------------------------------------
-- §2b. get_review_breakdown_stats — GAP-2b by_source_file re-point (owner-
--    ruled, S443): "repoint onto the register's existing provenance path, no
--    new column." rel_path is NOT a column — the value is persisted into
--    source_documents.storage_path (flow.py:2160/2581). Rewritten from the
--    permanent '{}'::json placeholder to a grouping over sd.storage_path,
--    modelled EXACTLY on the by_source_document block below (source_document-
--    only, published-filtered). Also updates the 'flagged' branch's column
--    reference to match §2a's ingestion_quality_log rename (content_item_id
--    -> source_document_id) so this CREATE OR REPLACE is internally
--    consistent with the rest of this same migration. Everything else
--    (total/verified/flagged/draft/overdue/by_domain/by_content_type/
--    by_source_document) identical to the {131.12} body. Return shape
--    UNCHANGED. Caller: app/api/review/stats/route.ts (untouched, out of
--    scope — reads record_lifecycle via this RPC, bundled to {131.19}).
--    CREATE OR REPLACE cleanly supersedes {131.12}'s shipped 20260702130000
--    version — that migration file is left immutable.
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
    ),
    'verified', (
      SELECT COUNT(*)
      FROM record_lifecycle rl
      LEFT JOIN source_documents sd ON rl.owner_kind = 'source_document' AND sd.id = rl.source_document_id
      LEFT JOIN q_a_pairs qap ON rl.owner_kind = 'q_a_pair' AND qap.id = rl.q_a_pair_id
      WHERE COALESCE(sd.publication_status, qap.publication_status) = 'published'
        AND rl.verified_at IS NOT NULL
    ),
    -- 'flagged': column reference updated for §2a's rename (content_item_id ->
    -- source_document_id). Still UNCHANGED in intent/shape — TECH.md's "FK &
    -- trigger disposition" section defers full re-point of this branch's
    -- semantics; left reading the (now source_document-scoped) flag rows.
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
        GROUP BY sd.id, sd.filename
      ) doc
    )
  );
$$;

COMMENT ON FUNCTION "public"."get_review_breakdown_stats"() IS 'ID-131 {131.13} G-GOV-FACET-B: supersedes {131.12}. GAP-2b by_source_file re-pointed onto source_documents.storage_path (owner-ruled S443), modelled on by_source_document, source_document-only, published-filtered. flagged branch column reference updated for the §2a ingestion_quality_log rename (content_item_id -> source_document_id). Return shape preserved.';

REVOKE ALL ON FUNCTION "public"."get_review_breakdown_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_review_breakdown_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_review_breakdown_stats"() TO "service_role";

-- ---------------------------------------------------------------------------
-- §3. Owner/verification flag SQL — grepped the TS corpus for live callers.
-- ---------------------------------------------------------------------------

-- 3a. get_content_owner_stats — LIVE caller found: app/api/content-owners/
--    stats/route.ts (RPC call, shape consumed via types/owner.ts
--    ContentOwnerStats). REWRITE onto record_lifecycle (content_owner_id,
--    freshness, verified_at all live there per M1a). Freshness axis is
--    source_document-only (D7) — q_a_pair owner rows always have NULL
--    freshness, so their rows count towards total_items/unverified_count but
--    never toward fresh/aging/stale/expired (FILTER naturally yields 0 for
--    them, matching D7's per-axis discipline, no extra guard needed).
--    archived_at exclusion mirrors the by_source_document/overdue pattern
--    above (source_document-only column). Signature/shape preserved — NO
--    caller change required.
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
    AND (rl.owner_kind <> 'source_document' OR sd.archived_at IS NULL)
  GROUP BY rl.content_owner_id;
$$;

COMMENT ON FUNCTION "public"."get_content_owner_stats"() IS 'ID-131 {131.13} G-GOV-FACET-B: rewritten onto record_lifecycle (live caller: app/api/content-owners/stats/route.ts). content_owner_id spans BOTH owner_kinds (governance axis, BI-20); freshness counts are source_document-only (D7 per-axis) and naturally zero for q_a_pair owners. Signature/shape preserved — no caller change.';

REVOKE ALL ON FUNCTION "public"."get_content_owner_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_content_owner_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_content_owner_stats"() TO "service_role";
-- api.get_content_owner_stats() is an unchanged passthrough wrapper
-- (`SELECT * FROM public.get_content_owner_stats()`) — signature preserved,
-- no regen needed here.

-- 3b. get_verification_stats — ZERO live callers (confirmed by grep AND by
--    the existing scripts/audit-opaque-json-rpcs.ts inventory, verdict
--    'no-ts-callers': "Analytics/reporting function likely superseded by
--    get_review_breakdown_stats"). DROP.
DROP FUNCTION IF EXISTS "public"."get_verification_stats"();

-- 3c. bulk_assign_content_owner — LIVE callers found: app/api/content-owners/
--    bulk-assign/route.ts, lib/mcp/tools/content.ts (2 call sites). REWRITE
--    onto record_lifecycle (content_owner_id is governance-axis, spans both
--    owner_kinds via the generated owner_id = COALESCE(source_document_id,
--    q_a_pair_id)). Signature preserved (p_item_ids uuid[], p_owner_id uuid,
--    p_assigned_by uuid) -> integer.
--
--    TWO KNOWN GAPS flagged for {131.19} (documented, not fixed here — this
--    migration is authored-not-applied, consistent with the GO-apply
--    consequence-bridge pattern):
--      (a) record_lifecycle carries NO updated_by-equivalent column (unlike
--          content_items.updated_by) — p_assigned_by is accepted for
--          call-signature compatibility but NOT persisted anywhere.
--      (b) ID-SCHEME MISMATCH: both call sites currently populate p_item_ids
--          from content_items.id values (the bulk-assign route's own
--          `.from('content_items').select('id')` filter-resolution query,
--          plus explicit item_ids passed by callers). content_items.id does
--          NOT equal record_lifecycle.owner_id (source_document_id /
--          q_a_pair_id) — {131.19} MUST re-point both callers (and the
--          bulk-assign route's content_items filter query) to resolve/pass
--          owner ids before this migration is applied, or every assignment
--          silently matches zero rows post-GO-apply.
CREATE OR REPLACE FUNCTION "public"."bulk_assign_content_owner"("p_item_ids" "uuid"[], "p_owner_id" "uuid", "p_assigned_by" "uuid") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  updated_count int;
BEGIN
  UPDATE record_lifecycle rl
    SET content_owner_id = p_owner_id,
        updated_at = now()
    WHERE rl.owner_id = ANY(p_item_ids);

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

COMMENT ON FUNCTION "public"."bulk_assign_content_owner"("p_item_ids" "uuid"[], "p_owner_id" "uuid", "p_assigned_by" "uuid") IS 'ID-131 {131.13} G-GOV-FACET-B: rewritten onto record_lifecycle (live callers: app/api/content-owners/bulk-assign/route.ts, lib/mcp/tools/content.ts x2). KNOWN GAPS (flagged for {131.19}): p_assigned_by accepted but not persisted (no updated_by-equivalent facet column); p_item_ids must become owner ids (source_document_id/q_a_pair_id), NOT content_items.id, before this migration is applied — callers currently resolve/pass content_items.id.';

REVOKE ALL ON FUNCTION "public"."bulk_assign_content_owner"("p_item_ids" "uuid"[], "p_owner_id" "uuid", "p_assigned_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bulk_assign_content_owner"("p_item_ids" "uuid"[], "p_owner_id" "uuid", "p_assigned_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_assign_content_owner"("p_item_ids" "uuid"[], "p_owner_id" "uuid", "p_assigned_by" "uuid") TO "service_role";

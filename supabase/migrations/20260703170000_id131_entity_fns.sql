-- ID-131 {131.14} G-GOV-FACET-C — SQL-only re-scope (Phase-1 Planner, Checker-PASS'd).
--
-- The api-view boundary (config.toml schemas=["api"]) means TS that reads/writes
-- record_lifecycle is blocked until {131.19} regens the api views. So only the
-- SQL fn bodies (run in-DB against public.*) land here as an authored-not-applied
-- migration. ALL the TS in the original {131.14} scope (lib/dashboard.ts split,
-- lib/reorient.ts, lib/change-reports.ts, and the entity->facet reverse-bridge
-- ROUTE at app/api/entities/[canonical_name]/metadata/route.ts) is OUT of scope
-- here -> bundled into {131.19}, because they write the record_lifecycle facet
-- from TS (api-blocked).
--
-- PART 1 — Entity fns re-point content_item_id -> source_document_id
-- --------------------------------------------------------------------------
-- M2 ({131.8}, migration 20260628200000_id131_extract_reparent) renamed
-- entity_mentions.content_item_id -> source_document_id and
-- entity_relationships.source_item_id -> source_document_id (entities STAY in
-- the DB per BI-14). PG defers PL/pgSQL column-validation to exec time, so the
-- 4 fn bodies below silently still reference the OLD column names post-M2.
-- Each is re-pointed here; RETURNS signatures are preserved verbatim (the TS
-- callers below must not churn):
--   - get_entity_summary        (caller: hooks/browse/use-filter-data.ts,
--                                 lib/mcp/tools/entities.ts, lib/mcp/resources.ts)
--   - merge_entities            (caller: app/api/entities/merge/route.ts)
--   - get_entity_co_occurrence  (caller: app/api/entities/co-occurrence/route.ts)
--   - delete_duplicate_entity_mentions (no live TS/RPC caller found; Python
--                                 stage_5.py mirrors its survivor policy but
--                                 does not invoke the RPC)
--
-- PART 2 — get_dashboard_attention_counts re-pointed onto record_lifecycle
-- --------------------------------------------------------------------------
-- The governance/verification/freshness/expiry counts previously read straight
-- off content_items (the dying IMS staging table, dropped wholesale in
-- M6/{131.19}). Those signals now live on the record_lifecycle facet
-- ({131.6}, M1a) for owner_kind='source_document' (BI-20/BI-22). Re-pointed:
--   - governance_review_count  (record_lifecycle.governance_review_status)
--   - unverified_count         (record_lifecycle.verified_at)
--   - freshness breakdown      (record_lifecycle.freshness)
--   - expiring_content_date_count (record_lifecycle.expiry_date)
-- "Active record" filtering now joins source_documents.archived_at (record_
-- lifecycle carries no archived_at of its own). quality_flag_count
-- (ingestion_quality_log) and coverage_gap_count (taxonomy_subtopics /
-- content_items.primary_subtopic) are UNCHANGED here — neither is part of the
-- record_lifecycle facet; their content_items dependency is {131.19}'s to
-- retire alongside the table drop. RETURNS TABLE shape preserved verbatim;
-- caller lib/dashboard.ts:316 reads data[0].<column> by name and survives
-- unchanged. The api.* SECURITY INVOKER wrapper is an unconditional pass-
-- through (`SELECT * FROM public.get_dashboard_attention_counts(...)`) so an
-- unchanged RETURNS shape needs no wrapper regen — the api generator / api.*
-- view regen proper is {131.19}'s coordinated GO.

-- ===========================================================================
-- 1. get_entity_summary — content_item_id -> source_document_id
-- ===========================================================================
CREATE OR REPLACE FUNCTION "public"."get_entity_summary"("p_entity_name" "text" DEFAULT NULL::"text", "p_entity_type" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT NULL::integer) RETURNS TABLE("canonical_name" "text", "entity_type" "text", "mention_count" bigint, "content_item_ids" "uuid"[], "related_entities" "jsonb")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  WITH mention_counts AS (
    SELECT
      em.canonical_name,
      COALESCE(em.entity_type_override, em.entity_type) AS entity_type,
      COUNT(*) as mention_count,
      ARRAY_AGG(DISTINCT em.source_document_id) as content_item_ids
    FROM entity_mentions em
    WHERE
      (p_entity_name IS NULL OR em.canonical_name ILIKE '%' || p_entity_name || '%')
      AND (p_entity_type IS NULL OR COALESCE(em.entity_type_override, em.entity_type) = p_entity_type)
    GROUP BY em.canonical_name, COALESCE(em.entity_type_override, em.entity_type)
  ),
  ranked AS (
    SELECT
      mc.*,
      ROW_NUMBER() OVER (ORDER BY mc.mention_count DESC) as rn
    FROM mention_counts mc
  ),
  bounded AS (
    SELECT * FROM ranked
    WHERE p_limit IS NULL OR rn <= p_limit
  ),
  related AS (
    SELECT
      b.canonical_name,
      b.entity_type,
      COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object(
          'relationship', er.relationship_type,
          'target', er.target_entity
        )) FILTER (WHERE er.id IS NOT NULL),
        '[]'::jsonb
      ) ||
      COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object(
          'relationship', er2.relationship_type,
          'source', er2.source_entity
        )) FILTER (WHERE er2.id IS NOT NULL),
        '[]'::jsonb
      ) as related_entities
    FROM bounded b
    LEFT JOIN entity_relationships er ON er.source_entity = b.canonical_name
    LEFT JOIN entity_relationships er2 ON er2.target_entity = b.canonical_name
    GROUP BY b.canonical_name, b.entity_type
  )
  SELECT
    b.canonical_name,
    b.entity_type,
    b.mention_count,
    b.content_item_ids,
    COALESCE(r.related_entities, '[]'::jsonb)
  FROM bounded b
  LEFT JOIN related r ON r.canonical_name = b.canonical_name AND r.entity_type = b.entity_type
  ORDER BY b.mention_count DESC;
END;
$$;

ALTER FUNCTION "public"."get_entity_summary"("p_entity_name" "text", "p_entity_type" "text", "p_limit" integer) OWNER TO "postgres";

COMMENT ON FUNCTION "public"."get_entity_summary"("p_entity_name" "text", "p_entity_type" "text", "p_limit" integer) IS 'Query entity mentions with counts, content items, and related entities. Uses COALESCE(entity_type_override, entity_type) for effective type. ID-131 {131.14}: re-pointed onto entity_mentions.source_document_id post-M2 rename; output column content_item_ids preserved (shape-preserving).';

-- ===========================================================================
-- 2. merge_entities — content_item_id -> source_document_id
--    Body otherwise preserved verbatim from ID-70's typed-TABLE rewrite.
-- ===========================================================================
CREATE OR REPLACE FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text")
    RETURNS TABLE(
      "merged" boolean,
      "target" "text",
      "entity_type" "text",
      "mentions_updated" integer,
      "relationship_sources_updated" integer,
      "relationship_targets_updated" integer,
      "duplicates_removed" integer
    )
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_mentions_updated integer := 0;
  v_rel_sources_updated integer := 0;
  v_rel_targets_updated integer := 0;
  v_duplicates_removed integer := 0;
BEGIN
  -- Validate inputs
  IF p_target_name IS NULL OR p_target_name = '' THEN
    RAISE EXCEPTION 'Target name must not be empty';
  END IF;

  IF p_source_names IS NULL OR array_length(p_source_names, 1) IS NULL THEN
    RAISE EXCEPTION 'Source names array must not be empty';
  END IF;

  -- 1. Update entity_mentions: rename canonical_name to target and set type override
  UPDATE entity_mentions
  SET canonical_name = p_target_name,
      entity_type_override = p_entity_type
  WHERE canonical_name = ANY(p_source_names);

  GET DIAGNOSTICS v_mentions_updated = ROW_COUNT;

  -- 2. Update entity_relationships: source_entity references
  UPDATE entity_relationships
  SET source_entity = p_target_name
  WHERE source_entity = ANY(p_source_names);

  GET DIAGNOSTICS v_rel_sources_updated = ROW_COUNT;

  -- 3. Update entity_relationships: target_entity references
  UPDATE entity_relationships
  SET target_entity = p_target_name
  WHERE target_entity = ANY(p_source_names);

  GET DIAGNOSTICS v_rel_targets_updated = ROW_COUNT;

  -- 4. Delete duplicate mentions (same canonical_name + entity_type + source_document_id)
  --    Keep the row with highest confidence (or earliest created_at as tiebreaker)
  --    NB (ID-70): columns are qualified with the `em` alias because the new
  --    RETURNS TABLE OUT column `entity_type` would otherwise be ambiguous against
  --    entity_mentions.entity_type inside this plpgsql body.
  --    ID-131 {131.14}: em.content_item_id -> em.source_document_id (M2 rename).
  WITH duplicates AS (
    SELECT em.id,
      ROW_NUMBER() OVER (
        PARTITION BY em.canonical_name, COALESCE(em.entity_type_override, em.entity_type), em.source_document_id
        ORDER BY em.confidence DESC NULLS LAST, em.created_at ASC
      ) AS rn
    FROM entity_mentions em
    WHERE em.canonical_name = p_target_name
  )
  DELETE FROM entity_mentions
  WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

  GET DIAGNOSTICS v_duplicates_removed = ROW_COUNT;

  -- Return the typed result summary as a single row.
  RETURN QUERY SELECT
    true,
    p_target_name,
    p_entity_type,
    v_mentions_updated,
    v_rel_sources_updated,
    v_rel_targets_updated,
    v_duplicates_removed;
END;
$$;

ALTER FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") IS 'Atomically merge multiple entities into one canonical form. Updates mentions, relationships, and deduplicates — all within a single transaction. Returns a single typed row (ID-70). ID-131 {131.14}: duplicate-detection PARTITION BY re-pointed onto entity_mentions.source_document_id post-M2 rename.';

-- ===========================================================================
-- 3. get_entity_co_occurrence — content_item_id -> source_document_id
-- ===========================================================================
CREATE OR REPLACE FUNCTION "public"."get_entity_co_occurrence"("p_limit" integer DEFAULT 20, "p_min_count" integer DEFAULT 2, "p_entity_type" "text" DEFAULT NULL::"text") RETURNS TABLE("entity_a" "text", "type_a" "text", "entity_b" "text", "type_b" "text", "shared_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  WITH filtered_mentions AS (
    -- Deduplicate: one row per (canonical_name, source_document_id)
    SELECT DISTINCT ON (canonical_name, source_document_id)
      canonical_name,
      COALESCE(entity_type_override, entity_type) AS effective_type,
      source_document_id
    FROM entity_mentions
    WHERE (p_entity_type IS NULL OR entity_type = p_entity_type
           OR entity_type_override = p_entity_type)
  ),
  pairs AS (
    SELECT
      LEAST(a.canonical_name, b.canonical_name) AS entity_a,
      CASE WHEN a.canonical_name < b.canonical_name THEN a.effective_type
           ELSE b.effective_type END AS type_a,
      GREATEST(a.canonical_name, b.canonical_name) AS entity_b,
      CASE WHEN a.canonical_name < b.canonical_name THEN b.effective_type
           ELSE a.effective_type END AS type_b,
      a.source_document_id
    FROM filtered_mentions a
    JOIN filtered_mentions b
      ON a.source_document_id = b.source_document_id
      AND a.canonical_name < b.canonical_name
  )
  SELECT
    p.entity_a,
    p.type_a,
    p.entity_b,
    p.type_b,
    COUNT(DISTINCT p.source_document_id) AS shared_count
  FROM pairs p
  GROUP BY p.entity_a, p.type_a, p.entity_b, p.type_b
  HAVING COUNT(DISTINCT p.source_document_id) >= p_min_count
  ORDER BY shared_count DESC
  LIMIT LEAST(p_limit, 50);
$$;

ALTER FUNCTION "public"."get_entity_co_occurrence"("p_limit" integer, "p_min_count" integer, "p_entity_type" "text") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."get_entity_co_occurrence"("p_limit" integer, "p_min_count" integer, "p_entity_type" "text") IS 'ID-131 {131.14}: entity co-occurrence pairing re-pointed onto entity_mentions.source_document_id post-M2 rename (output columns entity_a/type_a/entity_b/type_b/shared_count unchanged — shape-preserving).';

-- ===========================================================================
-- 4. delete_duplicate_entity_mentions — content_item_id -> source_document_id
-- ===========================================================================
CREATE OR REPLACE FUNCTION "public"."delete_duplicate_entity_mentions"("p_canonical_name" "text") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Delete duplicate mentions, keeping the row with highest confidence
  -- (or earliest created_at as tiebreaker).
  WITH duplicates AS (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY canonical_name, entity_type, source_document_id
        ORDER BY confidence DESC NULLS LAST, created_at ASC
      ) AS rn
    FROM entity_mentions
    WHERE canonical_name = p_canonical_name
  )
  DELETE FROM entity_mentions
  WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

ALTER FUNCTION "public"."delete_duplicate_entity_mentions"("p_canonical_name" "text") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."delete_duplicate_entity_mentions"("p_canonical_name" "text") IS 'Delete duplicate entity_mentions rows for a given canonical_name, keeping the highest-confidence row per (canonical_name, entity_type, source_document_id). ID-131 {131.14}: re-pointed post-M2 rename (was content_item_id).';

-- ===========================================================================
-- 5. get_dashboard_attention_counts — governance counts re-pointed onto
--    record_lifecycle (owner_kind='source_document'); RETURNS shape preserved.
-- ===========================================================================
CREATE OR REPLACE FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text" DEFAULT 'viewer'::"text")
    RETURNS TABLE(
      "governance_review_count" integer,
      "unverified_count" integer,
      "quality_flag_count" integer,
      "stale_content_count" integer,
      "expired_content_count" integer,
      "expiring_content_date_count" integer,
      "unread_notification_count" integer,
      "coverage_gap_count" integer,
      "freshness_summary" "jsonb"
    )
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_governance_review_count integer := 0;
  v_unverified_count integer;
  v_quality_flag_count integer := 0;
  v_stale_count integer;
  v_expired_count integer;
  v_fresh_count integer;
  v_aging_count integer;
  v_unread_notification_count integer;
  v_expiring_content_date_count integer;
  v_coverage_gap_count integer;
BEGIN
  -- Governance review count (editors + admins only).
  -- ID-131 {131.14}: re-pointed onto record_lifecycle (owner_kind='source_document',
  -- BI-20 review/governance axis), joined to source_documents for the "active
  -- record" (not archived) filter that content_items.archived_at used to provide.
  IF p_role IN ('admin', 'editor') THEN
    SELECT COUNT(*) INTO v_governance_review_count
    FROM record_lifecycle rl
    JOIN source_documents sd ON sd.id = rl.source_document_id
    WHERE rl.owner_kind = 'source_document'
      AND sd.archived_at IS NULL
      AND rl.governance_review_status = 'pending';

    -- Quality flag count (editors + admins only). ingestion_quality_log is
    -- not part of the record_lifecycle facet; its content_items dependency
    -- is {131.19}'s to retire alongside the content_items table drop — kept
    -- here, join re-pointed only to survive {131.13}'s content_item_id ->
    -- source_document_id rename (ID-131 {131.32} G-PRE-APPLY-131.13,
    -- surgical fix; not the {131.19} facet rework).
    SELECT COUNT(DISTINCT iql.source_document_id) INTO v_quality_flag_count
    FROM ingestion_quality_log iql
    JOIN content_items ci ON iql.source_document_id = ci.source_document_id
    WHERE iql.resolved = FALSE
      AND iql.source_document_id IS NOT NULL
      AND ci.archived_at IS NULL;
  END IF;

  -- Unverified count. ID-131 {131.14}: record_lifecycle.verified_at.
  SELECT COUNT(*) INTO v_unverified_count
  FROM record_lifecycle rl
  JOIN source_documents sd ON sd.id = rl.source_document_id
  WHERE rl.owner_kind = 'source_document'
    AND sd.archived_at IS NULL
    AND rl.verified_at IS NULL;

  -- Freshness breakdown (single scan). ID-131 {131.14}: record_lifecycle.freshness
  -- (BI-22 freshness/expiry axis is source_document-only).
  SELECT
    COUNT(*) FILTER (WHERE rl.freshness = 'fresh'),
    COUNT(*) FILTER (WHERE rl.freshness = 'aging'),
    COUNT(*) FILTER (WHERE rl.freshness = 'stale'),
    COUNT(*) FILTER (WHERE rl.freshness = 'expired')
  INTO v_fresh_count, v_aging_count, v_stale_count, v_expired_count
  FROM record_lifecycle rl
  JOIN source_documents sd ON sd.id = rl.source_document_id
  WHERE rl.owner_kind = 'source_document'
    AND sd.archived_at IS NULL
    AND rl.freshness IS NOT NULL;

  -- Unread notifications. UNCHANGED — unrelated to content_items/record_lifecycle.
  SELECT COUNT(*) INTO v_unread_notification_count
  FROM notifications
  WHERE user_id = p_user_id
    AND dismissed_at IS NULL
    AND read_at IS NULL
    AND (expires_at IS NULL OR expires_at > NOW());

  -- Expiring content dates (within 30 days). ID-131 {131.14}: record_lifecycle.expiry_date.
  SELECT COUNT(*) INTO v_expiring_content_date_count
  FROM record_lifecycle rl
  JOIN source_documents sd ON sd.id = rl.source_document_id
  WHERE rl.owner_kind = 'source_document'
    AND sd.archived_at IS NULL
    AND rl.expiry_date IS NOT NULL
    AND rl.expiry_date <= NOW() + INTERVAL '30 days';

  -- Coverage gaps: active subtopics with zero content items. UNCHANGED —
  -- taxonomy_subtopics / content_items.primary_subtopic is not part of the
  -- record_lifecycle facet; {131.19}'s to re-point alongside the table drop.
  SELECT COUNT(*) INTO v_coverage_gap_count
  FROM taxonomy_subtopics ts
  WHERE ts.is_active = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM content_items ci
      WHERE ci.primary_subtopic = ts.name
        AND ci.archived_at IS NULL
    );

  RETURN QUERY SELECT
    v_governance_review_count,
    v_unverified_count,
    v_quality_flag_count,
    v_stale_count,
    v_expired_count,
    v_expiring_content_date_count,
    v_unread_notification_count,
    v_coverage_gap_count,
    jsonb_build_object(
      'fresh', v_fresh_count,
      'aging', v_aging_count,
      'stale', v_stale_count,
      'expired', v_expired_count
    );
END;
$$;

ALTER FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") IS 'ID-131 {131.14}: governance/verification/freshness/expiry counts re-pointed onto record_lifecycle (owner_kind=''source_document'', BI-20/BI-22), joined to source_documents for the archived_at filter. quality_flag_count and coverage_gap_count remain on content_items/ingestion_quality_log/taxonomy_subtopics — the content_items/taxonomy_subtopics facet dependency is still out of this Subtask''s scope (bundled into {131.19} alongside the content_items table drop). {131.32} G-PRE-APPLY-131.13 surgically re-pointed ONLY the quality_flag_count subquery''s ingestion_quality_log join column (content_item_id -> source_document_id, per {131.13}''s rename) so this function survives GO-apply; the facet rework itself is untouched. RETURNS TABLE shape unchanged (ID-70); caller lib/dashboard.ts:316 reads data[0].<column> by name.';

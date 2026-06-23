-- ID-70 {70.5}: OQ-R9 opaque-Json RPC migration — RETURNS Json -> RETURNS TABLE.
--
-- Restores call-site type safety for 3 RPCs that resolved to opaque `Json`, and
-- drops 2 dead functions. Signature-only refactor: NO user-facing behaviour change.
--
-- Touches BOTH schemas: `public.*` (the row shapes `database.types.ts` is generated
-- against) AND the `api.*` SECURITY INVOKER wrappers (the runtime `.rpc()` target per
-- ID-115 — clients route to `api` at runtime, stay typed against `public`). The id-115
-- standalone migration was folded into the squash baseline (20260617130000), so the api
-- wrappers are updated here in this forward migration rather than via a generator re-run.
--
-- Postgres rejects a `CREATE OR REPLACE` that changes a function's return type, so each
-- migrated function is DROP-then-CREATE; the api wrapper is dropped FIRST (it references
-- `public.<fn>`), and a re-created function regains default EXECUTE-to-PUBLIC, so the
-- baseline grant pattern (REVOKE FROM PUBLIC; GRANT TO authenticated, service_role) is
-- re-stated for every re-created function. `anon` stays excluded.
--
-- See specs/id-70-opaque-json-rpc-migration/TECH.md ({70.3}).

-- ===========================================================================
-- 1. DROP the 2 dead functions (zero callers across TS/Python/SQL; no api wrapper)
-- ===========================================================================
DROP FUNCTION IF EXISTS "public"."get_workspace_counts"();
DROP FUNCTION IF EXISTS "public"."get_workspace_item_counts"();

-- ===========================================================================
-- 2. get_user_tag_counts (Tier 1) — RETURNS jsonb -> RETURNS TABLE(tag, count)
-- ===========================================================================
DROP FUNCTION IF EXISTS "api"."get_user_tag_counts"();
DROP FUNCTION IF EXISTS "public"."get_user_tag_counts"();

CREATE OR REPLACE FUNCTION "public"."get_user_tag_counts"()
    RETURNS TABLE("tag" "text", "count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT tag, COUNT(*) AS "count"
  FROM content_items ci, unnest(ci.user_tags) AS tag
  WHERE user_tags IS NOT NULL AND user_tags != '{}'
  GROUP BY tag
  ORDER BY COUNT(*) DESC;
$$;

ALTER FUNCTION "public"."get_user_tag_counts"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "api"."get_user_tag_counts"()
    RETURNS TABLE("tag" "text", "count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_user_tag_counts();
$$;

ALTER FUNCTION "api"."get_user_tag_counts"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_user_tag_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_tag_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_tag_counts"() TO "service_role";
REVOKE ALL ON FUNCTION "api"."get_user_tag_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_user_tag_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_user_tag_counts"() TO "service_role";

-- ===========================================================================
-- 3. merge_entities (DML) — RETURNS jsonb -> RETURNS TABLE(7 typed columns)
--    MUST stay LANGUAGE plpgsql (volatile) — it performs UPDATE x3 + DELETE.
--    Body preserved verbatim; only the trailing RETURN switches to RETURN QUERY.
-- ===========================================================================
DROP FUNCTION IF EXISTS "api"."merge_entities"("text"[], "text", "text");
DROP FUNCTION IF EXISTS "public"."merge_entities"("text"[], "text", "text");

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

  -- 4. Delete duplicate mentions (same canonical_name + entity_type + content_item_id)
  --    Keep the row with highest confidence (or earliest created_at as tiebreaker)
  --    NB (ID-70): columns are qualified with the `em` alias because the new
  --    RETURNS TABLE OUT column `entity_type` would otherwise be ambiguous against
  --    entity_mentions.entity_type inside this plpgsql body.
  WITH duplicates AS (
    SELECT em.id,
      ROW_NUMBER() OVER (
        PARTITION BY em.canonical_name, COALESCE(em.entity_type_override, em.entity_type), em.content_item_id
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

COMMENT ON FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") IS 'Atomically merge multiple entities into one canonical form. Updates mentions, relationships, and deduplicates — all within a single transaction. Returns a single typed row (ID-70).';

CREATE OR REPLACE FUNCTION "api"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text")
    RETURNS TABLE(
      "merged" boolean,
      "target" "text",
      "entity_type" "text",
      "mentions_updated" integer,
      "relationship_sources_updated" integer,
      "relationship_targets_updated" integer,
      "duplicates_removed" integer
    )
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.merge_entities(p_source_names => p_source_names, p_target_name => p_target_name, p_entity_type => p_entity_type);
$$;

ALTER FUNCTION "api"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") TO "service_role";
REVOKE ALL ON FUNCTION "api"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") TO "service_role";

-- ===========================================================================
-- 4. get_dashboard_attention_counts (Tier 2) — RETURNS json -> RETURNS TABLE
--    Option (a): 8 typed integer scalar columns + freshness_summary jsonb.
--    Body preserved verbatim; only the trailing RETURN switches to RETURN QUERY,
--    and the freshness sub-object becomes jsonb_build_object (the jsonb column).
-- ===========================================================================
DROP FUNCTION IF EXISTS "api"."get_dashboard_attention_counts"("uuid", "text");
DROP FUNCTION IF EXISTS "public"."get_dashboard_attention_counts"("uuid", "text");

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
  -- Governance review count (editors + admins only)
  IF p_role IN ('admin', 'editor') THEN
    SELECT COUNT(*) INTO v_governance_review_count
    FROM content_items
    WHERE archived_at IS NULL
      AND governance_review_status = 'pending';

    -- Quality flag count (editors + admins only)
    SELECT COUNT(DISTINCT content_item_id) INTO v_quality_flag_count
    FROM ingestion_quality_log iql
    JOIN content_items ci ON iql.content_item_id = ci.id
    WHERE iql.resolved = FALSE
      AND iql.content_item_id IS NOT NULL
      AND ci.archived_at IS NULL;
  END IF;

  -- Unverified count
  SELECT COUNT(*) INTO v_unverified_count
  FROM content_items
  WHERE archived_at IS NULL
    AND verified_at IS NULL;

  -- Freshness breakdown (single scan)
  SELECT
    COUNT(*) FILTER (WHERE freshness = 'fresh'),
    COUNT(*) FILTER (WHERE freshness = 'aging'),
    COUNT(*) FILTER (WHERE freshness = 'stale'),
    COUNT(*) FILTER (WHERE freshness = 'expired')
  INTO v_fresh_count, v_aging_count, v_stale_count, v_expired_count
  FROM content_items
  WHERE archived_at IS NULL
    AND freshness IS NOT NULL;

  -- Unread notifications
  SELECT COUNT(*) INTO v_unread_notification_count
  FROM notifications
  WHERE user_id = p_user_id
    AND dismissed_at IS NULL
    AND read_at IS NULL
    AND (expires_at IS NULL OR expires_at > NOW());

  -- Expiring content dates (within 30 days)
  SELECT COUNT(*) INTO v_expiring_content_date_count
  FROM content_items
  WHERE archived_at IS NULL
    AND expiry_date IS NOT NULL
    AND expiry_date <= NOW() + INTERVAL '30 days';

  -- Coverage gaps: active subtopics with zero content items
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

CREATE OR REPLACE FUNCTION "api"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text" DEFAULT 'viewer'::"text")
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
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_dashboard_attention_counts(p_user_id => p_user_id, p_role => p_role);
$$;

ALTER FUNCTION "api"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") TO "service_role";
REVOKE ALL ON FUNCTION "api"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") TO "service_role";

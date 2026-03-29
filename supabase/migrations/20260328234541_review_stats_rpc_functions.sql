-- Migration: review_stats_rpc_functions
-- Purpose: Move client-side JS aggregation to server-side RPC functions for
-- review stats, entity co-occurrence, entity listing, and dashboard attention counts.

-- =============================================================================
-- 1. get_review_breakdown_stats()
-- Replaces JS aggregation in app/api/review/stats/route.ts
-- =============================================================================

CREATE OR REPLACE FUNCTION get_review_breakdown_stats()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
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

ALTER FUNCTION get_review_breakdown_stats() OWNER TO postgres;


-- =============================================================================
-- 2. get_entity_co_occurrence(p_limit, p_min_count, p_entity_type)
-- Replaces JS self-join in app/api/entities/co-occurrence/route.ts
-- =============================================================================

CREATE OR REPLACE FUNCTION get_entity_co_occurrence(
  p_limit integer DEFAULT 20,
  p_min_count integer DEFAULT 2,
  p_entity_type text DEFAULT NULL
)
RETURNS TABLE(
  entity_a text,
  type_a text,
  entity_b text,
  type_b text,
  shared_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH filtered_mentions AS (
    -- Deduplicate: one row per (canonical_name, content_item_id)
    SELECT DISTINCT ON (canonical_name, content_item_id)
      canonical_name,
      COALESCE(entity_type_override, entity_type) AS effective_type,
      content_item_id
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
      a.content_item_id
    FROM filtered_mentions a
    JOIN filtered_mentions b
      ON a.content_item_id = b.content_item_id
      AND a.canonical_name < b.canonical_name
  )
  SELECT
    p.entity_a,
    p.type_a,
    p.entity_b,
    p.type_b,
    COUNT(DISTINCT p.content_item_id) AS shared_count
  FROM pairs p
  GROUP BY p.entity_a, p.type_a, p.entity_b, p.type_b
  HAVING COUNT(DISTINCT p.content_item_id) >= p_min_count
  ORDER BY shared_count DESC
  LIMIT LEAST(p_limit, 50);
$$;

ALTER FUNCTION get_entity_co_occurrence(integer, integer, text) OWNER TO postgres;


-- =============================================================================
-- 3. get_entity_list_aggregated(...)
-- Replaces JS aggregation in app/api/entities/route.ts
-- =============================================================================

CREATE OR REPLACE FUNCTION get_entity_list_aggregated(
  p_type text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_variants_only boolean DEFAULT false,
  p_type_conflicts boolean DEFAULT false,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  result json;
BEGIN
  WITH entity_agg AS (
    SELECT
      em.canonical_name,
      COALESCE(
        MAX(em.entity_type_override),
        MAX(em.entity_type)
      ) AS effective_type,
      COUNT(*) AS mention_count,
      COUNT(DISTINCT em.entity_name) AS variant_count,
      array_agg(DISTINCT em.entity_name) AS variant_names,
      -- types_seen_count: deduplicated count across both entity_type and
      -- entity_type_override columns. Uses a subquery to UNION the two sources
      -- and COUNT(DISTINCT), matching the JS code's Set-based deduplication.
      (SELECT COUNT(DISTINCT t) FROM (
        SELECT entity_type AS t FROM entity_mentions WHERE canonical_name = em.canonical_name
        UNION
        SELECT entity_type_override FROM entity_mentions WHERE canonical_name = em.canonical_name AND entity_type_override IS NOT NULL
      ) sub) AS types_seen_count,
      array_agg(DISTINCT em.entity_type) ||
        array_agg(DISTINCT em.entity_type_override) FILTER (WHERE em.entity_type_override IS NOT NULL) AS types_seen_raw
    FROM entity_mentions em
    WHERE
      (p_type IS NULL OR em.entity_type = p_type
       OR (em.entity_type_override IS NOT NULL AND em.entity_type_override = p_type)
       OR (em.entity_type_override IS NULL AND em.entity_type = p_type))
      AND (p_search IS NULL OR em.canonical_name ILIKE '%' || p_search || '%')
    GROUP BY em.canonical_name
  ),
  filtered AS (
    SELECT *
    FROM entity_agg ea
    WHERE
      (NOT p_variants_only OR ea.variant_count > 1)
      AND (NOT p_type_conflicts OR ea.types_seen_count > 1)
  ),
  with_rels AS (
    SELECT
      f.*,
      COALESCE(rc.rel_count, 0) AS relationship_count
    FROM filtered f
    LEFT JOIN (
      SELECT entity_name, COUNT(*) AS rel_count
      FROM (
        SELECT source_entity AS entity_name FROM entity_relationships
        WHERE source_entity IN (SELECT canonical_name FROM filtered)
        UNION ALL
        SELECT target_entity AS entity_name FROM entity_relationships
        WHERE target_entity IN (SELECT canonical_name FROM filtered)
      ) combined
      GROUP BY entity_name
    ) rc ON rc.entity_name = f.canonical_name
  ),
  total_count AS (
    SELECT COUNT(*) AS cnt FROM with_rels
  ),
  paged AS (
    SELECT *
    FROM with_rels
    ORDER BY mention_count DESC
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT json_build_object(
    'entities', (
      SELECT COALESCE(json_agg(json_build_object(
        'canonical_name', p.canonical_name,
        'entity_type', p.effective_type,
        'mention_count', p.mention_count,
        'variant_count', p.variant_count,
        'variant_names', p.variant_names,
        'relationship_count', p.relationship_count,
        'has_type_conflict', (p.types_seen_count > 1),
        'types_seen', (
          SELECT array_agg(DISTINCT t)
          FROM unnest(p.types_seen_raw) AS t
          WHERE t IS NOT NULL
        )
      ) ORDER BY p.mention_count DESC), '[]'::json)
      FROM paged p
    ),
    'total', (SELECT cnt FROM total_count)
  ) INTO result;

  RETURN result;
END;
$$;

ALTER FUNCTION get_entity_list_aggregated(text, text, boolean, boolean, integer, integer) OWNER TO postgres;


-- =============================================================================
-- 4. get_dashboard_attention_counts(p_user_id, p_role)
-- Consolidates 8 parallel dashboard queries into 1 RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION get_dashboard_attention_counts(
  p_user_id uuid,
  p_role text DEFAULT 'viewer'
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  result json;
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

  SELECT json_build_object(
    'governance_review_count', v_governance_review_count,
    'unverified_count', v_unverified_count,
    'quality_flag_count', v_quality_flag_count,
    'stale_content_count', v_stale_count,
    'expired_content_count', v_expired_count,
    'expiring_content_date_count', v_expiring_content_date_count,
    'unread_notification_count', v_unread_notification_count,
    'coverage_gap_count', v_coverage_gap_count,
    'freshness_summary', json_build_object(
      'fresh', v_fresh_count,
      'aging', v_aging_count,
      'stale', v_stale_count,
      'expired', v_expired_count
    )
  ) INTO result;

  RETURN result;
END;
$$;

ALTER FUNCTION get_dashboard_attention_counts(uuid, text) OWNER TO postgres;


-- =============================================================================
-- 5. Supporting index for ingestion_quality_log (if not already present)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_iql_review_needed_unresolved
  ON ingestion_quality_log (content_item_id)
  WHERE flag_type = 'review_needed' AND resolved = FALSE;

-- NOTE: An index named `idx_notifications_user_unread` already exists with
-- columns (user_id, created_at DESC) and the same WHERE clause. The existing
-- index already covers the notification count query (filters on user_id with
-- the same partial conditions). Do NOT create a duplicate -- the existing
-- index is sufficient and includes created_at DESC ordering which benefits
-- other notification queries.

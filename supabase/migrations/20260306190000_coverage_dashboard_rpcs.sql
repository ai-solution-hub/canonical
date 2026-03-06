-- =============================================================================
-- Migration: Coverage Dashboard RPCs
-- =============================================================================
-- Two RPCs to power the Coverage Dashboard:
--   1. get_coverage_matrix — full domain x subtopic grid with freshness counts
--   2. get_coverage_summary — per-domain totals, fresh %, gaps, expired count
-- =============================================================================

-- =============================================================================
-- RPC 1: get_coverage_matrix
-- =============================================================================
-- Returns one row per domain+subtopic combination (including those with zero
-- content items), with item counts broken down by freshness state.
-- Optional p_layer parameter filters content to a specific layer.
-- Excludes draft items from all counts.

CREATE OR REPLACE FUNCTION get_coverage_matrix(p_layer text DEFAULT NULL)
RETURNS TABLE (
  domain_name   text,
  subtopic_name text,
  item_count    bigint,
  fresh_count   bigint,
  aging_count   bigint,
  stale_count   bigint,
  expired_count bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    d.name::text                                            AS domain_name,
    s.name::text                                            AS subtopic_name,
    COUNT(ci.id)                                            AS item_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'fresh')      AS fresh_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'aging')      AS aging_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'stale')      AS stale_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'expired')    AS expired_count
  FROM taxonomy_domains d
  INNER JOIN taxonomy_subtopics s ON s.domain_id = d.id AND s.is_active = TRUE
  LEFT JOIN content_items ci
    ON ci.primary_domain = d.name
    AND ci.primary_subtopic = s.name
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
    AND (p_layer IS NULL OR ci.metadata->>'layer' = p_layer)
  WHERE d.is_active = TRUE
  GROUP BY d.name, s.name, d.display_order, s.display_order
  ORDER BY d.display_order, s.display_order;
$$;

-- =============================================================================
-- RPC 2: get_coverage_summary
-- =============================================================================
-- Returns one row per active domain with aggregate coverage metrics:
--   - total_items: count of non-draft content items in the domain
--   - fresh_pct: percentage of items with freshness = 'fresh' (0 if no items)
--   - gap_count: number of active subtopics with zero content items
--   - expired_count: number of items with freshness = 'expired'

CREATE OR REPLACE FUNCTION get_coverage_summary()
RETURNS TABLE (
  domain_name    text,
  domain_colour  text,
  total_items    bigint,
  fresh_pct      numeric,
  gap_count      bigint,
  expired_count  bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    d.name::text                                              AS domain_name,
    d.colour::text                                            AS domain_colour,
    COUNT(ci.id)                                              AS total_items,
    CASE
      WHEN COUNT(ci.id) = 0 THEN 0
      ELSE ROUND(
        100.0 * COUNT(ci.id) FILTER (WHERE ci.freshness = 'fresh') / COUNT(ci.id),
        1
      )
    END                                                       AS fresh_pct,
    -- Count subtopics that have zero non-draft items in this domain
    (
      SELECT COUNT(*)
      FROM taxonomy_subtopics sub
      WHERE sub.domain_id = d.id
        AND sub.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM content_items ci2
          WHERE ci2.primary_domain = d.name
            AND ci2.primary_subtopic = sub.name
            AND (ci2.governance_review_status IS NULL OR ci2.governance_review_status != 'draft')
        )
    )                                                         AS gap_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'expired')      AS expired_count
  FROM taxonomy_domains d
  LEFT JOIN content_items ci
    ON ci.primary_domain = d.name
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
  WHERE d.is_active = TRUE
  GROUP BY d.id, d.name, d.colour, d.display_order
  ORDER BY d.display_order;
$$;

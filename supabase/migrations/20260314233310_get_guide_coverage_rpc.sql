-- RPC: get_guide_coverage
-- Returns one row per guide section with content count and freshness summary.
-- Used by the Coverage Dashboard "Guides" tab.

CREATE OR REPLACE FUNCTION get_guide_coverage()
RETURNS TABLE (
  guide_id uuid,
  guide_name text,
  guide_slug text,
  guide_type text,
  domain_filter text,
  section_id uuid,
  section_name text,
  section_order int,
  expected_layer text,
  is_required boolean,
  content_count bigint,
  fresh_count bigint,
  stale_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    g.id AS guide_id,
    g.name AS guide_name,
    g.slug AS guide_slug,
    g.guide_type,
    g.domain_filter,
    gs.id AS section_id,
    gs.section_name,
    gs.display_order AS section_order,
    gs.expected_layer,
    gs.is_required,
    COUNT(ci.id) AS content_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'fresh') AS fresh_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness IN ('stale', 'expired')) AS stale_count
  FROM guides g
  JOIN guide_sections gs ON gs.guide_id = g.id
  LEFT JOIN content_items ci ON (
    ci.primary_domain = g.domain_filter
    AND (gs.subtopic_filter IS NULL OR ci.primary_subtopic = gs.subtopic_filter)
    AND (gs.expected_layer IS NULL OR ci.metadata->>'layer' = gs.expected_layer)
    AND (gs.content_type_filter IS NULL OR ci.content_type = gs.content_type_filter)
    AND ci.archived_at IS NULL
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
  )
  WHERE g.is_published = true
  GROUP BY g.id, g.name, g.slug, g.guide_type, g.domain_filter,
           gs.id, gs.section_name, gs.display_order, gs.expected_layer, gs.is_required
  ORDER BY g.display_order, g.name, gs.display_order;
$$;

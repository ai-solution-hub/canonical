-- Migration: secondary_domain_guide_matching
-- Purpose: Include secondary_domain matches in guide content and coverage RPCs.
--          Also migrates layer references from metadata->>'layer' to ci.layer (promoted column).

-- 1. Index on secondary_domain for performant OR matching
CREATE INDEX IF NOT EXISTS idx_content_items_secondary_domain
  ON content_items (secondary_domain) WHERE secondary_domain IS NOT NULL;

-- 2. Update get_guide_content to match on primary OR secondary domain,
--    match secondary_subtopic against subtopic_filter,
--    and use ci.layer instead of metadata->>'layer'
CREATE OR REPLACE FUNCTION get_guide_content(p_guide_slug text)
RETURNS TABLE(
  section_id uuid,
  section_name text,
  section_description text,
  section_order integer,
  expected_layer text,
  subtopic_filter text,
  is_required boolean,
  content_id uuid,
  content_title text,
  content_type text,
  content_layer text,
  content_brief text,
  content_freshness text,
  content_verified_at timestamptz,
  content_captured_date timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    gs.id AS section_id,
    gs.section_name,
    gs.description AS section_description,
    gs.display_order AS section_order,
    gs.expected_layer,
    gs.subtopic_filter,
    gs.is_required,
    ci.id AS content_id,
    ci.title AS content_title,
    ci.content_type,
    ci.layer AS content_layer,
    ci.brief AS content_brief,
    ci.freshness AS content_freshness,
    ci.verified_at AS content_verified_at,
    ci.captured_date AS content_captured_date
  FROM guide_sections gs
  JOIN guides g ON g.id = gs.guide_id
  LEFT JOIN content_items ci ON (
    -- Match by domain (primary OR secondary) from guide
    (ci.primary_domain = g.domain_filter OR ci.secondary_domain = g.domain_filter)
    AND (gs.subtopic_filter IS NULL OR ci.primary_subtopic = gs.subtopic_filter
         OR ci.secondary_subtopic = gs.subtopic_filter)
    -- Match by layer if section specifies one
    AND (gs.expected_layer IS NULL OR ci.layer = gs.expected_layer)
    -- Match by content type if section specifies one
    AND (gs.content_type_filter IS NULL OR ci.content_type = gs.content_type_filter)
    -- Exclude drafts
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
    -- Exclude archived items
    AND ci.archived_at IS NULL
  )
  WHERE g.slug = p_guide_slug
  ORDER BY gs.display_order, ci.captured_date DESC;
$$;

ALTER FUNCTION get_guide_content(text) OWNER TO postgres;

-- 3. Update get_guide_coverage with the same secondary domain matching fix
--    and use ci.layer instead of metadata->>'layer'
CREATE OR REPLACE FUNCTION get_guide_coverage()
RETURNS TABLE(
  guide_id uuid,
  guide_name text,
  guide_slug text,
  guide_type text,
  domain_filter text,
  section_id uuid,
  section_name text,
  section_order integer,
  expected_layer text,
  is_required boolean,
  content_count bigint,
  fresh_count bigint,
  stale_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
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
    -- Match by domain (primary OR secondary) from guide
    (ci.primary_domain = g.domain_filter OR ci.secondary_domain = g.domain_filter)
    AND (gs.subtopic_filter IS NULL OR ci.primary_subtopic = gs.subtopic_filter
         OR ci.secondary_subtopic = gs.subtopic_filter)
    -- Match by layer if section specifies one
    AND (gs.expected_layer IS NULL OR ci.layer = gs.expected_layer)
    -- Match by content type if section specifies one
    AND (gs.content_type_filter IS NULL OR ci.content_type = gs.content_type_filter)
    -- Exclude archived items
    AND ci.archived_at IS NULL
    -- Exclude drafts
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
  )
  WHERE g.is_published = true
  GROUP BY g.id, g.name, g.slug, g.guide_type, g.domain_filter,
           gs.id, gs.section_name, gs.display_order, gs.expected_layer, gs.is_required
  ORDER BY g.display_order, g.name, gs.display_order;
$$;

ALTER FUNCTION get_guide_coverage() OWNER TO postgres;

-- Returns guide sections with matched content items
-- Each row is a section + one matched content item (or NULL if no content)
CREATE OR REPLACE FUNCTION get_guide_content(p_guide_slug text)
RETURNS TABLE (
  section_id uuid,
  section_name text,
  section_description text,
  section_order int,
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
    ci.metadata->>'layer' AS content_layer,
    ci.brief AS content_brief,
    ci.freshness AS content_freshness,
    ci.verified_at AS content_verified_at,
    ci.captured_date AS content_captured_date
  FROM guide_sections gs
  JOIN guides g ON g.id = gs.guide_id
  LEFT JOIN content_items ci ON (
    -- Match by domain (from guide) + subtopic (from section)
    ci.primary_domain = g.domain_filter
    AND (gs.subtopic_filter IS NULL OR ci.primary_subtopic = gs.subtopic_filter)
    -- Match by layer if section specifies one
    AND (gs.expected_layer IS NULL OR ci.metadata->>'layer' = gs.expected_layer)
    -- Match by content type if section specifies one
    AND (gs.content_type_filter IS NULL OR ci.content_type = gs.content_type_filter)
    -- Exclude drafts (correction 4: proper NULL handling)
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
    -- Exclude archived items (correction 3)
    AND ci.archived_at IS NULL
  )
  WHERE g.slug = p_guide_slug
  ORDER BY gs.display_order, ci.captured_date DESC;
$$;

-- =============================================================================
-- Migration: Add content_citations table and win rate RPC
--
-- Part of the feedback loop (WP-5): tracks which KB content items were used
-- in bid responses and calculates win rates to boost search ranking for
-- effective content.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. content_citations — Tracks which content items were used in bid responses
-- ---------------------------------------------------------------------------

CREATE TABLE content_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  bid_response_id uuid NOT NULL REFERENCES bid_responses(id) ON DELETE CASCADE,
  citation_type text NOT NULL DEFAULT 'reference' CHECK (citation_type IN ('reference', 'copied', 'adapted', 'inspired')),
  created_at timestamptz DEFAULT now(),
  created_by uuid,
  UNIQUE(content_item_id, bid_response_id)
);

CREATE INDEX idx_content_citations_item ON content_citations(content_item_id);
CREATE INDEX idx_content_citations_response ON content_citations(bid_response_id);

-- ---------------------------------------------------------------------------
-- 2. RLS policies
-- ---------------------------------------------------------------------------

ALTER TABLE content_citations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view citations"
  ON content_citations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Editors and admins can manage citations"
  ON content_citations FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Editors and admins can update citations"
  ON content_citations FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Admins can delete citations"
  ON content_citations FOR DELETE TO authenticated
  USING (get_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 3. get_content_win_rate RPC — Calculates how often cited content is
--    associated with winning bid outcomes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_content_win_rate(p_content_item_id uuid)
RETURNS TABLE (
  total_citations bigint,
  winning_citations bigint,
  win_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH citation_outcomes AS (
    SELECT
      cc.content_item_id,
      cc.bid_response_id,
      bq.project_id,
      w.domain_metadata->>'outcome' as bid_outcome
    FROM content_citations cc
    JOIN bid_responses br ON br.id = cc.bid_response_id
    JOIN bid_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.project_id
    WHERE cc.content_item_id = p_content_item_id
  )
  SELECT
    COUNT(*)::bigint as total_citations,
    COUNT(*) FILTER (WHERE bid_outcome = 'won')::bigint as winning_citations,
    CASE
      WHEN COUNT(*) > 0 THEN
        ROUND((COUNT(*) FILTER (WHERE bid_outcome = 'won'))::numeric / COUNT(*)::numeric, 2)
      ELSE 0
    END as win_rate
  FROM citation_outcomes;
END;
$$;

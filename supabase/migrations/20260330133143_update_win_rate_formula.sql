-- Update get_content_win_rate to use won/(won+lost) formula
-- instead of won/total. This excludes pending and withdrawn bids
-- from the denominator, preventing early-stage bids from deflating
-- the win rate. Also adds losing_citations and pending_citations
-- to support the "awaiting outcomes" UI state.

-- Must DROP first because we are adding new return columns
DROP FUNCTION IF EXISTS public.get_content_win_rate(uuid);

CREATE OR REPLACE FUNCTION public.get_content_win_rate(p_content_item_id uuid)
RETURNS TABLE(
  total_citations bigint,
  winning_citations bigint,
  losing_citations bigint,
  pending_citations bigint,
  win_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
    COUNT(*) FILTER (WHERE bid_outcome = 'lost')::bigint as losing_citations,
    COUNT(*) FILTER (WHERE bid_outcome IS NULL
                      OR bid_outcome NOT IN ('won', 'lost', 'withdrawn'))::bigint as pending_citations,
    CASE
      WHEN COUNT(*) FILTER (WHERE bid_outcome IN ('won', 'lost')) > 0 THEN
        ROUND(
          COUNT(*) FILTER (WHERE bid_outcome = 'won')::numeric /
          COUNT(*) FILTER (WHERE bid_outcome IN ('won', 'lost'))::numeric,
          2
        )
      ELSE 0
    END as win_rate
  FROM citation_outcomes;
END;
$$;

-- Aggregate win-rate analytics RPC
-- Returns overall and per-domain win-rate metrics for the content performance dashboard.
-- Win rate = won / (won + lost), excluding pending and withdrawn bids.

CREATE OR REPLACE FUNCTION get_aggregate_win_rate_stats()
RETURNS TABLE(
  scope text,
  total_citations bigint,
  winning_citations bigint,
  losing_citations bigint,
  pending_citations bigint,
  win_rate numeric,
  unique_items_cited bigint,
  unique_bids bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY

  WITH citation_detail AS (
    SELECT
      ci.primary_domain,
      cc.content_item_id,
      cc.bid_response_id,
      bq.project_id,
      w.domain_metadata->>'outcome' as bid_outcome
    FROM content_citations cc
    JOIN content_items ci ON ci.id = cc.content_item_id
    JOIN bid_responses br ON br.id = cc.bid_response_id
    JOIN bid_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.project_id
  ),
  domain_stats AS (
    SELECT
      primary_domain as scope,
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
      END as win_rate,
      COUNT(DISTINCT content_item_id)::bigint as unique_items_cited,
      COUNT(DISTINCT project_id)::bigint as unique_bids
    FROM citation_detail
    GROUP BY primary_domain
  ),
  overall AS (
    SELECT
      'overall'::text as scope,
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
      END as win_rate,
      COUNT(DISTINCT content_item_id)::bigint as unique_items_cited,
      COUNT(DISTINCT project_id)::bigint as unique_bids
    FROM citation_detail
  )
  SELECT * FROM overall
  UNION ALL
  SELECT * FROM domain_stats
  ORDER BY scope;
END;
$$;

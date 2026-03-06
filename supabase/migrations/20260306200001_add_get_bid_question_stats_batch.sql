-- Migration: Add get_bid_question_stats_batch RPC
-- Batch version of get_bid_question_stats that accepts an array of project IDs
-- to avoid N+1 queries when listing bids.

CREATE OR REPLACE FUNCTION public.get_bid_question_stats_batch(p_project_ids UUID[])
RETURNS TABLE(
  project_id UUID,
  total_questions BIGINT,
  strong_match_count BIGINT,
  partial_match_count BIGINT,
  needs_sme_count BIGINT,
  no_content_count BIGINT,
  unmatched_count BIGINT,
  drafted_count BIGINT,
  complete_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    bq.project_id,
    COUNT(*)::BIGINT AS total_questions,
    COUNT(*) FILTER (WHERE confidence_posture = 'strong_match')::BIGINT AS strong_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'partial_match')::BIGINT AS partial_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'needs_sme')::BIGINT AS needs_sme_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'no_content')::BIGINT AS no_content_count,
    COUNT(*) FILTER (WHERE confidence_posture IS NULL)::BIGINT AS unmatched_count,
    COUNT(*) FILTER (WHERE status = 'ai_drafted')::BIGINT AS drafted_count,
    COUNT(*) FILTER (WHERE status = 'complete')::BIGINT AS complete_count
  FROM bid_questions bq
  WHERE bq.project_id = ANY(p_project_ids)
  GROUP BY bq.project_id;
$$;

-- get_bid_question_stats: single-project question stats RPC.
--
-- Gap discovered during S180 re-ingestion build check: present on the old
-- project (rovrymhhffssilaftdwd) and referenced by
-- app/api/bids/[id]/questions/route.ts, but absent from the S176 squashed
-- schema. Sibling `get_bid_question_stats_batch` was squashed in; the
-- singleton was dropped.
--
-- Definition copied verbatim from the old project via
-- `pg_get_functiondef`.

CREATE OR REPLACE FUNCTION public.get_bid_question_stats(p_project_id uuid)
RETURNS TABLE(
  total_questions bigint,
  strong_match_count bigint,
  partial_match_count bigint,
  needs_sme_count bigint,
  no_content_count bigint,
  unmatched_count bigint,
  drafted_count bigint,
  complete_count bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    COUNT(*)::BIGINT AS total_questions,
    COUNT(*) FILTER (WHERE confidence_posture = 'strong_match')::BIGINT AS strong_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'partial_match')::BIGINT AS partial_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'needs_sme')::BIGINT AS needs_sme_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'no_content')::BIGINT AS no_content_count,
    COUNT(*) FILTER (WHERE confidence_posture IS NULL)::BIGINT AS unmatched_count,
    COUNT(*) FILTER (WHERE status = 'ai_drafted')::BIGINT AS drafted_count,
    COUNT(*) FILTER (WHERE status = 'complete')::BIGINT AS complete_count
  FROM bid_questions
  WHERE project_id = p_project_id;
$function$;

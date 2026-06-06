-- =============================================================================
-- ID-84.1 — redefine four stale bid_questions.project_id RPCs (T2 rename rot)
-- =============================================================================
--
-- Scope: S319 CI restoration. The T2 column rename (20260520120828,
-- `bid_questions.project_id → workspace_id`) does NOT rewrite function
-- bodies; four RPCs continued to reference the dropped column and error
-- SQLSTATE 42703 on every call:
--
--   1. get_bid_question_stats(p_project_id uuid)
--        def 20260419094557 — `WHERE project_id = p_project_id`.
--        Live-broken MCP get_procurement_detail (eval L3 TE-04, L4 FC-31).
--   2. get_content_win_rate(p_content_item_id uuid)
--        pre-squash 20260416102457:1123 — CTE selects `bq.project_id` and
--        joins `workspaces w ON w.id = bq.project_id`.
--        Live-broken MCP get_content_effectiveness (eval L4 FC-51).
--   3. get_bid_summary(bid_workspace_id uuid)
--        pre-squash 20260416102457:1029 — six `project_id` body sites.
--        No current rpc() call-sites (defined-only per ops43 audit) but
--        equally broken; redefined for catalogue hygiene + prod parity.
--   4. get_aggregate_win_rate_stats()
--        pre-squash — CTE `bq.project_id` select + join + two
--        `COUNT(DISTINCT project_id)` aggregate refs.
--        Caller: app/api/analytics/win-rate/route.ts.
--
-- ID-22 (20260521100650) documented this 42703 class but fixed ONLY
-- get_bid_question_stats_batch. Catalogue sweep on staging
-- (pg_proc WHERE prosrc ILIKE '%project_id%' AND prosrc ILIKE
-- '%bid_questions%') returns exactly these four + the already-fixed
-- _batch variant (matched only on its `p_project_ids` parameter name) —
-- no other stale functions exist.
--
-- Shape preservation (load-bearing — MCP tools + API routes depend on it):
--   * Parameter names preserved verbatim (`p_project_id`,
--     `p_content_item_id`, `bid_workspace_id`) — T2 carve-out per
--     no-bid-regression-guard.test.ts; rpc() callers pass named args.
--   * RETURNS clauses byte-identical to live defs — CREATE OR REPLACE is
--     legal (no return-type change) and preserves existing ACLs.
--   * Body change is strictly `project_id → workspace_id` column refs
--     (+ internal CTE column rename in the two win-rate functions; the
--     CTE column is not part of any return shape).
--
-- ACL posture (audited live on staging 06/06/2026, all four identical):
--   proacl = {postgres=X, authenticated=X, service_role=X} — PUBLIC and
--   anon revoked (ops43 20260502143049), SECURITY INVOKER (ops43.1
--   20260502232856). Re-asserted explicitly below per RLS-PATTERN P-4 so
--   fresh-environment replays (preview branches) land the same posture.
--   Per bl-231: no PUBLIC grant exists on these functions today, so the
--   REVOKE below preserves (not regresses) the live posture.
--
-- Apply log:
--   * staging (turayklvaunphgbgscat): applied 06/06/2026 (S319 ID-84.1)
--   * prod    (rovrymhhffssilaftdwd): orchestrator-executed opt-in push
--     (Liam-ratified S319) — NOT applied by this subtask.

SET search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- 1. get_bid_question_stats — single-workspace question-stats aggregator
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_bid_question_stats(p_project_id uuid)
RETURNS TABLE(
  total_questions     bigint,
  strong_match_count  bigint,
  partial_match_count bigint,
  needs_sme_count     bigint,
  no_content_count    bigint,
  unmatched_count     bigint,
  drafted_count       bigint,
  complete_count      bigint
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
  WHERE workspace_id = p_project_id;
$function$;

ALTER FUNCTION public.get_bid_question_stats(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_bid_question_stats(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_bid_question_stats(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_bid_question_stats(uuid) IS
  'ID-84.1 (S319) — single-workspace question-stats aggregator. Body fixed '
  'from the dropped bid_questions.project_id column to workspace_id (T2 '
  'rename rot, SQLSTATE 42703 since S247 prod-apply). Parameter name '
  'p_project_id preserved for caller signature stability (T2 carve-out per '
  'no-bid-regression-guard.test.ts).';

-- -----------------------------------------------------------------------------
-- 2. get_content_win_rate — per-content-item citation win-rate
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_content_win_rate(p_content_item_id uuid)
RETURNS TABLE(
  total_citations   bigint,
  winning_citations bigint,
  losing_citations  bigint,
  pending_citations bigint,
  win_rate          numeric
)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  WITH citation_outcomes AS (
    SELECT
      cc.content_item_id,
      cc.bid_response_id,
      bq.workspace_id,
      w.domain_metadata->>'outcome' as bid_outcome
    FROM content_citations cc
    JOIN bid_responses br ON br.id = cc.bid_response_id
    JOIN bid_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.workspace_id
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
$function$;

ALTER FUNCTION public.get_content_win_rate(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_content_win_rate(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_content_win_rate(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_content_win_rate(uuid) IS
  'ID-84.1 (S319) — per-content-item citation win-rate. CTE join fixed from '
  'the dropped bid_questions.project_id column to workspace_id (T2 rename '
  'rot, SQLSTATE 42703). Return shape and parameter name unchanged.';

-- -----------------------------------------------------------------------------
-- 3. get_bid_summary — workspace rollup JSON (defined-only; no TS callers)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_bid_summary(bid_workspace_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT json_build_object(
    'workspace_id', bid_workspace_id,
    'total_questions', (SELECT COUNT(*) FROM bid_questions WHERE workspace_id = bid_workspace_id),
    'status_breakdown', (
      SELECT json_agg(json_build_object('status', status, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT status, COUNT(*) AS cnt FROM bid_questions WHERE workspace_id = bid_workspace_id GROUP BY status) sub),
    'confidence_breakdown', (
      SELECT json_agg(json_build_object('posture', confidence_posture, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT confidence_posture, COUNT(*) AS cnt FROM bid_questions
        WHERE workspace_id = bid_workspace_id AND confidence_posture IS NOT NULL GROUP BY confidence_posture) sub),
    'responses_count', (
      SELECT COUNT(*) FROM bid_responses br JOIN bid_questions bq ON bq.id = br.question_id WHERE bq.workspace_id = bid_workspace_id),
    'review_status_breakdown', (
      SELECT json_agg(json_build_object('status', review_status, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT br.review_status, COUNT(*) AS cnt FROM bid_responses br
        JOIN bid_questions bq ON bq.id = br.question_id WHERE bq.workspace_id = bid_workspace_id GROUP BY br.review_status) sub),
    'sections', (
      SELECT json_agg(json_build_object('section', section_name, 'question_count', cnt, 'completed', completed_cnt) ORDER BY min_seq)
      FROM (SELECT bq.section_name, COUNT(*) AS cnt, COUNT(*) FILTER (WHERE bq.status = 'complete') AS completed_cnt,
        MIN(bq.section_sequence) AS min_seq FROM bid_questions bq WHERE bq.workspace_id = bid_workspace_id GROUP BY bq.section_name) sub)
  );
$function$;

ALTER FUNCTION public.get_bid_summary(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_bid_summary(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_bid_summary(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_bid_summary(uuid) IS
  'ID-84.1 (S319) — workspace rollup JSON. Six body sites fixed from the '
  'dropped bid_questions.project_id column to workspace_id (T2 rename rot, '
  'SQLSTATE 42703). No current rpc() call-sites (ops43 audit) — redefined '
  'for catalogue hygiene and prod parity.';

-- -----------------------------------------------------------------------------
-- 4. get_aggregate_win_rate_stats — overall + per-domain citation win-rate
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_aggregate_win_rate_stats()
RETURNS TABLE(
  scope              text,
  total_citations    bigint,
  winning_citations  bigint,
  losing_citations   bigint,
  pending_citations  bigint,
  win_rate           numeric,
  unique_items_cited bigint,
  unique_bids        bigint
)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY

  WITH citation_detail AS (
    SELECT
      ci.primary_domain,
      cc.content_item_id,
      cc.bid_response_id,
      bq.workspace_id,
      w.domain_metadata->>'outcome' as bid_outcome
    FROM content_citations cc
    JOIN content_items ci ON ci.id = cc.content_item_id
    JOIN bid_responses br ON br.id = cc.bid_response_id
    JOIN bid_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.workspace_id
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
      COUNT(DISTINCT workspace_id)::bigint as unique_bids
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
      COUNT(DISTINCT workspace_id)::bigint as unique_bids
    FROM citation_detail
  )
  SELECT * FROM overall
  UNION ALL
  SELECT * FROM domain_stats
  ORDER BY scope;
END;
$function$;

ALTER FUNCTION public.get_aggregate_win_rate_stats() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_aggregate_win_rate_stats() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_aggregate_win_rate_stats() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_aggregate_win_rate_stats() IS
  'ID-84.1 (S319) — overall + per-domain citation win-rate aggregator. CTE '
  'select/join and two COUNT(DISTINCT ...) refs fixed from the dropped '
  'bid_questions.project_id column to workspace_id (T2 rename rot, SQLSTATE '
  '42703). Return shape unchanged; caller app/api/analytics/win-rate.';

-- ID-64.14 — bid_* -> form_* rename (OQ-64-3 ratified 08/06/2026; STEP-0 -> form_*)
-- ============================================================================
-- Renames the bid_* surface (tables + dependent constraint/index/policy/trigger
-- identifiers) to form_* while the platform is pre-live. ALTER ... RENAME
-- preserves rows + data + FK referential integrity (FK targets follow by OID).
--
-- SCOPE (ID-93 RESEARCH §3.1 / task-list {64.14}):
--   tables:  bid_responses -> form_responses
--            bid_response_history -> form_response_history
--            bid_questions -> form_questions
--   RPC:     search_for_bid_response -> search_for_form_response
--   + every dependent constraint / index / policy / trigger identifier that
--     embeds the old table name.
--
-- EXCLUDED (owned elsewhere, do NOT touch here):
--   * content_citations + content_citations_bid_response_id_fkey
--     (ID-58 / T11 owns its rename/replace). Its FK target auto-follows the
--     bid_responses -> form_responses rename and stays valid; the constraint
--     NAME is left as-is for T11. content_citations.bid_response_id column also
--     untouched (T11 disposition).
--   * citing_entity enum value (T11 unbuilt).
--   * form_template_fields_question_id_fkey — name carries no "bid", FK target
--     auto-follows the bid_questions -> form_questions rename; no rename needed.
--
-- FUNCTION-BODY FOLLOW-ON (required for correctness, NOT a name rename):
--   Several SQL/PLpgSQL function BODIES hard-reference the old table names in
--   their FROM/JOIN/INSERT clauses. A table rename does NOT rewrite stored
--   function text, so these break at call time unless rebodied. We CREATE OR
--   REPLACE them with identical signatures/ACL/security/search_path, changing
--   ONLY the table identifiers. Function NAMES are preserved (out of {64.14}
--   rename scope) EXCEPT search_for_bid_response (explicit scope) and
--   snapshot_bid_response_history (the rename target trigger's function).
-- ============================================================================

BEGIN;

-- Resolve the pgvector `vector` type (lives in the extensions schema) when
-- parsing function argument types below (matches ID-197 migration pattern).
SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Rename the tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.bid_responses        RENAME TO form_responses;
ALTER TABLE public.bid_response_history RENAME TO form_response_history;
ALTER TABLE public.bid_questions        RENAME TO form_questions;

-- ---------------------------------------------------------------------------
-- 2. Rename constraints (PK / FK / UNIQUE / CHECK identifiers embedding "bid")
--    NOTE: PK + UNIQUE constraint renames also rename their backing indexes.
-- ---------------------------------------------------------------------------
-- form_questions
ALTER TABLE public.form_questions RENAME CONSTRAINT bid_questions_status_check                 TO form_questions_status_check;
ALTER TABLE public.form_questions RENAME CONSTRAINT bid_questions_assigned_to_fkey            TO form_questions_assigned_to_fkey;
ALTER TABLE public.form_questions RENAME CONSTRAINT bid_questions_created_by_fkey             TO form_questions_created_by_fkey;
ALTER TABLE public.form_questions RENAME CONSTRAINT bid_questions_template_requirement_id_fkey TO form_questions_template_requirement_id_fkey;
ALTER TABLE public.form_questions RENAME CONSTRAINT bid_questions_workspace_id_fkey           TO form_questions_workspace_id_fkey;
ALTER TABLE public.form_questions RENAME CONSTRAINT bid_questions_pkey                        TO form_questions_pkey;
ALTER TABLE public.form_questions RENAME CONSTRAINT bid_questions_workspace_question_unique   TO form_questions_workspace_question_unique;

-- form_response_history
ALTER TABLE public.form_response_history RENAME CONSTRAINT bid_response_history_edited_by_fkey         TO form_response_history_edited_by_fkey;
ALTER TABLE public.form_response_history RENAME CONSTRAINT bid_response_history_response_id_fkey       TO form_response_history_response_id_fkey;
ALTER TABLE public.form_response_history RENAME CONSTRAINT bid_response_history_pkey                   TO form_response_history_pkey;
ALTER TABLE public.form_response_history RENAME CONSTRAINT bid_response_history_response_id_version_key TO form_response_history_response_id_version_key;

-- form_responses
ALTER TABLE public.form_responses RENAME CONSTRAINT chk_bid_responses_overall_score_range TO chk_form_responses_overall_score_range;
ALTER TABLE public.form_responses RENAME CONSTRAINT bid_responses_approved_by_fkey        TO form_responses_approved_by_fkey;
ALTER TABLE public.form_responses RENAME CONSTRAINT bid_responses_drafted_by_fkey         TO form_responses_drafted_by_fkey;
ALTER TABLE public.form_responses RENAME CONSTRAINT bid_responses_last_edited_by_fkey     TO form_responses_last_edited_by_fkey;
ALTER TABLE public.form_responses RENAME CONSTRAINT bid_responses_question_id_fkey        TO form_responses_question_id_fkey;
ALTER TABLE public.form_responses RENAME CONSTRAINT bid_responses_pkey                    TO form_responses_pkey;

-- ---------------------------------------------------------------------------
-- 3. Rename the plain (idx_*) indexes (PK/UNIQUE indexes already renamed in §2)
-- ---------------------------------------------------------------------------
ALTER INDEX public.idx_bid_questions_assigned_to            RENAME TO idx_form_questions_assigned_to;
ALTER INDEX public.idx_bid_questions_created_by             RENAME TO idx_form_questions_created_by;
ALTER INDEX public.idx_bid_questions_status                 RENAME TO idx_form_questions_status;
ALTER INDEX public.idx_bid_questions_template_requirement_id RENAME TO idx_form_questions_template_requirement_id;
ALTER INDEX public.idx_bid_questions_workspace              RENAME TO idx_form_questions_workspace;

ALTER INDEX public.idx_bid_response_history_edited_by       RENAME TO idx_form_response_history_edited_by;
ALTER INDEX public.idx_bid_response_history_response        RENAME TO idx_form_response_history_response;

ALTER INDEX public.idx_bid_responses_approved_by            RENAME TO idx_form_responses_approved_by;
ALTER INDEX public.idx_bid_responses_drafted_by            RENAME TO idx_form_responses_drafted_by;
ALTER INDEX public.idx_bid_responses_last_edited_by        RENAME TO idx_form_responses_last_edited_by;
ALTER INDEX public.idx_bid_responses_overall_score         RENAME TO idx_form_responses_overall_score;
ALTER INDEX public.idx_bid_responses_question              RENAME TO idx_form_responses_question;

-- ---------------------------------------------------------------------------
-- 4. Rename RLS policies
-- ---------------------------------------------------------------------------
-- form_questions
ALTER POLICY bid_questions_delete ON public.form_questions RENAME TO form_questions_delete;
ALTER POLICY bid_questions_insert ON public.form_questions RENAME TO form_questions_insert;
ALTER POLICY bid_questions_select ON public.form_questions RENAME TO form_questions_select;
ALTER POLICY bid_questions_update ON public.form_questions RENAME TO form_questions_update;

-- form_response_history (human-readable policy names embedding "bid")
ALTER POLICY "Admins can delete bid response history"          ON public.form_response_history RENAME TO "Admins can delete form response history";
ALTER POLICY "Authenticated users can view bid response history" ON public.form_response_history RENAME TO "Authenticated users can view form response history";
ALTER POLICY "Editors and admins can insert bid response history" ON public.form_response_history RENAME TO "Editors and admins can insert form response history";

-- form_responses
ALTER POLICY bid_responses_delete ON public.form_responses RENAME TO form_responses_delete;
ALTER POLICY bid_responses_insert ON public.form_responses RENAME TO form_responses_insert;
ALTER POLICY bid_responses_select ON public.form_responses RENAME TO form_responses_select;
ALTER POLICY bid_responses_update ON public.form_responses RENAME TO form_responses_update;

-- ---------------------------------------------------------------------------
-- 5. Rename triggers
-- ---------------------------------------------------------------------------
ALTER TRIGGER set_bid_questions_updated_at   ON public.form_questions RENAME TO set_form_questions_updated_at;
ALTER TRIGGER bid_response_history_snapshot  ON public.form_responses RENAME TO form_response_history_snapshot;
ALTER TRIGGER bid_response_set_version       ON public.form_responses RENAME TO form_response_set_version;
ALTER TRIGGER set_bid_responses_updated_at   ON public.form_responses RENAME TO set_form_responses_updated_at;

-- ---------------------------------------------------------------------------
-- 6. RPC: search_for_bid_response -> search_for_form_response
--    DROP + CREATE (rename) with the authoritative ID-197 body, rebodied to the
--    renamed tables. Preserve: LANGUAGE plpgsql, SET search_path, the implicit
--    SECURITY INVOKER (NO security clause => INVOKER), and the ACL
--    (REVOKE FROM PUBLIC/anon implied by granting only authenticated +
--    service_role). The trigger snapshot func is rebodied in §7.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_for_bid_response(vector, text, integer, boolean, varchar);

CREATE FUNCTION public.search_for_form_response(
  query_embedding vector,
  query_text text DEFAULT '',
  limit_count integer DEFAULT 10,
  include_superseded boolean DEFAULT false,
  visibility_filter varchar DEFAULT 'default'
)
RETURNS TABLE(
  id uuid,
  title text,
  content text,
  brief text,
  detail text,
  primary_domain character varying,
  primary_subtopic character varying,
  content_type character varying,
  ai_keywords text[],
  similarity numeric
)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  win_boost CONSTANT numeric := 0.03;
  min_win_citations CONSTANT integer := 2;
BEGIN
  RETURN QUERY
  WITH win_stats AS (
    SELECT
      cc.content_item_id,
      COUNT(DISTINCT cc.bid_response_id)::integer AS total_citations,
      COUNT(DISTINCT cc.bid_response_id) FILTER (
        WHERE w.domain_metadata->>'outcome' = 'won'
      )::numeric / NULLIF(COUNT(DISTINCT cc.bid_response_id), 0) AS win_rate
    FROM content_citations cc
    JOIN form_responses br ON br.id = cc.bid_response_id
    JOIN form_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.workspace_id
    GROUP BY cc.content_item_id
  )
  SELECT
    ci.id, ci.title, ci.content, ci.brief, ci.detail,
    ci.primary_domain, ci.primary_subtopic, ci.content_type, ci.ai_keywords,
    LEAST(1.0, (
      (1 - (ci.embedding <=> query_embedding)) * 0.80
      + CASE WHEN query_text != '' AND ci.title ILIKE '%' || query_text || '%' THEN 0.10
             ELSE 0.0 END
      + CASE WHEN query_text != '' AND query_text = ANY(ci.ai_keywords) THEN 0.10
             ELSE 0.0 END
    ) * CASE
        WHEN COALESCE(ws.total_citations, 0) >= min_win_citations
        THEN (1.0 + win_boost * COALESCE(ws.win_rate, 0.0))
        ELSE 1.0
      END
    )::NUMERIC(4, 3) AS similarity
  FROM content_items ci
  LEFT JOIN win_stats ws ON ws.content_item_id = ci.id
  WHERE ci.embedding IS NOT NULL
    AND (1 - (ci.embedding <=> query_embedding)) > 0.25
    AND (include_superseded OR ci.superseded_by IS NULL)
    AND CASE visibility_filter
          WHEN 'default' THEN ci.publication_status = 'published'
          WHEN 'all' THEN ci.publication_status != 'archived'
          WHEN 'admin' THEN TRUE
          ELSE ci.publication_status = 'published'
        END
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$function$;

-- ACL: REVOKE FROM PUBLIC + anon; GRANT authenticated + service_role
-- (mirrors search_for_bid_response ACL: {authenticated=X, service_role=X}).
REVOKE EXECUTE ON FUNCTION public.search_for_form_response(vector, text, integer, boolean, varchar) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_for_form_response(vector, text, integer, boolean, varchar) FROM anon;
GRANT  EXECUTE ON FUNCTION public.search_for_form_response(vector, text, integer, boolean, varchar) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.search_for_form_response(vector, text, integer, boolean, varchar) TO service_role;

COMMENT ON FUNCTION public.search_for_form_response(
  vector, text, integer, boolean, varchar
) IS 'ID-64.14 (renamed from search_for_bid_response): form-response search with visibility_filter. default=published-only, all=non-archived, admin=all states. Body references renamed tables form_responses/form_questions; cc.bid_response_id retained (content_citations excluded from rename per ID-58/T11).';

-- ---------------------------------------------------------------------------
-- 7. Trigger function rename + rebody: snapshot_bid_response_history ->
--    snapshot_form_response_history. Body INSERTs into the renamed history
--    table. Preserve SECURITY DEFINER + search_path. Repoint the trigger
--    (already renamed in §5) to the renamed function, then drop the old one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_form_response_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF OLD.response_text IS DISTINCT FROM NEW.response_text
     OR OLD.response_text_advanced IS DISTINCT FROM NEW.response_text_advanced
     OR OLD.metadata IS DISTINCT FROM NEW.metadata THEN

    INSERT INTO form_response_history (
      response_id, version, response_text, response_text_advanced,
      review_status, metadata, source_content_ids, edited_by, change_reason
    ) VALUES (
      OLD.id, OLD.version, OLD.response_text, OLD.response_text_advanced,
      OLD.review_status, OLD.metadata, OLD.source_content_ids,
      COALESCE(auth.uid(), NEW.last_edited_by),
      current_setting('app.change_reason', true)
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- Repoint the (already-renamed) trigger to the renamed function.
DROP TRIGGER form_response_history_snapshot ON public.form_responses;
CREATE TRIGGER form_response_history_snapshot
  BEFORE UPDATE ON public.form_responses
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_form_response_history();

DROP FUNCTION IF EXISTS public.snapshot_bid_response_history();

-- ---------------------------------------------------------------------------
-- 8. Rebody remaining functions whose bodies hard-reference the old table
--    names (FROM/JOIN). Function NAMES preserved (out of rename scope) — only
--    table identifiers in the bodies change. Signatures/volatility/security/
--    search_path are reproduced verbatim from the live definitions.
-- ---------------------------------------------------------------------------

-- 8a. get_bid_question_stats
CREATE OR REPLACE FUNCTION public.get_bid_question_stats(p_project_id uuid)
RETURNS TABLE(total_questions bigint, strong_match_count bigint, partial_match_count bigint, needs_sme_count bigint, no_content_count bigint, unmatched_count bigint, drafted_count bigint, complete_count bigint)
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
  FROM form_questions
  WHERE workspace_id = p_project_id;
$function$;

-- 8b. get_bid_question_stats_batch
CREATE OR REPLACE FUNCTION public.get_bid_question_stats_batch(p_project_ids uuid[])
RETURNS TABLE(workspace_id uuid, total_questions bigint, strong_match_count bigint, partial_match_count bigint, needs_sme_count bigint, no_content_count bigint, unmatched_count bigint, drafted_count bigint, complete_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    bq.workspace_id,
    COUNT(*)::BIGINT AS total_questions,
    COUNT(*) FILTER (WHERE confidence_posture = 'strong_match')::BIGINT AS strong_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'partial_match')::BIGINT AS partial_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'needs_sme')::BIGINT     AS needs_sme_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'no_content')::BIGINT    AS no_content_count,
    COUNT(*) FILTER (WHERE confidence_posture IS NULL)::BIGINT           AS unmatched_count,
    COUNT(*) FILTER (WHERE status = 'ai_drafted')::BIGINT                AS drafted_count,
    COUNT(*) FILTER (WHERE status = 'complete')::BIGINT                  AS complete_count
  FROM form_questions bq
  WHERE bq.workspace_id = ANY(p_project_ids)
  GROUP BY bq.workspace_id;
$function$;

-- 8c. get_bid_summary
CREATE OR REPLACE FUNCTION public.get_bid_summary(bid_workspace_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT json_build_object(
    'workspace_id', bid_workspace_id,
    'total_questions', (SELECT COUNT(*) FROM form_questions WHERE workspace_id = bid_workspace_id),
    'status_breakdown', (
      SELECT json_agg(json_build_object('status', status, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT status, COUNT(*) AS cnt FROM form_questions WHERE workspace_id = bid_workspace_id GROUP BY status) sub),
    'confidence_breakdown', (
      SELECT json_agg(json_build_object('posture', confidence_posture, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT confidence_posture, COUNT(*) AS cnt FROM form_questions
        WHERE workspace_id = bid_workspace_id AND confidence_posture IS NOT NULL GROUP BY confidence_posture) sub),
    'responses_count', (
      SELECT COUNT(*) FROM form_responses br JOIN form_questions bq ON bq.id = br.question_id WHERE bq.workspace_id = bid_workspace_id),
    'review_status_breakdown', (
      SELECT json_agg(json_build_object('status', review_status, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT br.review_status, COUNT(*) AS cnt FROM form_responses br
        JOIN form_questions bq ON bq.id = br.question_id WHERE bq.workspace_id = bid_workspace_id GROUP BY br.review_status) sub),
    'sections', (
      SELECT json_agg(json_build_object('section', section_name, 'question_count', cnt, 'completed', completed_cnt) ORDER BY min_seq)
      FROM (SELECT bq.section_name, COUNT(*) AS cnt, COUNT(*) FILTER (WHERE bq.status = 'complete') AS completed_cnt,
        MIN(bq.section_sequence) AS min_seq FROM form_questions bq WHERE bq.workspace_id = bid_workspace_id GROUP BY bq.section_name) sub)
  );
$function$;

-- 8d. get_aggregate_win_rate_stats
CREATE OR REPLACE FUNCTION public.get_aggregate_win_rate_stats()
RETURNS TABLE(scope text, total_citations bigint, winning_citations bigint, losing_citations bigint, pending_citations bigint, win_rate numeric, unique_items_cited bigint, unique_bids bigint)
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
    JOIN form_responses br ON br.id = cc.bid_response_id
    JOIN form_questions bq ON bq.id = br.question_id
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

-- 8e. get_content_win_rate
CREATE OR REPLACE FUNCTION public.get_content_win_rate(p_content_item_id uuid)
RETURNS TABLE(total_citations bigint, winning_citations bigint, losing_citations bigint, pending_citations bigint, win_rate numeric)
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
    JOIN form_responses br ON br.id = cc.bid_response_id
    JOIN form_questions bq ON bq.id = br.question_id
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

-- 8f. hybrid_search (win_stats CTE JOINs the renamed tables)
CREATE OR REPLACE FUNCTION public.hybrid_search(query_embedding vector, query_text text DEFAULT ''::text, similarity_threshold numeric DEFAULT 0.3, limit_count integer DEFAULT 10, include_superseded boolean DEFAULT false, visibility_filter character varying DEFAULT 'default'::character varying)
RETURNS TABLE(id uuid, title text, suggested_title text, summary text, primary_domain text, primary_subtopic text, content_type text, platform text, author_name text, source_domain text, thumbnail_url text, captured_date timestamp with time zone, ai_keywords text[], classification_confidence numeric, priority text, metadata jsonb, similarity numeric, snippet text, created_by uuid, verified_at timestamp with time zone, verified_by uuid)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  win_boost CONSTANT numeric := 0.03;
  min_win_citations CONSTANT integer := 2;
BEGIN
  RETURN QUERY
  WITH win_stats AS (
    SELECT cc.content_item_id,
      COUNT(DISTINCT cc.bid_response_id)::integer AS total_citations,
      COUNT(DISTINCT cc.bid_response_id) FILTER (
        WHERE w.domain_metadata->>'outcome' = 'won'
      )::numeric / NULLIF(COUNT(DISTINCT cc.bid_response_id), 0) AS win_rate
    FROM content_citations cc
    JOIN form_responses br ON br.id = cc.bid_response_id
    JOIN form_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.workspace_id
    GROUP BY cc.content_item_id
  )
  SELECT
    ci.id, ci.title, ci.suggested_title, ci.summary,
    ci.primary_domain::text, ci.primary_subtopic::text, ci.content_type::text, ci.platform::text,
    ci.author_name::text, ci.source_domain::text, ci.thumbnail_url, ci.captured_date,
    ci.ai_keywords, ci.classification_confidence, ci.priority::text, ci.metadata,
    LEAST(1.0, (
      (1 - (ci.embedding <=> query_embedding)) * 0.70
      + CASE WHEN ci.suggested_title ILIKE '%' || query_text || '%' THEN 0.15
             WHEN ci.title ILIKE '%' || query_text || '%' THEN 0.15
             ELSE 0.0 END
      + CASE WHEN query_text = ANY(ci.ai_keywords) THEN 0.10
             WHEN EXISTS (SELECT 1 FROM unnest(ci.ai_keywords) AS kw WHERE kw ILIKE '%' || query_text || '%') THEN 0.05
             ELSE 0.0 END
      + CASE WHEN ci.summary ILIKE '%' || query_text || '%' THEN 0.03 ELSE 0.0 END
      + CASE WHEN ci.author_name ILIKE '%' || query_text || '%' THEN 0.02 ELSE 0.0 END
      + CASE WHEN ci.captured_date IS NOT NULL AND ci.captured_date > NOW() - INTERVAL '30 days'
             THEN 0.05 * (1.0 - EXTRACT(EPOCH FROM (NOW() - ci.captured_date)) / (30.0 * 86400.0))
             ELSE 0.0 END
    ) * CASE
        WHEN COALESCE(ws.total_citations, 0) >= min_win_citations
        THEN (1.0 + win_boost * COALESCE(ws.win_rate, 0.0))
        ELSE 1.0
      END
    )::NUMERIC(4, 3) AS similarity,
    CASE WHEN query_text IS NOT NULL AND query_text != '' AND ci.content IS NOT NULL
         AND position(lower(query_text) IN lower(ci.content)) > 0
         THEN substring(ci.content FROM greatest(1, position(lower(query_text) IN lower(ci.content)) - 80) FOR 200)
         ELSE NULL END AS snippet,
    ci.created_by,
    ci.verified_at,
    ci.verified_by
  FROM content_items ci
  LEFT JOIN win_stats ws ON ws.content_item_id = ci.id
  WHERE ci.embedding IS NOT NULL
    AND (include_superseded OR ci.superseded_by IS NULL)
    AND CASE visibility_filter
          WHEN 'default' THEN ci.publication_status = 'published'
          WHEN 'all' THEN ci.publication_status != 'archived'
          WHEN 'admin' THEN TRUE
          ELSE ci.publication_status = 'published'
        END
    AND (
      (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
      OR (
        query_text IS NOT NULL AND query_text != '' AND (
          ci.suggested_title ILIKE '%' || query_text || '%'
          OR ci.title ILIKE '%' || query_text || '%'
          OR ci.content ILIKE '%' || query_text || '%'
        )
      )
    )
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$function$;

COMMIT;

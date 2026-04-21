-- ============================================================
-- Supersession default-filter on search RPCs (S186 WP-B.3)
-- ============================================================
-- Adds `include_superseded BOOLEAN DEFAULT false` to every RPC that
-- returns user-visible content_items rows. The WHERE clause gains
-- `(include_superseded OR ci.superseded_by IS NULL)` so callers that
-- don't pass the param automatically exclude superseded rows per
-- docs/specs/supersession-model-spec.md §4.1–§4.3.
--
-- In-scope RPCs (verified against live schema 2026-04-21):
--   * hybrid_search          — canonical full-text + vector
--   * search_for_bid_response — bid-draft retrieval
--
-- Out of scope (spec §4.2):
--   * find_exact_duplicates  — dedup infra needs to match superseded rows
--   * find_similar_content   — near-dup infra, same reason
--   * search_by_domain / content_items_for_guide / search_by_entities
--                            — not present on the live schema
--
-- Drop-then-CREATE is used because Postgres CREATE OR REPLACE FUNCTION
-- cannot add a new parameter; adding one without dropping creates an
-- overload and call sites become ambiguous. Drop the existing
-- signature first so the single-arity callers resolve cleanly.
--
-- search_path + SECURITY DEFINER preserved verbatim from
-- supabase/migrations/20260419095345_restore_stub_functions_from_production.sql.
-- ============================================================

SET search_path = public, extensions;

-- ---------------------------------------------------------------
-- hybrid_search — default-filter superseded rows
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS public.hybrid_search(vector, text, numeric, integer);

CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_embedding vector,
  query_text text DEFAULT '',
  similarity_threshold numeric DEFAULT 0.3,
  limit_count integer DEFAULT 10,
  include_superseded boolean DEFAULT false
)
RETURNS TABLE(
  id uuid,
  title text,
  suggested_title text,
  summary text,
  primary_domain text,
  primary_subtopic text,
  content_type text,
  platform text,
  author_name text,
  source_domain text,
  thumbnail_url text,
  captured_date timestamp with time zone,
  ai_keywords text[],
  classification_confidence numeric,
  priority text,
  metadata jsonb,
  similarity numeric,
  snippet text,
  created_by uuid,
  verified_at timestamp with time zone,
  verified_by uuid
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
    JOIN bid_responses br ON br.id = cc.bid_response_id
    JOIN bid_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.project_id
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
    AND ci.archived_at IS NULL
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
    AND (include_superseded OR ci.superseded_by IS NULL)
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

-- ---------------------------------------------------------------
-- search_for_bid_response — default-filter superseded rows
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS public.search_for_bid_response(vector, text, integer);

CREATE OR REPLACE FUNCTION public.search_for_bid_response(
  query_embedding vector,
  query_text text DEFAULT '',
  limit_count integer DEFAULT 10,
  include_superseded boolean DEFAULT false
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
    JOIN bid_responses br ON br.id = cc.bid_response_id
    JOIN bid_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.project_id
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
    AND ci.archived_at IS NULL
    AND (1 - (ci.embedding <=> query_embedding)) > 0.25
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
    AND (include_superseded OR ci.superseded_by IS NULL)
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$function$;

-- Win Signal Search Boost
-- Adds a small relevance boost to search results for content items
-- that have been cited in winning bids. The boost is proportional to
-- the win rate of bids citing each item, with a minimum citation
-- threshold of 2 to avoid noise from single citations.
--
-- Boost range: 1.0x (no winning citations) to 1.03x (100% win rate, 2+ citations)

-- Set search_path so the pgvector 'vector' type resolves during DROP/CREATE
SET search_path TO public, extensions;

-- =============================================================================
-- 1. Recreate hybrid_search with win signal boost
-- =============================================================================
DROP FUNCTION IF EXISTS hybrid_search(vector, text, double precision, integer);

CREATE FUNCTION hybrid_search(
  query_embedding vector,
  query_text text,
  similarity_threshold double precision DEFAULT 0.3,
  limit_count integer DEFAULT 20
)
RETURNS TABLE(
  id UUID,
  title TEXT,
  suggested_title TEXT,
  ai_summary TEXT,
  primary_domain CHARACTER VARYING,
  primary_subtopic CHARACTER VARYING,
  content_type CHARACTER VARYING,
  platform CHARACTER VARYING,
  author_name CHARACTER VARYING,
  source_domain CHARACTER VARYING,
  thumbnail_url TEXT,
  captured_date TIMESTAMPTZ,
  ai_keywords TEXT[],
  classification_confidence NUMERIC,
  priority CHARACTER VARYING,
  metadata JSONB,
  similarity NUMERIC,
  snippet TEXT,
  created_by UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
  -- Win signal boost: content cited in winning bids receives up to this
  -- multiplier bonus on its similarity score. Applied proportionally to
  -- win rate, only when citation count >= min_win_citations.
  win_boost CONSTANT numeric := 0.03;
  min_win_citations CONSTANT integer := 2;
BEGIN
  RETURN QUERY
  WITH win_stats AS (
    -- Compute win rate per content item from citation/bid outcome data.
    -- Join path: content_citations -> bid_responses -> bid_questions -> workspaces
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
    ci.id, ci.title, ci.suggested_title, ci.ai_summary,
    ci.primary_domain, ci.primary_subtopic, ci.content_type, ci.platform,
    ci.author_name, ci.source_domain, ci.thumbnail_url, ci.captured_date,
    ci.ai_keywords, ci.classification_confidence, ci.priority, ci.metadata,
    LEAST(1.0, (
      (1 - (ci.embedding <=> query_embedding)) * 0.70
      + CASE WHEN ci.suggested_title ILIKE '%' || query_text || '%' THEN 0.15
             WHEN ci.title ILIKE '%' || query_text || '%' THEN 0.15
             ELSE 0.0 END
      + CASE WHEN query_text = ANY(ci.ai_keywords) THEN 0.10
             WHEN EXISTS (SELECT 1 FROM unnest(ci.ai_keywords) AS kw WHERE kw ILIKE '%' || query_text || '%') THEN 0.05
             ELSE 0.0 END
      + CASE WHEN ci.ai_summary ILIKE '%' || query_text || '%' THEN 0.03 ELSE 0.0 END
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
    ci.created_by
  FROM content_items ci
  LEFT JOIN win_stats ws ON ws.content_item_id = ci.id
  WHERE ci.embedding IS NOT NULL
    AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$$;

-- Ensure pgvector operators resolve correctly inside the function body
ALTER FUNCTION hybrid_search(vector, text, double precision, integer)
  SET search_path = public, extensions;

-- =============================================================================
-- 2. Recreate search_for_bid_response with win signal boost
-- =============================================================================
DROP FUNCTION IF EXISTS search_for_bid_response(vector, text, integer);

CREATE FUNCTION search_for_bid_response(
  query_embedding vector,
  query_text text DEFAULT '',
  limit_count integer DEFAULT 10
)
RETURNS TABLE(
  id UUID,
  title TEXT,
  content TEXT,
  brief TEXT,
  detail TEXT,
  primary_domain CHARACTER VARYING,
  primary_subtopic CHARACTER VARYING,
  content_type CHARACTER VARYING,
  ai_keywords TEXT[],
  similarity NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  -- Win signal boost: content cited in winning bids receives up to this
  -- multiplier bonus on its similarity score. Applied proportionally to
  -- win rate, only when citation count >= min_win_citations.
  win_boost CONSTANT numeric := 0.03;
  min_win_citations CONSTANT integer := 2;
BEGIN
  RETURN QUERY
  WITH win_stats AS (
    -- Compute win rate per content item from citation/bid outcome data.
    -- Join path: content_citations -> bid_responses -> bid_questions -> workspaces
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
    AND (1 - (ci.embedding <=> query_embedding)) > 0.25
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$$;

-- Ensure pgvector operators resolve correctly inside the function body
ALTER FUNCTION search_for_bid_response(vector, text, integer)
  SET search_path = public, extensions;

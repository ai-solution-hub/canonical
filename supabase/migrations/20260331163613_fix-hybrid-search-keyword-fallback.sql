-- Fix hybrid_search to include keyword matches even when cosine similarity
-- is below threshold. Short queries like "ISO 27001" produce embeddings that
-- are far from document embeddings, but should still be found via keyword match.
--
-- Change: WHERE clause now uses OR to include items matching via title/content
-- keyword in addition to cosine similarity threshold.
-- Also drops the old function signature (double precision threshold) to avoid
-- ambiguous function call errors.

DROP FUNCTION IF EXISTS hybrid_search(vector, text, double precision, integer);

CREATE OR REPLACE FUNCTION hybrid_search(
  query_embedding vector(1024),
  query_text text DEFAULT '',
  similarity_threshold numeric DEFAULT 0.3,
  limit_count integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  title text,
  suggested_title text,
  ai_summary text,
  primary_domain text,
  primary_subtopic text,
  content_type text,
  platform text,
  author_name text,
  source_domain text,
  thumbnail_url text,
  captured_date timestamptz,
  ai_keywords text[],
  classification_confidence numeric,
  priority text,
  metadata jsonb,
  similarity numeric,
  snippet text,
  created_by uuid,
  verified_at timestamptz,
  verified_by uuid
)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
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
    ci.id, ci.title, ci.suggested_title, ci.ai_summary,
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
    ci.created_by,
    ci.verified_at,
    ci.verified_by
  FROM content_items ci
  LEFT JOIN win_stats ws ON ws.content_item_id = ci.id
  WHERE ci.embedding IS NOT NULL
    AND ci.archived_at IS NULL
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
    AND (
      -- Cosine similarity above threshold
      (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
      -- OR keyword match in title/suggested_title/content (fallback for short queries)
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
$$;

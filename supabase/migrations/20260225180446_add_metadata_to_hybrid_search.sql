-- Add metadata to hybrid_search return columns so search results can show starred state
-- Must DROP first because return type is changing (can't ALTER return type with CREATE OR REPLACE)
DROP FUNCTION IF EXISTS public.hybrid_search(vector, text, numeric, integer);

CREATE FUNCTION public.hybrid_search(
  query_embedding vector,
  query_text text,
  similarity_threshold numeric DEFAULT 0.35,
  limit_count integer DEFAULT 30
)
RETURNS TABLE(
  id uuid,
  title text,
  suggested_title text,
  ai_summary text,
  primary_domain character varying,
  primary_subtopic character varying,
  content_type character varying,
  platform character varying,
  author_name character varying,
  source_domain character varying,
  thumbnail_url text,
  captured_date timestamp with time zone,
  ai_keywords text[],
  classification_confidence numeric,
  metadata jsonb,
  similarity numeric,
  snippet text
)
LANGUAGE sql
STABLE
AS $$
SELECT
  ci.id,
  ci.title,
  ci.suggested_title,
  ci.ai_summary,
  ci.primary_domain,
  ci.primary_subtopic,
  ci.content_type,
  ci.platform,
  ci.author_name,
  ci.source_domain,
  ci.thumbnail_url,
  ci.captured_date,
  ci.ai_keywords,
  ci.classification_confidence,
  ci.metadata,
  LEAST(1.0, (
    -- Base: embedding cosine similarity (weight: 0.70)
    (1 - (ci.embedding <=> query_embedding)) * 0.70
    -- Bonus: title match (weight: 0.15)
    + CASE
        WHEN ci.suggested_title ILIKE '%' || query_text || '%' THEN 0.15
        WHEN ci.title ILIKE '%' || query_text || '%' THEN 0.15
        ELSE 0.0
      END
    -- Bonus: keyword match (weight: 0.10)
    + CASE
        WHEN query_text = ANY(ci.ai_keywords) THEN 0.10
        WHEN EXISTS (
          SELECT 1 FROM unnest(ci.ai_keywords) AS kw
          WHERE kw ILIKE '%' || query_text || '%'
        ) THEN 0.05
        ELSE 0.0
      END
    -- Bonus: summary/author mention (weight: 0.05)
    + CASE
        WHEN ci.ai_summary ILIKE '%' || query_text || '%' THEN 0.03
        ELSE 0.0
      END
    + CASE
        WHEN ci.author_name ILIKE '%' || query_text || '%' THEN 0.02
        ELSE 0.0
      END
    -- Bonus: recency (weight: up to 0.05, linear decay over 30 days)
    + CASE
        WHEN ci.captured_date IS NOT NULL
          AND ci.captured_date > NOW() - INTERVAL '30 days'
        THEN 0.05 * (1.0 - EXTRACT(EPOCH FROM (NOW() - ci.captured_date)) / (30.0 * 86400.0))
        ELSE 0.0
      END
  ))::NUMERIC(4, 3) AS similarity,
  -- Snippet: extract 200 chars around the first keyword match in content
  CASE
    WHEN query_text IS NOT NULL
      AND query_text != ''
      AND ci.content IS NOT NULL
      AND position(lower(query_text) IN lower(ci.content)) > 0
    THEN substring(
      ci.content
      FROM greatest(1, position(lower(query_text) IN lower(ci.content)) - 80)
      FOR 200
    )
    ELSE NULL
  END AS snippet
FROM content_items ci
WHERE ci.embedding IS NOT NULL
  AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
ORDER BY similarity DESC
LIMIT limit_count;
$$;

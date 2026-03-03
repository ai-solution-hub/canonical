-- Hybrid search: combines cosine similarity with keyword matching bonuses
-- and recency boost. Replaces search_content as the primary search RPC
-- (search_content is kept for backward compatibility and related-items queries).
--
-- Scoring breakdown:
--   - Embedding similarity: weighted 0.70 of the score
--   - Title match (ILIKE): +0.15 bonus
--   - Keyword match (exact array membership): +0.10 bonus
--   - Summary/author mention (ILIKE): +0.05 bonus
--   - Recency (linear decay over 30 days): up to +0.05 bonus
-- These bonuses are additive and capped at 1.0.
--
-- Also returns a content snippet: 200 chars around the first keyword match.

CREATE OR REPLACE FUNCTION hybrid_search(
  query_embedding vector(1024),
  query_text TEXT,
  similarity_threshold NUMERIC DEFAULT 0.35,
  limit_count INT DEFAULT 30
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  suggested_title TEXT,
  ai_summary TEXT,
  primary_domain VARCHAR(50),
  primary_subtopic VARCHAR(100),
  content_type VARCHAR(50),
  platform VARCHAR(30),
  author_name VARCHAR(255),
  source_domain VARCHAR(100),
  thumbnail_url TEXT,
  captured_date TIMESTAMPTZ,
  ai_keywords TEXT[],
  classification_confidence NUMERIC,
  similarity NUMERIC,
  snippet TEXT
) AS $$
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
$$ LANGUAGE SQL STABLE;

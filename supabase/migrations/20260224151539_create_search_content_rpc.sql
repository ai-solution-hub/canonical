-- Create search_content() RPC function
-- Returns all display columns + similarity in a single query
-- Replaces the 2-query pattern (find_similar_content + display fields fetch)
-- Keeps find_similar_content() for backward compatibility (used by find_similar_all)

CREATE OR REPLACE FUNCTION search_content(
  query_embedding vector(1024),
  similarity_threshold NUMERIC DEFAULT 0.25,
  limit_count INT DEFAULT 20
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
  similarity NUMERIC
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
  (1 - (ci.embedding <=> query_embedding))::NUMERIC(4, 3) AS similarity
FROM content_items ci
WHERE ci.embedding IS NOT NULL
  AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
ORDER BY ci.embedding <=> query_embedding
LIMIT limit_count;
$$ LANGUAGE SQL STABLE;

-- find_related_items: server-side related content lookup by item ID.
-- Eliminates the embedding round-trip (DB -> server -> DB) that the old
-- approach required (fetch embedding, call find_similar_content, fetch details).
-- Single RPC call returns display-ready rows with similarity scores.

CREATE OR REPLACE FUNCTION public.find_related_items(
  p_item_id uuid,
  p_similarity_threshold double precision DEFAULT 0.6,
  p_limit_count integer DEFAULT 6
)
RETURNS TABLE(
  id uuid,
  title text,
  suggested_title text,
  ai_summary text,
  primary_domain text,
  primary_subtopic text,
  content_type character varying,
  platform character varying,
  author_name character varying,
  source_domain character varying,
  thumbnail_url text,
  captured_date timestamptz,
  ai_keywords text[],
  classification_confidence double precision,
  priority character varying,
  user_tags text[],
  similarity numeric
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  WITH source AS (
    SELECT embedding
    FROM content_items
    WHERE content_items.id = p_item_id
  )
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
    ci.priority,
    ci.user_tags,
    ROUND((1 - (ci.embedding <=> source.embedding))::numeric, 4) AS similarity
  FROM content_items ci, source
  WHERE ci.id != p_item_id
    AND ci.archived_at IS NULL
    AND ci.embedding IS NOT NULL
    AND source.embedding IS NOT NULL
    AND (1 - (ci.embedding <=> source.embedding)) >= p_similarity_threshold
  ORDER BY ci.embedding <=> source.embedding ASC
  LIMIT p_limit_count;
$$;

ALTER FUNCTION public.find_related_items(uuid, double precision, integer) OWNER TO postgres;

GRANT ALL ON FUNCTION public.find_related_items(uuid, double precision, integer) TO anon;
GRANT ALL ON FUNCTION public.find_related_items(uuid, double precision, integer) TO authenticated;
GRANT ALL ON FUNCTION public.find_related_items(uuid, double precision, integer) TO service_role;

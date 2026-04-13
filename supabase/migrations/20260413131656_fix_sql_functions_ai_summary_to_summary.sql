-- Fix SQL functions that still reference content_items.ai_summary (now renamed to summary).
-- The column rename migration (20260413120021) changed the column but not the functions.
-- feed_articles.ai_summary is NOT affected — that column was not renamed.
--
-- CREATE OR REPLACE cannot change return types, so we DROP then CREATE.
-- Functions that return ai_summary in their RETURNS TABLE must be dropped first.

-- Ensure vector type is visible for function signatures
SET search_path TO public, extensions;

-- Drop functions with changed return types (filter_by_keywords returns uuid, no change needed)
DROP FUNCTION IF EXISTS public.find_related_items(uuid, double precision, integer);
DROP FUNCTION IF EXISTS public.get_audit_content_items(text, integer);
DROP FUNCTION IF EXISTS public.hybrid_search(vector, text, numeric, integer);
DROP FUNCTION IF EXISTS public.search_content(vector, double precision, integer);
DROP FUNCTION IF EXISTS public.search_content(vector, numeric, integer);

-- 1. filter_by_keywords (returns uuid — no return type change, just body fix)
CREATE OR REPLACE FUNCTION public.filter_by_keywords(search_terms text[])
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
SELECT id FROM content_items
WHERE (
  SELECT bool_and(
    array_to_string(COALESCE(ai_keywords, '{}'), ' ') ILIKE '%' || kw || '%'
    OR COALESCE(title, '') ILIKE '%' || kw || '%'
    OR COALESCE(summary, '') ILIKE '%' || kw || '%'
    OR COALESCE(author_name, '') ILIKE '%' || kw || '%'
  ) FROM unnest(search_terms) AS kw
);
$function$;

-- 2. find_related_items
CREATE OR REPLACE FUNCTION public.find_related_items(p_item_id uuid, p_similarity_threshold double precision DEFAULT 0.6, p_limit_count integer DEFAULT 6)
 RETURNS TABLE(id uuid, title text, suggested_title text, summary text, primary_domain text, primary_subtopic text, content_type character varying, platform character varying, author_name character varying, source_domain character varying, thumbnail_url text, captured_date timestamp with time zone, ai_keywords text[], classification_confidence double precision, priority character varying, user_tags text[], similarity numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH source AS (
    SELECT embedding
    FROM content_items
    WHERE content_items.id = p_item_id
  )
  SELECT
    ci.id,
    ci.title,
    ci.suggested_title,
    ci.summary,
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
$function$;

-- 3. get_audit_content_items
CREATE OR REPLACE FUNCTION public.get_audit_content_items(p_domain text DEFAULT NULL::text, p_limit integer DEFAULT 500)
 RETURNS TABLE(id uuid, title text, suggested_title text, content_type text, primary_domain text, content_length integer, summary text, ai_keywords text[], classification_confidence double precision, freshness text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    ci.id,
    ci.title,
    ci.suggested_title,
    ci.content_type,
    ci.primary_domain,
    COALESCE(char_length(ci.content), 0)::int AS content_length,
    ci.summary,
    ci.ai_keywords,
    ci.classification_confidence,
    ci.freshness
  FROM content_items ci
  WHERE ci.archived_at IS NULL
    AND (p_domain IS NULL OR ci.primary_domain = p_domain)
  ORDER BY ci.updated_at DESC
  LIMIT p_limit;
$function$;

-- 4. hybrid_search
CREATE OR REPLACE FUNCTION public.hybrid_search(query_embedding vector, query_text text DEFAULT ''::text, similarity_threshold numeric DEFAULT 0.3, limit_count integer DEFAULT 10)
 RETURNS TABLE(id uuid, title text, suggested_title text, summary text, primary_domain text, primary_subtopic text, content_type text, platform text, author_name text, source_domain text, thumbnail_url text, captured_date timestamp with time zone, ai_keywords text[], classification_confidence numeric, priority text, metadata jsonb, similarity numeric, snippet text, created_by uuid, verified_at timestamp with time zone, verified_by uuid)
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

-- 5. search_content — overload 1 (plpgsql, double precision threshold)
CREATE OR REPLACE FUNCTION public.search_content(query_embedding vector, similarity_threshold double precision DEFAULT 0.3, limit_count integer DEFAULT 50)
 RETURNS TABLE(id uuid, title text, suggested_title text, summary text, primary_domain character varying, primary_subtopic character varying, content_type character varying, platform character varying, author_name character varying, source_domain character varying, thumbnail_url text, captured_date timestamp with time zone, ai_keywords text[], classification_confidence numeric, similarity numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT ci.id, ci.title, ci.suggested_title, ci.summary,
    ci.primary_domain, ci.primary_subtopic, ci.content_type, ci.platform,
    ci.author_name, ci.source_domain, ci.thumbnail_url, ci.captured_date,
    ci.ai_keywords, ci.classification_confidence,
    (1 - (ci.embedding <=> query_embedding))::NUMERIC(4, 3) AS similarity
  FROM content_items ci
  WHERE ci.embedding IS NOT NULL
    AND ci.archived_at IS NULL
    AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
  ORDER BY ci.embedding <=> query_embedding
  LIMIT limit_count;
END;
$function$;

-- 6. search_content — overload 2 (sql, numeric threshold, stable)
CREATE OR REPLACE FUNCTION public.search_content(query_embedding vector, similarity_threshold numeric DEFAULT 0.35, limit_count integer DEFAULT 30)
 RETURNS TABLE(id uuid, title text, suggested_title text, summary text, primary_domain character varying, primary_subtopic character varying, content_type character varying, platform character varying, author_name character varying, source_domain character varying, thumbnail_url text, captured_date timestamp with time zone, ai_keywords text[], classification_confidence numeric, similarity numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
SELECT ci.id, ci.title, ci.suggested_title, ci.summary,
  ci.primary_domain, ci.primary_subtopic, ci.content_type, ci.platform,
  ci.author_name, ci.source_domain, ci.thumbnail_url, ci.captured_date,
  ci.ai_keywords, ci.classification_confidence,
  (1 - (ci.embedding <=> query_embedding))::NUMERIC(4, 3) AS similarity
FROM content_items ci
WHERE ci.embedding IS NOT NULL
  AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
ORDER BY ci.embedding <=> query_embedding
LIMIT limit_count;
$function$;

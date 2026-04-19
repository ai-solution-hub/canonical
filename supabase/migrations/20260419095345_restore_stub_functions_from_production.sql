-- Restore four stub/overload functions on the new project to match OLD
-- production signatures and bodies. Discovered during S180 build check:
--   get_author_analysis      — squash replaced body with `RETURN;` stub
--                             and changed signature to (limit_count integer)
--   get_trend_analysis       — same pattern; new signature (days_back, bucket_size)
--   hybrid_search            — stub + extra overload (rrf_k variant)
--   search_for_bid_response  — stub + extra overload (question_id / domain_filter)
--
-- Definitions copied verbatim from the old project via
-- `pg_get_functiondef` on 2026-04-19. Extra overloads dropped so the code's
-- single-arity call sites (e.g. supabase.rpc('hybrid_search', ...))
-- resolve unambiguously.

-- Drop all existing signatures so the CREATE below isn't blocked by overload
-- clashes or return-type changes.
DROP FUNCTION IF EXISTS public.get_author_analysis(integer);
DROP FUNCTION IF EXISTS public.get_author_analysis(text);
DROP FUNCTION IF EXISTS public.get_trend_analysis(integer, text);
DROP FUNCTION IF EXISTS public.get_trend_analysis(integer, integer);
DROP FUNCTION IF EXISTS public.hybrid_search(vector, text, numeric, integer);
DROP FUNCTION IF EXISTS public.hybrid_search(text, vector, integer, double precision, double precision, integer);
DROP FUNCTION IF EXISTS public.search_for_bid_response(vector, text, integer);
DROP FUNCTION IF EXISTS public.search_for_bid_response(uuid, vector, integer, text);

-- get_author_analysis(p_author_name text) → json
CREATE OR REPLACE FUNCTION public.get_author_analysis(p_author_name text)
RETURNS json
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
SELECT json_build_object(
  'author_name', p_author_name,
  'total_items', (SELECT COUNT(*) FROM content_items WHERE author_name ILIKE p_author_name),
  'first_item', (SELECT MIN(captured_date) FROM content_items WHERE author_name ILIKE p_author_name),
  'latest_item', (SELECT MAX(captured_date) FROM content_items WHERE author_name ILIKE p_author_name),
  'avg_confidence', (SELECT ROUND(AVG(classification_confidence)::NUMERIC, 3) FROM content_items
    WHERE author_name ILIKE p_author_name AND classification_confidence IS NOT NULL),
  'domain_breakdown', (
    SELECT json_agg(json_build_object('domain', primary_domain, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT primary_domain, COUNT(*) AS cnt FROM content_items
      WHERE author_name ILIKE p_author_name AND primary_domain IS NOT NULL GROUP BY primary_domain) sub),
  'subtopic_breakdown', (
    SELECT json_agg(json_build_object('subtopic', primary_subtopic, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT primary_subtopic, COUNT(*) AS cnt FROM content_items
      WHERE author_name ILIKE p_author_name AND primary_subtopic IS NOT NULL GROUP BY primary_subtopic) sub),
  'top_keywords', (
    SELECT json_agg(json_build_object('keyword', kw, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT kw, COUNT(*) AS cnt FROM content_items ci, unnest(ci.ai_keywords) AS kw
      WHERE ci.author_name ILIKE p_author_name GROUP BY kw ORDER BY cnt DESC LIMIT 10) sub),
  'content_types', (
    SELECT json_agg(json_build_object('type', content_type, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT content_type, COUNT(*) AS cnt FROM content_items
      WHERE author_name ILIKE p_author_name GROUP BY content_type) sub),
  'recent_items', (
    SELECT json_agg(json_build_object('id', id, 'title', COALESCE(suggested_title, title),
      'content_type', content_type, 'captured_date', captured_date, 'primary_subtopic', primary_subtopic) ORDER BY captured_date DESC)
    FROM (SELECT id, suggested_title, title, content_type, captured_date, primary_subtopic FROM content_items
      WHERE author_name ILIKE p_author_name ORDER BY captured_date DESC LIMIT 5) sub)
);
$function$;

-- get_trend_analysis(p_days integer, p_min_count integer) → TABLE(keyword, current_count, ...)
CREATE OR REPLACE FUNCTION public.get_trend_analysis(p_days integer DEFAULT 30, p_min_count integer DEFAULT 2)
RETURNS TABLE(keyword text, current_count bigint, previous_count bigint, growth_rate numeric, domains text[])
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
SELECT kw AS keyword,
  COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL) AS current_count,
  COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL
    AND ci.captured_date < NOW() - (p_days || ' days')::INTERVAL) AS previous_count,
  CASE WHEN COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL
    AND ci.captured_date < NOW() - (p_days || ' days')::INTERVAL) = 0 THEN NULL
  ELSE ROUND(
    (COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL)::NUMERIC -
     COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL
       AND ci.captured_date < NOW() - (p_days || ' days')::INTERVAL)::NUMERIC) /
    COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL
      AND ci.captured_date < NOW() - (p_days || ' days')::INTERVAL)::NUMERIC * 100, 1)
  END AS growth_rate,
  array_agg(DISTINCT ci.primary_domain) FILTER (WHERE ci.primary_domain IS NOT NULL
    AND ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL) AS domains
FROM content_items ci, unnest(ci.ai_keywords) AS kw
WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL AND ci.ai_keywords IS NOT NULL
GROUP BY kw
HAVING COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL) >= p_min_count
ORDER BY current_count DESC, growth_rate DESC NULLS LAST;
$function$;

-- hybrid_search(query_embedding, query_text, similarity_threshold, limit_count)
CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_embedding vector,
  query_text text DEFAULT '',
  similarity_threshold numeric DEFAULT 0.3,
  limit_count integer DEFAULT 10
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

-- search_for_bid_response(query_embedding, query_text, limit_count)
CREATE OR REPLACE FUNCTION public.search_for_bid_response(
  query_embedding vector,
  query_text text DEFAULT '',
  limit_count integer DEFAULT 10
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
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$function$;

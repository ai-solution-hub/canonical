-- Restore 7 further squash-stubbed analytics/search functions.
--
-- Continuation of 20260419095345 — length-diff sweep (OLD vs NEW) revealed
-- seven more functions where the squash left a tiny placeholder while the
-- old project carries the real implementation. Bodies copied verbatim from
-- the old project via `pg_get_functiondef` on 2026-04-19.
--
-- `find_similar_content` in the old project has two overloads (double
-- precision + numeric thresholds); the squash dropped the numeric overload.
-- Both are restored here.

-- Drop current (stub) signatures so CREATE can adopt the real parameter names.
DROP FUNCTION IF EXISTS public.find_similar_content(vector, double precision, integer);
DROP FUNCTION IF EXISTS public.find_similar_content(vector, numeric, integer);
DROP FUNCTION IF EXISTS public.get_popular_keywords(integer);
DROP FUNCTION IF EXISTS public.get_reading_patterns(integer);
DROP FUNCTION IF EXISTS public.get_top_authors(integer);
DROP FUNCTION IF EXISTS public.get_topic_deep_dive(text);
DROP FUNCTION IF EXISTS public.get_unique_authors();
DROP FUNCTION IF EXISTS public.get_user_tag_counts();

-- find_similar_content — double precision overload
CREATE OR REPLACE FUNCTION public.find_similar_content(
  query_embedding vector,
  similarity_threshold double precision DEFAULT 0.7,
  limit_count integer DEFAULT 10
)
RETURNS TABLE(id uuid, title text, content text, similarity numeric, content_type character varying, platform character varying, author_name character varying, source_domain character varying)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT ci.id, ci.title, ci.content,
    (1 - (ci.embedding <=> query_embedding))::NUMERIC(4, 3) as similarity,
    ci.content_type, ci.platform, ci.author_name, ci.source_domain
  FROM content_items ci
  WHERE ci.embedding IS NOT NULL
    AND ci.archived_at IS NULL
    AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
  ORDER BY ci.embedding <=> query_embedding
  LIMIT limit_count;
END;
$function$;

-- find_similar_content — numeric overload (restored)
CREATE OR REPLACE FUNCTION public.find_similar_content(
  query_embedding vector,
  similarity_threshold numeric DEFAULT 0.5,
  limit_count integer DEFAULT 10
)
RETURNS TABLE(id uuid, title text, content text, similarity numeric, content_type character varying, platform character varying, author_name character varying, source_domain character varying)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
SELECT ci.id, ci.title, ci.content,
  (1 - (ci.embedding <=> query_embedding))::NUMERIC(4, 3) as similarity,
  ci.content_type, ci.platform, ci.author_name, ci.source_domain
FROM content_items ci
WHERE ci.embedding IS NOT NULL
  AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
ORDER BY ci.embedding <=> query_embedding
LIMIT limit_count;
$function$;

-- get_popular_keywords(p_limit integer)
CREATE OR REPLACE FUNCTION public.get_popular_keywords(p_limit integer DEFAULT 10)
RETURNS TABLE(keyword text, item_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
SELECT kw AS keyword, COUNT(*) AS item_count FROM content_items, unnest(ai_keywords) AS kw
WHERE ai_keywords IS NOT NULL GROUP BY kw ORDER BY item_count DESC LIMIT p_limit;
$function$;

-- get_reading_patterns(p_days integer)
CREATE OR REPLACE FUNCTION public.get_reading_patterns(p_days integer DEFAULT 30)
RETURNS json
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
SELECT json_build_object(
  'period_days', p_days,
  'total_items', (SELECT COUNT(*) FROM content_items WHERE captured_date >= NOW() - (p_days || ' days')::INTERVAL),
  'items_read', (SELECT COUNT(DISTINCT rm.content_item_id) FROM read_marks rm
    JOIN content_items ci ON ci.id = rm.content_item_id WHERE rm.read_at >= NOW() - (p_days || ' days')::INTERVAL),
  'reading_velocity', (SELECT ROUND(COUNT(DISTINCT rm.content_item_id)::NUMERIC / GREATEST(p_days, 1), 1)
    FROM read_marks rm WHERE rm.read_at >= NOW() - (p_days || ' days')::INTERVAL),
  'domain_reading', (
    SELECT json_agg(json_build_object('domain', domain, 'total', total, 'read', read_count,
      'read_pct', CASE WHEN total > 0 THEN ROUND(read_count::NUMERIC / total * 100, 1) ELSE 0 END) ORDER BY total DESC)
    FROM (SELECT ci.primary_domain AS domain, COUNT(*) AS total, COUNT(rm.id) AS read_count
      FROM content_items ci LEFT JOIN read_marks rm ON ci.id = rm.content_item_id
      WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL AND ci.primary_domain IS NOT NULL
      GROUP BY ci.primary_domain) sub),
  'type_reading', (
    SELECT json_agg(json_build_object('type', content_type, 'total', total, 'read', read_count) ORDER BY total DESC)
    FROM (SELECT ci.content_type, COUNT(*) AS total, COUNT(rm.id) AS read_count
      FROM content_items ci LEFT JOIN read_marks rm ON ci.id = rm.content_item_id
      WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL GROUP BY ci.content_type) sub),
  'daily_reading', (
    SELECT json_agg(json_build_object('date', read_date, 'count', cnt) ORDER BY read_date DESC)
    FROM (SELECT DATE(rm.read_at) AS read_date, COUNT(*) AS cnt FROM read_marks rm
      WHERE rm.read_at >= NOW() - (p_days || ' days')::INTERVAL GROUP BY DATE(rm.read_at) ORDER BY read_date DESC) sub)
);
$function$;

-- get_top_authors(p_limit integer)
CREATE OR REPLACE FUNCTION public.get_top_authors(p_limit integer DEFAULT 8)
RETURNS TABLE(author_name text, item_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
SELECT author_name::TEXT, COUNT(*) AS item_count FROM content_items
WHERE author_name IS NOT NULL AND author_name != '' GROUP BY author_name ORDER BY item_count DESC LIMIT p_limit;
$function$;

-- get_topic_deep_dive(p_keyword text)
CREATE OR REPLACE FUNCTION public.get_topic_deep_dive(p_keyword text)
RETURNS json
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
SELECT json_build_object(
  'keyword', p_keyword,
  'total_items', (SELECT COUNT(*) FROM content_items WHERE ai_keywords @> ARRAY[lower(p_keyword)]),
  'domain_distribution', (
    SELECT json_agg(json_build_object('domain', primary_domain, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT primary_domain, COUNT(*) AS cnt FROM content_items
      WHERE ai_keywords @> ARRAY[lower(p_keyword)] AND primary_domain IS NOT NULL GROUP BY primary_domain) sub),
  'top_authors', (
    SELECT json_agg(json_build_object('author', author_name, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT author_name, COUNT(*) AS cnt FROM content_items
      WHERE ai_keywords @> ARRAY[lower(p_keyword)] AND author_name IS NOT NULL AND author_name != ''
      GROUP BY author_name ORDER BY cnt DESC LIMIT 10) sub),
  'timeline', (
    SELECT json_agg(json_build_object('month', month, 'count', cnt) ORDER BY month DESC)
    FROM (SELECT date_trunc('month', captured_date) AS month, COUNT(*) AS cnt FROM content_items
      WHERE ai_keywords @> ARRAY[lower(p_keyword)] GROUP BY month ORDER BY month DESC LIMIT 12) sub),
  'co_occurring_keywords', (
    SELECT json_agg(json_build_object('keyword', co_kw, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT kw AS co_kw, COUNT(*) AS cnt FROM content_items ci, unnest(ci.ai_keywords) AS kw
      WHERE ci.ai_keywords @> ARRAY[lower(p_keyword)] AND kw != lower(p_keyword)
      GROUP BY kw ORDER BY cnt DESC LIMIT 15) sub),
  'recent_items', (
    SELECT json_agg(json_build_object('id', id, 'title', COALESCE(suggested_title, title),
      'content_type', content_type, 'author_name', author_name, 'captured_date', captured_date) ORDER BY captured_date DESC)
    FROM (SELECT id, suggested_title, title, content_type, author_name, captured_date FROM content_items
      WHERE ai_keywords @> ARRAY[lower(p_keyword)] ORDER BY captured_date DESC LIMIT 10) sub)
);
$function$;

-- get_unique_authors()
CREATE OR REPLACE FUNCTION public.get_unique_authors()
RETURNS TABLE(author_name text, count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
SELECT ci.author_name, COUNT(*) as count FROM content_items ci
WHERE ci.author_name IS NOT NULL AND ci.author_name != '' GROUP BY ci.author_name ORDER BY count DESC;
$function$;

-- get_user_tag_counts()
CREATE OR REPLACE FUNCTION public.get_user_tag_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
SELECT COALESCE(jsonb_object_agg(tag, cnt), '{}'::jsonb)
FROM (SELECT tag, COUNT(*) as cnt FROM content_items ci, unnest(ci.user_tags) AS tag
  WHERE user_tags IS NOT NULL AND user_tags != '{}' GROUP BY tag ORDER BY cnt DESC) sub;
$function$;

-- Capture remote-only functions as local migrations.
-- These functions were previously applied via the Supabase MCP tool
-- and had no corresponding local migration files.
-- Using CREATE OR REPLACE so this migration is idempotent.

CREATE OR REPLACE FUNCTION public.get_filter_counts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT jsonb_build_object(
    'domain', COALESCE(
      (SELECT jsonb_object_agg(primary_domain, cnt)
       FROM (SELECT primary_domain, COUNT(*) as cnt
             FROM content_items
             WHERE primary_domain IS NOT NULL
             GROUP BY primary_domain) d),
      '{}'::jsonb
    ),
    'content_type', COALESCE(
      (SELECT jsonb_object_agg(content_type, cnt)
       FROM (SELECT content_type, COUNT(*) as cnt
             FROM content_items
             WHERE content_type IS NOT NULL
             GROUP BY content_type) t),
      '{}'::jsonb
    ),
    'platform', COALESCE(
      (SELECT jsonb_object_agg(platform, cnt)
       FROM (SELECT platform, COUNT(*) as cnt
             FROM content_items
             WHERE platform IS NOT NULL
             GROUP BY platform) p),
      '{}'::jsonb
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_domain_subtopic_counts()
 RETURNS TABLE(primary_domain text, primary_subtopic text, item_count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    primary_domain::TEXT,
    primary_subtopic::TEXT,
    COUNT(*) AS item_count
  FROM content_items
  WHERE primary_domain IS NOT NULL
  GROUP BY primary_domain, primary_subtopic
  ORDER BY primary_domain, item_count DESC;
$function$;

CREATE OR REPLACE FUNCTION public.filter_by_keywords(search_terms text[])
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT id FROM content_items
  WHERE (
    SELECT bool_and(
      array_to_string(COALESCE(ai_keywords, '{}'), ' ') ILIKE '%' || kw || '%'
      OR COALESCE(title, '') ILIKE '%' || kw || '%'
      OR COALESCE(ai_summary, '') ILIKE '%' || kw || '%'
      OR COALESCE(author_name, '') ILIKE '%' || kw || '%'
    )
    FROM unnest(search_terms) AS kw
  );
$function$;

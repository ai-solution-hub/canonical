-- Tag Management RPCs — Sprint B
-- 5 new functions for duplicate detection, domain grouping, filtered counts,
-- bulk delete, and bulk merge with deduplication.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. find_duplicate_tags(p_type text)
-- Identifies case-variation and plural/singular duplicate groups.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION find_duplicate_tags(p_type text)
RETURNS TABLE (
  canonical text,
  variants text[],
  variant_count int,
  total_usage bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Require authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_type = 'ai' THEN
    -- Case duplicates
    RETURN QUERY
    SELECT
      lower(tag) AS canonical,
      array_agg(DISTINCT tag ORDER BY tag) AS variants,
      count(DISTINCT tag)::int AS variant_count,
      count(*)::bigint AS total_usage
    FROM content_items, LATERAL unnest(ai_keywords) AS tag
    GROUP BY lower(tag)
    HAVING count(DISTINCT tag) > 1

    UNION ALL

    -- Plural/singular pairs (simple 's' suffix)
    SELECT
      t1.tag AS canonical,
      ARRAY[t1.tag, t1.tag || 's'] AS variants,
      2 AS variant_count,
      (t1.cnt + t2.cnt)::bigint AS total_usage
    FROM (
      SELECT tag, count(*) AS cnt
      FROM content_items, LATERAL unnest(ai_keywords) AS tag
      GROUP BY tag
    ) t1
    INNER JOIN (
      SELECT tag, count(*) AS cnt
      FROM content_items, LATERAL unnest(ai_keywords) AS tag
      GROUP BY tag
    ) t2 ON t2.tag = t1.tag || 's'
    -- Exclude pairs already captured as case duplicates
    WHERE lower(t1.tag) != lower(t2.tag);

  ELSIF p_type = 'user' THEN
    RETURN QUERY
    SELECT
      lower(tag) AS canonical,
      array_agg(DISTINCT tag ORDER BY tag) AS variants,
      count(DISTINCT tag)::int AS variant_count,
      count(*)::bigint AS total_usage
    FROM content_items, LATERAL unnest(user_tags) AS tag
    GROUP BY lower(tag)
    HAVING count(DISTINCT tag) > 1

    UNION ALL

    SELECT
      t1.tag AS canonical,
      ARRAY[t1.tag, t1.tag || 's'] AS variants,
      2 AS variant_count,
      (t1.cnt + t2.cnt)::bigint AS total_usage
    FROM (
      SELECT tag, count(*) AS cnt
      FROM content_items, LATERAL unnest(user_tags) AS tag
      GROUP BY tag
    ) t1
    INNER JOIN (
      SELECT tag, count(*) AS cnt
      FROM content_items, LATERAL unnest(user_tags) AS tag
      GROUP BY tag
    ) t2 ON t2.tag = t1.tag || 's'
    WHERE lower(t1.tag) != lower(t2.tag);

  ELSE
    RAISE EXCEPTION 'Invalid p_type: %. Must be ''ai'' or ''user''.', p_type;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. get_tags_by_domain(p_type text)
-- Tags grouped by the content item's primary_domain.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_tags_by_domain(p_type text)
RETURNS TABLE (
  domain text,
  tag text,
  count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_type = 'ai' THEN
    RETURN QUERY
    SELECT
      COALESCE(ci.primary_domain, 'Uncategorised')::text AS domain,
      t.tag::text,
      count(*)::bigint
    FROM content_items ci, LATERAL unnest(ci.ai_keywords) AS t(tag)
    GROUP BY ci.primary_domain, t.tag
    ORDER BY ci.primary_domain NULLS LAST, count(*) DESC, t.tag;

  ELSIF p_type = 'user' THEN
    RETURN QUERY
    SELECT
      COALESCE(ci.primary_domain, 'Uncategorised')::text AS domain,
      t.tag::text,
      count(*)::bigint
    FROM content_items ci, LATERAL unnest(ci.user_tags) AS t(tag)
    GROUP BY ci.primary_domain, t.tag
    ORDER BY ci.primary_domain NULLS LAST, count(*) DESC, t.tag;

  ELSE
    RAISE EXCEPTION 'Invalid p_type: %. Must be ''ai'' or ''user''.', p_type;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. get_tag_counts_filtered(p_type, p_min_count, p_search, p_limit, p_offset)
-- Filtered and paginated tag list with total count.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_tag_counts_filtered(
  p_type text,
  p_min_count int DEFAULT 1,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  tag text,
  count bigint,
  source text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_total bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Clamp limits
  IF p_limit > 500 THEN p_limit := 500; END IF;
  IF p_limit < 1 THEN p_limit := 50; END IF;
  IF p_offset < 0 THEN p_offset := 0; END IF;

  IF p_type = 'ai' THEN
    -- Get total matching count first
    SELECT count(*) INTO v_total
    FROM (
      SELECT t.tag
      FROM content_items ci, LATERAL unnest(ci.ai_keywords) AS t(tag)
      GROUP BY t.tag
      HAVING count(*) >= p_min_count
        AND (p_search IS NULL OR t.tag ILIKE '%' || p_search || '%')
    ) sub;

    RETURN QUERY
    SELECT
      t.tag::text,
      count(*)::bigint,
      'ai'::text AS source,
      v_total AS total_count
    FROM content_items ci, LATERAL unnest(ci.ai_keywords) AS t(tag)
    GROUP BY t.tag
    HAVING count(*) >= p_min_count
      AND (p_search IS NULL OR t.tag ILIKE '%' || p_search || '%')
    ORDER BY count(*) DESC, t.tag
    LIMIT p_limit
    OFFSET p_offset;

  ELSIF p_type = 'user' THEN
    SELECT count(*) INTO v_total
    FROM (
      SELECT t.tag
      FROM content_items ci, LATERAL unnest(ci.user_tags) AS t(tag)
      GROUP BY t.tag
      HAVING count(*) >= p_min_count
        AND (p_search IS NULL OR t.tag ILIKE '%' || p_search || '%')
    ) sub;

    RETURN QUERY
    SELECT
      t.tag::text,
      count(*)::bigint,
      'user'::text AS source,
      v_total AS total_count
    FROM content_items ci, LATERAL unnest(ci.user_tags) AS t(tag)
    GROUP BY t.tag
    HAVING count(*) >= p_min_count
      AND (p_search IS NULL OR t.tag ILIKE '%' || p_search || '%')
    ORDER BY count(*) DESC, t.tag
    LIMIT p_limit
    OFFSET p_offset;

  ELSE
    RAISE EXCEPTION 'Invalid p_type: %. Must be ''ai'' or ''user''.', p_type;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. bulk_delete_tags(p_tags text[], p_type text)
-- Remove multiple tags from all items in a single UPDATE per column.
-- Returns the number of rows affected.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bulk_delete_tags(p_tags text[], p_type text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_affected int;
  v_role text;
BEGIN
  -- Require admin role
  SELECT get_user_role() INTO v_role;
  IF v_role IS NULL OR v_role != 'admin' THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  IF array_length(p_tags, 1) IS NULL OR array_length(p_tags, 1) = 0 THEN
    RETURN 0;
  END IF;

  IF p_type = 'ai' THEN
    -- Remove all specified tags from ai_keywords
    UPDATE content_items
    SET ai_keywords = (
      SELECT COALESCE(array_agg(kw), '{}')
      FROM unnest(ai_keywords) AS kw
      WHERE kw != ALL(p_tags)
    )
    WHERE ai_keywords && p_tags;

    GET DIAGNOSTICS v_affected = ROW_COUNT;

  ELSIF p_type = 'user' THEN
    UPDATE content_items
    SET user_tags = (
      SELECT COALESCE(array_agg(t), '{}')
      FROM unnest(user_tags) AS t
      WHERE t != ALL(p_tags)
    )
    WHERE user_tags && p_tags;

    GET DIAGNOSTICS v_affected = ROW_COUNT;

  ELSE
    RAISE EXCEPTION 'Invalid p_type: %. Must be ''ai'' or ''user''.', p_type;
  END IF;

  RETURN v_affected;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. bulk_merge_tags(p_sources text[], p_target text, p_type text)
-- Merge multiple source tags into a single target tag with deduplication.
-- Items that have any source tag get the target added (if not present),
-- then all source tags are removed. The final array is deduplicated.
-- Returns the number of rows affected.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bulk_merge_tags(
  p_sources text[],
  p_target text,
  p_type text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_affected int;
  v_role text;
BEGIN
  -- Require admin role
  SELECT get_user_role() INTO v_role;
  IF v_role IS NULL OR v_role != 'admin' THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  IF array_length(p_sources, 1) IS NULL OR array_length(p_sources, 1) = 0 THEN
    RETURN 0;
  END IF;

  IF p_type = 'ai' THEN
    -- For each item that has any of the source tags:
    -- 1. Remove all source tags
    -- 2. Add the target tag
    -- 3. Deduplicate the final array
    UPDATE content_items
    SET ai_keywords = (
      SELECT array_agg(DISTINCT kw ORDER BY kw)
      FROM (
        -- Keep existing keywords that are NOT source tags
        SELECT unnest(ai_keywords) AS kw
        EXCEPT
        SELECT unnest(p_sources)
        UNION
        -- Add the target tag
        SELECT p_target
      ) sub
    )
    WHERE ai_keywords && p_sources;

    GET DIAGNOSTICS v_affected = ROW_COUNT;

  ELSIF p_type = 'user' THEN
    UPDATE content_items
    SET user_tags = (
      SELECT array_agg(DISTINCT t ORDER BY t)
      FROM (
        SELECT unnest(user_tags) AS t
        EXCEPT
        SELECT unnest(p_sources)
        UNION
        SELECT p_target
      ) sub
    )
    WHERE user_tags && p_sources;

    GET DIAGNOSTICS v_affected = ROW_COUNT;

  ELSE
    RAISE EXCEPTION 'Invalid p_type: %. Must be ''ai'' or ''user''.', p_type;
  END IF;

  RETURN v_affected;
END;
$$;

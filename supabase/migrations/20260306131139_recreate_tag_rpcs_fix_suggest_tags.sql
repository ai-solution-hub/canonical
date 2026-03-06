-- =============================================================================
-- Migration: Recreate Tag Management RPCs + Fix suggest_tags
-- =============================================================================
-- Migration 20260306111701 was recorded as applied but the functions were not
-- created (silent failure). This migration re-creates all 5 RPCs and fixes the
-- suggest_tags function to use a subquery pattern instead of non-standard
-- HAVING unnest().
-- =============================================================================

-- 1. get_all_tag_counts: UNION of user_tags and ai_keywords with source column
CREATE OR REPLACE FUNCTION get_all_tag_counts()
RETURNS TABLE (tag TEXT, count BIGINT, source TEXT)
LANGUAGE sql STABLE
AS $$
  SELECT unnest(user_tags) AS tag, COUNT(*) AS count, 'user'::TEXT AS source
  FROM content_items
  WHERE user_tags IS NOT NULL AND array_length(user_tags, 1) > 0
  GROUP BY tag
  UNION ALL
  SELECT unnest(ai_keywords) AS tag, COUNT(*) AS count, 'ai'::TEXT AS source
  FROM content_items
  WHERE ai_keywords IS NOT NULL AND array_length(ai_keywords, 1) > 0
  GROUP BY tag
  ORDER BY count DESC, tag ASC;
$$;

-- 2. rename_tag: Atomic rename across all items
CREATE OR REPLACE FUNCTION rename_tag(p_old TEXT, p_new TEXT, p_type TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected INTEGER;
BEGIN
  IF p_type = 'user' THEN
    UPDATE content_items
    SET user_tags = array_replace(user_tags, p_old, p_new),
        updated_at = NOW()
    WHERE p_old = ANY(user_tags);
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSIF p_type = 'ai' THEN
    UPDATE content_items
    SET ai_keywords = array_replace(ai_keywords, p_old, p_new),
        updated_at = NOW()
    WHERE p_old = ANY(ai_keywords);
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'Invalid tag type: %. Must be ''user'' or ''ai''.', p_type;
  END IF;
  RETURN affected;
END;
$$;

-- 3. merge_tags: Merge source tag into target tag
CREATE OR REPLACE FUNCTION merge_tags(p_source TEXT, p_target TEXT, p_type TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected INTEGER;
BEGIN
  IF p_type = 'user' THEN
    UPDATE content_items
    SET user_tags = array_append(user_tags, p_target),
        updated_at = NOW()
    WHERE p_source = ANY(user_tags) AND NOT (p_target = ANY(user_tags));

    UPDATE content_items
    SET user_tags = array_remove(user_tags, p_source),
        updated_at = NOW()
    WHERE p_source = ANY(user_tags);
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSIF p_type = 'ai' THEN
    UPDATE content_items
    SET ai_keywords = array_append(ai_keywords, p_target),
        updated_at = NOW()
    WHERE p_source = ANY(ai_keywords) AND NOT (p_target = ANY(ai_keywords));

    UPDATE content_items
    SET ai_keywords = array_remove(ai_keywords, p_source),
        updated_at = NOW()
    WHERE p_source = ANY(ai_keywords);
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'Invalid tag type: %. Must be ''user'' or ''ai''.', p_type;
  END IF;
  RETURN affected;
END;
$$;

-- 4. delete_tag: Remove a tag from all items
CREATE OR REPLACE FUNCTION delete_tag(p_tag TEXT, p_type TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected INTEGER;
BEGIN
  IF p_type = 'user' THEN
    UPDATE content_items
    SET user_tags = array_remove(user_tags, p_tag),
        updated_at = NOW()
    WHERE p_tag = ANY(user_tags);
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSIF p_type = 'ai' THEN
    UPDATE content_items
    SET ai_keywords = array_remove(ai_keywords, p_tag),
        updated_at = NOW()
    WHERE p_tag = ANY(ai_keywords);
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'Invalid tag type: %. Must be ''user'' or ''ai''.', p_type;
  END IF;
  RETURN affected;
END;
$$;

-- 5. suggest_tags: Autocomplete matching prefix, ordered by frequency
--    Fixed: uses subquery + WHERE instead of non-standard HAVING unnest()
--    Fixed: uses CASE expression instead of redundant UNION ALL
CREATE OR REPLACE FUNCTION suggest_tags(p_prefix TEXT, p_type TEXT)
RETURNS TABLE (tag TEXT, count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT tag, COUNT(*) AS count
  FROM (
    SELECT unnest(CASE WHEN p_type = 'user' THEN user_tags
                       WHEN p_type = 'ai'   THEN ai_keywords
                  END) AS tag
    FROM content_items
    WHERE CASE WHEN p_type = 'user'
               THEN user_tags IS NOT NULL AND array_length(user_tags, 1) > 0
               WHEN p_type = 'ai'
               THEN ai_keywords IS NOT NULL AND array_length(ai_keywords, 1) > 0
               ELSE FALSE
          END
  ) expanded
  WHERE tag ILIKE (p_prefix || '%')
  GROUP BY tag
  ORDER BY count DESC, tag ASC
  LIMIT 10;
$$;

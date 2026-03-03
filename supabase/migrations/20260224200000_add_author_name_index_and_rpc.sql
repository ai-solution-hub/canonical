-- B-tree index on author_name for efficient filtering and grouping
CREATE INDEX IF NOT EXISTS idx_content_items_author_name
  ON public.content_items USING btree (author_name);

-- RPC function to return unique authors with item counts
CREATE OR REPLACE FUNCTION get_unique_authors()
RETURNS TABLE(author_name text, count bigint)
LANGUAGE sql STABLE
AS $$
  SELECT ci.author_name, COUNT(*) as count
  FROM content_items ci
  WHERE ci.author_name IS NOT NULL AND ci.author_name != ''
  GROUP BY ci.author_name
  ORDER BY count DESC;
$$;

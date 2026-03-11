SET search_path TO public, extensions;

-- 1. Fix Foreign Key constraints for Hard Delete
-- content_item_workspaces
ALTER TABLE content_item_workspaces 
  DROP CONSTRAINT IF EXISTS content_item_workspaces_content_item_id_fkey,
  ADD CONSTRAINT content_item_workspaces_content_item_id_fkey 
  FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE CASCADE;

-- ingestion_quality_log
ALTER TABLE ingestion_quality_log 
  DROP CONSTRAINT IF EXISTS ingestion_quality_log_content_item_id_fkey,
  ADD CONSTRAINT ingestion_quality_log_content_item_id_fkey 
  FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE CASCADE;

-- read_marks
ALTER TABLE read_marks 
  DROP CONSTRAINT IF EXISTS read_marks_content_item_id_fkey,
  ADD CONSTRAINT read_marks_content_item_id_fkey 
  FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE CASCADE;

-- 2. Update find_duplicate_pairs to support domain filtering
DROP FUNCTION IF EXISTS find_duplicate_pairs(NUMERIC, INTEGER);
DROP FUNCTION IF EXISTS find_duplicate_pairs(NUMERIC, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION find_duplicate_pairs(
  similarity_threshold NUMERIC DEFAULT 0.95,
  p_domain TEXT DEFAULT NULL,
  limit_count INTEGER DEFAULT 50
)
RETURNS TABLE (
  id1 UUID,
  title1 TEXT,
  type1 CHARACTER VARYING,
  domain1 CHARACTER VARYING,
  id2 UUID,
  title2 TEXT,
  type2 CHARACTER VARYING,
  domain2 CHARACTER VARYING,
  similarity NUMERIC
)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ci1.id AS id1,
    COALESCE(ci1.suggested_title, ci1.title) AS title1,
    ci1.content_type AS type1,
    ci1.primary_domain AS domain1,
    ci2.id AS id2,
    COALESCE(ci2.suggested_title, ci2.title) AS title2,
    ci2.content_type AS type2,
    ci2.primary_domain AS domain2,
    (1 - (ci1.embedding <=> ci2.embedding))::NUMERIC(4, 3) AS similarity
  FROM content_items ci1
  CROSS JOIN content_items ci2
  WHERE ci1.id < ci2.id
    AND ci1.archived_at IS NULL
    AND ci2.archived_at IS NULL
    AND ci1.embedding IS NOT NULL
    AND ci2.embedding IS NOT NULL
    AND (p_domain IS NULL OR ci1.primary_domain = p_domain)
    AND (p_domain IS NULL OR ci2.primary_domain = p_domain)
    AND (1 - (ci1.embedding <=> ci2.embedding)) >= similarity_threshold
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$$;

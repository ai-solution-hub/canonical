-- Batch-check whether content items still exist (for citation orphan detection)
CREATE OR REPLACE FUNCTION check_content_exists(ids uuid[])
RETURNS TABLE(id uuid, item_exists boolean)
LANGUAGE sql STABLE
AS $$
  SELECT
    unnest_id AS id,
    EXISTS(SELECT 1 FROM content_items ci WHERE ci.id = unnest_id) AS item_exists
  FROM unnest(ids) AS unnest_id;
$$;

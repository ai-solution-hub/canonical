-- Cleanup filtered articles older than 90 days
-- Removes feed_articles where passed = false and created_at is older than 90 days
-- Returns the count of deleted rows for logging

CREATE OR REPLACE FUNCTION cleanup_filtered_articles()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM feed_articles
  WHERE passed = false
    AND created_at < now() - interval '90 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

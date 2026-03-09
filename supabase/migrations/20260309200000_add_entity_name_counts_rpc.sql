CREATE OR REPLACE FUNCTION get_entity_name_counts()
RETURNS TABLE(canonical_name text, mention_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT canonical_name, count(*) as mention_count
  FROM entity_mentions
  GROUP BY canonical_name
  ORDER BY mention_count DESC
  LIMIT 50;
$$;

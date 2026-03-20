-- Denormalise citation_count into content_items.metadata
-- Keeps metadata.citation_count in sync whenever content_citations rows are inserted or deleted.

CREATE OR REPLACE FUNCTION update_citation_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  target_id uuid;
  new_count int;
BEGIN
  -- Determine which content_item_id to update
  IF TG_OP = 'DELETE' THEN
    target_id := OLD.content_item_id;
  ELSE
    target_id := NEW.content_item_id;
  END IF;

  -- Count citations for this item
  SELECT count(*)::int INTO new_count
  FROM content_citations
  WHERE content_item_id = target_id;

  -- Update metadata JSONB (merge, preserving existing keys)
  UPDATE content_items
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('citation_count', new_count)
  WHERE id = target_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_citation_count_insert
  AFTER INSERT ON content_citations
  FOR EACH ROW
  EXECUTE FUNCTION update_citation_count();

CREATE TRIGGER trg_citation_count_delete
  AFTER DELETE ON content_citations
  FOR EACH ROW
  EXECUTE FUNCTION update_citation_count();

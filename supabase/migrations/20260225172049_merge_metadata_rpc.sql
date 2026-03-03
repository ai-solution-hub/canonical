-- Merge keys into content_items.metadata (JSONB ||) without overwriting existing keys
-- Used by enrichment pipelines to add media_type, etc. without clobbering other metadata
CREATE OR REPLACE FUNCTION merge_item_metadata(
  p_item_id UUID,
  p_new_data JSONB
)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE content_items
  SET metadata = COALESCE(metadata, '{}'::jsonb) || p_new_data,
      updated_at = now()
  WHERE id = p_item_id;
$$;

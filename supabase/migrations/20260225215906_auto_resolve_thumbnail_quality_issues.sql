-- Auto-resolve "missing_thumbnail" quality issues when thumbnail_url is updated
-- This makes the pipeline dashboard self-healing regardless of which script adds thumbnails
CREATE OR REPLACE FUNCTION auto_resolve_thumbnail_issues()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.thumbnail_url IS NOT NULL AND NEW.thumbnail_url != ''
     AND (OLD.thumbnail_url IS NULL OR OLD.thumbnail_url = '') THEN
    UPDATE ingestion_quality_log
    SET resolved = true,
        resolved_at = now(),
        resolved_by = 'trigger',
        resolution_notes = 'Thumbnail added; auto-resolved by trigger'
    WHERE content_item_id = NEW.id
      AND flag_type = 'missing_thumbnail'
      AND resolved = false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_resolve_thumbnail
  AFTER UPDATE OF thumbnail_url ON content_items
  FOR EACH ROW
  EXECUTE FUNCTION auto_resolve_thumbnail_issues();

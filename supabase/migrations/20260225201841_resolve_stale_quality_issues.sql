-- Resolve missing_thumbnail quality issues where the item now has a thumbnail.
-- These were logged during ingestion but thumbnails were later enriched
-- via linkedin_pipeline.py --enrich-thumbs without resolving the log entries.
UPDATE ingestion_quality_log
SET resolved = true,
    details = details || '{"resolved_reason": "thumbnail_enriched", "resolved_at": "2026-02-25T20:18:00Z"}'::jsonb
WHERE flag_type = 'missing_thumbnail'
  AND resolved = false
  AND content_item_id IN (
    SELECT id FROM content_items
    WHERE thumbnail_url IS NOT NULL AND thumbnail_url != ''
  );

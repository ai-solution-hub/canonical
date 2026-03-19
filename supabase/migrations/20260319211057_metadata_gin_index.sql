-- ============================================================================
-- GIN index on content_items.metadata for frequently filtered JSONB keys
-- Supports efficient queries on: layer, starred, source_file, topic_id
-- ============================================================================

CREATE INDEX idx_content_items_metadata_gin
  ON content_items
  USING gin (metadata jsonb_path_ops);

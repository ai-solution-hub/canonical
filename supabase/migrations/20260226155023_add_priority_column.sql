-- Add priority column to content_items
ALTER TABLE content_items ADD COLUMN priority VARCHAR(10)
  CHECK (priority IN ('high', 'medium', 'low'));

-- Partial index for efficient filtering (only index non-null values)
CREATE INDEX idx_content_items_priority ON content_items(priority)
  WHERE priority IS NOT NULL;

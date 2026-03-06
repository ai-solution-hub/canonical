-- Expression indexes for layer and topic_id metadata fields
CREATE INDEX IF NOT EXISTS idx_content_items_layer
  ON content_items ((metadata->>'layer'))
  WHERE metadata->>'layer' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_content_items_topic_id
  ON content_items ((metadata->>'topic_id'))
  WHERE metadata->>'topic_id' IS NOT NULL;

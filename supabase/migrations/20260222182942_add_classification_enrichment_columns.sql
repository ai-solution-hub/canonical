
-- Add columns for classification enrichment
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS suggested_title TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS classification_reasoning TEXT;

COMMENT ON COLUMN content_items.suggested_title IS 'AI-generated descriptive title (40-100 chars); original title preserved in title column';
COMMENT ON COLUMN content_items.classification_reasoning IS 'AI reasoning for classification decision; useful for reviewing flagged items';

-- {64.13} Drop 4 orphan content_items cols. Pre-drop FKs/index first. bl-189 Part B. (parent_id self-FK re-added 20260601180102.)
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_parent_id_fkey;
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_source_bid_fkey;
DROP INDEX IF EXISTS idx_content_items_source_bid;
ALTER TABLE content_items
  DROP COLUMN notes,
  DROP COLUMN parent_id,
  DROP COLUMN source_bid,
  DROP COLUMN source_document;

-- Fix source_bid FK to allow bid deletion after KB integration
-- Content items should keep their content but lose the bid provenance link

-- source_bid is currently TEXT but projects.id is UUID — fix the type mismatch
-- No existing data uses source_bid so the USING cast is safe
ALTER TABLE content_items
  ALTER COLUMN source_bid TYPE uuid USING source_bid::uuid;

-- Now add the FK with ON DELETE SET NULL so deleting a bid doesn't 500
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_source_bid_fkey;
ALTER TABLE content_items ADD CONSTRAINT content_items_source_bid_fkey
  FOREIGN KEY (source_bid) REFERENCES projects(id) ON DELETE SET NULL;

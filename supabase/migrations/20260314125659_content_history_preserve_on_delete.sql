-- C-1: Preserve content_history rows when a content_item is hard-deleted.
-- Previously ON DELETE CASCADE destroyed the audit trail. Now SET NULL keeps
-- the history record with content_item_id = NULL so deletions remain auditable.

-- Allow NULL so SET NULL can work
ALTER TABLE content_history
  ALTER COLUMN content_item_id DROP NOT NULL;

-- Replace CASCADE with SET NULL
ALTER TABLE content_history
  DROP CONSTRAINT content_history_content_item_id_fkey,
  ADD CONSTRAINT content_history_content_item_id_fkey
    FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE SET NULL;

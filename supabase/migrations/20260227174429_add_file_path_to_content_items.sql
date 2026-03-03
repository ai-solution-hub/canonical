ALTER TABLE content_items ADD COLUMN file_path TEXT;
COMMENT ON COLUMN content_items.file_path IS 'Supabase Storage path for uploaded files (documents bucket). NULL for URL-ingested items.';

-- Add description columns if not present
ALTER TABLE taxonomy_domains
  ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE taxonomy_subtopics
  ADD COLUMN IF NOT EXISTS description TEXT;

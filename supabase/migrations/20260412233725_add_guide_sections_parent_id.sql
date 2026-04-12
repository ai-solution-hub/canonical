-- Add parent_section_id to guide_sections for hierarchical guide structure.
-- Nullable — existing rows remain top-level (parent_section_id = NULL).
-- ON DELETE CASCADE: deleting a parent sector removes its child topics.

ALTER TABLE guide_sections
  ADD COLUMN parent_section_id uuid REFERENCES guide_sections(id)
    ON DELETE CASCADE;

CREATE INDEX idx_guide_sections_parent_section_id
  ON guide_sections (parent_section_id)
  WHERE parent_section_id IS NOT NULL;

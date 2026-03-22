-- Add reviewer_note column to source_document_diffs.
--
-- Allows reviewers to annotate individual diff entries with free-text notes
-- explaining their review decision (why they applied or dismissed a change).

ALTER TABLE source_document_diffs
  ADD COLUMN IF NOT EXISTS reviewer_note text;

COMMENT ON COLUMN source_document_diffs.reviewer_note IS 'Free-text reviewer annotation explaining the review decision for this diff entry';

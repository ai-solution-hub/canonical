-- Add audit columns to source_document_diffs for review tracking.
--
-- reviewed_at / reviewed_by — track when and who changed the entry
-- status away from 'pending_review'.
-- created_by — track which user triggered the diff computation.

ALTER TABLE source_document_diffs
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_source_document_diffs_reviewed_by
  ON source_document_diffs(reviewed_by) WHERE reviewed_by IS NOT NULL;

COMMENT ON COLUMN source_document_diffs.reviewed_at IS 'Timestamp when the entry status was last changed from pending_review';
COMMENT ON COLUMN source_document_diffs.reviewed_by IS 'User who last changed the entry status';
COMMENT ON COLUMN source_document_diffs.created_by IS 'User who triggered the diff computation';

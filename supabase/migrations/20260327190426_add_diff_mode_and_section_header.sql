-- Add diff_mode and section_header columns to source_document_diffs
-- Supports the full-text diff mode alongside the existing Q&A diff mode.

ALTER TABLE source_document_diffs
  ADD COLUMN IF NOT EXISTS diff_mode text NOT NULL DEFAULT 'qa'
  CONSTRAINT source_document_diffs_diff_mode_check
    CHECK (diff_mode IN ('qa', 'full_text'));

ALTER TABLE source_document_diffs
  ADD COLUMN IF NOT EXISTS section_header text;

COMMENT ON COLUMN source_document_diffs.diff_mode IS
  'Diff algorithm used: qa for Q&A pair matching, full_text for line-level text diff';
COMMENT ON COLUMN source_document_diffs.section_header IS
  'Section heading context for full-text diff entries';

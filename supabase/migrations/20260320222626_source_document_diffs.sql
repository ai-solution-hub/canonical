-- Source document diff results — tracks differences between document versions.
-- Each row represents one matched or unmatched Q&A pair between two document versions.
--
-- Phase 4.1 of Content Lifecycle spec.

CREATE TABLE IF NOT EXISTS source_document_diffs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  old_document_id uuid NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  new_document_id uuid NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  diff_type text NOT NULL CHECK (diff_type IN ('added', 'removed', 'modified', 'unchanged')),
  old_content text,
  new_content text,
  old_question text,
  new_question text,
  similarity_score float,
  affected_content_item_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'applied', 'dismissed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Ensure old/new document pair is valid
  CONSTRAINT different_documents CHECK (old_document_id != new_document_id)
);

COMMENT ON TABLE source_document_diffs IS 'Stores Q&A pair-level diffs between source document versions. Each row represents one matched or unmatched pair.';

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_source_document_diffs_old_doc
  ON source_document_diffs(old_document_id);
CREATE INDEX IF NOT EXISTS idx_source_document_diffs_new_doc
  ON source_document_diffs(new_document_id);
CREATE INDEX IF NOT EXISTS idx_source_document_diffs_status
  ON source_document_diffs(status) WHERE status = 'pending_review';
CREATE INDEX IF NOT EXISTS idx_source_document_diffs_affected_item
  ON source_document_diffs(affected_content_item_id) WHERE affected_content_item_id IS NOT NULL;

-- RLS policies
ALTER TABLE source_document_diffs ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view diffs
CREATE POLICY "Authenticated users can view diffs"
  ON source_document_diffs FOR SELECT
  TO authenticated
  USING (true);

-- Editors and admins can insert and update diffs
CREATE POLICY "Editors can manage diffs"
  ON source_document_diffs FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role IN ('editor', 'admin')
    )
  );

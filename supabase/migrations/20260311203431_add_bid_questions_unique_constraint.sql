-- =============================================================================
-- Add unique constraint on bid_questions(project_id, question_text)
-- =============================================================================
-- Enables idempotent re-extraction via upsert with ignoreDuplicates.
-- Protects against race conditions and partial inserts from timed-out
-- extraction attempts (observed in UAT scenario 2b with large DOCX files).
-- =============================================================================

-- Remove any existing duplicates first (keep the earliest row per pair)
DELETE FROM bid_questions a
USING bid_questions b
WHERE a.project_id = b.project_id
  AND a.question_text = b.question_text
  AND a.created_at > b.created_at;

-- Add the unique constraint
ALTER TABLE bid_questions
  ADD CONSTRAINT bid_questions_project_question_unique
  UNIQUE (project_id, question_text);
-- ==========================================================================
-- Migration: Add Q&A answer variant columns + split existing content
-- Spec 5 (Q&A Library) — Session 55
--
-- 1. Add answer_standard and answer_advanced columns
-- 2. Add partial index for Q&A pair lookups
-- 3. Parse existing content field to populate new columns
-- 4. Clean up ai_summary artifacts
-- 5. Update metadata flags
-- ==========================================================================

-- ── 1. Schema changes ─────────────────────────────────────────────────────

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS answer_standard TEXT,
  ADD COLUMN IF NOT EXISTS answer_advanced TEXT;

CREATE INDEX IF NOT EXISTS idx_content_items_qa_type
  ON content_items (content_type)
  WHERE content_type = 'q_a_pair';

-- ── 2. Data migration: split content into answer_standard / answer_advanced ──
-- Pattern: "Q: <question>\n\nStandard: <answer>\n\nAdvanced: <answer>"
-- Some items have only Standard, some have neither (question only).

-- 2a. Items with both Standard and Advanced
UPDATE content_items
SET
  answer_standard = trim(substring(content FROM 'Standard:\s*(.*?)(?:\n\nAdvanced:)')),
  answer_advanced = trim(substring(content FROM 'Advanced:\s*(.*)\s*$')),
  content = trim(
    substring(content FROM 'Standard:\s*(.*?)(?:\n\nAdvanced:)') ||
    E'\n\n' ||
    substring(content FROM 'Advanced:\s*(.*)\s*$')
  ),
  metadata = jsonb_set(
    jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{has_standard}', 'true'
    ),
    '{has_advanced}', 'true'
  )
WHERE content_type = 'q_a_pair'
  AND content LIKE '%Standard:%'
  AND content LIKE '%Advanced:%';

-- 2b. Items with Standard only (no Advanced)
UPDATE content_items
SET
  answer_standard = trim(substring(content FROM 'Standard:\s*(.*)\s*$')),
  content = trim(substring(content FROM 'Standard:\s*(.*)\s*$')),
  metadata = jsonb_set(
    jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{has_standard}', 'true'
    ),
    '{has_advanced}', 'false'
  )
WHERE content_type = 'q_a_pair'
  AND content LIKE '%Standard:%'
  AND content NOT LIKE '%Advanced:%';

-- 2c. Items with no Standard/Advanced labels (question only or raw answer)
-- Strip the "Q: ..." prefix if present, leave content as-is otherwise
UPDATE content_items
SET
  content = CASE
    WHEN content ~ '^Q:\s' THEN trim(regexp_replace(content, '^Q:\s.*?(\n\n|$)', '', 's'))
    ELSE content
  END,
  metadata = jsonb_set(
    jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{has_standard}', 'false'
    ),
    '{has_advanced}', 'false'
  )
WHERE content_type = 'q_a_pair'
  AND content NOT LIKE '%Standard:%'
  AND content NOT LIKE '%Advanced:%';

-- ── 3. Clean up ai_summary artifacts ──────────────────────────────────────
-- Replace useless "Q&A pair from <filename>" with first 200 chars of answer

UPDATE content_items
SET ai_summary = left(
  COALESCE(answer_standard, content),
  200
)
WHERE content_type = 'q_a_pair'
  AND ai_summary LIKE 'Q&A pair from%';

-- ── 4. Remove legacy metadata key ────────────────────────────────────────

UPDATE content_items
SET metadata = metadata - 'has_advanced_answer'
WHERE content_type = 'q_a_pair'
  AND metadata ? 'has_advanced_answer';

-- ── 5. Fix metadata flags from actual column values ──────────────────────
-- Steps 2a-2c have a sequencing issue: 2a modifies content, then 2c matches
-- those rows. This final step sets flags from the authoritative columns.

UPDATE content_items
SET metadata = jsonb_set(
  jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{has_standard}', to_jsonb(answer_standard IS NOT NULL)
  ),
  '{has_advanced}', to_jsonb(answer_advanced IS NOT NULL)
)
WHERE content_type = 'q_a_pair';

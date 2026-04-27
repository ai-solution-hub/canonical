-- Migration: merge corporate.financial → corporate.financial-standing
--
-- Driver: PQQ-aligned canonical slug consolidation. See
-- docs/specs/taxonomy-financial-merge-spec.md §1.4 for justification.
--
-- This migration:
--   1. Migrates 5 content_items rows (4 primary + 1 secondary) to financial-standing.
--   2. Migrates 4 guide_sections rows.
--   3. Migrates 7 template_requirements rows (5 primary + 2 secondary).
--   4. Soft-deletes the `financial` row in taxonomy_subtopics (is_active=false).
--   5. Emits content_history audit rows for content_items only (the only
--      table tracked by content_history per docs/reference/data-entry-points.md).
--
-- All UPDATEs are idempotent: re-running on a clean DB is a no-op.
--
-- Implementation note (faithful execution of spec §5.2.6):
--   The spec references `ci.version + 1` to source the next audit version,
--   but `content_items` has no `version` column (verified via
--   information_schema.columns 2026-04-27). version is monotonic per
--   content_item_id and recorded in content_history only. We compute the
--   next version with a correlated subquery against content_history.

BEGIN;

-- ── 5.2.1 content_items.primary_subtopic
UPDATE content_items
SET primary_subtopic = 'financial-standing'
WHERE primary_domain = 'corporate'
  AND primary_subtopic = 'financial';

-- ── 5.2.2 content_items.secondary_subtopic
UPDATE content_items
SET secondary_subtopic = 'financial-standing'
WHERE secondary_subtopic = 'financial';

-- ── 5.2.3 guide_sections.subtopic_filter
UPDATE guide_sections
SET subtopic_filter = 'financial-standing'
WHERE subtopic_filter = 'financial';

-- ── 5.2.4 template_requirements.primary_subtopic
UPDATE template_requirements
SET primary_subtopic = 'financial-standing'
WHERE primary_subtopic = 'financial';

-- ── 5.2.5 template_requirements.secondary_subtopic
UPDATE template_requirements
SET secondary_subtopic = 'financial-standing'
WHERE secondary_subtopic = 'financial';

-- ── 5.2.6.A — 4 primary_subtopic audit rows in content_history
-- Schema (verified 2026-04-27 via information_schema.columns on
-- project rovrymhhffssilaftdwd): NOT NULL on version, title, content,
-- change_type. CHECK constraint on change_type allows 'metadata_change'.
-- Version computed from content_history (source of truth — content_items
-- has no version column).
INSERT INTO content_history (
  content_item_id,
  version,
  title,
  content,
  change_type,
  change_reason,
  change_summary,
  created_by
)
SELECT
  ci.id,
  COALESCE((SELECT MAX(version) FROM content_history h WHERE h.content_item_id = ci.id), 0) + 1,
  ci.title,
  ci.content,
  'metadata_change',
  'taxonomy_merge_financial_to_financial_standing',
  'primary_subtopic: financial → financial-standing (slug consolidation per taxonomy-financial-merge-spec.md §1.4)',
  'a0000000-0000-4000-8000-000000000001'::uuid
FROM content_items ci
WHERE ci.id IN (
    '1c750aaa-bad7-4e6e-9ffd-b267172f64d1',
    'd288b109-caba-4f80-8f2e-a9963136fb57',
    '246d1e4c-0ab0-47eb-b007-8a0958b9150c',
    '0ec2579c-de77-4a0e-bc51-86d319607cae'
  )
  AND NOT EXISTS (
    SELECT 1 FROM content_history h
    WHERE h.content_item_id = ci.id
      AND h.change_reason = 'taxonomy_merge_financial_to_financial_standing'
      AND h.change_summary LIKE 'primary_subtopic:%'
  );

-- ── 5.2.6.B — 1 secondary_subtopic audit row in content_history
INSERT INTO content_history (
  content_item_id,
  version,
  title,
  content,
  change_type,
  change_reason,
  change_summary,
  created_by
)
SELECT
  ci.id,
  COALESCE((SELECT MAX(version) FROM content_history h WHERE h.content_item_id = ci.id), 0) + 1,
  ci.title,
  ci.content,
  'metadata_change',
  'taxonomy_merge_financial_to_financial_standing',
  'secondary_subtopic: financial → financial-standing (slug consolidation per taxonomy-financial-merge-spec.md §1.4)',
  'a0000000-0000-4000-8000-000000000001'::uuid
FROM content_items ci
WHERE ci.id = '540e3ace-d7f2-40b4-b269-2c3e12a5fba7'
  AND NOT EXISTS (
    SELECT 1 FROM content_history h
    WHERE h.content_item_id = ci.id
      AND h.change_reason = 'taxonomy_merge_financial_to_financial_standing'
      AND h.change_summary LIKE 'secondary_subtopic:%'
  );

-- ── 5.2.7 Soft-delete the taxonomy_subtopics 'financial' row
UPDATE taxonomy_subtopics
SET is_active = false
WHERE name = 'financial'
  AND domain_id = (SELECT id FROM taxonomy_domains WHERE name = 'corporate');

COMMIT;

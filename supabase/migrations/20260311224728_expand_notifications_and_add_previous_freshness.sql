-- =============================================================================
-- Migration: Expand notification constraints + add previous_freshness
-- =============================================================================
-- Combines 3 spec migrations (§8.1, §8.2, §8.3) into one file:
--   1. Expand notifications_type_check with 3 new automation types
--   2. Expand notifications_entity_type_check with template_requirement, domain
--   3. Add previous_freshness column to content_items for transition detection
-- =============================================================================

-- 1. Expand notification types
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
      'governance_review_needed'::text,
      'governance_approve'::text,
      'governance_request_changes'::text,
      'governance_revert'::text,
      'quality_flag'::text,
      'digest_ready'::text,
      'freshness_transition'::text,
      'coverage_alert'::text,
      'content_gap'::text
    ])
  );

-- 2. Expand notification entity types
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_entity_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_entity_type_check CHECK (
    entity_type = ANY (ARRAY[
      'content_item'::text,
      'digest'::text,
      'template_requirement'::text,
      'domain'::text
    ])
  );

-- 3. Add previous_freshness column for freshness transition detection
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS previous_freshness varchar;

ALTER TABLE content_items
  ADD CONSTRAINT content_items_previous_freshness_check
  CHECK (previous_freshness IS NULL OR previous_freshness IN ('fresh', 'aging', 'stale', 'expired'));

-- Backfill: set previous_freshness = freshness for all existing items
UPDATE content_items SET previous_freshness = freshness;
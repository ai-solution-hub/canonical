-- =============================================================================
-- Migration: Fix governance_review_status CHECK constraint to include 'draft'
-- =============================================================================
-- The earlier migration (20260306111700) attempted to add 'draft' but used
-- CHECK (governance_review_status IN (...)) which rejects NULL values.
-- Most rows have governance_review_status IS NULL, so the constraint
-- addition failed silently. This migration drops and recreates the
-- constraint with the correct NULL-permissive syntax.
-- =============================================================================

ALTER TABLE content_items
  DROP CONSTRAINT IF EXISTS content_items_governance_review_status_check;

ALTER TABLE content_items
  ADD CONSTRAINT content_items_governance_review_status_check
  CHECK (
    governance_review_status IS NULL
    OR governance_review_status = ANY (ARRAY[
      'pending'::text,
      'approved'::text,
      'reverted'::text,
      'changes_requested'::text,
      'draft'::text
    ])
  );
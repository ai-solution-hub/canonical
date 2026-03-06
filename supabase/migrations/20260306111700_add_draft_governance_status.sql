-- =============================================================================
-- Migration: Add 'draft' to governance_review_status CHECK constraint
-- =============================================================================
-- Session 53: Lightweight Draft Extension (Spec 3 Section 4)
--
-- Adds 'draft' as a valid governance_review_status. Items with status 'draft'
-- are excluded from search results, bid matching, and the review queue by
-- default. Browse can include them with an explicit filter toggle.
-- =============================================================================

-- Drop existing CHECK constraint and recreate with 'draft' included
ALTER TABLE content_items
  DROP CONSTRAINT IF EXISTS content_items_governance_review_status_check;

ALTER TABLE content_items
  ADD CONSTRAINT content_items_governance_review_status_check
  CHECK (governance_review_status IN ('pending', 'approved', 'changes_requested', 'reverted', 'draft'));

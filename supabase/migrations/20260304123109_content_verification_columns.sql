-- =============================================================================
-- Migration 7: Content Verification Columns
-- =============================================================================
-- Adds verification tracking to content_items for the Content Review workflow.
-- Nullable columns: NULL means unverified, non-null means verified.
-- =============================================================================

-- Add verification columns
ALTER TABLE content_items ADD COLUMN verified_at TIMESTAMPTZ;
ALTER TABLE content_items ADD COLUMN verified_by UUID REFERENCES auth.users(id);

-- Index for filtering unverified items (partial index for efficiency)
CREATE INDEX idx_content_items_unverified
    ON content_items (created_at DESC)
    WHERE verified_at IS NULL;

-- Index for verification audit trail
CREATE INDEX idx_content_items_verified_by ON content_items (verified_by)
    WHERE verified_by IS NOT NULL;

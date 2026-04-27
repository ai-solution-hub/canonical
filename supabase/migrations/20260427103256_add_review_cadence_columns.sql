-- Migration: add_review_cadence_columns
-- Phase 1 of §5.5 Document Control & Lifecycle (P0).
-- Spec: docs/specs/p0-document-control-lifecycle-spec.md v1.3 §5.2.
-- Plan: docs/plans/§5.5-phase-1-schema-plan.md (T1).
-- Pinned arrays: docs/plans/§5.5-phase-1-PINNED-ARRAYS.md (W0-V6).
--
-- Adds two nullable columns (`next_review_date`, `review_cadence_days`) to
-- `content_items`; extends `governance_review_status` CHECK enum with
-- `'review_overdue'`; extends `notifications.type` CHECK enum with
-- `'review_overdue'`; adds partial index `idx_content_items_next_review_date`
-- gated on non-superseded, non-archived rows for the Phase 2 cron query path.
--
-- All DDL is idempotent (`IF NOT EXISTS` / `IF EXISTS` guards) so the
-- migration can replay against a partially-applied DB without erroring. CHECK
-- constraints use the canonical DROP-then-ADD pattern (PostgreSQL has no
-- `ALTER CONSTRAINT` for CHECK clauses). The re-ADD enumerations match the
-- live arrays captured in PINNED-ARRAYS.md (W0-V1, W0-V2 confirmed no drift
-- from the spec literal).

-- 1a — ADD COLUMN (nullable; backfill ships in §5.4 / Plan T6).
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS next_review_date date,
  ADD COLUMN IF NOT EXISTS review_cadence_days integer;

-- 1b — Cadence range CHECK (1-1095 days; defensive DROP IF EXISTS for replay).
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_review_cadence_days_check;
ALTER TABLE content_items ADD CONSTRAINT content_items_review_cadence_days_check
  CHECK ((review_cadence_days IS NULL) OR (review_cadence_days BETWEEN 1 AND 1095));

-- 1c — Extend governance_review_status CHECK with 'review_overdue'.
-- Live array (W0-V1, 27/04/2026): pending, approved, reverted, changes_requested, draft.
-- Appended: review_overdue.
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_governance_review_status_check;
ALTER TABLE content_items ADD CONSTRAINT content_items_governance_review_status_check
  CHECK ((governance_review_status IS NULL) OR (governance_review_status = ANY (ARRAY['pending'::text, 'approved'::text, 'reverted'::text, 'changes_requested'::text, 'draft'::text, 'review_overdue'::text])));

-- 1d — Extend notifications_type_check with 'review_overdue'.
-- Live array (W0-V2, 27/04/2026): governance_review_needed, governance_approve,
-- governance_request_changes, governance_revert, quality_flag, digest_ready,
-- freshness_transition, coverage_alert, content_gap, owner_content_stale,
-- owner_content_updated, owner_assignment, source_document_updated,
-- date_expiry_approaching. Appended: review_overdue.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY['governance_review_needed'::text, 'governance_approve'::text, 'governance_request_changes'::text, 'governance_revert'::text, 'quality_flag'::text, 'digest_ready'::text, 'freshness_transition'::text, 'coverage_alert'::text, 'content_gap'::text, 'owner_content_stale'::text, 'owner_content_updated'::text, 'owner_assignment'::text, 'source_document_updated'::text, 'date_expiry_approaching'::text, 'review_overdue'::text]));

-- 1e — Partial index for the Phase 2 cron query path.
-- Indexes only non-superseded, non-archived rows with a non-NULL review date,
-- keeping the index small and matching the canonical predicate.
CREATE INDEX IF NOT EXISTS idx_content_items_next_review_date
  ON content_items (next_review_date)
  WHERE next_review_date IS NOT NULL
    AND superseded_by IS NULL
    AND archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Rollback (per spec §15.5 / plan §7) — operators may copy-paste this block
-- into a psql session against rovrymhhffssilaftdwd to back Phase 1 out.
-- Order: drop columns -> drop cadence-range CHECK -> drop partial index ->
-- restore original governance_review_status CHECK -> restore original
-- notifications.type CHECK. Backfilled data is lost on rollback (acceptable
-- per spec §15.5: cohort SQL in T6 is deterministic given a snapshot date).
--
-- -- 1. Remove new columns
-- ALTER TABLE content_items DROP COLUMN IF EXISTS next_review_date;
-- ALTER TABLE content_items DROP COLUMN IF EXISTS review_cadence_days;
--
-- -- 2. Remove the cadence-range CHECK
-- ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_review_cadence_days_check;
--
-- -- 3. Remove the partial index
-- DROP INDEX IF EXISTS idx_content_items_next_review_date;
--
-- -- 4. Restore original governance_review_status CHECK (without 'review_overdue')
-- ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_governance_review_status_check;
-- ALTER TABLE content_items ADD CONSTRAINT content_items_governance_review_status_check
--   CHECK ((governance_review_status IS NULL) OR (governance_review_status = ANY (
--       ARRAY['pending'::text, 'approved'::text, 'reverted'::text, 'changes_requested'::text, 'draft'::text])));
--
-- -- 5. Restore original notifications_type_check (without 'review_overdue')
-- ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
-- ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
--   CHECK (type = ANY (ARRAY[
--     'governance_review_needed'::text, 'governance_approve'::text, 'governance_request_changes'::text,
--     'governance_revert'::text, 'quality_flag'::text, 'digest_ready'::text, 'freshness_transition'::text,
--     'coverage_alert'::text, 'content_gap'::text, 'owner_content_stale'::text, 'owner_content_updated'::text,
--     'owner_assignment'::text, 'source_document_updated'::text, 'date_expiry_approaching'::text]));

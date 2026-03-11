-- =============================================================================
-- Migration: Add result JSONB column to pipeline_runs
-- =============================================================================
-- Automations 2-4 store structured results (snapshots, gap lists) in this
-- column for audit logging and week-over-week comparison.
-- =============================================================================

ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS result jsonb;
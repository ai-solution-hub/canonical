-- P1-15 Phase 1: Add is_primary flag to company_profiles
-- Promotes Company Profile from SI-scoped to app-wide organisation grounding.
-- Option A from spec §3.3: widen existing table with is_primary flag.

ALTER TABLE company_profiles
  ADD COLUMN is_primary boolean NOT NULL DEFAULT false;

-- Enforce at most one primary active profile (singleton pattern).
-- Partial unique index: only rows where is_primary=true AND is_active=true
-- participate in the uniqueness check.
CREATE UNIQUE INDEX idx_company_profiles_primary_singleton
  ON company_profiles (is_primary)
  WHERE is_primary = true AND is_active = true;

COMMENT ON COLUMN company_profiles.is_primary IS
  'When true, this profile represents the organisation itself (app-wide grounding). At most one row may be primary and active (enforced by partial unique index). SI workspaces may reference any active profile via domain_metadata.company_profile_id.';

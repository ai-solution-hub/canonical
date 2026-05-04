-- ============================================================
-- Corrective migration: re-backfill user_profiles + retry failed FK
-- ============================================================
--
-- Context: Migration 20260503225703_migrate_auth_user_fks_to_user_profiles
-- failed on production at statement 37 (feed_prompts_created_by_fkey)
-- because user 4f0ea46b-cd86-47c6-bb9f-ae9732d7c5cc existed in
-- auth.users but had no corresponding row in public.user_profiles.
--
-- The original backfill in 20260428122626 ran at migration-apply time;
-- any auth.users rows created between that migration and the FK
-- migration — or rows where the AFTER INSERT trigger failed silently —
-- would be missing from user_profiles.
--
-- This migration:
--   1. Re-runs the user_profiles backfill (idempotent ON CONFLICT DO NOTHING)
--   2. Re-applies the single FK constraint that failed (idempotent via
--      DROP IF EXISTS + ADD)
--
-- On staging (where 20260503225703 already succeeded): step 1 is a no-op,
-- step 2 drops+recreates the already-existing constraint (harmless).
--
-- On production, 20260503225703 must now pass first because pending migrations
-- run in timestamp order. This migration is retained as an idempotent safety
-- check and as a visible corrective marker for the incident.
-- ============================================================

-- Step 1: Re-backfill user_profiles from auth.users
-- Catches any rows that slipped through between the original backfill
-- and the FK migration.
INSERT INTO public.user_profiles (id, email, full_name)
SELECT id,
       email,
       raw_user_meta_data ->> 'full_name'
  FROM auth.users
 ON CONFLICT (id) DO NOTHING;

-- Step 2: Re-apply the constraint that failed on production.
-- The DROP IF EXISTS handles both cases:
--   - If absent: create it after the defensive backfill
--   - If present: drop + recreate is safe and keeps the definition aligned
ALTER TABLE ONLY public.feed_prompts
  DROP CONSTRAINT IF EXISTS feed_prompts_created_by_fkey;
ALTER TABLE ONLY public.feed_prompts
  ADD CONSTRAINT feed_prompts_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id);

-- ============================================================
-- Fix: Pipeline service account role downgrade (S183 WP3)
-- ============================================================
-- Root cause discovered during S183 WP3 row-count follow-up:
-- the pipeline service account (a0000000-...) was observed as
-- `viewer` on the rebuilt NEW project, despite the seed migration
-- 20260416122127_seed_pipeline_service_account.sql intending `admin`.
--
-- Mechanism:
--   1. The seed migration INSERTs the pipeline account into
--      auth.users.
--   2. The `handle_new_user_role()` trigger fires and inserts
--      (user_id, 'viewer') into public.user_roles.
--   3. The seed migration's subsequent INSERT with
--      `ON CONFLICT (user_id) DO NOTHING` is a no-op.
--   4. Final state: role='viewer'.
--
-- This only affected the rebuilt project; the original project
-- had pre-existing state that won the race.
--
-- Pipeline writes via SUPABASE_SECRET_KEY bypass RLS, so the
-- downgrade did not cause live failures on NEW. The fix is
-- defensive: any `getUserRole('a0000000-...')` call returning
-- 'viewer' would incorrectly block admin-gated behaviour.
--
-- Idempotent: running this migration again on a DB where the
-- role is already 'admin' is a no-op.
-- ============================================================

SET search_path = public, extensions;

UPDATE public.user_roles
SET role = 'admin'
WHERE user_id = 'a0000000-0000-4000-8000-000000000001'
  AND role <> 'admin';

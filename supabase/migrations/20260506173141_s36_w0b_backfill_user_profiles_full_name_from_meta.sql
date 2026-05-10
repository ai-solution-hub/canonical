-- kh-prod-readiness-S36 W0b — Class A integration-test fix (Step 1 of 2)
--
-- Backfills public.user_profiles.full_name from auth.users.raw_user_meta_data
-- for any pre-existing row whose mirror trigger silently no-op'd because the
-- seed script wrote 'display_name' but handle_new_user reads 'full_name'.
--
-- The OPS-60 B-strict refactor (`20260506115807_s34_w2b_ops60_get_user_display_names_invoker`)
-- intentionally dropped the email-prefix branch from the get_user_display_names
-- COALESCE chain. That branch had been masking the latent NULL full_name for
-- every user seeded via scripts/seed-e2e-users.ts. Post-OPS-60 the chain falls
-- through to the 'A team member' sentinel, breaking the display-name integration
-- assertions on staging.
--
-- This migration is idempotent: only rows where full_name IS NULL are touched,
-- and only when raw_user_meta_data carries either 'display_name' or 'full_name'.
--
-- Companion: 20260506173500_s36_w0b_patch_auth_users_full_name_metadata.sql
-- patches auth.users.raw_user_meta_data so handle_user_update does not re-NULL
-- this backfill on the next signInWithPassword. Both are needed.
--
-- Forward-pair: scripts/seed-e2e-users.ts now writes both keys on createUser so
-- newly seeded users no longer need either step.

UPDATE public.user_profiles AS up
   SET full_name = COALESCE(
         u.raw_user_meta_data ->> 'full_name',
         u.raw_user_meta_data ->> 'display_name'
       ),
       updated_at = NOW()
  FROM auth.users AS u
 WHERE up.id = u.id
   AND up.full_name IS NULL
   AND (
         u.raw_user_meta_data ? 'full_name'
      OR u.raw_user_meta_data ? 'display_name'
       );

-- kh-prod-readiness-S36 W0b — Class A integration-test fix (Step 2 of 2)
--
-- Patches auth.users.raw_user_meta_data to add the canonical 'full_name' key
-- alongside the existing 'display_name' for every user where 'full_name' is
-- absent. This is the source-of-truth fix that complements the user_profiles
-- backfill in 20260506173141_s36_w0b_backfill_user_profiles_full_name_from_meta.
--
-- Why both migrations are needed:
--   • The user_profiles backfill alone is insufficient because
--     handle_user_update fires on every UPDATE of auth.users (including
--     last_sign_in_at on signInWithPassword) and rewrites
--     user_profiles.full_name from raw_user_meta_data->>'full_name'.
--     With 'full_name' missing from the metadata, the trigger writes NULL
--     back into user_profiles, defeating the backfill on the next sign-in.
--   • This migration ensures handle_user_update has the canonical key to read.
--
-- The integration test sequence
--   signInAsTestUser → auth.users UPDATE last_sign_in_at → handle_user_update
--   trigger → user_profiles.full_name = raw_user_meta_data->>'full_name'
-- is what surfaces the issue. Adding the key here means the trigger no longer
-- nulls the backfill.
--
-- Idempotent: only rows missing the 'full_name' key but carrying 'display_name'
-- are patched; existing 'full_name' values are preserved verbatim. Safe to
-- replay against any environment.

UPDATE auth.users AS u
   SET raw_user_meta_data = u.raw_user_meta_data
       || jsonb_build_object(
            'full_name', u.raw_user_meta_data ->> 'display_name'
          )
 WHERE (u.raw_user_meta_data ? 'display_name')
   AND NOT (u.raw_user_meta_data ? 'full_name');

-- ============================================================
-- S156: Fix pipeline service account auth row shape
-- ============================================================
--
-- Problem:
--   The pipeline service account (user_id a0000000-0000-4000-8000-000000000001)
--   was originally inserted directly via SQL during S149, bypassing
--   auth.admin.createUser(). The row is missing the field initialisation
--   that GoTrue normally provides:
--
--     1. email_change_token_new IS NULL          (GoTrue expects '')
--     2. No corresponding row in auth.identities (GoTrue expects 1)
--
--   When supabase.auth.admin.listUsers() runs, GoTrue scans
--   email_change_token_new into a Go string. NULL causes a scan error which
--   500s the ENTIRE listUsers() response — so the /api/admin/users route
--   returns 500 and the Team Members UI shows "No team members found".
--
--   The earlier migration 20260406180000_create_pipeline_service_account.sql
--   has been amended to produce the correct shape on fresh rebuilds, but it
--   uses ON CONFLICT DO NOTHING so it does not self-heal the existing bad
--   row on environments where the user was already present (i.e. live prod).
--   This migration is the corrective fix for those environments.
--
-- Idempotency:
--   Safe to re-run. The UPDATE is a no-op if the fields are already correct,
--   and the identities INSERT uses ON CONFLICT DO NOTHING.
--
-- Verification:
--   After apply, auth.admin.listUsers() should succeed and /api/admin/users
--   should return all 7 users (or 6, once the service account is filtered
--   from the API response in a follow-up code change).
-- ============================================================

SET search_path = public, extensions, auth;

-- 1. Normalise NULL token columns to '' on the service account row.
--    Only this row is touched — other users created via auth.admin.createUser()
--    already have '' and are unaffected.
UPDATE auth.users
SET
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  confirmation_token = COALESCE(confirmation_token, ''),
  recovery_token = COALESCE(recovery_token, ''),
  email_change = COALESCE(email_change, ''),
  phone_change = COALESCE(phone_change, ''),
  phone_change_token = COALESCE(phone_change_token, ''),
  reauthentication_token = COALESCE(reauthentication_token, '')
WHERE id = 'a0000000-0000-4000-8000-000000000001';

-- 2. Backfill the missing auth.identities row. Shape mirrors what
--    auth.admin.createUser({ email }) would have produced.
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  'a0000000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_object(
    'sub', 'a0000000-0000-4000-8000-000000000001',
    'email', 'pipeline@system.knowledge-hub.internal',
    'email_verified', true,
    'provider', 'email'
  ),
  'email',
  'pipeline@system.knowledge-hub.internal',
  NOW(),
  NOW(),
  NOW()
WHERE EXISTS (
  SELECT 1 FROM auth.users WHERE id = 'a0000000-0000-4000-8000-000000000001'
)
ON CONFLICT (provider_id, provider) DO NOTHING;

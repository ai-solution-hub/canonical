-- Capture auth-hook function restricting sign-ups to @client.example
--
-- The hook was created on 2026-04-24 via the Supabase dashboard
-- (Authentication → Hooks → Before User Created) and was missing from
-- migration history. This migration captures the function definition so a
-- project reset would restore it.
--
-- NOTE: The dashboard wiring (enabling the hook for the "Before User
-- Created" event) is NOT captured here — it must be re-configured via the
-- Supabase dashboard after any project reset. Dashboard URL:
-- https://supabase.com/dashboard/project/rovrymhhffssilaftdwd/auth/hooks
--
-- Full audit: docs/audits/s195-investigations/inv-3-auth-setup.md
-- Reference: docs/reference/auth-hooks.md

CREATE OR REPLACE FUNCTION public.hook_restrict_signup_to_example-client_domain(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $function$
DECLARE
  email text;
  domain text;
BEGIN
  email := coalesce(event->'user'->>'email', '');
  domain := lower(split_part(email, '@', 2));

  IF domain = 'client.example' THEN
    RETURN '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'Please sign up with your @client.example email address.',
      'http_code', 403
    )
  );
END;
$function$;

-- Hygiene: restrict execution to supabase_auth_admin only
-- (per Supabase docs best practice for auth hooks — no other role needs
-- to invoke this function)
REVOKE EXECUTE ON FUNCTION public.hook_restrict_signup_to_example-client_domain(jsonb)
  FROM public, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.hook_restrict_signup_to_example-client_domain(jsonb)
  TO supabase_auth_admin;

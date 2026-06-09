-- ID-68.21 GUC -> config-table pivot for the sign-up domain restriction auth hook.
--
-- WHY THIS SUPERSEDES THE GUC MECHANISM:
-- The generic hook (migration 20260603121652) read the allowed sign-up domain at
-- call time from the `app.allowed_signup_domain` database GUC. Setting that GUC
-- requires `ALTER DATABASE postgres SET app.allowed_signup_domain = '...'`, which
-- FAILS on managed Supabase with `ERROR: 42501: permission denied to set
-- parameter` (no superuser in the SQL editor / managed instance). The GUC
-- mechanism is therefore dead on managed Supabase.
--
-- Supabase's own advisor recommends the supported alternative: a single-row config
-- table the hook reads at call time. The domain value is set PER-ENVIRONMENT as a
-- DATA STEP run out-of-band (SQL editor / post-deploy), NEVER committed in a
-- migration -- so the client domain never enters tracked source. Same
-- client-isolation win as the GUC, but supported on managed Supabase.
--
-- Per-environment data step (run out of band, NOT committed to git):
--   INSERT INTO public.signup_policy (allowed_domain) VALUES ('<domain>')
--     ON CONFLICT (id) DO UPDATE SET allowed_domain = EXCLUDED.allowed_domain;
--
-- Fail-closed preserved: if the row is absent or allowed_domain is unset/empty the
-- hook REJECTS sign-up. A wired-but-unconfigured restriction must not silently
-- permit open registration.
--
-- The hook keeps the EXACT same function name + signature
-- (public.hook_restrict_signup_to_allowed_domain(jsonb)); supabase/config.toml
-- already points at this name and Liam has already flipped the live hooks, so no
-- re-wire is needed. NO client domain literal appears anywhere in this file.
--
-- RLS/grant pattern confirmed against Supabase docs (custom_access_token_hook
-- reading public.user_roles): the before_user_created hook executes as
-- supabase_auth_admin, which is neither the table owner nor BYPASSRLS, so reading
-- an RLS-enabled table needs BOTH a table GRANT and a permissive SELECT policy for
-- that role. The hook itself stays SECURITY INVOKER plpgsql (the docs example does
-- not use SECURITY DEFINER), reading the table directly.
--
-- Reference: docs/reference/auth-hooks.md ; ID-68 TECH section PC-39(i).

-- (a) Single-row generic config table -- NO client domain literal.
CREATE TABLE IF NOT EXISTS public.signup_policy (
  id boolean PRIMARY KEY DEFAULT true,
  allowed_domain text,
  CONSTRAINT signup_policy_singleton CHECK (id = true)
);

COMMENT ON TABLE public.signup_policy IS
  'Single-row per-instance sign-up domain policy. allowed_domain is set out-of-band per environment (SQL editor / post-deploy data step), NEVER in committed migrations, so the client domain never enters tracked source. Read by the before_user_created auth hook (hook_restrict_signup_to_allowed_domain).';

-- (b) RLS deny-all + grant SELECT to the auth-hook role only.
-- The before_user_created hook executes as supabase_auth_admin. RLS applies to
-- that role (not owner, lacks BYPASSRLS), so it needs BOTH a GRANT and a
-- permissive SELECT policy. Documented Supabase auth-hook table-read pattern.
ALTER TABLE public.signup_policy ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.signup_policy FROM anon, authenticated, public;
GRANT SELECT ON TABLE public.signup_policy TO supabase_auth_admin;

CREATE POLICY "auth_admin_reads_signup_policy"
  ON public.signup_policy
  AS PERMISSIVE FOR SELECT
  TO supabase_auth_admin
  USING (true);

-- (c) Repoint the hook to read the config table instead of the GUC.
-- Same function name/signature; fail-closed semantics preserved.
CREATE OR REPLACE FUNCTION public.hook_restrict_signup_to_allowed_domain(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $function$
DECLARE
  email text;
  domain text;
  allowed text;
BEGIN
  SELECT lower(nullif(trim(coalesce(allowed_domain, '')), ''))
    INTO allowed
    FROM public.signup_policy
    LIMIT 1;

  IF allowed IS NULL THEN
    -- Fail closed: wired restriction with no configured domain rejects rather
    -- than silently permitting any address.
    RETURN jsonb_build_object('error', jsonb_build_object(
      'message', 'Sign-up is currently unavailable: the allowed email domain is not configured.',
      'http_code', 403));
  END IF;

  email := coalesce(event->'user'->>'email', '');
  domain := lower(split_part(email, '@', 2));

  IF domain = allowed THEN
    RETURN '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object('error', jsonb_build_object(
    'message', format('Please sign up with your @%s email address.', allowed),
    'http_code', 403));
END;
$function$;

-- Re-assert hook grants (replay-safe; matches 20260603121652).
REVOKE EXECUTE ON FUNCTION public.hook_restrict_signup_to_allowed_domain(jsonb)
  FROM public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hook_restrict_signup_to_allowed_domain(jsonb)
  TO supabase_auth_admin;

-- Generic, config-driven sign-up domain restriction auth hook.
--
-- ID-68 {68.13} item B (pre-flip client de-identification). Supersedes the
-- client-named hook (hook_restrict_signup_to_<client>_domain, captured in an
-- earlier migration) whose body hardcoded the client's email domain — the single
-- highest-signal client-identity leak in the public source.
--
-- This function takes NO domain literal. It reads the allowed domain at call time
-- from the `app.allowed_signup_domain` database GUC, which is set PER-DEPLOY out
-- of band (NOT in migration history, so the client domain never enters tracked
-- source), e.g. on the target project:
--   ALTER DATABASE postgres SET app.allowed_signup_domain = 'example.org';
--
-- Fail-closed: if the GUC is unset/empty the hook REJECTS sign-up. A wired-but-
-- unconfigured restriction must not silently allow open registration.
--
-- ADDITIVE-ONLY by design: this migration only CREATEs the generic function. The
-- live-wiring cutover (repoint supabase/config.toml's before_user_created hook to
-- this function, drop the superseded client-named function, set the per-deploy
-- GUC) is a deliberate, separately-gated deploy step performed AFTER this hook is
-- staging-verified — keeping `db push` safe to run against a live project without
-- touching the active auth pipeline.
--
-- Reference: docs/reference/auth-hooks.md ; PRE-FLIP-DEID-PLAN.md §2 B.

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
  -- Per-deploy allowed domain; NULL when the GUC is unset (missing_ok = true).
  allowed := lower(nullif(trim(coalesce(current_setting('app.allowed_signup_domain', true), '')), ''));

  IF allowed IS NULL THEN
    -- Fail closed: wired restriction with no configured domain rejects rather
    -- than silently permitting any address.
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'message', 'Sign-up is currently unavailable: the allowed email domain is not configured.',
        'http_code', 403
      )
    );
  END IF;

  email := coalesce(event->'user'->>'email', '');
  domain := lower(split_part(email, '@', 2));

  IF domain = allowed THEN
    RETURN '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'message', format('Please sign up with your @%s email address.', allowed),
      'http_code', 403
    )
  );
END;
$function$;

-- Hygiene: only supabase_auth_admin invokes auth hooks (Supabase best practice).
REVOKE EXECUTE ON FUNCTION public.hook_restrict_signup_to_allowed_domain(jsonb)
  FROM public, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.hook_restrict_signup_to_allowed_domain(jsonb)
  TO supabase_auth_admin;

-- ID-61.14 amendment — DR-035 born-locked handler: match set_config by EXACT
-- regprocedure SIGNATURE, not bare proname (checker PASS_WITH_NOTES item 1 on
-- the companion migration, 20260707190500_id61_dr035_default_privileges.sql).
--
-- THE GAP: the original handler exempted the anon-EXECUTE REVOKE for any
-- function merely NAMED `set_config`, regardless of schema or argument types
-- (`SELECT proname INTO fn_name ...; IF fn_name IS DISTINCT FROM
-- 'set_config'`). A future function/overload named `set_config` — any schema
-- in {public, api}, any argument list — would silently dodge the born-locked
-- REVOKE, reopening exactly the class of anon-EXECUTE drift DR-035 exists to
-- close.
--
-- THE FIX: match on `obj.objid::regprocedure::text` against the two live
-- set_config signatures ONLY, verified live on staging (rbwqewalexrzgxtvcqrh)
-- via the same cast expression under the handler's own `SET search_path =
-- public, extensions` (regprocedure schema-qualifies both regardless of
-- search_path in this environment — confirmed empirically, not assumed):
--   api.set_config(text,text,boolean)
--   public.set_config(text,text,boolean)
-- Any other function named set_config (different schema, different args, or
-- a future overload) is now born-locked like every other public/api
-- function.
CREATE OR REPLACE FUNCTION public._dr035_enforce_born_locked_functions()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SET search_path = public, extensions
AS $fn$
DECLARE
  obj record;
  fn_sig text;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
              WHERE object_type = 'function'
                AND schema_name IN ('public', 'api')
  LOOP
    fn_sig := obj.objid::regprocedure::text;
    -- The two live set_config signatures are the sole deliberate
    -- anon-EXECUTE exception (INV-20), matched by exact signature so a
    -- future fn/overload merely NAMED set_config cannot dodge the REVOKE.
    IF fn_sig NOT IN (
      'api.set_config(text,text,boolean)',
      'public.set_config(text,text,boolean)'
    ) THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon',
        obj.objid::regprocedure
      );
    END IF;
  END LOOP;
END;
$fn$;

COMMENT ON FUNCTION public._dr035_enforce_born_locked_functions() IS
  'DR-035 {61.14} born-locked posture: ddl_command_end event-trigger handler that REVOKEs EXECUTE FROM PUBLIC, anon on every function CREATEd/REPLACEd in public or api, except the two live set_config signatures (INV-20) matched by exact regprocedure text -- api.set_config(text,text,boolean) / public.set_config(text,text,boolean) -- not bare proname, so a future fn/overload merely named set_config cannot dodge the REVOKE (amendment: 20260707190600_id61_dr035_set_config_signature_match.sql). See 20260707190500_id61_dr035_default_privileges.sql for the full empirical rationale (ALTER DEFAULT PRIVILEGES alone cannot suppress the compiled PUBLIC-EXECUTE default for functions on this platform).';

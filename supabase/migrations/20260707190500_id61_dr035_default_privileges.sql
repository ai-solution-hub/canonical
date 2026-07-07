-- ID-61.14 — DR-035 born-locked posture: ALTER DEFAULT PRIVILEGES + a
-- ddl_command_end event trigger enforcing zero PUBLIC/anon EXECUTE on every
-- FUTURE function created in public/api — the mechanism half of DR-035
-- (companion to the one-time sweep in 20260707190000_id61_dr035_revoke_sweep.sql).
--
-- WHY A MECHANISM, NOT JUST A SWEEP: the per-migration "remember to REVOKE"
-- discipline demonstrably regressed within days (S410, 20260624, fixed `api`
-- 72->1; by S450, 20260705, ~34 fresh `api` fns and ~68 `public` fns had
-- drifted straight back to anon-callable, because every hand-authored
-- migration since S410 created functions without an explicit REVOKE). A
-- one-time sweep alone would regress the same way again.
--
-- EMPIRICAL FINDING (verified live on staging rbwqewalexrzgxtvcqrh via
-- probe-fn create -> check pg_proc.proacl -> drop, {61.14}):
-- `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` does
-- NOT suppress Postgres's compiled-in "PUBLIC gets EXECUTE on new functions"
-- baseline when no PUBLIC entry already exists in the target
-- (role,schema,objtype) default-ACL row (`pg_default_acl`) — REVOKE of an
-- absent grant is a genuine no-op; it does not record a negative/deny entry.
-- Since `anon` unconditionally inherits whatever PUBLIC holds, a brand-new
-- function STILL came out anon-EXECUTE-able after this ALTER DEFAULT
-- PRIVILEGES statement ran, confirmed identically with and without an
-- explicit `FOR ROLE postgres`. Revoking a NAMED role's default (anon,
-- independent of PUBLIC) DID work reliably in the same test — kept below as
-- defense-in-depth — but it is not sufficient alone to close INV-20.
--
-- The reliable mechanism is therefore the event trigger below: it fires on
-- every `ddl_command_end` for a CREATE FUNCTION (the tag also covers CREATE
-- OR REPLACE) in `public`/`api` and issues the SAME proven per-object
-- `REVOKE EXECUTE ... FROM PUBLIC, anon` the S410 hardening and the companion
-- sweep migration use — just automated at creation time instead of relying on
-- every future migration author to remember it. `set_config` is skipped
-- (INV-20's sole intended anon entrypoint) so it is never fought by this
-- trigger; migrations that (re)create it keep granting anon back explicitly
-- afterward, same as today.
--
-- `postgres` (the role `supabase db push` / this migration connects as) is
-- NOT superuser on the Platform DBs (`rolsuper=false`) but IS empirically
-- permitted to `CREATE EVENT TRIGGER` — confirmed live; Supabase grants it
-- the necessary privilege even though plain `ALTER DEFAULT PRIVILEGES FOR
-- ROLE supabase_admin` is refused ("permission denied to change default
-- privileges" — postgres cannot alter supabase_admin's own defaults, and
-- supabase_admin is not the role that creates migration-authored functions
-- anyway: `SELECT DISTINCT proowner::regrole FROM pg_proc WHERE pronamespace
-- IN ('public','api')` returns exactly `postgres` today).

-- Defense-in-depth: suppress the anon-specific default grant Supabase's own
-- platform bootstrap adds (`ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON
-- FUNCTIONS TO anon, authenticated, service_role` at project creation) for
-- functions the `postgres` role creates. Confirmed empirically effective for
-- the NAMED anon grant on schema `public` (removes `anon=X/postgres` from
-- pg_default_acl); a no-op today on schema `api` (no default-ACL row exists
-- there yet) but harmless and future-proofs against one being added. Does
-- NOT by itself suppress the PUBLIC baseline — see event trigger below.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, api
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public._dr035_enforce_born_locked_functions()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SET search_path = public, extensions
AS $fn$
DECLARE
  obj record;
  fn_name text;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
              WHERE object_type = 'function'
                AND schema_name IN ('public', 'api')
  LOOP
    SELECT proname INTO fn_name FROM pg_proc WHERE oid = obj.objid;
    -- set_config is the sole deliberate anon-EXECUTE exception (INV-20);
    -- every other public/api function is born with zero PUBLIC/anon EXECUTE.
    IF fn_name IS DISTINCT FROM 'set_config' THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon',
        obj.objid::regprocedure
      );
    END IF;
  END LOOP;
END;
$fn$;

COMMENT ON FUNCTION public._dr035_enforce_born_locked_functions() IS
  'DR-035 {61.14} born-locked posture: ddl_command_end event-trigger handler that REVOKEs EXECUTE FROM PUBLIC, anon on every function CREATEd/REPLACEd in public or api (except set_config, INV-20). See this migration''s header for the empirical rationale (ALTER DEFAULT PRIVILEGES alone cannot suppress the compiled PUBLIC-EXECUTE default for functions on this platform).';

DROP EVENT TRIGGER IF EXISTS dr035_born_locked_functions;
CREATE EVENT TRIGGER dr035_born_locked_functions
  ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION')
  EXECUTE FUNCTION public._dr035_enforce_born_locked_functions();

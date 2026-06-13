-- ID-95 {95.11} PI-18 -- per-client canonical-content propagation version ledger.
--
-- PURPOSE:
-- A per-client (per-database) ledger recording which version of each canonical
-- payload has been applied to THIS database by the one-way platform -> client
-- propagation worker (PI-18, RESEARCH §9.2 Pattern 2). One row per canonical
-- payload (keyed by the source table name, the "payload_key"). The worker upserts
-- a row by payload_key after a successful fan-out apply, recording the source
-- version it applied and a checksum of the applied payload so a subsequent run can
-- skip an already-current target.
--
-- This is a GENERIC, multi-row client-side ledger -- exactly like the tenant_config
-- / signup_policy config-as-data pattern, it carries NO client name or domain
-- literal and is fanned to every client DB + staging by the normal migration path.
-- It is NOT platform-DB DDL and is NOT gated.
--
-- OUT-OF-BAND / SERVICE-ROLE ONLY:
-- The PI-18 fan-out worker (scripts/propagate-canonical-content.ts, {95.13}) writes
-- this table using the per-target service-role key, which bypasses RLS and holds
-- default table privileges. No application code path reads or writes this table, so
-- anon/authenticated receive NO grant (deny-all, mirroring signup_policy). The
-- worker upserts by payload_key:
--   INSERT INTO public.content_propagation_version
--     (payload_key, version, payload_checksum)
--   VALUES ('<source_table_name>', <version>, '<checksum>')
--   ON CONFLICT (payload_key)
--   DO UPDATE SET version = EXCLUDED.version,
--                payload_checksum = EXCLUDED.payload_checksum,
--                applied_at = now();
--
-- One-way only: the worker never reads client rows back into the platform source
-- (PI-18); this ledger records target-apply state only. NO client literal anywhere.

CREATE TABLE IF NOT EXISTS public.content_propagation_version (
  payload_key text PRIMARY KEY,
  version bigint NOT NULL,
  payload_checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.content_propagation_version IS
  'Per-client ledger of canonical-payload versions applied to THIS database by the one-way PI-18 propagation worker. One row per payload_key (the source table name). Service-role-only: the worker upserts by payload_key out-of-band; deny-all for anon/authenticated. No client literal.';

-- Deny-all: RLS on, no grant to anon/authenticated/public. The propagation worker
-- writes with the service-role key (bypasses RLS, default privileges). Mirrors the
-- signup_policy config-table deny-all pattern.
ALTER TABLE public.content_propagation_version ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.content_propagation_version FROM anon, authenticated, public;

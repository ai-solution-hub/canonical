-- Relocate `vector` to `extensions` schema and drop unused `pg_trgm` extension.
--
-- Background: the squash baseline (`20260416102457_pre_squash_reconciliation.sql`
-- lines 48 + 76) creates `vector` and `pg_trgm` `WITH SCHEMA "public"`. The fix
-- on production was applied out-of-band via `psql` (per the comment block in
-- `20260417134137_fix_squash_schema_gaps.sql:1-15`) and was never committed as a
-- SQL migration. The persistent staging branch `turayklvaunphgbgscat` was
-- provisioned fresh on 26/04/2026 and replayed the baseline as-written, so it
-- inherited the bad placement that prod was patched out of.
--
-- This migration brings staging into parity with prod and ensures any future
-- branch provisioned from these files lands with the canonical placement. On
-- prod it is a no-op because `vector` is already in `extensions` and `pg_trgm`
-- was never installed.

-- 1. vector → extensions (idempotent: skip if already correctly placed).
DO $$
DECLARE
  cur_schema text;
BEGIN
  SELECT n.nspname INTO cur_schema
  FROM pg_extension e
  JOIN pg_namespace n ON e.extnamespace = n.oid
  WHERE e.extname = 'vector';

  IF cur_schema IS NULL THEN
    RAISE NOTICE 'vector extension not installed; skipping';
  ELSIF cur_schema = 'extensions' THEN
    RAISE NOTICE 'vector extension already in extensions schema; skipping';
  ELSE
    EXECUTE 'ALTER EXTENSION vector SET SCHEMA extensions';
    RAISE NOTICE 'vector extension relocated from % to extensions', cur_schema;
  END IF;
END
$$;

-- 2. Drop pg_trgm if installed. On staging it has 47 dependent objects but zero
-- in-use indexes (verified via `pg_indexes` ILIKE '%trgm%' returning empty);
-- on prod it is not installed (no-op). Deliberately no CASCADE — any unforeseen
-- dependency aborts cleanly so we can investigate.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    DROP EXTENSION pg_trgm;
    RAISE NOTICE 'pg_trgm extension dropped';
  ELSE
    RAISE NOTICE 'pg_trgm extension not installed; skipping';
  END IF;
END
$$;

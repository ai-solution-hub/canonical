-- Align staging and production auth.users indexes observed by schema parity.
-- auth.users is owned by Supabase Auth in hosted projects, so the standard
-- Supabase migration role cannot reliably create or drop indexes on it.
--
-- Production rejected normal CREATE INDEX DDL with SQLSTATE 42501
-- ("must be owner of table users"). Do not apply these staging-only indexes to
-- production just for parity: they are unproven, out-of-band Auth-owned drift.
-- The intended cleanup is to remove the four indexes from staging via an
-- elevated Supabase/Auth-owner action, not to duplicate them in production.
--
-- Keep this migration as a ledger-safe no-op so production can advance past the
-- version that originally attempted unsupported auth.users DDL.

DO $$
BEGIN
  RAISE NOTICE
    'No-op: auth.users parity indexes are Auth-owner managed drift; remove staging-only indexes via elevated Supabase/Auth-owner action if desired.';
END
$$;

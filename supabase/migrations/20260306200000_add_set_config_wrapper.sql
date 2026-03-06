-- Migration: Add public.set_config wrapper
-- The built-in pg_catalog.set_config() is not visible to Supabase type generation.
-- This thin wrapper exposes it in the public schema so the TypeScript types include it.

CREATE OR REPLACE FUNCTION public.set_config(
  setting TEXT,
  value TEXT,
  is_local BOOLEAN
)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT pg_catalog.set_config(setting, value, is_local);
$$;

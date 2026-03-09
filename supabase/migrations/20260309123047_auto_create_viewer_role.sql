-- Migration: Auto-create viewer role for new users
--
-- When a new user signs up via Supabase Auth, automatically insert a
-- user_roles row with role = 'viewer'. This ensures every authenticated
-- user has an explicit role entry, which is required for:
-- 1. MCP tool role checks (getMcpUserRole)
-- 2. RLS write policies (get_user_role() helper)
-- 3. Consistent behaviour across the app (no "no row = viewer" fallback)
--
-- The trigger fires AFTER INSERT on auth.users so the user row exists
-- before we reference it. Uses SECURITY DEFINER to bypass RLS on
-- user_roles (only admins can normally INSERT).

CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'viewer')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Create the trigger on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();

-- Backfill: create viewer roles for any existing users who don't have one
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'viewer'
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.user_roles)
ON CONFLICT (user_id) DO NOTHING;

-- Migration: Drop the old 2-parameter overload of get_grouped_activity_feed
--
-- The cursor-based version (migration 20260308171658) added a 3-parameter
-- overload instead of replacing the original. PostgREST cannot resolve
-- ambiguous function overloads, causing 500 errors on /api/activity.
--
-- This drops the old (p_limit, p_is_admin) overload, leaving only the
-- (p_limit, p_is_admin, p_before) version which handles both cases
-- via DEFAULT NULL on p_before.

DROP FUNCTION IF EXISTS public.get_grouped_activity_feed(integer, boolean);

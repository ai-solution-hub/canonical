-- Migration: Add get_freshness_breakdown RPC
-- Returns a count of content items grouped by freshness status.
-- Used by the dashboard to display freshness summary.

CREATE OR REPLACE FUNCTION public.get_freshness_breakdown()
RETURNS TABLE(freshness TEXT, count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT freshness::text, COUNT(*) FROM content_items WHERE freshness IS NOT NULL GROUP BY freshness;
$$;

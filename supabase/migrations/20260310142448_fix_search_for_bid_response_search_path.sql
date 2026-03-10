-- Fix search_for_bid_response: add 'extensions' to search_path so the
-- pgvector <=> operator resolves inside the function body.
-- Without this, the function fails with:
--   "operator does not exist: extensions.vector <=> extensions.vector"
-- See CLAUDE.md gotcha: "pgvector search_path in Supabase functions"

ALTER FUNCTION search_for_bid_response(extensions.vector, text, integer)
  SET search_path = public, extensions;

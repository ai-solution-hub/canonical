-- Fix hybrid_search function: set search_path to include extensions schema
-- so the pgvector <=> operator resolves correctly.
-- Without this, the operator lookup fails with:
--   "operator does not exist: extensions.vector <=> extensions.vector"
ALTER FUNCTION hybrid_search(extensions.vector, text, double precision, integer)
SET search_path = public, extensions;

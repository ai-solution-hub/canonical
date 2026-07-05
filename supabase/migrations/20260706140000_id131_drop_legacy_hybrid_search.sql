-- ID-131.19 S450 GO — drop the legacy 6-param hybrid_search overload.
--
-- 20260702120000_id131_search_rpcs ({131.11}) re-created public.hybrid_search
-- with the application_type ranking-profile parameter (7-param, owner-ratified
-- §9 design) but did not drop the pre-existing 6-param overload. Harmless while
-- the api surface carried only the old 6-param wrapper (id130 regen), but the
-- S450 M-API whole-surface regen (20260706130000) faithfully mirrored BOTH
-- public overloads into api — and PostgREST answers named-param rpc() calls
-- that match two candidates with PGRST203 (ambiguous), breaking every
-- hybrid_search caller (live: lib/mcp/tools/search.ts). The 7-param overload
-- fully supersedes the 6-param one (application_type DEFAULTs to 'procurement').
--
-- The follow-up whole-surface regen (20260706150000) re-emits the api surface
-- with only the surviving overload; this migration pre-drops both schemas'
-- 6-param variants by exact signature.
DROP FUNCTION IF EXISTS api.hybrid_search(query_embedding extensions.vector, query_text text, similarity_threshold numeric, limit_count integer, include_superseded boolean, visibility_filter character varying);
DROP FUNCTION IF EXISTS public.hybrid_search(query_embedding extensions.vector, query_text text, similarity_threshold numeric, limit_count integer, include_superseded boolean, visibility_filter character varying);

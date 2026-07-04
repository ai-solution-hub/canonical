-- ID-131.15 (G-DEDUP): retire the legacy content_items dedup family.
--
-- WHY: owner ratified opt-i (S446) — drop the legacy near-duplicate /
-- exact-duplicate detection RPCs that operated on content_items. The
-- replacement is the id-120 q_a_pairs dedup-proposals model
-- (scripts/**/qa_dedup_proposer.py + app/admin/q-a-pairs/dedup-proposals/*),
-- which is NOT touched by this migration. MCP find_duplicates' scope:'item'
-- branch (findSimilarItemsImpl, record_embeddings-backed) also survives — it
-- does not call any of these five functions.
--
-- WHAT: DROP the five public.* functions that made up the legacy dedup family:
--   - find_duplicate_pairs: whole-KB near-duplicate pair scan (admin
--     content-dedup near-duplicates queue).
--   - find_exact_duplicates: content_hash exact-match lookup (on-ingest
--     pre-check in lib/dedup/content-dedup.ts and its callers).
--   - find_similar_content (two numeric-type overloads: double precision and
--     numeric similarity_threshold): topic-inference's
--     findSimilarUngroupedItem + admin content-dedup single-item detail view.
--   - resolve_near_dup_confirm_unique: admin near-duplicates "confirm unique"
--     action, flips content_items.dedup_status.
--
-- COORDINATION (do NOT apply standalone): this migration must NOT be applied
-- until it rides alongside {131.19}'s SURFACE_RPCS removal in
-- scripts/generate-api-views.ts. The api.* INVOKER wrappers for these five
-- functions (defined in 20260625160000_id130_api_views_regen.sql /
-- 20260623140000_id115_api_views_and_rpcs.sql) are NOT dropped here — dropping
-- the public.* bodies while the api.* wrappers still reference them via
-- `SELECT * FROM public.find_...(...)` would leave dangling wrappers that
-- error at call time instead of at generation time, and a standalone apply
-- would desync the generator's introspection (it expects SURFACE_RPCS and the
-- live catalog to agree). {131.19} removes the five entries from
-- SURFACE_RPCS, regenerates the api views/wrappers (dropping the api.*
-- wrappers too), and applies this migration in the same GO.
--
-- All five call-sites (admin content-dedup surface, on-ingest pre-checks,
-- MCP whole-KB dup-scan, topic-inference) were removed from the application
-- layer in this same Subtask (ID-131.15), so by the time this migration
-- applies at {131.19}'s GO, nothing in the app references these functions.

DROP FUNCTION IF EXISTS public.find_duplicate_pairs(numeric, text, integer);
DROP FUNCTION IF EXISTS public.find_exact_duplicates(text, uuid);
DROP FUNCTION IF EXISTS public.find_similar_content(extensions.vector, double precision, integer);
DROP FUNCTION IF EXISTS public.find_similar_content(extensions.vector, numeric, integer);
DROP FUNCTION IF EXISTS public.resolve_near_dup_confirm_unique(uuid, uuid, uuid, text, text, numeric, numeric);

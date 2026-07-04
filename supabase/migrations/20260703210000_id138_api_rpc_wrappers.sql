-- ID-138 {138.7}/{138.9} companion — api schema RPC wrappers for the id138
-- function set.
--
-- Root cause: config.toml `schemas = ["api"]` means PostgREST resolves every
-- supabase-js `.rpc('<fn>')` call to `api.<fn>`, never `public.<fn>` directly
-- (same class of gap as the source_documents view drift fixed by the sibling
-- 20260703200000 companion). The five id138 migrations
-- (20260703160050-20260703160400) created their functions in `public` only,
-- so `api.corpus_writer_fence_try_acquire` / `api.citations_cascade_preflight`
-- etc. do not exist — confirmed missing live on staging (PGRST202) and
-- breaking the id138 integration suite + the shipped TS caller
-- lib/corpus/writer-fence.ts (withFence).
--
-- Scope: ONLY the id138 functions with a real `.rpc()` caller (TS production
-- code or the id138 integration tests). The two underscore-prefixed private
-- helpers (`_source_document_cascade_erase`, `_corpus_writer_fence_key`) are
-- REVOKE ALL FROM PUBLIC with no role grants in their origin migrations —
-- they are only ever reached via a nested call from within another
-- SECURITY DEFINER function owned by postgres, never directly over
-- PostgREST, so they get NO api wrapper (wrapping them would need its own
-- EXECUTE grant, which would create a second, ungated way to invoke a
-- privileged cascade primitive that is deliberately not independently
-- callable).
--
-- Convention: same shape scripts/generate-api-views.ts's emitFunction()
-- produces for a "SECURITY DEFINER public fn" (see e.g. api.reference_ingest
-- / api.q_a_search in 20260625160000_id130_api_views_regen.sql) — thin
-- LANGUAGE sql SECURITY INVOKER wrapper, search_path pinned, named-argument
-- passthrough (`name => name`) so the inner call binds by name exactly as
-- PostgREST itself binds RPC args from the JSON body, REVOKE EXECUTE FROM
-- PUBLIC then GRANT to the SAME roles the public original grants (all six
-- fns here: authenticated + service_role only — anon is REVOKEd on every
-- public original and gets nothing here either). Hand-authored (not run
-- through the generator, which regenerates a fixed local-catalog-sourced
-- file) because the underlying public functions are authored-not-yet-applied
-- migrations — same class of standalone companion patch as
-- 20260703180000/20260703190000/20260703200000.
--
-- corpus_writer_fence_try_acquire / corpus_writer_fence_release caveat: a
-- LANGUAGE sql wrapper executes its body inline in the CALLING backend
-- session (no new session, no dblink/FDW hop), so `pg_try_advisory_lock` /
-- `pg_advisory_unlock` inside the wrapped public fn still acquire/release on
-- exactly the same session as calling `public.corpus_writer_fence_*` directly
-- — the wrapper changes NOTHING about the advisory-lock session-affinity
-- semantics or the documented PostgREST session-affinity limitation
-- (20260703160400_id138_writer_fence.sql header, lib/corpus/writer-fence.ts).
--
-- Authored, NOT applied: apply is an owner-gated coordinated GO alongside the
-- id138 serial this completes. No db push, no types regen in this Subtask.
--
-- UK English throughout (DD/MM/YYYY). Authored 03/07/2026.

SET search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- api.resolve_or_mint_source_identity  [INVOKER wrapper over SECURITY DEFINER
-- public fn] — {138.6} M2, called by the TS upload leg (supabase-js .rpc(),
-- {138.13}) and the id138-admission-identity integration test.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.resolve_or_mint_source_identity(p_content_hash text, p_rel_path text, p_filename text, p_mime_type text, p_file_size integer, p_origin_type text, p_retention_class text, p_op_id uuid);
CREATE FUNCTION api.resolve_or_mint_source_identity(p_content_hash text, p_rel_path text, p_filename text, p_mime_type text, p_file_size integer, p_origin_type text DEFAULT NULL::text, p_retention_class text DEFAULT NULL::text, p_op_id uuid DEFAULT NULL::uuid)
  RETURNS TABLE(source_document_id uuid, was_minted boolean)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.resolve_or_mint_source_identity(p_content_hash => p_content_hash, p_rel_path => p_rel_path, p_filename => p_filename, p_mime_type => p_mime_type, p_file_size => p_file_size, p_origin_type => p_origin_type, p_retention_class => p_retention_class, p_op_id => p_op_id);
$api$;
REVOKE EXECUTE ON FUNCTION api.resolve_or_mint_source_identity(p_content_hash text, p_rel_path text, p_filename text, p_mime_type text, p_file_size integer, p_origin_type text, p_retention_class text, p_op_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.resolve_or_mint_source_identity(p_content_hash text, p_rel_path text, p_filename text, p_mime_type text, p_file_size integer, p_origin_type text, p_retention_class text, p_op_id uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- api.tombstone_source_document  [INVOKER wrapper over SECURITY DEFINER
-- public fn] — {138.7} M3, editor/admin-gated GDPR erasure cascade entry
-- point, called by the id138-erasure-cascade integration test.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.tombstone_source_document(p_id uuid);
CREATE FUNCTION api.tombstone_source_document(p_id uuid)
  RETURNS TABLE(source_document_id uuid, chunks_deleted integer, embeddings_deleted integer, entity_mentions_deleted integer, entity_relationships_deleted integer, extractions_deleted integer)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.tombstone_source_document(p_id => p_id);
$api$;
REVOKE EXECUTE ON FUNCTION api.tombstone_source_document(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.tombstone_source_document(p_id uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- api.reap_orphaned_source_documents  [INVOKER wrapper over SECURITY DEFINER
-- public fn] — {138.7} M4, editor/admin-gated register-tombstone reaper,
-- called by the id138-erasure-cascade integration test.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.reap_orphaned_source_documents();
CREATE FUNCTION api.reap_orphaned_source_documents()
  RETURNS TABLE(source_document_id uuid, chunks_deleted integer, embeddings_deleted integer, entity_mentions_deleted integer, entity_relationships_deleted integer, extractions_deleted integer)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.reap_orphaned_source_documents();
$api$;
REVOKE EXECUTE ON FUNCTION api.reap_orphaned_source_documents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.reap_orphaned_source_documents() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- api.citations_cascade_preflight  [INVOKER wrapper over SECURITY DEFINER
-- public fn] — {138.7} M4, editor/admin-gated read-only full_reprocess
-- guard, called by the id138-erasure-cascade integration test.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.citations_cascade_preflight();
CREATE FUNCTION api.citations_cascade_preflight()
  RETURNS TABLE(safe_to_reprocess boolean, at_risk_citation_count integer)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT * FROM public.citations_cascade_preflight();
$api$;
REVOKE EXECUTE ON FUNCTION api.citations_cascade_preflight() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.citations_cascade_preflight() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- api.corpus_writer_fence_try_acquire  [INVOKER wrapper over SECURITY DEFINER
-- public fn] — {138.9}, called by lib/corpus/writer-fence.ts (production TS
-- caller) and the id138-writer-fence integration test. See file header for
-- the advisory-lock session-affinity preservation note.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.corpus_writer_fence_try_acquire(p_holder text);
CREATE FUNCTION api.corpus_writer_fence_try_acquire(p_holder text DEFAULT NULL::text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.corpus_writer_fence_try_acquire(p_holder => p_holder);
$api$;
REVOKE EXECUTE ON FUNCTION api.corpus_writer_fence_try_acquire(p_holder text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.corpus_writer_fence_try_acquire(p_holder text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- api.corpus_writer_fence_release  [INVOKER wrapper over SECURITY DEFINER
-- public fn] — {138.9}, called by lib/corpus/writer-fence.ts (production TS
-- caller) and the id138-writer-fence integration test. See file header for
-- the advisory-lock session-affinity preservation note.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.corpus_writer_fence_release(p_holder text);
CREATE FUNCTION api.corpus_writer_fence_release(p_holder text DEFAULT NULL::text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, extensions
AS $api$
  SELECT public.corpus_writer_fence_release(p_holder => p_holder);
$api$;
REVOKE EXECUTE ON FUNCTION api.corpus_writer_fence_release(p_holder text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.corpus_writer_fence_release(p_holder text) TO authenticated, service_role;

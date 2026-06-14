-- 20260614010200_id110_reference_ingest_rpc.sql
-- ID-110 ({110.5}) — reference_ingest SECURITY DEFINER RPC.
-- Spec: specs/id-110-url-import-reference-items/TECH.md §1 (Proposed changes / migration).
--
-- Re-points the manual single-URL ingest (/api/ingest/url) onto the ID-75 reference
-- layer. This RPC is the SINGLE owner-gated write seam that atomically lands the
-- ID-75 evidence pair — one public.source_documents row (FK target) + one
-- public.reference_items row — per normalised URL. It mints both PKs server-side as
-- uuid5 so the manual path shares identity with the async feed path
-- (scripts/cocoindex_pipeline/flow.py:_ingest_url_body) and converges idempotently.
--
-- WHY an RPC (not an INSERT RLS policy or a TS writer): keeps reference_items
-- write-policy-free (ID-75 BI-16, pipeline-only-writer posture) and centralises both
-- identity-minting and the declare_row field contract in ONE place (the DB). Mirrors
-- reference_search / reference_get_verbatim being the only authenticated reference
-- surface (20260606130224_id75_reference_search_rpcs.sql).
--
-- IDENTITY PARITY (load-bearing):
--   Namespace = '_KH_PIPELINE_DOC_NS' = uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1")
--   pinned in scripts/cocoindex_pipeline/flow.py:1601. The feed path mints
--   source_document_id = uuid5(NS, 'sd:'||url) and reference_item_id = uuid5(NS, 'ri:'||url)
--   (flow.py:2710-2712). Postgres extensions.uuid_generate_v5 and Python uuid.uuid5 both
--   implement RFC-4122 v5 (SHA-1) — identical output for identical namespace+name.
--   uuid-ossp is installed (20260416102457_pre_squash_reconciliation.sql:69).
--   The route MUST pass an ALREADY-normalised URL (lib/intelligence/content-extractor.ts
--   normaliseUrl), matching the feed path's normalise_url, so the PK is stable.
--
-- extraction_method = NULL (silent-default #1):
--   source_documents.extraction_method CHECK (ID-42,
--   20260526074944_id42_pullmd_provenance.sql:24-26) admits ONLY
--   {rss_content, fetch, jina_reader, firecrawl, summary_fallback, pullmd_readability,
--    pullmd_playwright, pullmd_cloudflare, pullmd_reddit, pullmd_trafilatura, docling}
--   (IS NULL OR = ANY(...)). It admits NEITHER 'readability' NOR 'unpdf' (the app
--   extractFromUrl producers). The CHECK is therefore satisfied by writing NULL; the
--   TRUE producer is recorded in source_documents.extraction_metadata JSONB
--   (e.g. {"extractor":"readability","via":"app_sync_url_import"}) by the caller.
--   DO NOT widen the CHECK — that couples reference provenance vocabulary to the legacy
--   app extractor (TECH OQ-B, out of scope).
--
-- No schema change to reference_items / source_documents columns:
--   reference_items.ingestion_source CHECK already admits 'url_import'
--   (20260606121451_id75_reference_items_layer.sql:18-19).
--
-- GRANTS in the SAME migration as CREATE (ID-64 convention); ID-75 grant pattern:
--   OWNER postgres; REVOKE EXECUTE FROM PUBLIC + anon; GRANT EXECUTE TO
--   authenticated, service_role; full 14-arg signature spelled in each REVOKE/GRANT.
--
-- Apply log:
--   * 2026-06-14 — applied to staging (turayklvaunphgbgscat) via supabase db push.
--     PROD push is a GATED operator step (NOT applied here).

-- Session-level search_path so the unqualified vector type resolves at DDL time
-- (S318 fix — same pattern as the ID-75 reference-search migration, {75.6}).
SET search_path = public, extensions;

-- =============================================================================
-- FUNCTION public.reference_ingest
-- =============================================================================
--
-- Atomically lands the source_documents + reference_items evidence pair for one
-- normalised URL. Pre-SELECTs the deterministic ri PK; if it exists, returns the
-- existing row with already_existed = true and writes nothing.

CREATE OR REPLACE FUNCTION public.reference_ingest(
  p_source_url          text,           -- caller passes the ALREADY-normalised URL
  p_title               text,
  p_body                text,           -- extractFromUrl output (reference_items.body NOT NULL)
  p_summary             text,           -- nullable
  p_primary_domain      text,           -- nullable (classifier output)
  p_primary_subtopic    text,           -- nullable (classifier output)
  p_embedding           vector(1024),   -- nullable; caller passes JSON.stringify(array)
  p_published_at        timestamptz,    -- nullable; original publication time, never ingest time
  p_filename            text,           -- last path segment ELSE host (caller guards non-empty)
  p_mime_type           text,
  p_file_size           integer,
  p_content_hash        text,
  p_extraction_metadata jsonb DEFAULT '{}'::jsonb,  -- {"extractor":"readability","via":...} (OQ-B)
  p_op_id               uuid  DEFAULT NULL
)
RETURNS TABLE (
  reference_id       uuid,
  source_document_id uuid,
  title              text,
  summary            text,
  source_url         text,
  primary_domain     text,
  primary_subtopic   text,
  already_existed    boolean
)
LANGUAGE plpgsql
VOLATILE                                -- writes (contrast the STABLE search RPCs)
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  -- Server-side uuid5 PKs. Namespace pinned to the Python pipeline constant
  -- _KH_PIPELINE_DOC_NS (flow.py:1601) for cross-path identity parity (flow.py:2710-2712).
  v_sd_id    uuid := extensions.uuid_generate_v5(
    'fbfaf1ff-1ee4-583c-9757-1674465b2ec1'::uuid, 'sd:' || p_source_url);
  v_ri_id    uuid := extensions.uuid_generate_v5(
    'fbfaf1ff-1ee4-583c-9757-1674465b2ec1'::uuid, 'ri:' || p_source_url);
  v_existing uuid;
BEGIN
  -- Idempotency (PRODUCT §2.1/§2.2): if the reference already exists, return it with
  -- already_existed = true and write NOTHING. Deterministic PK + UNIQUE(source_url)
  -- make a repeat ingest of the same URL a no-op converge.
  SELECT ri.id INTO v_existing FROM public.reference_items ri WHERE ri.id = v_ri_id;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY
      SELECT ri.id, ri.source_document_id, ri.title, ri.summary, ri.source_url,
             ri.primary_domain, ri.primary_subtopic, true
      FROM public.reference_items ri
      WHERE ri.id = v_ri_id;
    RETURN;
  END IF;

  -- Atomicity (PRODUCT §4.6): the PL/pgSQL body runs in the caller's transaction; an
  -- exception on either INSERT rolls back both — no orphaned provenance row. sd FIRST
  -- (FK target: reference_items.source_document_id NOT NULL REFERENCES ... ON DELETE
  -- RESTRICT), then ri.
  INSERT INTO public.source_documents (
    id, filename, original_filename, mime_type, file_size, content_hash,
    storage_path, source_url, status, extraction_method, extraction_metadata, op_id)
  VALUES (
    v_sd_id, p_filename, p_filename, p_mime_type, p_file_size, p_content_hash,
    p_source_url,            -- storage_path = source_url for URL-sourced provenance (feed-path parity)
    p_source_url,
    'processed',             -- body extracted synchronously; no async processing follows (CHECK admits)
    NULL,                    -- extraction_method NULL (ID-42 CHECK rejects readability/unpdf — OQ-B)
    p_extraction_metadata,   -- true producer recorded here, not the CHECKed column
    p_op_id)
  ON CONFLICT (id) DO NOTHING;  -- belt-and-braces idempotency vs a concurrent identical-URL race

  INSERT INTO public.reference_items (
    id, title, body, summary, source_url, published_at, primary_domain,
    primary_subtopic, layer, embedding, source_document_id, ingestion_source, op_id)
  VALUES (
    v_ri_id, p_title, p_body, p_summary, p_source_url, p_published_at, p_primary_domain,
    p_primary_subtopic,
    'research',              -- v1 layer constant (validated by trg_validate_reference_items_layer)
    p_embedding, v_sd_id,
    'url_import',            -- CHECK already admits this value (ID-75 schema)
    p_op_id)
  ON CONFLICT (id) DO NOTHING;  -- belt-and-braces idempotency vs the same concurrent race

  RETURN QUERY
    SELECT ri.id, ri.source_document_id, ri.title, ri.summary, ri.source_url,
           ri.primary_domain, ri.primary_subtopic, false
    FROM public.reference_items ri
    WHERE ri.id = v_ri_id;
END;
$$;

-- Ownership
ALTER FUNCTION public.reference_ingest(
  text, text, text, text, text, text, vector, timestamptz, text, text, integer, text,
  jsonb, uuid) OWNER TO postgres;

-- RLS-PATTERN P-4: explicit REVOKE from anon + PUBLIC (same pattern and rationale as
-- the ID-75 reference RPCs). pg_default_acl auto-grants EXECUTE to anon on every new
-- public.* function; REVOKE FROM PUBLIC alone is a no-op against anon, so an explicit
-- REVOKE FROM anon is required. Full 14-arg signature spelled in each statement.
REVOKE EXECUTE ON FUNCTION public.reference_ingest(
  text, text, text, text, text, text, vector, timestamptz, text, text, integer, text,
  jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reference_ingest(
  text, text, text, text, text, text, vector, timestamptz, text, text, integer, text,
  jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reference_ingest(
  text, text, text, text, text, text, vector, timestamptz, text, text, integer, text,
  jsonb, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.reference_ingest(
  text, text, text, text, text, text, vector, timestamptz, text, text, integer, text,
  jsonb, uuid) IS
  'ID-110 {110.5} — TECH.md §1. Owner-gated single write seam for the manual single-URL '
  'reference ingest. Atomically lands the source_documents + reference_items evidence '
  'pair for one normalised URL, minting both PKs server-side as uuid5 (namespace '
  'fbfaf1ff-1ee4-583c-9757-1674465b2ec1, parity with the Python feed path flow.py:1601). '
  'extraction_method written NULL (ID-42 CHECK rejects readability/unpdf); true producer '
  'in extraction_metadata. Idempotent: a repeat URL returns already_existed=true and '
  'writes nothing. Keeps reference_items write-policy-free (ID-75 BI-16).';

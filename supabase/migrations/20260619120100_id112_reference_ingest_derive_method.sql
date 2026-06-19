-- ID-112.9 — reference_ingest derives extraction_method server-side (PI-7, PI-11)
--
-- Option-2 server-side derivation (ID-112): the manual single-URL ingest seam
-- now records the true extractor label in the typed source_documents.extraction_method
-- column instead of writing NULL. The label is derived from the JSONB the route
-- already passes (p_extraction_metadata->>'extractor'); ID-112.8 extended the
-- source_documents.extraction_method CHECK to admit the in-house extractor labels
-- (trafilatura / playwright / unpdf), so the derived value now satisfies the
-- constraint that previously forced NULL (ID-42 OQ-B).
--
-- CREATE OR REPLACE over the byte-identical 14-param signature from the
-- 20260617130000_squash_baseline.sql definition. The function identity is
-- unchanged: existing GRANTs and owner persist, so no GRANT / ALTER FUNCTION OWNER
-- / DROP is needed. The ONLY changes versus the baseline are (1) the single body
-- literal NULL -> COALESCE(p_extraction_metadata->>'extractor', NULL) and (2) the
-- COMMENT ON FUNCTION wording. Everything else (storage_path = source_url, sd
-- INSERT before ri INSERT, uuid5 PK derivation, ON CONFLICT (id) DO NOTHING,
-- SET search_path, SECURITY DEFINER, the reference_items INSERT, the RETURN) is
-- reproduced verbatim.

CREATE OR REPLACE FUNCTION "public"."reference_ingest"("p_source_url" "text", "p_title" "text", "p_body" "text", "p_summary" "text", "p_primary_domain" "text", "p_primary_subtopic" "text", "p_embedding" "extensions"."vector", "p_published_at" timestamp with time zone, "p_filename" "text", "p_mime_type" "text", "p_file_size" integer, "p_content_hash" "text", "p_extraction_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_op_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("reference_id" "uuid", "source_document_id" "uuid", "title" "text", "summary" "text", "source_url" "text", "primary_domain" "text", "primary_subtopic" "text", "already_existed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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
    COALESCE(p_extraction_metadata->>'extractor', NULL),  -- extraction_method derived server-side from the JSONB the route passes (ID-112.9, Option 2)
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


COMMENT ON FUNCTION "public"."reference_ingest"("p_source_url" "text", "p_title" "text", "p_body" "text", "p_summary" "text", "p_primary_domain" "text", "p_primary_subtopic" "text", "p_embedding" "extensions"."vector", "p_published_at" timestamp with time zone, "p_filename" "text", "p_mime_type" "text", "p_file_size" integer, "p_content_hash" "text", "p_extraction_metadata" "jsonb", "p_op_id" "uuid") IS 'ID-110 {110.5} — TECH.md §1; extraction_method derivation ID-112 {112.9}. Owner-gated single write seam for the manual single-URL reference ingest. Atomically lands the source_documents + reference_items evidence pair for one normalised URL, minting both PKs server-side as uuid5 (namespace fbfaf1ff-1ee4-583c-9757-1674465b2ec1, parity with the Python feed path flow.py:1601). extraction_method is DERIVED server-side from p_extraction_metadata->>''extractor'' (ID-112 Option-2 server-side derivation; ID-112.8 extended the CHECK to admit trafilatura/playwright/unpdf), with the full metadata also retained in extraction_metadata. Idempotent: a repeat URL returns already_existed=true and writes nothing. Keeps reference_items write-policy-free (ID-75 BI-16).';

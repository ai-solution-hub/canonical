-- ID-139.10 — reference_ingest RPC writes M6-dropped reference_items.embedding.
--
-- PROVENANCE: S452 ci-red-triage-3 (run 28910405645), integration
-- id138-admission-identity:240 — SQLSTATE 42703 "column embedding of relation
-- reference_items does not exist" on EVERY call to public.reference_ingest, on
-- BOTH staging and prod. ROOT CAUSE: 20260706120000_id131_drop_inline_vector_
-- cols.sql DROPped reference_items.embedding (its safety audit covered READS
-- only — hybrid_search's reference_item arm already reads record_embeddings —
-- but MISSED that reference_ingest's own INSERT still writes the column
-- directly). 5th retirement-gate-escape instance of the same write-path-audit
-- gap (ID-140 evidence).
--
-- CALLER INVESTIGATION (this Subtask): grepped the full TS + Python corpus for
-- `reference_ingest` / `p_embedding`. TWO live callers pass a real,
-- caller-generated embedding — app/api/ingest/url/route.ts:285 and
-- lib/mcp/tools/content.ts:685 (both call generateEmbedding() and pass
-- JSON.stringify()'d vector as p_embedding; both tolerate embedding-generation
-- failure by passing NULL, never by omitting the param). The MCP caller's own
-- comment (content.ts:608) states a HARD INVARIANT: "the reference_ingest RPC
-- signature MUST NOT be altered — call it as-is." Per DR-036 (record_embeddings
-- is the single home for embeddings — no inline-vector columns), the fix is
-- therefore NOT "drop p_embedding" (that would violate the hard invariant and
-- silently stop persisting embeddings for both callers) but "keep the param,
-- redirect the write" — mirroring the EXACT precedent
-- 20260706170000_id131_qa_fns_record_embeddings_repoint.sql set for the
-- q_a_pairs.question_embedding drop (re-point onto record_embeddings, zero
-- signature change).
--
-- FIX: CREATE OR REPLACE public.reference_ingest with the IDENTICAL 14-param
-- signature and IDENTICAL RETURNS TABLE shape as the current
-- (20260619130100_id112_reference_ingest_derive_method.sql) definition. The
-- reference_items INSERT drops the `embedding` column from its column/VALUES
-- list. A NEW step inserts p_embedding into public.record_embeddings
-- (owner_kind='reference_item', owner_id=v_ri_id — the SAME uuid5 PK the
-- reference_items row is keyed on, so a re-ingest UPSERTs the same
-- record_embeddings row via its (owner_kind, owner_id, model) UNIQUE), guarded
-- on `p_embedding IS NOT NULL` (both live callers already tolerate a NULL
-- embedding; a NULL-vector record_embeddings row would be useless dead weight
-- — mirrors the "column is nullable; a backfill can re-derive it" comment at
-- both TS call sites). `owner_kind='reference_item'` is ALREADY a valid value
-- on record_embeddings_owner_kind_chk (20260628190001_id131_record_embeddings_
-- store.sql) — no CHECK-constraint widening needed (contrast
-- 20260703140000_id131_company_embedding_migrate.sql /
-- 20260707200000_id130_form_requirement_embedding_migrate.sql, which both
-- needed one). The idempotency early-return (already_existed=true) path is
-- UNCHANGED — a repeat URL still writes nothing, including no
-- record_embeddings row.
--
-- API WRAPPER: api.reference_ingest (20260706150000_id131_api_views_regen2.sql,
-- EXTRA_DEFINER_RPCS in scripts/generate-api-views.ts) is a thin
-- `SELECT * FROM public.reference_ingest(named args...)` LANGUAGE sql INVOKER
-- body. Since the wrapped signature and return shape are byte-identical, the
-- wrapper resolves to the SAME overload post-replace and needs NO regen —
-- same "CREATE OR REPLACE only, no signature change -> no wrapper regen"
-- reasoning 20260706170000 used for the q_a fns. No types regen needed either
-- (Database['public']['Functions']['reference_ingest']['Args']/'Returns' is
-- driven by signature + return shape, both unchanged).
--
-- GRANTS/OWNER: deliberately NOT restated, mirroring
-- 20260619130100_id112_reference_ingest_derive_method.sql's own precedent
-- ("Function identity unchanged: existing GRANTs and owner persist, so no
-- GRANT / ALTER FUNCTION OWNER / DROP is needed") — CREATE OR REPLACE over an
-- EXISTING function preserves its proacl (only a genuinely NEW function
-- inherits schema default privileges). Checked the DR-035 {61.14} born-locked
-- interaction: the `dr035_born_locked_functions` event trigger DOES fire on
-- this CREATE OR REPLACE (its WHEN TAG 'CREATE FUNCTION' covers REPLACE too)
-- and re-issues `REVOKE EXECUTE ... FROM PUBLIC, anon` — but
-- 20260707190000_id61_dr035_revoke_sweep.sql already swept this exact
-- function's PUBLIC/anon grant off on staging+prod, so the trigger's re-fire
-- is an idempotent no-op here, not a new restriction; authenticated/
-- service_role's pre-existing grants are untouched by both the sweep and the
-- trigger (neither statement names those roles).
--
-- APPLY: staging (rbwqewalexrzgxtvcqrh) apply explicitly granted this
-- Subtask (S452 owner steer — reference_items/record_embeddings data is
-- transient). Prod apply is NOT part of this Subtask — it lands via the
-- parent batch (prod is ALSO broken today by the same drop, so the batch is
-- urgent, but out of this Subtask's remit).
--
-- OUT-OF-SCOPE FINDING (routed to the Curator, not fixed here): the Python
-- cocoindex feed pipeline's REFERENCE_ITEMS_SCHEMA
-- (scripts/cocoindex_pipeline/flow.py:1297-1327) still declares an `embedding`
-- column via `ri_target.declare_row(... "embedding": embedding ...)`
-- (flow.py:3914, ingest_url path) — the SAME dropped column, a DIFFERENT
-- write path (the async feed pipeline, not this RPC). flow.py:3926's own
-- comment ("stays until a sibling slice drops the column") shows this was a
-- KNOWN planned follow-up, not an oversight, but the column is ALREADY
-- dropped on staging+prod today, so this is presumably ALSO live-broken. Out
-- of this Subtask's `details` scope (SQL RPC only) — flagged for the
-- Orchestrator to route to the Curator as a probable 6th write-path instance.
--
-- UK English throughout (DD/MM/YYYY). Authored 08/07/2026.

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
  -- ID-139.10 DR-036: record_embeddings.model literal — mirrors the plpgsql
  -- idiom 20260706170000_id131_qa_fns_record_embeddings_repoint.sql uses
  -- (q_a_search / question_match_recompute's `embedding_model CONSTANT text`).
  v_embedding_model CONSTANT text := 'text-embedding-3-large';
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

  -- ID-139.10 (DR-036): `embedding` REMOVED from this INSERT — the column was
  -- dropped from reference_items by 20260706120000_id131_drop_inline_vector_
  -- cols.sql. The vector now lands in record_embeddings below instead.
  INSERT INTO public.reference_items (
    id, title, body, summary, source_url, published_at, primary_domain,
    primary_subtopic, layer, source_document_id, ingestion_source, op_id)
  VALUES (
    v_ri_id, p_title, p_body, p_summary, p_source_url, p_published_at, p_primary_domain,
    p_primary_subtopic,
    'research',              -- v1 layer constant (validated by trg_validate_reference_items_layer)
    v_sd_id,
    'url_import',            -- CHECK already admits this value (ID-75 schema)
    p_op_id)
  ON CONFLICT (id) DO NOTHING;  -- belt-and-braces idempotency vs the same concurrent race

  -- ID-139.10 (DR-036): the vector no longer lives inline on reference_items —
  -- write it to the polymorphic record_embeddings store instead, keyed on the
  -- SAME deterministic PK (v_ri_id) the reference_items row above uses, so a
  -- re-ingest UPSERTs the same record_embeddings row via the
  -- (owner_kind, owner_id, model) UNIQUE. Guarded on IS NOT NULL: both live
  -- callers (app/api/ingest/url/route.ts, lib/mcp/tools/content.ts) already
  -- tolerate embedding-generation failure by passing NULL — a NULL-vector
  -- record_embeddings row would be useless dead weight, never written.
  IF p_embedding IS NOT NULL THEN
    INSERT INTO public.record_embeddings (owner_kind, owner_id, model, embedding)
    VALUES ('reference_item', v_ri_id, v_embedding_model, p_embedding)
    ON CONFLICT (owner_kind, owner_id, model) DO UPDATE
      SET embedding = EXCLUDED.embedding,
          updated_at = now();
  END IF;

  RETURN QUERY
    SELECT ri.id, ri.source_document_id, ri.title, ri.summary, ri.source_url,
           ri.primary_domain, ri.primary_subtopic, false
    FROM public.reference_items ri
    WHERE ri.id = v_ri_id;
END;
$$;


COMMENT ON FUNCTION "public"."reference_ingest"("p_source_url" "text", "p_title" "text", "p_body" "text", "p_summary" "text", "p_primary_domain" "text", "p_primary_subtopic" "text", "p_embedding" "extensions"."vector", "p_published_at" timestamp with time zone, "p_filename" "text", "p_mime_type" "text", "p_file_size" integer, "p_content_hash" "text", "p_extraction_metadata" "jsonb", "p_op_id" "uuid") IS 'ID-110 {110.5} — TECH.md §1; extraction_method derivation ID-112 {112.9}; ID-139.10 record_embeddings repoint (DR-036). Owner-gated single write seam for the manual single-URL reference ingest. Atomically lands the source_documents + reference_items evidence pair for one normalised URL, minting both PKs server-side as uuid5 (namespace fbfaf1ff-1ee4-583c-9757-1674465b2ec1, parity with the Python feed path flow.py:1601). extraction_method is DERIVED server-side from p_extraction_metadata->>''extractor'' (ID-112 Option-2 server-side derivation; ID-112.8 extended the CHECK to admit trafilatura/playwright/unpdf), with the full metadata also retained in extraction_metadata. p_embedding (when supplied) is written to public.record_embeddings (owner_kind=''reference_item'', owner_id=the minted reference_items.id, model=''text-embedding-3-large'') rather than inline on reference_items — the inline column was dropped by 20260706120000; DR-036 is the single home for embeddings. Idempotent: a repeat URL returns already_existed=true and writes nothing (including no record_embeddings row). Keeps reference_items write-policy-free (ID-75 BI-16).';

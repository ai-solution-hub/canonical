-- ID-138 {138.6} M2 — resolve_or_mint_source_identity (admission-minted identity)
-- TECH.md §3.1 M2; §2.2 R(id) (admission-minted identity, rename-tolerant, DR-024
-- clause i STANDS); §2.1 R(a) (SEED-CONTRACT interplay).
--
-- Stops the walk from deriving identity from the live rel_path. Content_hash-FIRST
-- resolution: same bytes at a NEW path return the STORED id + UPDATE the mutable
-- logical_path attribute ({138.5} column) — identity is NEVER re-derived from path.
-- A genuinely new content_hash mints id = uuid5(NS, "sd:"+rel_path) ONCE
-- (deterministic ⇒ idempotent) and stores it; post-mint the id is authoritative.
--
-- SEED-CONTRACT match (byte-for-byte with the Python pipeline, flow.py:1957/2116/
-- 2568 `uuid.uuid5(_KH_PIPELINE_DOC_NS, f"sd:{rel_path}")`, namespace
-- fbfaf1ff-1ee4-583c-9757-1674465b2ec1): this is the SAME namespace + formula
-- already used by the existing SQL-side precedent `public.reference_ingest`
-- (20260619130100_id112_reference_ingest_derive_method.sql:28-29,
-- 20260617130000_squash_baseline.sql:4564-4565) via
-- `extensions.uuid_generate_v5(namespace, 'sd:' || rel_path)`. `uuid_generate_v5`
-- (uuid-ossp, RFC 4122 v5/SHA-1) is byte-identical to Python's `uuid.uuid5` given
-- the same namespace UUID + name string, so admission and the walk mint the SAME
-- id for the same rel_path — a divergence here would silently orphan every
-- citation at first bundle publication (id-132 BI-20/21, TECH §6 CRITICAL risk).
--
-- Authored, NOT applied: apply is an owner-gated coordinated GO (migration #2 of
-- the id138 serial — {138.5} -> {138.6} -> {138.7} -> {138.9}). No db push, no
-- types regen in this Subtask.
--
-- UK English throughout (DD/MM/YYYY). Authored 03/07/2026.

CREATE OR REPLACE FUNCTION "public"."resolve_or_mint_source_identity"(
    "p_content_hash" "text",
    "p_rel_path" "text",
    "p_filename" "text",
    "p_mime_type" "text",
    "p_file_size" integer,
    "p_origin_type" "text" DEFAULT NULL::"text",
    "p_retention_class" "text" DEFAULT NULL::"text",
    "p_op_id" "uuid" DEFAULT NULL::"uuid"
) RETURNS TABLE("source_document_id" "uuid", "was_minted" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  -- SEED-CONTRACT namespace, pinned identical to flow.py's _KH_PIPELINE_DOC_NS
  -- and the reference_ingest precedent (see header comment).
  v_existing_id uuid;
  v_minted_id   uuid;
BEGIN
  -- content_hash-FIRST resolution (R(id)): same bytes at a new path never
  -- re-mint. Earliest-admitted row wins if content_hash somehow duplicates
  -- (pre-existing possibility; content_hash is indexed but not UNIQUE).
  SELECT sd.id INTO v_existing_id
  FROM public.source_documents sd
  WHERE sd.content_hash = p_content_hash
  ORDER BY sd.created_at ASC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Rename-tolerant: update the MUTABLE logical_path only. storage_path (the
    -- frozen SEED-CONTRACT key, §2.1 R(a)) and id are NEVER re-derived post-mint.
    UPDATE public.source_documents
       SET logical_path = p_rel_path
     WHERE id = v_existing_id
       AND logical_path IS DISTINCT FROM p_rel_path;

    RETURN QUERY SELECT v_existing_id, false;
    RETURN;
  END IF;

  -- Genuinely new content_hash: mint ONCE on the SEED-CONTRACT formula.
  v_minted_id := extensions.uuid_generate_v5(
    'fbfaf1ff-1ee4-583c-9757-1674465b2ec1'::uuid, 'sd:' || p_rel_path);

  INSERT INTO public.source_documents (
    id, filename, original_filename, mime_type, file_size, content_hash,
    storage_path, logical_path, origin_type, retention_class, op_id)
  VALUES (
    v_minted_id, p_filename, p_filename, p_mime_type, p_file_size, p_content_hash,
    p_rel_path,  -- storage_path = the admission-time rel_path, frozen thereafter
    p_rel_path,  -- logical_path := storage_path at mint time (PLAN §2)
    p_origin_type, p_retention_class, p_op_id)
  ON CONFLICT (id) DO NOTHING;  -- belt-and-braces vs a concurrent identical-mint race

  RETURN QUERY SELECT v_minted_id, true;
END;
$$;

ALTER FUNCTION "public"."resolve_or_mint_source_identity"("text", "text", "text", "text", integer, "text", "text", "uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."resolve_or_mint_source_identity"("text", "text", "text", "text", integer, "text", "text", "uuid") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."resolve_or_mint_source_identity"("text", "text", "text", "text", integer, "text", "text", "uuid") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."resolve_or_mint_source_identity"("text", "text", "text", "text", integer, "text", "text", "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."resolve_or_mint_source_identity"("text", "text", "text", "text", integer, "text", "text", "uuid") TO "service_role";

COMMENT ON FUNCTION "public"."resolve_or_mint_source_identity"("text", "text", "text", "text", integer, "text", "text", "uuid") IS 'ID-138 {138.6} M2 — TECH.md §2.2 R(id), §2.1 R(a) SEED-CONTRACT. Content_hash-first identity resolution called by BOTH the Python walk (raw asyncpg pool, {138.10}) and the TS upload leg (supabase-js .rpc(), {138.13}). Same bytes at a new rel_path resolve to the STORED id + update the mutable logical_path only; a genuinely new content_hash mints id = uuid5(fbfaf1ff-1ee4-583c-9757-1674465b2ec1, "sd:"+rel_path) ONCE, byte-identical to flow.py''s uuid.uuid5(_KH_PIPELINE_DOC_NS, f"sd:{rel_path}") and the reference_ingest SQL precedent. was_minted distinguishes a fresh admission from a rename-resolve for callers that need to skip re-extraction. Idempotent: repeat calls with the same content_hash converge on the same id.';

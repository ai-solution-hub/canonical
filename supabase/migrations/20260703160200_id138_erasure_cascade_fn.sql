-- ID-138 {138.7} M3 — tombstone_source_document (GDPR erasure cascade)
-- TECH.md §3.1 M3; §2.6 R(ops) (erasure/reaper/fencing); §2.5 R(e) per-record-class
-- contract (LOAD-BEARING — governs which derived rows this cascade targets).
-- Ratification amendment (S443, OQ-138-C): coherent with the historic handover
-- guide `handover-guides/gdpr-data-export.md` — see the header note below.
--
-- Sets admission_status='tombstoned', cascades to the derived STAGING rows
-- (chunks/embeddings/entities/extractions) via a shared private helper, discards
-- the bucket bytes (O — {138.4}/ops leg, not this migration's SQL surface), but
-- the REGISTER ROW SURVIVES (DR-025) — citations degrade to it, never orphan.
-- q_a_pairs (promoted/curated, DR-026) are deliberately OUT of this cascade — the
-- promotion boundary means walks/erasure never mutate promoted records (§2.4 R(d));
-- a citation pointing at cited_source_document_id keeps resolving because the sd
-- row is never DELETEd, only its admission_status flips.
--
-- GDPR-DATA-EXPORT COHERENCE (S443 OQ-138-C amendment): this mechanism is
-- deliberately coherent with `handover-guides/gdpr-data-export.md`:
--   1. Gated, non-automatic action (guide §5: "Liam decides per-table what to
--      delete vs pseudonymise... manual SQL is required... with extreme care").
--      tombstone_source_document is editor/admin-role-gated via get_user_role(),
--      never a timer/schedule (R(b) NO-AUTO-DISCARD, {138.7} sibling migration).
--   2. Register/audit-trail-over-deletion (guide §5's Article 17 tension —
--      pseudonymise audit-trail actor columns rather than delete history):
--      the source_documents REGISTER ROW is retained, never dropped — the same
--      "keep the identifying skeleton, strip the content" resolution as the
--      guide's own erasure posture.
--   3. Per-invocation operator audit trail (guide §7: "every invocation of the
--      export script automatically writes a row to pipeline_runs"): the shared
--      helper below writes a matching pipeline_runs row
--      (pipeline_name='source_document_erasure') so an erasure is auditable via
--      the SAME mechanism the guide documents for DSAR exports.
--
-- Authored, NOT applied: apply is an owner-gated coordinated GO (migration #3 of
-- the id138 serial — {138.5} -> {138.6} -> {138.7} -> {138.9}). No db push, no
-- types regen in this Subtask.
--
-- UK English throughout (DD/MM/YYYY). Authored 03/07/2026.

-- ---------------------------------------------------------------------------
-- Private helper (underscore-prefixed, per the existing _test_* convention) —
-- shared by tombstone_source_document (this file) and reap_orphaned_source_
-- documents (20260703160300_id138_orphan_reaper_fn.sql). NOT granted to anon
-- or authenticated: only callable from within another SECURITY DEFINER
-- function owned by postgres (the nested call runs as the definer, which is a
-- superuser and bypasses the EXECUTE check). This keeps the role-gate (editor/
-- admin OR the reaper's own gate) as the SINGLE enforcement point, never
-- bypassable by calling the helper directly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."_source_document_cascade_erase"(
    "p_id" "uuid",
    "p_trigger" "text" DEFAULT 'manual_tombstone'::"text"
) RETURNS TABLE(
    "chunks_deleted" integer,
    "embeddings_deleted" integer,
    "entity_mentions_deleted" integer,
    "entity_relationships_deleted" integer,
    "extractions_deleted" integer
)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_chunks       integer := 0;
  v_embeddings   integer := 0;
  v_sd_embedding integer := 0;
  v_mentions     integer := 0;
  v_rels         integer := 0;
  v_extractions  integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.source_documents WHERE id = p_id) THEN
    RAISE EXCEPTION '_source_document_cascade_erase: source_document % not found', p_id
      USING ERRCODE = 'P0002';
  END IF;

  -- record_embeddings has NO FK (D7 contrast — owner_kind='concept' has no DB
  -- row) so it cannot cascade automatically; delete chunk-owned rows BEFORE the
  -- chunks themselves (the owner_id lookup needs the chunk rows to still exist).
  DELETE FROM public.record_embeddings
   WHERE owner_kind = 'content_chunk'
     AND owner_id IN (SELECT id FROM public.content_chunks WHERE source_document_id = p_id);
  GET DIAGNOSTICS v_embeddings = ROW_COUNT;

  DELETE FROM public.record_embeddings
   WHERE owner_kind = 'source_document' AND owner_id = p_id;
  GET DIAGNOSTICS v_sd_embedding = ROW_COUNT;
  v_embeddings := v_embeddings + v_sd_embedding;

  DELETE FROM public.content_chunks WHERE source_document_id = p_id;
  GET DIAGNOSTICS v_chunks = ROW_COUNT;

  DELETE FROM public.entity_mentions WHERE source_document_id = p_id;
  GET DIAGNOSTICS v_mentions = ROW_COUNT;

  DELETE FROM public.entity_relationships WHERE source_document_id = p_id;
  GET DIAGNOSTICS v_rels = ROW_COUNT;

  DELETE FROM public.q_a_extractions WHERE source_document_id = p_id;
  GET DIAGNOSTICS v_extractions = ROW_COUNT;

  -- The register row SURVIVES (DR-025) — citations degrade to it, never orphan.
  -- q_a_pairs (promoted/curated) are untouched — DR-026 promotion boundary.
  UPDATE public.source_documents
     SET admission_status = 'tombstoned'
   WHERE id = p_id;

  -- Operator audit trail, coherent with the GDPR export script's pipeline_runs
  -- row-per-invocation pattern (gdpr-data-export.md §7).
  INSERT INTO public.pipeline_runs (
    pipeline_name, status, items_processed, result, completed_at, ended_at)
  VALUES (
    'source_document_erasure', 'completed',
    v_chunks + v_mentions + v_rels + v_extractions,
    jsonb_build_object(
      'source_document_id', p_id, 'trigger', p_trigger,
      'chunks_deleted', v_chunks, 'embeddings_deleted', v_embeddings,
      'entity_mentions_deleted', v_mentions, 'entity_relationships_deleted', v_rels,
      'extractions_deleted', v_extractions),
    now(), now());

  RETURN QUERY SELECT v_chunks, v_embeddings, v_mentions, v_rels, v_extractions;
END;
$$;

ALTER FUNCTION "public"."_source_document_cascade_erase"("uuid", "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."_source_document_cascade_erase"("uuid", "text") FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Public-facing erasure entry point — editor/admin only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."tombstone_source_document"("p_id" "uuid")
    RETURNS TABLE(
        "source_document_id" "uuid",
        "chunks_deleted" integer,
        "embeddings_deleted" integer,
        "entity_mentions_deleted" integer,
        "entity_relationships_deleted" integer,
        "extractions_deleted" integer
    )
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_role   text := public.get_user_role();
  v_result record;
BEGIN
  IF v_role NOT IN ('editor', 'admin') THEN
    RAISE EXCEPTION 'tombstone_source_document: editor/admin role required (got %)', v_role
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_result FROM public._source_document_cascade_erase(p_id, 'manual_tombstone');

  RETURN QUERY SELECT p_id, v_result.chunks_deleted, v_result.embeddings_deleted,
                      v_result.entity_mentions_deleted, v_result.entity_relationships_deleted,
                      v_result.extractions_deleted;
END;
$$;

ALTER FUNCTION "public"."tombstone_source_document"("uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."tombstone_source_document"("uuid") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."tombstone_source_document"("uuid") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."tombstone_source_document"("uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."tombstone_source_document"("uuid") TO "service_role";

COMMENT ON FUNCTION "public"."tombstone_source_document"("uuid") IS 'ID-138 {138.7} M3 — TECH.md §2.6 R(ops), §2.5 R(e); S443 OQ-138-C (GDPR-data-export.md coherence, see file header). Editor/admin-gated GDPR erasure cascade: sets admission_status=''tombstoned'', deletes derived STAGING rows (content_chunks/record_embeddings/entity_mentions/entity_relationships/q_a_extractions) via the shared _source_document_cascade_erase helper, records the erasure as a pipeline_runs audit row. The register row (source_documents) SURVIVES (DR-025) — citations degrade to it, never orphan; q_a_pairs (promoted/curated) are untouched (DR-026 promotion boundary). Idempotent: re-running on an already-tombstoned id is a safe no-op cascade (all DELETEs affect zero rows).';

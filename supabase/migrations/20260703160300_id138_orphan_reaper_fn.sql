-- ID-138 {138.7} M4 — reap_orphaned_source_documents + citations_cascade_preflight
-- TECH.md §3.1 M4; §2.6 R(ops); §1.3 fact 3 (citations-CASCADE hazard,
-- flow.py:2931-2936).
--
-- (a) reap_orphaned_source_documents(): register-TOMBSTONE semantics (§10.3) —
-- `full_reprocess` never deletes off-engine source_documents rows, so orphans
-- accumulate when a source leaves the walk scope. This reaper TOMBSTONES them
-- (never hard-deletes — the register is permanent, DR-025) by reusing the SAME
-- cascade helper as tombstone_source_document (20260703160200_
-- id138_erasure_cascade_fn.sql), so a reaped row and a manually-tombstoned row
-- converge on identical semantics + the same pipeline_runs audit trail.
--
-- R(b) NO-AUTO-DISCARD is respected by SCOPE, not by a special case: the orphan
-- candidate query below matches ONLY retention_class='keep_and_watch' rows —
-- the one class where "walked once, now has zero engine-declared derived rows"
-- cleanly means "left the walk scope" (the engine's own orphan-cleanup already
-- reaps the CHUNKS/EXTRACTIONS/ENTITIES for a keep_and_watch source that leaves
-- scope; this reaper closes the gap by also tombstoning the now-empty register
-- row, which the engine's off-engine write path never touches). `ingest_once`,
-- `live_connected`, and `external_referenced` rows are NEVER candidates: an
-- ingest_once source is legitimately expected to carry NO engine-declared
-- derived rows (extracted off-engine, one-shot, {138.11}) — tombstoning it here
-- would BE the auto-discard timer R(b) forbids. A live_connected source with no
-- recent sync is "sync-broken", not orphaned (§2.6: "distinguish... sync-broken
-- vs intentionally-ingest-once") — investigation, not erasure. A 1-day grace
-- period on created_at avoids reaping a source admitted moments before its
-- first walk completes.
--
-- OPEN OPERATIONAL QUESTION (flagged, not resolved here — Ops/infra leg, O,
-- {138.4}/PLAN territory): reap_orphaned_source_documents() is editor/admin-
-- role-gated per the brief's "every fn" instruction, matching
-- tombstone_source_document. A pg_cron / scheduled invocation of this function
-- must therefore run under a session that resolves via get_user_role() to
-- editor/admin (e.g. a dedicated service account row in user_roles), or be
-- invoked by an admin operator on demand rather than on a timer. Wiring that
-- invocation context is NOT this migration's concern (SQL fn authoring only).
--
-- (b) citations_cascade_preflight(): read-only guard before a live
-- `full_reprocess` of the URL ledger — `citations.cited_reference_item_id` is
-- ON DELETE CASCADE to reference_items (20260628191703_id131_cite_ext_
-- winrate_fix.sql:30), and full_reprocess delete-then-re-exports reference_items
-- (flow.py:2931-2936), which would CASCADE-DELETE any citation pointing at one.
--
-- Authored, NOT applied: apply is an owner-gated coordinated GO (migration #4 of
-- the id138 serial — {138.5} -> {138.6} -> {138.7} -> {138.9}). No db push, no
-- types regen in this Subtask.
--
-- UK English throughout (DD/MM/YYYY). Authored 03/07/2026.

CREATE OR REPLACE FUNCTION "public"."reap_orphaned_source_documents"()
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
  v_orphan record;
  v_result record;
BEGIN
  IF v_role NOT IN ('editor', 'admin') THEN
    RAISE EXCEPTION 'reap_orphaned_source_documents: editor/admin role required (got %)', v_role
      USING ERRCODE = '42501';
  END IF;

  FOR v_orphan IN
    -- keep_and_watch ONLY (see header note): admitted, past the 1-day grace
    -- period, with zero rows across every engine-declared derived table.
    SELECT sd.id
    FROM public.source_documents sd
    WHERE sd.retention_class = 'keep_and_watch'
      AND sd.admission_status = 'admitted'
      AND sd.created_at < (now() - interval '1 day')
      AND NOT EXISTS (SELECT 1 FROM public.content_chunks cc WHERE cc.source_document_id = sd.id)
      AND NOT EXISTS (SELECT 1 FROM public.q_a_extractions qe WHERE qe.source_document_id = sd.id)
      AND NOT EXISTS (SELECT 1 FROM public.entity_mentions em WHERE em.source_document_id = sd.id)
  LOOP
    SELECT * INTO v_result FROM public._source_document_cascade_erase(v_orphan.id, 'orphan_reaper');

    RETURN QUERY SELECT v_orphan.id, v_result.chunks_deleted, v_result.embeddings_deleted,
                        v_result.entity_mentions_deleted, v_result.entity_relationships_deleted,
                        v_result.extractions_deleted;
  END LOOP;
END;
$$;

ALTER FUNCTION "public"."reap_orphaned_source_documents"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."reap_orphaned_source_documents"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."reap_orphaned_source_documents"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."reap_orphaned_source_documents"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."reap_orphaned_source_documents"() TO "service_role";

COMMENT ON FUNCTION "public"."reap_orphaned_source_documents"() IS 'ID-138 {138.7} M4 — TECH.md §2.6 R(ops) register-tombstone reaper (§10.3). Editor/admin-gated. Candidates: retention_class=keep_and_watch, admission_status=admitted, created_at older than 1 day, zero rows across content_chunks/q_a_extractions/entity_mentions (left the walk scope). ingest_once/live_connected/external_referenced are NEVER candidates (R(b) NO-AUTO-DISCARD by scope, not by special-case — see file header). Reuses the tombstone_source_document cascade helper (_source_document_cascade_erase) so a reaped row converges on identical semantics + the same pipeline_runs audit trail. Never hard-deletes — the register is permanent (DR-025).';

-- ---------------------------------------------------------------------------
-- citations_cascade_preflight — read-only guard before a live full_reprocess
-- of the URL ledger (flow.py:2931-2936 hazard).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."citations_cascade_preflight"()
    RETURNS TABLE("safe_to_reprocess" boolean, "at_risk_citation_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_role  text := public.get_user_role();
  v_count integer;
BEGIN
  IF v_role NOT IN ('editor', 'admin') THEN
    RAISE EXCEPTION 'citations_cascade_preflight: editor/admin role required (got %)', v_role
      USING ERRCODE = '42501';
  END IF;

  -- citations.cited_reference_item_id -> reference_items ON DELETE CASCADE
  -- (20260628191703_id131_cite_ext_winrate_fix.sql:30). full_reprocess
  -- delete-then-re-exports reference_items, which would fire that CASCADE and
  -- silently delete every citation counted here.
  SELECT count(*) INTO v_count
  FROM public.citations
  WHERE cited_kind = 'reference_item';

  RETURN QUERY SELECT (v_count = 0), v_count;
END;
$$;

ALTER FUNCTION "public"."citations_cascade_preflight"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."citations_cascade_preflight"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."citations_cascade_preflight"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."citations_cascade_preflight"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."citations_cascade_preflight"() TO "service_role";

COMMENT ON FUNCTION "public"."citations_cascade_preflight"() IS 'ID-138 {138.7} M4 — TECH.md §1.3 fact 3, §2.6 R(ops). Editor/admin-gated read-only guard: refuses (safe_to_reprocess=false) a live full_reprocess of the URL ledger when citations.cited_kind=reference_item rows exist, because citations.cited_reference_item_id is ON DELETE CASCADE to reference_items and full_reprocess delete-then-re-exports reference_items (flow.py:2931-2936). Caller (Python ops tooling, out of this migration''s scope) MUST check safe_to_reprocess before invoking a live full_reprocess.';

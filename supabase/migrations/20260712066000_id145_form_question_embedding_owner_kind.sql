-- ID-145 {145.29} — Persist question embeddings under
-- record_embeddings.owner_kind='form_question' (S470 owner ratification).
--
-- CONTEXT: {145.17} wired the id-57 question_match_recompute RPC
-- (BI-34/35) with the query embedding computed on EVERY recompute call
-- (compute-on-recompute, TECH.md §9 decision 3 DEFAULT) and explicitly
-- deferred persistence: "record_embeddings has NO form_question owner_kind
-- ... OWNER MAY REVISE: persist under record_embeddings.owner_kind=
-- 'form_question' ... ONLY if re-match-on-corpus-change proves needed".
-- S470: Liam ratified PERSIST. This migration is the DDL half of that
-- ratification — widening the M1b CHECK
-- (20260628190001_id131_record_embeddings_store.sql) to admit
-- 'form_question' as an 8th owner_kind, alongside the app-side upsert
-- landing in the SAME commit (lib/domains/procurement/
-- question-match-recompute.ts).
--
-- Superset widen only (mirrors the company_profile /
-- form_template_requirement precedent —
-- 20260703140000_id131_company_embedding_migrate.sql,
-- 20260707200000_id130_form_requirement_embedding_migrate.sql): every
-- previously-valid owner_kind value is preserved, DROP CONSTRAINT IF
-- EXISTS + ADD CONSTRAINT so the migration is re-runnable.
--
-- NO backfill / normalise step (unlike the two precedents above): unlike
-- company_profiles.company_embedding or form_template_requirements.
-- requirement_embedding, form_question embeddings were NEVER persisted
-- anywhere pre-{145.29} (compute-on-recompute only, v1) — there is no
-- existing inline column or prior data to migrate into this store.
-- Existing form_questions simply gain a record_embeddings row the next
-- time they are created or updated (the app-side upsert this migration's
-- companion TS change adds). Additive, zero-row, data-safe.
--
-- No new partial HNSW index for 'form_question' (mirrors the same
-- company_profile / form_template_requirement precedent — neither added
-- one either): the question_match_recompute RPC never runs an ANN scan
-- keyed on the form_question side — the query embedding is passed
-- directly as a parameter (p_query_embedding); only the q_a_pair
-- CANDIDATE side is read via the existing idx_record_embeddings_q_a_pair
-- partial index. A form_question-side index would be dead weight.
--
-- SEQUENCING: timestamp (066000) sorts directly after the {145.6} W1 SQL
-- batch's last file (20260712065000_id145_bi8_retire_bid_creation_label.sql)
-- — authored into the held W1 batch per the {145.29} dispatch brief, NOT
-- pushed until Arc 3.
--
-- UK English throughout (DD/MM/YYYY). Authored 12/07/2026.

-- ============================================================================
-- record_embeddings_owner_kind_chk — add 'form_question' (S470 ratification).
-- Prior superset (20260707200000): {source_document, content_chunk,
-- q_a_pair, reference_item, concept, company_profile,
-- form_template_requirement}.
-- ============================================================================
ALTER TABLE "public"."record_embeddings" DROP CONSTRAINT IF EXISTS "record_embeddings_owner_kind_chk";
ALTER TABLE "public"."record_embeddings" ADD CONSTRAINT "record_embeddings_owner_kind_chk"
    CHECK (("owner_kind" = ANY (ARRAY[
        'source_document'::"text",
        'content_chunk'::"text",
        'q_a_pair'::"text",
        'reference_item'::"text",
        'concept'::"text",
        'company_profile'::"text",
        'form_template_requirement'::"text",
        'form_question'::"text"
    ])));

COMMENT ON TABLE "public"."record_embeddings" IS 'ID-131 {131.6} M1b: central embeddings store. (owner_kind, owner_id) idiom + owner_kind CHECK, NO FKs (D7 contrast — ''concept'' has no DB row). Owners: source_document|content_chunk|q_a_pair|reference_item|concept|company_profile|form_template_requirement|form_question (ID-145 {145.29}, S470 ratification — question embeddings persisted, not compute-on-recompute). UNIQUE (owner_kind, owner_id, model); per-owner_kind partial HNSW indexes (form_question has none — see header note). Absorbs scattered inline vector cols (dropped in M5). BI-17.';

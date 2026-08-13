-- id-434 {434.3} §4 — resolution-before-declaration migration (DR-140 clause 1,
-- DR-147, DR-036/D10; pre-launch posture DR-093: correct structure, delete bad
-- rows, no backfill).
--
-- Two halves, one landing:
--
-- 1. record_embeddings owner_kind gains 'entity_name' (TECH §2.6). The phase-2a
--    entity-name embeddings become a read-through cache over the DR-036 single
--    home: owner_id = uuid5(pipeline NS, 'entity_name:{name}'), model =
--    text-embedding-3-large, INSERT … ON CONFLICT DO NOTHING on miss. Cache
--    semantics, not engine target state — the substrate must survive corpus
--    changes and LMDB resets. No FK (the 'concept' no-DB-row precedent) and NO
--    new partial HNSW index: the ranking term is id-452's decision, gated on a
--    real-tier run; this is plumbing + cost + substrate only.
--
--    Superset widen only (mirrors 20260712066000_id145_form_question_embedding_
--    owner_kind.sql): DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT, re-runnable,
--    every previously-valid owner_kind preserved.
--
-- 2. entity_mentions wipe (TECH §4.2). The row-identity derivation changes —
--    id = uuid5(NS, 'em:{sd}:{RESOLVED canonical}:{type}') keyed on the
--    resolved canonical (DR-147 clause 1) — and every existing row is mock-tier
--    synthetic data keyed on the retiring per-document canonical. DR-093: they
--    are dropped and re-walked, never backfilled. Pins on mock-tier rows drop
--    with them — there is no pin worth preserving before the first real-tier
--    walk (TECH §4.2, owner-ratified spec).
--
--    entity_pair_resolutions is UNTOUCHED — it is the archaeology and the
--    stability substrate (DR-147 clause 4 / D5).
--
--    NOTE the companion deploy step this migration cannot carry: the engine
--    store (/cocoindex-state/lmdb) must be wiped before the first post-deploy
--    walk (TECH §4.3, the DR-146 precedent) — declare-site ownership moves from
--    the per-file components to the one corpus-wide declare component, so the
--    old per-file 'em' target-state records must not survive to be reconciled
--    against the new shape.
--
-- UK English throughout (DD/MM/YYYY). Authored 13/08/2026 (id-434).

-- ============================================================================
-- 1. record_embeddings_owner_kind_chk — add 'entity_name' (TECH §2.6).
-- Prior superset (20260712066000): {source_document, content_chunk, q_a_pair,
-- reference_item, concept, company_profile, form_template_requirement,
-- form_question}.
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
        'form_question'::"text",
        'entity_name'::"text"
    ])));

COMMENT ON TABLE "public"."record_embeddings" IS 'ID-131 {131.6} M1b: central embeddings store. (owner_kind, owner_id) idiom + owner_kind CHECK, NO FKs (D7 contrast — ''concept'' has no DB row). Owners: source_document|content_chunk|q_a_pair|reference_item|concept|company_profile|form_template_requirement|form_question|entity_name (id-434 TECH §2.6 — phase-2a resolution cache, read-through, no HNSW index pending id-452). UNIQUE (owner_kind, owner_id, model); per-owner_kind partial HNSW indexes. Absorbs scattered inline vector cols (dropped in M5). BI-17.';

-- ============================================================================
-- 2. entity_mentions wipe (TECH §4.2, DR-093). Mock-tier rows keyed on the
-- retiring per-document canonical; identity re-derives on the next walk.
-- ============================================================================
DELETE FROM "public"."entity_mentions";

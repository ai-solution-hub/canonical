-- ⛔ TERMINAL MIGRATION — DO NOT APPLY WITHIN THE {131.11} APPLY SET.
-- The 5 inline vector cols have writers/readers spread across MULTIPLE id-131 subtasks:
--   content_chunks.embedding      — flow.py (131.11 EX-PY) + search RPCs (131.11): SAFE once 131.11 lands
--   q_a_pairs.question_embedding  — promote-corpus.ts (131.21?) + qa_dedup_proposer.py + find_duplicate_pairs/find_similar_content (131.15 G-DEDUP)
--   reference_items.embedding     — content.ts + ingest/url/route.ts + forms (131.16)
--   form_template_requirements.requirement_embedding — from-instance.ts + template-coverage.ts + calibrate/catalogue scripts (131.16)
--   company_profiles.company_embedding (TEXT) — intelligence/pipeline.ts:123
-- This migration is a READY ARTIFACT for the PARENT to sequence at/after M6/G-API (131.19),
-- once EVERY record_embeddings read/write re-point across id-131 is complete. Applying it
-- earlier silently breaks siblings (PG defers PL/pgSQL col-validation to exec time).
--
-- api REGEN CONSEQUENCE (comment only — NO api edits here; G-API {131.19} owns it):
-- dropping these cols invalidates the explicit-col security_invoker views that project
-- them — api.content_chunks (embedding), api.q_a_pairs (question_embedding),
-- api.reference_items (embedding), api.form_template_requirements (requirement_embedding),
-- api.company_profiles (company_embedding). The whole-surface regen
-- (id131_api_views_regen) must run AFTER this migration to rebuild them without the cols.

-- ---------------------------------------------------------------------------
-- The 4 record_embeddings-superseded vector cols. Their reads move to
-- public.record_embeddings (owner_kind, owner_id, model) across id-131; once the
-- last read/write re-point lands these inline cols are dead weight.
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."content_chunks" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "public"."q_a_pairs" DROP COLUMN IF EXISTS "question_embedding";
ALTER TABLE "public"."reference_items" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "public"."form_template_requirements" DROP COLUMN IF EXISTS "requirement_embedding";

-- ---------------------------------------------------------------------------
-- TODO(OQ) — company_profiles.company_embedding (TEXT) — BLOCKED, ESCALATED TO PARENT.
--
-- The design note (§3, BI-17) says NORMALISE this TEXT (JSON-serialised) embedding
-- into record_embeddings as part of EMB-STORE completeness. That normalisation is
-- NOT implemented here and is NOT safe to apply yet, for THREE unresolved reasons:
--   1. record_embeddings.owner_kind CHECK has NO 'company_profile' value
--      (allowed set: source_document | content_chunk | q_a_pair | reference_item |
--      concept). Normalising company embeddings in needs a CHECK extension +
--      (per BI-17) a per-owner_kind partial HNSW index — a net-new schema change.
--   2. lib/intelligence/pipeline.ts:123 ACTIVELY reads company_profiles.company_embedding
--      (TEXT) for the relevance pre-filter cache. Dropping the col breaks that reader;
--      it must be re-pointed onto record_embeddings FIRST.
--   3. company_profile is NOT a search/sourcing match grain (no §2 consumer retrieves
--      over it) — so the owner must decide whether it belongs in EMB-STORE at all, or
--      stays a private relevance-cache column on company_profiles.
--
-- Per the {131.11} G-SEARCH brief this is DO-NOT-IMPLEMENT + escalate. The DROP below
-- is retained (to keep this file the complete "drop the 5 inline vector cols" artifact)
-- BUT it MUST NOT be applied until (1) the owner_kind CHECK is extended, (2) the TEXT
-- data is normalised into record_embeddings, and (3) pipeline.ts:123 is re-pointed —
-- all currently UNSCOPED. The parent must resolve this OQ (new subtask / owner call)
-- before including the statement below in any apply set.
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."company_profiles" DROP COLUMN IF EXISTS "company_embedding";

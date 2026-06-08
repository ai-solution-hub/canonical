-- =============================================================================
-- ID-94.1 (S329, ratified ID-93 register §6.7) — Q&A alternate-phrasings capture
-- at ingest (pre-re-ingest gate G4 in {64.8})
-- =============================================================================
--
-- The cocoindex Q&A extractor (scripts/cocoindex_pipeline/extraction.py QAPair)
-- is extended to emit 3-5 alternate question phrasings per pair during the
-- ID-45 run — the cheapest capture moment, enabling rephrase-invariant
-- search_qa_library matching without per-query LLM cost. This migration adds
-- the column so the Path-A write path
-- (scripts/cocoindex_pipeline/flow.py Q_A_EXTRACTIONS_SCHEMA + qa_target.declare_row)
-- can persist them.
--
-- text[] NOT NULL DEFAULT '{}' mirrors both the existing q_a_extractions list
-- columns (evidence_requirements / scope_tags, 20260530195956) and the
-- promotion-target column q_a_pairs.alternate_question_phrasings
-- (20260520225456_t6_q_a_pairs_full_schema.sql) — asyncpg maps Python list[str].
-- The empty-list default keeps every pre-existing row valid and lets the LLM
-- emit an empty list when no rephrasings apply.
--
-- Carry-through (NOT implemented here — ID-45 spec chain): at UC5 promotion,
-- q_a_extractions.alternate_question_phrasings -> q_a_pairs.alternate_question_phrasings.
--
-- No new PL/pgSQL function => no SET search_path needed.
-- =============================================================================

ALTER TABLE public.q_a_extractions
  ADD COLUMN alternate_question_phrasings text[] NOT NULL DEFAULT '{}';

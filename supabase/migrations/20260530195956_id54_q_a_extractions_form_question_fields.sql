-- =============================================================================
-- ID-54.1 (S273 OQ-52-LOSSY) — q_a_extractions form-question fields
-- =============================================================================
--
-- The cocoindex LLM extractor (scripts/cocoindex_pipeline/extraction.py QAPair)
-- emits 4 form-question fields that were dropped at write time because the
-- q_a_extractions table (created 20260520225456_t6_q_a_pairs_full_schema.sql)
-- never carried columns for them. This migration adds the 4 columns so the
-- Path-A write path (scripts/cocoindex_pipeline/flow.py Q_A_EXTRACTIONS_SCHEMA
-- + qa_target.declare_row) can persist them.
--
-- expected_response_kind mirrors the Pydantic Literal CV ('mandatory','optional');
-- the CHECK passes on NULL so nullable + CHECK coexist. The two list columns
-- mirror the q_a_pairs `text[] DEFAULT '{}'` precedent (asyncpg maps list[str]).
-- No new PL/pgSQL function => no SET search_path needed.
-- =============================================================================

ALTER TABLE public.q_a_extractions
  ADD COLUMN expected_response_kind text NULL
    CONSTRAINT q_a_extractions_expected_response_kind_check
      CHECK (expected_response_kind IN ('mandatory', 'optional')),
  ADD COLUMN evaluation_criteria text NULL,
  ADD COLUMN evidence_requirements text[] NOT NULL DEFAULT '{}',
  ADD COLUMN scope_tags text[] NOT NULL DEFAULT '{}';

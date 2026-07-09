-- ============================================================================
-- ID-57.9 — clamp embedding_score range in question_match_recompute
-- (+ q_a_search audit/mirror fix).
--
-- Provenance: S451 {57.7} fix-executor finding, curator-confirmed real (hit
-- live on staging with anti-parallel vectors while authoring test fixtures).
--
-- DEFECT: public.question_match_recompute (squash_baseline, ex-20260615165758;
-- most recently re-pointed by 20260706170000_id131_qa_fns_record_embeddings_
-- repoint.sql) computes:
--   embedding_score = (1.0 - (re.embedding <=> p_query_embedding))::numeric(5,4)
-- with NO clamp. pgvector cosine distance ranges [0,2], so distance > 1
-- yields a NEGATIVE score, which violates the question_matches table's
-- question_matches_embedding_score_range_chk CHECK ((embedding_score IS NULL)
-- OR (embedding_score BETWEEN 0 AND 1)) (squash baseline lines 8052-8057).
-- The RPC then fails with a raw Postgres constraint-violation error instead
-- of degrading gracefully.
--
-- FIX: wrap the scoring expression in GREATEST(0, LEAST(1, ...)) so the
-- value is clamped to [0,1] before being cast to numeric(5,4) and (for
-- question_match_recompute) upserted into question_matches. This is the
-- ONLY change to the function body — signature, return shape, JOIN/WHERE
-- logic, SET search_path, and LANGUAGE/SECURITY flags are all otherwise
-- byte-for-byte identical to the latest (20260706170000) body.
--
-- Q_A_SEARCH AUDIT (per this function's own comment, "mirrors q_a_search
-- verbatim"): public.q_a_search computes the IDENTICAL unclamped expression
-- (1.0 - (re.embedding <=> p_query_embedding))::numeric(5,4) at
-- 20260706170000_id131_qa_fns_record_embeddings_repoint.sql:133. VERDICT:
-- defect mirrored — yes. Unlike question_match_recompute, q_a_search's
-- embedding_score is a function RETURN column (not persisted to a
-- CHECK-constrained table), so this does not crash the RPC — but it can
-- still surface a semantically-invalid negative "similarity" score to API
-- callers (contradicts the function's own comment describing the range as
-- "0..1, higher = more similar"). Fixed here for consistency/parity, same
-- clamp idiom, in the SAME migration per the mirrors-verbatim relationship.
--
-- API-WRAPPER AUDIT (DR-032): api.question_match_recompute / api.q_a_search
-- are thin `SELECT * FROM public.fn(...)` INVOKER wrappers (squash baseline
-- lines 984-1003) with IDENTICAL signatures/arity/return shape to the
-- public originals, unchanged by this fix (only the internal scoring
-- expression changes, not params or RETURNS). 20260706170000 already
-- established this precedent for the same two functions when it re-pointed
-- their vector reads onto record_embeddings ("same exact-arity call
-- resolves to the same overload... need NO regen"). VERDICT: no companion
-- api-schema migration required.
--
-- DR-035 born-locked posture: the ddl_command_end event trigger
-- (dr035_born_locked_functions, 20260707190500_id61_dr035_default_
-- privileges.sql) already re-applies REVOKE EXECUTE FROM PUBLIC, anon to
-- every function this migration CREATE OR REPLACEs. The REVOKE/GRANT
-- statements below are redundant defense-in-depth, kept for readability/
-- parity with sibling migrations (e.g. 20260708140000_id130_procurement_
-- rollup_api_rpc.sql) — CREATE OR REPLACE FUNCTION does not itself alter an
-- existing function's ACL, so this re-states the posture explicitly rather
-- than relying solely on the trigger.
--
-- AUTHORED, NOT APPLIED by this Subtask — no `supabase db push`, no MCP
-- `apply_migration`, no types regen. Apply order: staging first, then prod,
-- per parity discipline.
--
-- UK English throughout (DD/MM/YYYY). Authored 09/07/2026 (UTC).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. question_match_recompute(...) — full body from
--    20260706170000_id131_qa_fns_record_embeddings_repoint.sql:184-239,
--    changed ONLY at the embedding_score line (GREATEST/LEAST clamp added).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."question_match_recompute"("p_form_question_id" "uuid", "p_query" "text", "p_query_embedding" "extensions"."vector", "p_question_kind" "text", "p_scope_tag" "text"[], "p_anti_scope_tag" "text"[], "p_limit" integer DEFAULT 20) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_count integer;
  embedding_model CONSTANT text := 'text-embedding-3-large';
BEGIN
  WITH scored AS (
    -- The live scoring expression (mirrors q_a_search verbatim). This is the ONLY place
    -- re-scoring happens; the reader (question_match_search) consumes the stored result.
    -- Vector read from record_embeddings (owner_kind='q_a_pair') — the inline
    -- question_embedding column was dropped (ID-131.19).
    SELECT
      qap.id AS q_a_pair_id,
      -- ID-57.9: clamped to [0,1] — pgvector cosine distance ranges [0,2], so
      -- distance > 1 previously yielded a negative score violating
      -- question_matches_embedding_score_range_chk.
      GREATEST(0, LEAST(1, 1.0 - (re.embedding <=> p_query_embedding)))::numeric(5,4) AS embedding_score,
      ts_rank(
        to_tsvector('english',
          qap.question_text || ' ' || COALESCE(qap.answer_standard, '') || ' ' ||
          array_to_string(qap.alternate_question_phrasings, ' ')),
        plainto_tsquery('english', p_query),
        2  -- bl-76 calibration anchor (F1/D3); changing the flag never alters the table (F3)
      )::numeric(5,4) AS fulltext_score
    FROM public.q_a_pairs qap
    -- B6 embedding-eligibility filter (was `qap.question_embedding IS NOT NULL`):
    -- an INNER JOIN only produces a row when a matching record_embeddings row exists.
    JOIN public.record_embeddings re ON re.owner_kind = 'q_a_pair' AND re.owner_id = qap.id AND re.model = embedding_model
    WHERE re.embedding IS NOT NULL              -- B6 embedding-eligibility
      AND qap.publication_status = 'published'  -- B6 publication gate
      AND qap.scope_tag && p_scope_tag                       -- B5 scope overlap
      AND NOT (qap.anti_scope_tag && p_scope_tag)            -- B5 anti-scope exclusion
  ),
  ranked AS (
    SELECT s.q_a_pair_id, s.embedding_score, s.fulltext_score
    FROM scored s
    -- D4 default blend selects the top-N to materialise; C3 deterministic tie-break.
    ORDER BY (s.embedding_score * 0.6 + s.fulltext_score * 0.4) DESC, s.q_a_pair_id
    LIMIT p_limit
  ),
  upserted AS (
    INSERT INTO public.question_matches
      (form_question_id, q_a_pair_id, question_kind, embedding_score, fulltext_score, matched_at)
    SELECT p_form_question_id, r.q_a_pair_id, p_question_kind,
           r.embedding_score, r.fulltext_score, now()
    FROM ranked r
    ON CONFLICT (form_question_id, q_a_pair_id) DO UPDATE
      SET embedding_score = EXCLUDED.embedding_score,
          fulltext_score  = EXCLUDED.fulltext_score,
          matched_at      = now(),
          updated_at      = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upserted;
  RETURN v_count;
END;
$$;

ALTER FUNCTION "public"."question_match_recompute"("p_form_question_id" "uuid", "p_query" "text", "p_query_embedding" "extensions"."vector", "p_question_kind" "text", "p_scope_tag" "text"[], "p_anti_scope_tag" "text"[], "p_limit" integer) OWNER TO "postgres";

COMMENT ON FUNCTION "public"."question_match_recompute"("p_form_question_id" "uuid", "p_query" "text", "p_query_embedding" "extensions"."vector", "p_question_kind" "text", "p_scope_tag" "text"[], "p_anti_scope_tag" "text"[], "p_limit" integer) IS 'ID-131.19 (S450 GO tail #3): vector read + B6 eligibility filter re-pointed off the dropped q_a_pairs.question_embedding column onto record_embeddings (owner_kind=''q_a_pair''), mirroring q_a_search. Signature and return shape (integer upsert count) unchanged. ID-57.9: embedding_score now clamped to [0,1] via GREATEST(0, LEAST(1, ...)) — pgvector cosine distance ranges [0,2], so distance>1 previously yielded a negative score violating question_matches_embedding_score_range_chk (curator-confirmed live-staging defect, S451 {57.7}).';

REVOKE ALL ON FUNCTION "public"."question_match_recompute"("p_form_question_id" "uuid", "p_query" "text", "p_query_embedding" "extensions"."vector", "p_question_kind" "text", "p_scope_tag" "text"[], "p_anti_scope_tag" "text"[], "p_limit" integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."question_match_recompute"("p_form_question_id" "uuid", "p_query" "text", "p_query_embedding" "extensions"."vector", "p_question_kind" "text", "p_scope_tag" "text"[], "p_anti_scope_tag" "text"[], "p_limit" integer) FROM "anon";
GRANT ALL ON FUNCTION "public"."question_match_recompute"("p_form_question_id" "uuid", "p_query" "text", "p_query_embedding" "extensions"."vector", "p_question_kind" "text", "p_scope_tag" "text"[], "p_anti_scope_tag" "text"[], "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."question_match_recompute"("p_form_question_id" "uuid", "p_query" "text", "p_query_embedding" "extensions"."vector", "p_question_kind" "text", "p_scope_tag" "text"[], "p_anti_scope_tag" "text"[], "p_limit" integer) TO "service_role";

-- ---------------------------------------------------------------------------
-- 2. q_a_search(...) — full body from
--    20260706170000_id131_qa_fns_record_embeddings_repoint.sql:115-170,
--    changed ONLY at the embedding_score line (GREATEST/LEAST clamp added),
--    per the audit above (identical unclamped pattern confirmed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."q_a_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer DEFAULT 20) RETURNS TABLE("pair_id" "uuid", "question_text_preview" "text", "answer_standard_preview" "text", "embedding_score" numeric, "fulltext_score" numeric, "scope_tag" "text"[], "publication_status" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  embedding_model CONSTANT text := 'text-embedding-3-large';
BEGIN
  RETURN QUERY
  WITH scored AS (
    SELECT
      qap.id                                                               AS pair_id,
      -- Preview: truncate to ~200 chars; LEFT() is safe on NULL but question_text is NOT NULL
      LEFT(qap.question_text, 200)                                         AS question_text_preview,
      -- answer_standard is NOT NULL post-WP1; COALESCE is defensive
      LEFT(COALESCE(qap.answer_standard, ''), 200)                         AS answer_standard_preview,
      -- Cosine similarity: 1 - distance (range 0..1, higher = more similar).
      -- Vector read from record_embeddings (owner_kind='q_a_pair') — the
      -- inline question_embedding column was dropped (ID-131.19). Clamped
      -- (ID-57.9): pgvector cosine distance ranges [0,2], so distance > 1
      -- would otherwise yield a negative "similarity" score.
      GREATEST(0, LEAST(1, 1.0 - (re.embedding <=> p_query_embedding)))::numeric(5,4) AS embedding_score,
      -- Full-text rank over question + answer + alternate phrasings
      -- ts_rank returns 0 when no plainto_tsquery match
      -- normalisation option 2: divide by 1 + log(ndoc) — bounds rank in practice
      ts_rank(
        to_tsvector(
          'english',
          qap.question_text
          || ' ' || COALESCE(qap.answer_standard, '')
          || ' ' || array_to_string(qap.alternate_question_phrasings, ' ')
        ),
        plainto_tsquery('english', p_query),
        2
      )::numeric(5,4)                                                      AS fulltext_score,
      qap.scope_tag,
      qap.publication_status
    FROM public.q_a_pairs qap
    -- Eligibility filter (was `qap.question_embedding IS NOT NULL`): an INNER
    -- JOIN only produces a row when a matching record_embeddings row exists.
    JOIN public.record_embeddings re ON re.owner_kind = 'q_a_pair' AND re.owner_id = qap.id AND re.model = embedding_model
    WHERE re.embedding IS NOT NULL
      AND qap.publication_status = 'published'
  )
  SELECT
    s.pair_id,
    s.question_text_preview,
    s.answer_standard_preview,
    s.embedding_score,
    s.fulltext_score,
    s.scope_tag,
    s.publication_status
  FROM scored s
  -- Deterministic internal blend: embeddings dominate (0.6), fulltext breaks ties (0.4)
  -- Not exposed as a return column; callers receive raw per-method scores (N9 RESOLVED-S236)
  ORDER BY (s.embedding_score * 0.6 + s.fulltext_score * 0.4) DESC
  LIMIT p_limit;
END;
$$;

ALTER FUNCTION "public"."q_a_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer) OWNER TO "postgres";

COMMENT ON FUNCTION "public"."q_a_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer) IS 'T6 WP2 — PLAN.md §4.6 sub-task 4. Two-step retrieval Step 1: ranked preview list. Returns embedding_score + fulltext_score as SEPARATE columns per N9 RESOLVED-S236 (05-qa-flow.md §7.3). Scope filtering is caller-side (scope_tag pass-through). Internal ORDER BY uses weighted blend embedding*0.6 + fulltext*0.4 but that blend is NOT returned — callers see raw scores and apply own blend/display policy. ID-131.19 (S450 GO tail #3): vector read re-pointed off the dropped q_a_pairs.question_embedding column onto record_embeddings (owner_kind=''q_a_pair''); eligibility filter re-expressed as an INNER JOIN. Signature and return shape unchanged. ID-57.9: embedding_score now clamped to [0,1] via GREATEST(0, LEAST(1, ...)), for parity with question_match_recompute''s identical fix — audit confirmed the same unclamped cosine-distance pattern (this function has no persisted CHECK constraint so it never crashed, but could surface a semantically-invalid negative score to callers).';

REVOKE ALL ON FUNCTION "public"."q_a_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."q_a_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer) FROM "anon";
GRANT ALL ON FUNCTION "public"."q_a_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."q_a_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer) TO "service_role";

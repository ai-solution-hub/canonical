-- ============================================================================
-- ID-131.19 (S450 GO tail #3, URGENT — live-erroring fns on staging):
-- q_a_extractions_promotion_candidates() / q_a_search() /
-- question_match_recompute() re-pointed off q_a_pairs.question_embedding
-- (DROPPED by 20260706120000_id131_drop_inline_vector_cols.sql, APPLIED to
-- staging) onto public.record_embeddings (owner_kind='q_a_pair').
--
-- Context: the {131.11} M5 search redesign (20260702120000_id131_search_rpcs.sql)
-- re-pointed hybrid_search / search_content_chunks / check_content_exists /
-- get_popular_keywords onto record_embeddings, but never redefined these three
-- functions — their bodies are STILL the original squash-baseline
-- (20260617130000_squash_baseline.sql) SQL, which reads qap.question_embedding
-- directly. Grepped every migration for each function name: squash baseline is
-- confirmed the LATEST (never-redefined) body for all three. With the column
-- dropped on staging, every call now errors ("column q_a_pairs.question_embedding
-- does not exist") — flagged by the prior {131.19} executor and left as
-- documented "KNOWN GAP" comments in the 5 affected integration test files
-- (see the comment-only touch-ups at the foot of this Subtask's diff).
--
-- Fix: re-point every question_embedding read onto record_embeddings, mirroring
-- 20260702120000_id131_search_rpcs.sql's exact idiom —
--   * embedding_model CONSTANT text := 'text-embedding-3-large' (plpgsql fns;
--     the LANGUAGE sql promotion-candidates fn has no DECLARE block, so the
--     literal is inlined directly — same literal, no DECLARE support in SQL
--     functions).
--   * JOIN/EXISTS on record_embeddings re ON re.owner_kind = 'q_a_pair' AND
--     re.owner_id = <q_a_pairs.id> AND re.model = embedding_model.
--   * `qap.question_embedding IS NULL` (no embedding yet) -> NOT EXISTS on the
--     record_embeddings row (q_a_extractions_promotion_candidates).
--   * `qap.question_embedding IS NOT NULL` (eligibility filter) -> INNER JOIN
--     record_embeddings (q_a_search, question_match_recompute) — a row is
--     only produced when a matching (owner_kind, owner_id, model) embedding
--     exists, same as hybrid_search's q_a_pair arm.
--   * cosine-distance expressions read re.embedding instead of
--     qap.question_embedding.
--
-- CREATE OR REPLACE only — NO signature changes (params/return TABLE shape
-- identical to the squash baseline), so:
--   * api.q_a_extractions_promotion_candidates / api.q_a_search /
--     api.question_match_recompute (thin `SELECT * FROM public.fn(...)` string
--     bodies, squash baseline lines 962-1003) need NO regen — same exact-arity
--     call resolves to the same overload.
--   * scripts/generate-api-views.ts SURFACE_RPCS
--     ('q_a_extractions_promotion_candidates') / EXTRA_DEFINER_RPCS
--     ('q_a_search', 'question_match_recompute') entries are unaffected — no
--     wrapper regen needed; confirmed by inspection, no edit made here.
--
-- Grants/search_path/SECURITY posture preserved IDENTICAL to the squash
-- baseline for all three: q_a_extractions_promotion_candidates keeps its
-- REVOKE-ALL-FROM-PUBLIC + GRANT-TO-authenticated/service_role (squash
-- baseline lines 12795-12797); q_a_search and question_match_recompute keep
-- their squash-baseline default privilege posture (no REVOKE/GRANT statement
-- existed for either in the baseline — none is added here, so PUBLIC EXECUTE
-- stays exactly as before; tightening it now would be an out-of-scope
-- security-posture change, not this fix). LANGUAGE/STABLE/SECURITY DEFINER
-- flags unchanged per function.
--
-- AUTHORED, NOT APPLIED by this Subtask — no `supabase db push`, no MCP
-- `apply_migration`, no types regen. Owner-gated apply lands later in the
-- {131.19} GO sequence, sequenced AFTER 20260706160000_bl398_governance_
-- tombstone_filter.sql.
--
-- UK English throughout (DD/MM/YYYY). Authored 06/07/2026.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. q_a_extractions_promotion_candidates() — latest body:
--    supabase/migrations/20260617130000_squash_baseline.sql:4148-4161.
--    `p.question_embedding IS NULL` (promoted pair has no embedding yet) ->
--    NOT EXISTS on record_embeddings. Return shape UNCHANGED
--    (SETOF q_a_extractions). LANGUAGE sql STABLE preserved (no DECLARE
--    support in SQL-language functions — the model literal is inlined).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."q_a_extractions_promotion_candidates"() RETURNS SETOF "public"."q_a_extractions"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT e.*
  FROM public.q_a_extractions e
  LEFT JOIN public.q_a_pairs p ON p.id = e.promoted_to_pair_id
  WHERE e.invalidated_at IS NULL
    AND (
      e.promoted_to_pair_id IS NULL
      OR (
        p.id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.record_embeddings re
          WHERE re.owner_kind = 'q_a_pair'
            AND re.owner_id = p.id
            AND re.model = 'text-embedding-3-large'
        )
      )
    )
  ORDER BY e.created_at;
$$;

ALTER FUNCTION "public"."q_a_extractions_promotion_candidates"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."q_a_extractions_promotion_candidates"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."q_a_extractions_promotion_candidates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."q_a_extractions_promotion_candidates"() TO "service_role";

COMMENT ON FUNCTION "public"."q_a_extractions_promotion_candidates"() IS 'ID-131.19 (S450 GO tail #3): re-pointed off the dropped q_a_pairs.question_embedding column onto record_embeddings (owner_kind=''q_a_pair''). ''p.question_embedding IS NULL'' becomes NOT EXISTS on the record_embeddings row. Return shape (SETOF q_a_extractions) and signature unchanged.';

-- ---------------------------------------------------------------------------
-- 2. q_a_search(p_query, p_query_embedding, p_limit) — latest body:
--    supabase/migrations/20260617130000_squash_baseline.sql:4270-4318.
--    Cosine-distance expression + the `qap.question_embedding IS NOT NULL`
--    eligibility filter both re-point onto record_embeddings, mirroring
--    hybrid_search's q_a_pair arm (20260702120000_id131_search_rpcs.sql:265-268).
--    Return shape UNCHANGED (pair_id, question_text_preview,
--    answer_standard_preview, embedding_score, fulltext_score, scope_tag,
--    publication_status). LANGUAGE plpgsql STABLE SECURITY DEFINER preserved.
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
      -- inline question_embedding column was dropped (ID-131.19).
      (1.0 - (re.embedding <=> p_query_embedding))::numeric(5,4)           AS embedding_score,
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

COMMENT ON FUNCTION "public"."q_a_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer) IS 'T6 WP2 — PLAN.md §4.6 sub-task 4. Two-step retrieval Step 1: ranked preview list. Returns embedding_score + fulltext_score as SEPARATE columns per N9 RESOLVED-S236 (05-qa-flow.md §7.3). Scope filtering is caller-side (scope_tag pass-through). Internal ORDER BY uses weighted blend embedding*0.6 + fulltext*0.4 but that blend is NOT returned — callers see raw scores and apply own blend/display policy. ID-131.19 (S450 GO tail #3): vector read re-pointed off the dropped q_a_pairs.question_embedding column onto record_embeddings (owner_kind=''q_a_pair''); eligibility filter re-expressed as an INNER JOIN. Signature and return shape unchanged.';

-- ---------------------------------------------------------------------------
-- 3. question_match_recompute(...) — latest body:
--    supabase/migrations/20260617130000_squash_baseline.sql:4328-4377.
--    Same re-point as q_a_search: cosine-distance expression + the B6
--    `qap.question_embedding IS NOT NULL` eligibility filter both move onto
--    record_embeddings. Return shape UNCHANGED (integer count of upserted
--    question_matches rows). LANGUAGE plpgsql SECURITY DEFINER preserved.
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
      (1.0 - (re.embedding <=> p_query_embedding))::numeric(5,4) AS embedding_score,
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

COMMENT ON FUNCTION "public"."question_match_recompute"("p_form_question_id" "uuid", "p_query" "text", "p_query_embedding" "extensions"."vector", "p_question_kind" "text", "p_scope_tag" "text"[], "p_anti_scope_tag" "text"[], "p_limit" integer) IS 'ID-131.19 (S450 GO tail #3): vector read + B6 eligibility filter re-pointed off the dropped q_a_pairs.question_embedding column onto record_embeddings (owner_kind=''q_a_pair''), mirroring q_a_search. Signature and return shape (integer upsert count) unchanged.';

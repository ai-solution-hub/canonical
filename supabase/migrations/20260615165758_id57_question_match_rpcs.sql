-- =============================================================================
-- ID-57 {57.6}/{57.7} T10 WP2 — question_match RPCs (writer + reader)
-- =============================================================================
-- Spec: specs/id-57-question-matches-retrieval/TECH.md §E (writer) + §C (reader).
-- Writer: question_match_recompute (VOLATILE) — owns the live scoring (cosine +
--   ts_rank(.,2)) over the scope/publication/embedding-eligible corpus, materialises
--   top-N candidate rows into question_matches via INSERT .. ON CONFLICT upsert.
-- Reader: question_match_search (STABLE, appended by {57.7}) — reads materialised rows.
-- Both follow RLS-PATTERN P-4: OWNER postgres, SET search_path = public, extensions,
--   explicit REVOKE anon, GRANT authenticated/service_role.
-- `extensions.vector` (schema-qualified) in signatures: the db push login role's search_path excludes the extensions schema, so bare `vector` fails 42704 at parse time (ops43 20260502143049:71-77 documents this).
-- ts_rank flag 2 is the bl-76 default ({57.8} calibration DEFERRED post-cutover).
--
-- Apply log:
--   * (pending) — applied to staging (turayklvaunphgbgscat) via supabase db push at
--     {57.7} (single combined apply for both RPCs). PROD push GATED — parent sequences
--     env promotion. NOT applied to prod here.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.question_match_recompute(
  p_form_question_id uuid,
  p_query            text,
  p_query_embedding  extensions.vector(1024),
  p_question_kind    text,
  p_scope_tag        text[],          -- caller-resolved workspace scope (B5)
  p_anti_scope_tag   text[],
  p_limit            integer DEFAULT 20
)
RETURNS integer          -- count of candidate rows materialised
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH scored AS (
    -- The live scoring expression (mirrors q_a_search verbatim). This is the ONLY place
    -- re-scoring happens; the reader (question_match_search) consumes the stored result.
    SELECT
      qap.id AS q_a_pair_id,
      (1.0 - (qap.question_embedding <=> p_query_embedding))::numeric(5,4) AS embedding_score,
      ts_rank(
        to_tsvector('english',
          qap.question_text || ' ' || COALESCE(qap.answer_standard, '') || ' ' ||
          array_to_string(qap.alternate_question_phrasings, ' ')),
        plainto_tsquery('english', p_query),
        2  -- bl-76 calibration anchor (F1/D3); changing the flag never alters the table (F3)
      )::numeric(5,4) AS fulltext_score
    FROM public.q_a_pairs qap
    WHERE qap.question_embedding IS NOT NULL        -- B6 embedding-eligibility
      AND qap.publication_status = 'published'      -- B6 publication gate
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

ALTER FUNCTION public.question_match_recompute(uuid, text, extensions.vector, text, text[], text[], integer)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION
  public.question_match_recompute(uuid, text, extensions.vector, text, text[], text[], integer) FROM anon;
GRANT  EXECUTE ON FUNCTION
  public.question_match_recompute(uuid, text, extensions.vector, text, text[], text[], integer)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Reader: question_match_search (STABLE) — {57.7}. Reads the MATERIALISED candidate
-- edges for a form-question, returns the STORED per-method scores (no re-scoring),
-- re-checks publication at read (no stale surfacing), ranks by the 0.6/0.4 blend over
-- stored scores with a deterministic q_a_pair_id tie-break.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.question_match_search(
  p_form_question_id uuid,
  p_question_kind    text    DEFAULT NULL,   -- optional kind filter (PRODUCT A6/B4)
  p_limit            integer DEFAULT 20      -- C4, mirrors q_a_search p_limit DEFAULT 20
)
RETURNS TABLE (
  q_a_pair_id               uuid,
  question_text_preview     text,
  answer_standard_preview   text,
  embedding_score           numeric(5,4),
  fulltext_score            numeric(5,4),
  scope_tag                 text[],
  publication_status        text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  -- Reads the MATERIALISED candidate edges for this form-question (05-qa-flow.md §7.2:
  -- question_matches RECORDS the ranked candidates). Returns the STORED per-method scores;
  -- no live re-scoring. The join to q_a_pairs supplies preview + pass-through columns only.
  SELECT
    qm.q_a_pair_id,
    LEFT(qap.question_text, 200)                 AS question_text_preview,
    LEFT(COALESCE(qap.answer_standard, ''), 200) AS answer_standard_preview,
    qm.embedding_score,                          -- STORED score (set by the writer, §E)
    qm.fulltext_score,                           -- STORED score (set by the writer, §E)
    qap.scope_tag,
    qap.publication_status
  FROM public.question_matches qm
  JOIN public.q_a_pairs qap ON qap.id = qm.q_a_pair_id
  WHERE qm.form_question_id = p_form_question_id                 -- C1: candidates FOR this fq
    AND (p_question_kind IS NULL OR qm.question_kind = p_question_kind)
    AND qap.publication_status = 'published'      -- B6 re-checked at read (no stale surfacing)
  -- D4 default ranking/blend over the STORED scores; C3 deterministic tie-break.
  ORDER BY (COALESCE(qm.embedding_score, 0) * 0.6 + COALESCE(qm.fulltext_score, 0) * 0.4) DESC,
           qm.q_a_pair_id
  LIMIT p_limit;
END;
$$;

ALTER FUNCTION public.question_match_search(uuid, text, integer) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.question_match_search(uuid, text, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.question_match_search(uuid, text, integer)
  TO authenticated, service_role;

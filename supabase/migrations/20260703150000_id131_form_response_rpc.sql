-- ID-131 {131.16} G-FORMS — search_for_form_response REWRITE (M5 forms slice).
-- TECH.md §Function disposition line 410 + §Proposed changes BI-29/BI-30/BI-31 +
-- §Testing BI-29-31 + §Risks #7. Own migration file (per {131.16} details) to
-- avoid collision with the dedup/freshness/search M5 slices already landed
-- (id131_search_rpcs.sql, id131_cite_ext_winrate_fix.sql).
--
-- Forms matching moves OFF the retiring content_items god-table onto:
--   * q_a_pairs      (PRIMARY match source — the answer grain).
--   * reference_items (OPTIONAL match source — external evidence grain).
--   * source_documents is explicitly EXCLUDED as a match arm (D2/E5 — SD has
--     no embedding/answer-grain; it is provenance-only, never a match
--     source). This mirrors hybrid_search's Arm-1 comment but the FORMS RPC
--     does not carry a text-only SD arm at all — TECH line 410/613 scope the
--     forms match set to q_a_pairs (primary) + reference_items (optional).
--
-- Vector reads come from record_embeddings (owner_kind/owner_id/model), NOT an
-- inline column (BI-17 EMB-STORE, already shipped — {131.6}/{131.11}).
--
-- Weighting: the ORIGINAL formula (80% vector + 10% title-match + 10%
-- keyword-ish match, win-rate multiplicative boost) is preserved STRUCTURALLY
-- — this is a re-point, not a re-tune (BI-31 defers numeric recalibration to
-- a real-corpus walk; see the TS-side template-coverage.ts change in the same
-- {131.16} commit). Each term is mapped to its closest schema analogue:
--   * q_a_pairs has no `ai_keywords` array (that was a content_items-only
--     col) — the closest structural analogue is `alternate_question_phrasings`
--     text[], already carried by q_a_pairs for exactly this "alternate way of
--     asking" purpose, so the 10% keyword-slot re-points there instead of
--     being invented anew.
--   * reference_items has no keyword array either — title + summary ILIKE
--     fills the same two 10% slots, mirroring hybrid_search's Arm 4 shape.
--
-- Win-rate boost: reused VERBATIM from the shipped q_a_pair-anchored win_stats
-- CTE (id131_cite_ext_winrate_fix.sql / id131_search_rpcs.sql hybrid_search
-- Arm 3) — cited_kind='q_a_pair', form_outcome_types.counts_toward_win_rate
-- denominator (BI-25/26 single canonical outcome source). The answer-first
-- ×1.1 profile boost is baked in unconditionally (this RPC IS the forms/
-- procurement context — no application_type param needed, unlike the general
-- hybrid_search which serves multiple app surfaces).
--
-- Return shape changes (content_items-shaped -> typed-record-shaped): the sole
-- live TS caller (app/api/procurement/[id]/questions/match/route.ts:131) only
-- reads id/similarity/title/content_type (types/MatchResult, lib/ai/match.ts)
-- — content/summary are included for parity with the sibling search RPCs and
-- because match/route.ts's downstream drafting consumers now separately fetch
-- full content via lib/domains/procurement/draft-response.ts
-- (fetchMatchedContentForDrafting), so this RPC's content/summary columns are
-- a convenience, not a hard dependency.
--
-- Signature-changing (return TABLE column set differs) -> DROP + CREATE, not
-- CREATE OR REPLACE (which cannot change a function's output column set).
--
-- api consequence: regen api.search_for_form_response (G-API {131.19}); the
-- api wrapper (string-body SQL `SELECT * FROM public.search_for_form_response(...)`)
-- goes STALE the moment this DROP+CREATE lands, matching the precedent already
-- accepted for hybrid_search / search_content_chunks in id131_search_rpcs.sql
-- — never hand-edit api.*.
--
-- HARD GATE: this migration is AUTHORED, NOT APPLIED, in {131.16} (files-only,
-- zero DDL apply — staging is a branch of prod). Apply + regenerate types at
-- GO, alongside rebinding __tests__/integration/supersession-filter.integration.test.ts
-- (currently seeds content_items; needs re-seeding onto q_a_pairs/reference_items
-- post-apply — same pattern as the {131.11} M5 GO cycle's test-rebind commits).

DROP FUNCTION IF EXISTS "public"."search_for_form_response"("extensions"."vector", "text", integer, boolean, character varying);

CREATE FUNCTION "public"."search_for_form_response"("query_embedding" "extensions"."vector", "query_text" "text" DEFAULT ''::"text", "limit_count" integer DEFAULT 10, "include_superseded" boolean DEFAULT false, "visibility_filter" character varying DEFAULT 'default'::character varying) RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "content_type" "text", "summary" "text", "similarity" numeric)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  win_boost CONSTANT numeric := 0.03;
  min_win_citations CONSTANT integer := 2;
  -- Preserves the pre-rewrite hardcoded floor (original: `> 0.25`, no param —
  -- match/route.ts never passed a threshold, so this stays a DECLARE, not a
  -- new signature param, to keep the call site unchanged).
  similarity_floor CONSTANT numeric := 0.25;
  embedding_model CONSTANT text := 'text-embedding-3-large';
  -- Answer-first profile boost, baked in (this RPC IS the forms/procurement
  -- context) — mirrors hybrid_search's 'procurement' application_type profile.
  qa_profile_boost CONSTANT numeric := 1.1;
BEGIN
  RETURN QUERY
  WITH win_stats AS (
    -- Verbatim re-use of the shipped q_a_pair-anchored win signal (BI-25/26):
    -- single canonical outcome source form_outcome_types.counts_toward_win_rate.
    SELECT cc.cited_q_a_pair_id AS q_a_pair_id,
      COUNT(DISTINCT cc.citing_form_response_id)::integer AS total_citations,
      COUNT(DISTINCT cc.citing_form_response_id) FILTER (
        WHERE fot.counts_toward_win_rate = true AND ft.outcome = 'won'
      )::numeric / NULLIF(
        COUNT(DISTINCT cc.citing_form_response_id) FILTER (WHERE fot.counts_toward_win_rate = true),
        0
      ) AS win_rate
    FROM public.citations cc
    JOIN form_responses br ON br.id = cc.citing_form_response_id
    JOIN form_questions fq ON fq.id = br.question_id
    JOIN form_templates ft ON ft.id = fq.form_template_id
    LEFT JOIN form_outcome_types fot ON fot.key = ft.outcome
    WHERE cc.cited_kind = 'q_a_pair'
    GROUP BY cc.cited_q_a_pair_id
  ),
  arms AS (
    -- ---- Arm 1: q_a_pairs — PRIMARY match source (BI-29).
    SELECT
      qa.id AS "id",
      qa.question_text AS "title",
      (
        'Q: ' || qa.question_text
        || E'\n\n' || qa.answer_standard
        || COALESCE(E'\n\n' || qa.answer_advanced, '')
      ) AS "content",
      'q_a_pair'::text AS "content_type",
      substring(qa.answer_standard FROM 1 FOR 300) AS "summary",
      LEAST(1.0, (
          (1 - (re.embedding <=> query_embedding)) * 0.80
        + CASE WHEN query_text <> '' AND qa.question_text ILIKE '%' || query_text || '%' THEN 0.10 ELSE 0.0 END
        + CASE WHEN query_text <> '' AND EXISTS (
                 SELECT 1 FROM unnest(qa.alternate_question_phrasings) AS phr
                 WHERE phr ILIKE '%' || query_text || '%'
               ) THEN 0.10 ELSE 0.0 END
        )
        * qa_profile_boost
        * CASE WHEN COALESCE(ws.total_citations, 0) >= min_win_citations
               THEN (1.0 + win_boost * COALESCE(ws.win_rate, 0.0))
               ELSE 1.0 END
      )::NUMERIC(4, 3) AS "similarity"
    FROM q_a_pairs qa
    JOIN record_embeddings re ON re.owner_kind = 'q_a_pair' AND re.owner_id = qa.id AND re.model = embedding_model
    LEFT JOIN win_stats ws ON ws.q_a_pair_id = qa.id
    WHERE re.embedding IS NOT NULL
      AND (1 - (re.embedding <=> query_embedding)) > similarity_floor
      AND (include_superseded OR (qa.superseded_by IS NULL AND (qa.valid_to IS NULL OR qa.valid_to > now())))
      AND CASE visibility_filter
            WHEN 'default' THEN qa.publication_status = 'published'
            WHEN 'all' THEN qa.publication_status <> 'archived'
            WHEN 'admin' THEN TRUE
            ELSE qa.publication_status = 'published'
          END

    UNION ALL

    -- ---- Arm 2: reference_items — OPTIONAL match source (BI-29). No
    -- win-rate boost (BI-26: the win signal is q_a_pair-only, matching the
    -- hybrid_search Arm 4 precedent) and no publication_status (reference_items
    -- is a global, always-visible evidence layer — only superseded_by gates).
    SELECT
      ri.id AS "id",
      ri.title AS "title",
      ri.body AS "content",
      'reference_item'::text AS "content_type",
      ri.summary AS "summary",
      LEAST(1.0, (
          (1 - (re.embedding <=> query_embedding)) * 0.80
        + CASE WHEN query_text <> '' AND ri.title ILIKE '%' || query_text || '%' THEN 0.10 ELSE 0.0 END
        + CASE WHEN query_text <> '' AND ri.summary ILIKE '%' || query_text || '%' THEN 0.10 ELSE 0.0 END
      ))::NUMERIC(4, 3) AS "similarity"
    FROM reference_items ri
    JOIN record_embeddings re ON re.owner_kind = 'reference_item' AND re.owner_id = ri.id AND re.model = embedding_model
    WHERE re.embedding IS NOT NULL
      AND (1 - (re.embedding <=> query_embedding)) > similarity_floor
      AND (include_superseded OR ri.superseded_by IS NULL)
  )
  SELECT arms.id, arms.title, arms.content, arms.content_type, arms.summary, arms.similarity
  FROM arms
  ORDER BY arms.similarity DESC
  LIMIT limit_count;
END;
$$;

ALTER FUNCTION "public"."search_for_form_response"("query_embedding" "extensions"."vector", "query_text" "text", "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying) OWNER TO "postgres";

-- Fail-closed grant posture (matches the M1a/M1b + {131.11} sibling RPCs):
-- REVOKE ALL FROM PUBLIC then explicit GRANTs — no anon (forms matching is an
-- authenticated admin/editor-only flow, per match/route.ts's role gate).
REVOKE ALL ON FUNCTION "public"."search_for_form_response"("query_embedding" "extensions"."vector", "query_text" "text", "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_for_form_response"("query_embedding" "extensions"."vector", "query_text" "text", "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_for_form_response"("query_embedding" "extensions"."vector", "query_text" "text", "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying) TO "service_role";

COMMENT ON FUNCTION "public"."search_for_form_response"("query_embedding" "extensions"."vector", "query_text" "text", "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying) IS 'ID-131.16 (G-FORMS, BI-29/30/31): forms matching re-pointed off content_items onto q_a_pairs (primary, answer-first x1.1 profile + q_a_pair-only win_stats boost, BI-26) + reference_items (optional, no boost). source_documents excluded (D2/E5 — provenance-only, not a match source). Vector reads from record_embeddings (BI-17). Weighting formula (80% vector / 10% title / 10% keyword-analogue) preserved structurally from the pre-rewrite content_items version; 0.25 similarity floor preserved as a DECLARE constant (no new param). Caller app/api/procurement/[id]/questions/match/route.ts:131.';

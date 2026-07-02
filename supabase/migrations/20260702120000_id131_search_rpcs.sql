-- ID-131 {131.11} G-SEARCH — M5 (Slice B): search / exist-check / keyword RPCs
-- re-homed off the (soon-dropped) content_items god-table onto the typed
-- L-records substrate (source_documents / content_chunks / q_a_pairs /
-- reference_items) + the record_lifecycle facet + the record_embeddings store.
--
-- Governing note: `.user-scratch/okf-search-sourcing-design-v1.md` §9
-- (owner-ratified S428) SUPERSEDES the ledger `details` and TECH.md where they
-- conflict. TECH.md §"Migration set" row M5, §"hybrid_search polymorphic UNION",
-- §"Function disposition". British English throughout (DD/MM/YYYY).
--
-- Applies (per §9 / TECH):
--   * hybrid_search      → 4-arm polymorphic UNION over record_embeddings, with
--                          per-application_type ranking PROFILE (one profile now:
--                          procurement = answer-first ×1.1 on the q_a_pair arm).
--   * search_content_chunks → re-point JOIN content_items → source_documents,
--                          governance filters → record_lifecycle, vector read →
--                          record_embeddings; filter/return content_item_id →
--                          source_document_id (SIGNATURE CHANGE).
--   * check_content_exists → exist-check across the typed record tables.
--   * get_popular_keywords → over source_documents.ai_keywords.
--   * find_related_items  → DROP ENTIRELY (§9 §7.4 — no surviving caller).
--   * filter_by_keywords  → DROP BOTH variants (§9 §7.5 — redundant with the
--                          hybrid_search keyword leg).
--
-- Embedding reads: every vector term reads public.record_embeddings
-- (owner_kind, owner_id, model = 'text-embedding-3-large'); NO inline vector
-- column is read. The inline vector columns are dropped by the SEPARATE terminal
-- migration 20260702120001_id131_drop_inline_vector_cols.sql, sequenced by the
-- parent at/after M6/G-API once every re-point across id-131 has landed.
--
-- Grants: every (re)created function follows the peer-standard secure pattern
-- REVOKE ALL … FROM PUBLIC; GRANT … TO authenticated, service_role. NOTE: a bare
-- "REVOKE EXECUTE … FROM anon" is a Postgres no-op while PUBLIC holds EXECUTE
-- (anon inherits the PUBLIC grant), so the effective anon-deny is REVOKE-FROM-
-- PUBLIC + explicit GRANTs — the idiom already live on the peer RPCs
-- (check_content_exists, get_popular_keywords, filter_by_keywords, …).
--
-- Safe-today basis: every re-home below is over empty/disposable rows once the
-- pre-M2 debris-wipe + full-replace re-ingest run (BI-1/BI-2). api wrapper
-- rebuilds (SURFACE_RPCS edits + api.* DROP/CREATE) are G-API's ({131.19}) job.

-- ============================================================================
-- 1a. public.hybrid_search — polymorphic 4-arm UNION (Slice B, BI-27/28).
--
-- Signature change: trailing optional param `application_type text DEFAULT
-- 'procurement'` selects the ranking PROFILE (§9 §7.1/7.2). The old 6-arg
-- overload (which single-scanned content_items) is DROPPED so a 6-arg call can
-- never resolve to it (an added-default overload would otherwise shadow-linger
-- and win the exact-arity match). api.hybrid_search is a string-body SQL wrapper
-- with no pg_depend on the public fn, so this DROP is dependency-safe; G-API
-- rebuilds the wrapper (threading workspace_id → application_type).
--
-- Body = UNION ALL across FOUR arms (source_documents, content_chunks→SD,
-- q_a_pairs, reference_items), each emitting all 21 return cols; content_chunk
-- hits COLLAPSE to their source_document identity (§8 settled item) and are
-- de-duplicated by provenance (one underlying SD = one hit; higher similarity
-- kept). Per-grain normalised weighted similarity; the q_a_pair arm alone
-- receives the answer-first profile boost AND the win_stats boost (q_a_pair-only
-- win signal — BI-26). The 6 IMS-vestige cols (platform, author_name,
-- source_domain, thumbnail_url, priority) are NULL on ALL arms (BI-28 explicit
-- drift — no typed home; do not fabricate).
-- ============================================================================
DROP FUNCTION IF EXISTS "public"."hybrid_search"("extensions"."vector", "text", numeric, integer, boolean, character varying);

CREATE FUNCTION "public"."hybrid_search"("query_embedding" "extensions"."vector", "query_text" "text" DEFAULT ''::"text", "similarity_threshold" numeric DEFAULT 0.3, "limit_count" integer DEFAULT 10, "include_superseded" boolean DEFAULT false, "visibility_filter" character varying DEFAULT 'default'::character varying, "application_type" "text" DEFAULT 'procurement'::"text") RETURNS TABLE("id" "uuid", "title" "text", "suggested_title" "text", "summary" "text", "primary_domain" "text", "primary_subtopic" "text", "content_type" "text", "platform" "text", "author_name" "text", "source_domain" "text", "thumbnail_url" "text", "captured_date" timestamp with time zone, "ai_keywords" "text"[], "classification_confidence" numeric, "priority" "text", "metadata" "jsonb", "similarity" numeric, "snippet" "text", "created_by" "uuid", "verified_at" timestamp with time zone, "verified_by" "uuid")
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  win_boost CONSTANT numeric := 0.03;
  min_win_citations CONSTANT integer := 2;
  embedding_model CONSTANT text := 'text-embedding-3-large';
  qa_profile_boost numeric;
BEGIN
  -- Ranking PROFILE selection by application_type (§9 §7.1/7.2, owner-ratified).
  -- Ship ONE profile now: 'procurement' applies an answer-first bounded boost
  -- (×1.1) to the q_a_pair arm's per-grain-normalised similarity — mirroring the
  -- win_stats ×1.03 multiplicative idiom (a bounded post-normalisation lever, NOT
  -- categorical priority). SI (reference-first) / sales-proposal (document-first)
  -- profiles add further WHEN branches here later (no calibration corpus yet).
  qa_profile_boost := CASE application_type
    WHEN 'procurement' THEN 1.1
    ELSE 1.0
  END;

  RETURN QUERY
  WITH win_stats AS (
    -- ID-131.10 Slice A (BI-25/BI-26): the win signal is now Q&A-anchored and sources
    -- win/loss from the single canonical source form_outcome_types.counts_toward_win_rate
    -- (the retired workspaces JSON outcome path is gone — no workspaces join). The output
    -- column is STILL aliased content_item_id purely so the unchanged body join below
    -- (LEFT JOIN win_stats ws ON ws.content_item_id = ci.id, where ci scans
    -- content_items) stays VALID — Slice B (M5 / ID-131.11) re-homes the body onto a
    -- polymorphic q_a_pair-aware UNION, at which point the join becomes meaningful.
    -- Until then this column holds cited_q_a_pair_id values, which never equal a
    -- content_items.id, so content_items receive NO win boost — intended: the win
    -- signal is a q_a_pair-only signal (BI-26); non-q_a_pair arms get no boost.
    SELECT cc.cited_q_a_pair_id AS content_item_id,
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
    -- ---- Arm 1: source_documents (PROVENANCE anchor; TEXT-ONLY match — BI-29).
    -- SD carries no embedding row in record_embeddings, so this arm contributes
    -- only on a query_text signal (title/filename/keyword/summary ILIKE); its
    -- similarity is a text-only score, no vector term. include_superseded is a
    -- no-op here (SD has no superseded_by; supersession is the parent_id/version
    -- chain; visibility_filter gates publication_status, M3 inline-hot col).
    SELECT
      sd.id AS "id",
      sd.filename AS "title",
      sd.suggested_title AS "suggested_title",
      sd.summary AS "summary",
      sd.primary_domain::text AS "primary_domain",
      sd.primary_subtopic::text AS "primary_subtopic",
      sd.content_type::text AS "content_type",
      NULL::text AS "platform",
      NULL::text AS "author_name",
      NULL::text AS "source_domain",
      NULL::text AS "thumbnail_url",
      sd.captured_date AS "captured_date",
      sd.ai_keywords AS "ai_keywords",
      sd.classification_confidence AS "classification_confidence",
      NULL::text AS "priority",
      NULL::jsonb AS "metadata",
      LEAST(1.0, (
          CASE WHEN query_text <> '' AND sd.suggested_title ILIKE '%' || query_text || '%' THEN 0.60
               WHEN query_text <> '' AND sd.filename ILIKE '%' || query_text || '%' THEN 0.55
               ELSE 0.0 END
        + CASE WHEN query_text <> '' AND query_text = ANY(sd.ai_keywords) THEN 0.25
               WHEN query_text <> '' AND EXISTS (SELECT 1 FROM unnest(sd.ai_keywords) AS kw WHERE kw ILIKE '%' || query_text || '%') THEN 0.15
               ELSE 0.0 END
        + CASE WHEN query_text <> '' AND sd.summary ILIKE '%' || query_text || '%' THEN 0.15 ELSE 0.0 END
      ))::NUMERIC(4, 3) AS "similarity",
      CASE WHEN query_text <> '' AND sd.summary IS NOT NULL
                AND position(lower(query_text) IN lower(sd.summary)) > 0
           THEN substring(sd.summary FROM greatest(1, position(lower(query_text) IN lower(sd.summary)) - 80) FOR 200)
           ELSE NULL END AS "snippet",
      sd.uploaded_by AS "created_by",
      rl.verified_at AS "verified_at",
      rl.verified_by AS "verified_by"
    FROM source_documents sd
    LEFT JOIN record_lifecycle rl ON rl.owner_kind = 'source_document' AND rl.owner_id = sd.id
    WHERE COALESCE(query_text, '') <> ''
      AND (
           sd.suggested_title ILIKE '%' || query_text || '%'
        OR sd.filename ILIKE '%' || query_text || '%'
        OR sd.summary ILIKE '%' || query_text || '%'
        OR EXISTS (SELECT 1 FROM unnest(sd.ai_keywords) AS kw WHERE kw ILIKE '%' || query_text || '%')
      )
      AND CASE visibility_filter
            WHEN 'default' THEN sd.publication_status = 'published'
            WHEN 'all' THEN sd.publication_status <> 'archived'
            WHEN 'admin' THEN TRUE
            ELSE sd.publication_status = 'published'
          END

    UNION ALL

    -- ---- Arm 2: content_chunks — VERBATIM passage grain, COLLAPSED to its
    -- source_document identity (returns sd.id, NOT cc.id — §8 settled item, for
    -- citation + the two-step get). Vector read from record_embeddings
    -- (owner_kind='content_chunk'). Chunk inherits the parent SD publication_status
    -- for visibility; governance/verified via the parent SD facet.
    SELECT
      cc.source_document_id AS "id",
      (sd.filename || ' — ' || COALESCE(cc.heading_text, '')) AS "title",
      NULL::text AS "suggested_title",
      substring(cc.content FROM 1 FOR 300) AS "summary",
      sd.primary_domain::text AS "primary_domain",
      sd.primary_subtopic::text AS "primary_subtopic",
      'content_chunk'::text AS "content_type",
      NULL::text AS "platform",
      NULL::text AS "author_name",
      NULL::text AS "source_domain",
      NULL::text AS "thumbnail_url",
      sd.captured_date AS "captured_date",
      sd.ai_keywords AS "ai_keywords",
      sd.classification_confidence AS "classification_confidence",
      NULL::text AS "priority",
      NULL::jsonb AS "metadata",
      LEAST(1.0, (
          (1 - (re.embedding <=> query_embedding)) * 0.70
        + CASE WHEN query_text <> '' AND cc.heading_text ILIKE '%' || query_text || '%' THEN 0.15 ELSE 0.0 END
        + CASE WHEN query_text <> '' AND cc.content ILIKE '%' || query_text || '%' THEN 0.05 ELSE 0.0 END
      ))::NUMERIC(4, 3) AS "similarity",
      CASE WHEN query_text <> '' AND position(lower(query_text) IN lower(cc.content)) > 0
           THEN substring(cc.content FROM greatest(1, position(lower(query_text) IN lower(cc.content)) - 80) FOR 200)
           ELSE substring(cc.content FROM 1 FOR 200) END AS "snippet",
      sd.uploaded_by AS "created_by",
      rl.verified_at AS "verified_at",
      rl.verified_by AS "verified_by"
    FROM content_chunks cc
    JOIN source_documents sd ON sd.id = cc.source_document_id
    JOIN record_embeddings re ON re.owner_kind = 'content_chunk' AND re.owner_id = cc.id AND re.model = embedding_model
    LEFT JOIN record_lifecycle rl ON rl.owner_kind = 'source_document' AND rl.owner_id = sd.id
    WHERE re.embedding IS NOT NULL
      AND CASE visibility_filter
            WHEN 'default' THEN sd.publication_status = 'published'
            WHEN 'all' THEN sd.publication_status <> 'archived'
            WHEN 'admin' THEN TRUE
            ELSE sd.publication_status = 'published'
          END
      AND (
        (1 - (re.embedding <=> query_embedding)) > similarity_threshold
        OR (query_text <> '' AND (
             cc.heading_text ILIKE '%' || query_text || '%'
          OR cc.content ILIKE '%' || query_text || '%'
        ))
      )

    UNION ALL

    -- ---- Arm 3: q_a_pairs — the PRIMARY answer grain. Gets the answer-first
    -- PROFILE boost (qa_profile_boost) AND the win_stats boost (q_a_pair-only win
    -- signal — BI-26). Domain from the record_lifecycle facet (q_a_pairs carry no
    -- primary_domain). valid_to is the hard hot boundary (BI-20) + superseded_by;
    -- both honoured by include_superseded.
    SELECT
      qa.id AS "id",
      qa.question_text AS "title",
      NULL::text AS "suggested_title",
      substring(qa.answer_standard FROM 1 FOR 300) AS "summary",
      COALESCE(rl.domain, 'unclassified')::text AS "primary_domain",
      NULL::text AS "primary_subtopic",
      'q_a_pair'::text AS "content_type",
      NULL::text AS "platform",
      NULL::text AS "author_name",
      NULL::text AS "source_domain",
      NULL::text AS "thumbnail_url",
      NULL::timestamp with time zone AS "captured_date",
      NULL::text[] AS "ai_keywords",
      NULL::numeric AS "classification_confidence",
      NULL::text AS "priority",
      NULL::jsonb AS "metadata",
      LEAST(1.0, (
          (1 - (re.embedding <=> query_embedding)) * 0.70
        + CASE WHEN query_text <> '' AND qa.question_text ILIKE '%' || query_text || '%' THEN 0.15 ELSE 0.0 END
        + CASE WHEN query_text <> '' AND qa.answer_standard ILIKE '%' || query_text || '%' THEN 0.05 ELSE 0.0 END
        )
        * qa_profile_boost
        * CASE WHEN COALESCE(ws.total_citations, 0) >= min_win_citations
               THEN (1.0 + win_boost * COALESCE(ws.win_rate, 0.0))
               ELSE 1.0 END
      )::NUMERIC(4, 3) AS "similarity",
      CASE WHEN query_text <> '' AND position(lower(query_text) IN lower(qa.answer_standard)) > 0
           THEN substring(qa.answer_standard FROM greatest(1, position(lower(query_text) IN lower(qa.answer_standard)) - 80) FOR 200)
           ELSE substring(qa.answer_standard FROM 1 FOR 200) END AS "snippet",
      NULL::uuid AS "created_by",
      rl.verified_at AS "verified_at",
      rl.verified_by AS "verified_by"
    FROM q_a_pairs qa
    JOIN record_embeddings re ON re.owner_kind = 'q_a_pair' AND re.owner_id = qa.id AND re.model = embedding_model
    LEFT JOIN record_lifecycle rl ON rl.owner_kind = 'q_a_pair' AND rl.owner_id = qa.id
    LEFT JOIN win_stats ws ON ws.content_item_id = qa.id
    WHERE re.embedding IS NOT NULL
      AND (include_superseded OR (qa.superseded_by IS NULL AND (qa.valid_to IS NULL OR qa.valid_to > now())))
      AND CASE visibility_filter
            WHEN 'default' THEN qa.publication_status = 'published'
            WHEN 'all' THEN qa.publication_status <> 'archived'
            WHEN 'admin' THEN TRUE
            ELSE qa.publication_status = 'published'
          END
      AND (
        (1 - (re.embedding <=> query_embedding)) > similarity_threshold
        OR (query_text <> '' AND (
             qa.question_text ILIKE '%' || query_text || '%'
          OR qa.answer_standard ILIKE '%' || query_text || '%'
        ))
      )

    UNION ALL

    -- ---- Arm 4: reference_items — external evidence grain. Vector read from
    -- record_embeddings (owner_kind='reference_item'). reference_items is EXCLUDED
    -- from the record_lifecycle facet (BI-19) so verified_at/by are NULL, and it
    -- carries NO publication_status (global evidence layer, always visible); only
    -- superseded_by (M3) gates visibility here.
    SELECT
      ri.id AS "id",
      ri.title AS "title",
      NULL::text AS "suggested_title",
      ri.summary AS "summary",
      ri.primary_domain::text AS "primary_domain",
      ri.primary_subtopic::text AS "primary_subtopic",
      'reference_item'::text AS "content_type",
      NULL::text AS "platform",
      NULL::text AS "author_name",
      NULL::text AS "source_domain",
      NULL::text AS "thumbnail_url",
      NULL::timestamp with time zone AS "captured_date",
      NULL::text[] AS "ai_keywords",
      NULL::numeric AS "classification_confidence",
      NULL::text AS "priority",
      NULL::jsonb AS "metadata",
      LEAST(1.0, (
          (1 - (re.embedding <=> query_embedding)) * 0.70
        + CASE WHEN query_text <> '' AND ri.title ILIKE '%' || query_text || '%' THEN 0.15 ELSE 0.0 END
        + CASE WHEN query_text <> '' AND ri.summary ILIKE '%' || query_text || '%' THEN 0.05 ELSE 0.0 END
      ))::NUMERIC(4, 3) AS "similarity",
      CASE WHEN query_text <> '' AND ri.summary IS NOT NULL
                AND position(lower(query_text) IN lower(ri.summary)) > 0
           THEN substring(ri.summary FROM greatest(1, position(lower(query_text) IN lower(ri.summary)) - 80) FOR 200)
           ELSE NULL END AS "snippet",
      NULL::uuid AS "created_by",
      NULL::timestamp with time zone AS "verified_at",
      NULL::uuid AS "verified_by"
    FROM reference_items ri
    JOIN record_embeddings re ON re.owner_kind = 'reference_item' AND re.owner_id = ri.id AND re.model = embedding_model
    WHERE re.embedding IS NOT NULL
      AND (include_superseded OR ri.superseded_by IS NULL)
      AND (
        (1 - (re.embedding <=> query_embedding)) > similarity_threshold
        OR (query_text <> '' AND (
             ri.title ILIKE '%' || query_text || '%'
          OR ri.summary ILIKE '%' || query_text || '%'
        ))
      )
  ),
  -- Provenance de-duplication: content_chunk arm and source_document arm can both
  -- resolve to the same SD id — collapse to one hit, keeping the higher similarity
  -- (§8: one underlying fact → one hit). DISTINCT ON keeps the first row per id
  -- under the ORDER BY id, similarity DESC.
  deduped AS (
    SELECT DISTINCT ON (arms.id) arms.*
    FROM arms
    ORDER BY arms.id, arms.similarity DESC
  )
  SELECT
    deduped.id, deduped.title, deduped.suggested_title, deduped.summary,
    deduped.primary_domain, deduped.primary_subtopic, deduped.content_type,
    deduped.platform, deduped.author_name, deduped.source_domain, deduped.thumbnail_url,
    deduped.captured_date, deduped.ai_keywords, deduped.classification_confidence,
    deduped.priority, deduped.metadata, deduped.similarity, deduped.snippet,
    deduped.created_by, deduped.verified_at, deduped.verified_by
  FROM deduped
  ORDER BY deduped.similarity DESC
  LIMIT limit_count;
END;
$$;

ALTER FUNCTION "public"."hybrid_search"("query_embedding" "extensions"."vector", "query_text" "text", "similarity_threshold" numeric, "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying, "application_type" "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."hybrid_search"("query_embedding" "extensions"."vector", "query_text" "text", "similarity_threshold" numeric, "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying, "application_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hybrid_search"("query_embedding" "extensions"."vector", "query_text" "text", "similarity_threshold" numeric, "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying, "application_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hybrid_search"("query_embedding" "extensions"."vector", "query_text" "text", "similarity_threshold" numeric, "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying, "application_type" "text") TO "service_role";

COMMENT ON FUNCTION "public"."hybrid_search"("query_embedding" "extensions"."vector", "query_text" "text", "similarity_threshold" numeric, "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying, "application_type" "text") IS 'ID-131.11 Slice B (M5, BI-27/28): grain-aware polymorphic search — UNION ALL over source_documents (text-only, no vector — BI-29), content_chunks (collapsed to source_document identity + provenance-deduped), q_a_pairs (primary answer grain; answer-first application_type profile boost + q_a_pair-only win_stats boost — BI-26), reference_items. No content_items scan. Vector reads from record_embeddings. NEW param application_type selects the ranking profile (one shipped: procurement=answer-first ×1.1). 6 IMS-vestige cols NULL on all arms (BI-28). Supersedes ID-131.10 Slice A win_stats-only edit.';

-- ============================================================================
-- 1b. public.search_content_chunks — re-point content_items → source_documents.
-- TECH §Function disposition line 410. SIGNATURE CHANGE: param
-- filter_content_item_id → filter_source_document_id and returned column
-- content_item_id → source_document_id (chunks re-parented to source_document_id
-- in M2). Renaming an input param is not possible with CREATE OR REPLACE, so this
-- is DROP + CREATE (argtypes unchanged; grants re-established below). Governance
-- filters (governance_review_status, next_review_date) re-home onto the
-- record_lifecycle facet (owner_kind='source_document'). Vector read from
-- record_embeddings. G-API + the TS caller (lib/mcp/tools/search.ts:581) must
-- update the arg name to filter_source_document_id.
-- ============================================================================
DROP FUNCTION IF EXISTS "public"."search_content_chunks"("extensions"."vector", numeric, integer, "uuid", boolean, integer, character varying);

CREATE FUNCTION "public"."search_content_chunks"("query_embedding" "extensions"."vector", "similarity_threshold" numeric DEFAULT 0.3, "limit_count" integer DEFAULT 20, "filter_source_document_id" "uuid" DEFAULT NULL::"uuid", "filter_overdue_review" boolean DEFAULT NULL::boolean, "filter_review_due_within_days" integer DEFAULT NULL::integer, "visibility_filter" character varying DEFAULT 'default'::character varying) RETURNS TABLE("chunk_id" "uuid", "source_document_id" "uuid", "item_title" "text", "item_suggested_title" "text", "item_content_type" "text", "item_primary_domain" "text", "item_primary_subtopic" "text", "heading_text" "text", "heading_level" smallint, "heading_path" "text"[], "content" "text", "position" smallint, "char_count" integer, "word_count" integer, "similarity" numeric)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  embedding_model CONSTANT text := 'text-embedding-3-large';
BEGIN
  RETURN QUERY
  SELECT
    cc.id AS chunk_id,
    cc.source_document_id,
    sd.filename AS item_title,
    sd.suggested_title AS item_suggested_title,
    sd.content_type::text AS item_content_type,
    sd.primary_domain::text AS item_primary_domain,
    sd.primary_subtopic::text AS item_primary_subtopic,
    cc.heading_text,
    cc.heading_level,
    cc.heading_path,
    cc.content,
    cc.position AS "position",
    cc.char_count,
    cc.word_count,
    (1 - (re.embedding <=> query_embedding))::NUMERIC(4, 3) AS similarity
  FROM content_chunks cc
  JOIN source_documents sd ON sd.id = cc.source_document_id
  JOIN record_embeddings re ON re.owner_kind = 'content_chunk' AND re.owner_id = cc.id AND re.model = embedding_model
  LEFT JOIN record_lifecycle rl ON rl.owner_kind = 'source_document' AND rl.owner_id = sd.id
  WHERE re.embedding IS NOT NULL
    AND CASE visibility_filter
          WHEN 'default' THEN sd.publication_status = 'published'
          WHEN 'all' THEN sd.publication_status <> 'archived'
          WHEN 'admin' THEN TRUE
          ELSE sd.publication_status = 'published'
        END
    AND (1 - (re.embedding <=> query_embedding)) > similarity_threshold
    AND (filter_source_document_id IS NULL OR cc.source_document_id = filter_source_document_id)
    -- §5.5 review-cadence filters — re-homed onto the record_lifecycle facet.
    AND (
      filter_overdue_review IS NULL
      OR (filter_overdue_review = TRUE AND rl.governance_review_status = 'review_overdue')
      OR (filter_overdue_review = FALSE AND (rl.governance_review_status IS DISTINCT FROM 'review_overdue'))
    )
    AND (
      filter_review_due_within_days IS NULL
      OR (
        rl.next_review_date IS NOT NULL
        AND rl.next_review_date <= (CURRENT_DATE + (filter_review_due_within_days || ' days')::interval)
      )
    )
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$$;

ALTER FUNCTION "public"."search_content_chunks"("query_embedding" "extensions"."vector", "similarity_threshold" numeric, "limit_count" integer, "filter_source_document_id" "uuid", "filter_overdue_review" boolean, "filter_review_due_within_days" integer, "visibility_filter" character varying) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."search_content_chunks"("query_embedding" "extensions"."vector", "similarity_threshold" numeric, "limit_count" integer, "filter_source_document_id" "uuid", "filter_overdue_review" boolean, "filter_review_due_within_days" integer, "visibility_filter" character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_content_chunks"("query_embedding" "extensions"."vector", "similarity_threshold" numeric, "limit_count" integer, "filter_source_document_id" "uuid", "filter_overdue_review" boolean, "filter_review_due_within_days" integer, "visibility_filter" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_content_chunks"("query_embedding" "extensions"."vector", "similarity_threshold" numeric, "limit_count" integer, "filter_source_document_id" "uuid", "filter_overdue_review" boolean, "filter_review_due_within_days" integer, "visibility_filter" character varying) TO "service_role";

COMMENT ON FUNCTION "public"."search_content_chunks"("query_embedding" "extensions"."vector", "similarity_threshold" numeric, "limit_count" integer, "filter_source_document_id" "uuid", "filter_overdue_review" boolean, "filter_review_due_within_days" integer, "visibility_filter" character varying) IS 'ID-131.11 (M5): chunk search re-pointed off content_items onto source_documents (item_* cols land M3), governance filters onto the record_lifecycle facet, vector read from record_embeddings. filter_content_item_id → filter_source_document_id and returned content_item_id → source_document_id (chunks re-parented M2). visibility_filter orthogonal to the §5.5 review-cadence filters.';

-- ============================================================================
-- 1c. public.check_content_exists(ids) — typed exist-check (caller
-- lib/citations.ts:146). The caller expects Array<{ id: uuid; item_exists
-- boolean }> — return shape + signature preserved. Existence now spans the typed
-- record tables (source_documents / q_a_pairs / reference_items) instead of
-- content_items. Kept LANGUAGE sql STABLE (pure query; matches current volatility).
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."check_content_exists"("ids" "uuid"[]) RETURNS TABLE("id" "uuid", "item_exists" boolean)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT
    unnest_id AS id,
    (
      EXISTS(SELECT 1 FROM source_documents sd WHERE sd.id = unnest_id)
      OR EXISTS(SELECT 1 FROM q_a_pairs qa WHERE qa.id = unnest_id)
      OR EXISTS(SELECT 1 FROM reference_items ri WHERE ri.id = unnest_id)
    ) AS item_exists
  FROM unnest(ids) AS unnest_id;
$$;

ALTER FUNCTION "public"."check_content_exists"("ids" "uuid"[]) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."check_content_exists"("ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_content_exists"("ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_content_exists"("ids" "uuid"[]) TO "service_role";

COMMENT ON FUNCTION "public"."check_content_exists"("ids" "uuid"[]) IS 'ID-131.11 (M5): existence check re-pointed off content_items onto the typed record tables (source_documents / q_a_pairs / reference_items). Return shape {id, item_exists} preserved for lib/citations.ts.';

-- ============================================================================
-- 1d. public.get_popular_keywords(p_limit) — over source_documents.ai_keywords
-- (caller app/api/search/suggestions/route.ts:19; ai_keywords lands on SD in M3).
-- Return shape {keyword, item_count} preserved. Kept LANGUAGE sql STABLE.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."get_popular_keywords"("p_limit" integer DEFAULT 10) RETURNS TABLE("keyword" "text", "item_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT kw AS keyword, COUNT(*) AS item_count
  FROM source_documents, unnest(ai_keywords) AS kw
  WHERE ai_keywords IS NOT NULL
  GROUP BY kw
  ORDER BY item_count DESC
  LIMIT p_limit;
$$;

ALTER FUNCTION "public"."get_popular_keywords"("p_limit" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_popular_keywords"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_popular_keywords"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_popular_keywords"("p_limit" integer) TO "service_role";

COMMENT ON FUNCTION "public"."get_popular_keywords"("p_limit" integer) IS 'ID-131.11 (M5): popular keywords re-pointed off content_items onto source_documents.ai_keywords (M3). Return shape {keyword, item_count} preserved.';

-- ============================================================================
-- 1e. DROP public.find_related_items — §9 §7.4 (owner-ratified S428): DROP
-- ENTIRELY (supersedes TECH's "re-anchor typed"). Sole caller
-- app/item/[id]/page.tsx:58 is on the IMS item-detail page deleted by
-- G-IMS-DELETE ({131.17}). Ontology-grounded "related records" is a BACKLOG item
-- (cosine q_a_pair→q_a_pair / SD→SD fallback, co-designed with the future detail
-- surfaces). The user_tags IMS-vestige output col is removed with the function.
-- api wrapper removal (api.find_related_items + SURFACE_RPCS entry) is G-API
-- ({131.19}). Single public overload confirmed (grep: only squash_baseline).
-- ============================================================================
DROP FUNCTION IF EXISTS "public"."find_related_items"("p_item_id" "uuid", "p_similarity_threshold" double precision, "p_limit_count" integer);

-- ============================================================================
-- 1f. DROP public.filter_by_keywords — §9 §7.5 (owner-ratified S428): DROP BOTH
-- variants (supersedes TECH's "re-point the text[] variant"). Redundant with the
-- hybrid_search keyword leg; a keyword pre-filter becomes a BACKLOG facet-param on
-- hybrid_search (owner_kind-scoped), not a standalone RPC. Sole caller of the live
-- variant is hooks/browse/use-browse-data.ts:183 (eliminated browse filter panel,
-- G-IMS-DELETE {131.17}). api wrapper removal + SURFACE_RPCS removal is G-API.
--   * (search_terms text[]) → SETOF uuid           — the live variant.
--   * (keyword_list text[], match_mode text) → SETOF content_items — the no-op stub.
-- ============================================================================
DROP FUNCTION IF EXISTS "public"."filter_by_keywords"("search_terms" "text"[]);
DROP FUNCTION IF EXISTS "public"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text");

-- ============================================================================
-- BI-17 BENCHMARK PLAN — O1 q_a_pair-arm latency at corpus scale vs the
-- 3-HNSW baseline (DESIGN ONLY; execution is post-GO on walked data).
--
-- Goal (id-71 O1): "answer this question well, fast" — the q_a_pair arm of
-- hybrid_search must return in < 30s end-to-end at corpus scale. Pre-refactor,
-- three separate inline-column HNSW indexes served the three grains
-- (content_items.embedding, q_a_pairs.question_embedding, content_chunks.embedding);
-- post-refactor all vector reads hit record_embeddings' per-owner_kind PARTIAL
-- HNSW indexes (m=16, ef_construction=64, one WHERE owner_kind='<kind>' per kind).
--
-- SEED STEP (bring record_embeddings to corpus scale):
--   1. Run the full-replace re-ingest (BI-2) against a walked Platform DB so
--      flow.py (EX-PY) populates record_embeddings for owner_kind IN
--      ('content_chunk','q_a_pair','reference_item') at realistic row counts
--      (target: ≥ the client-prod pre-OKF debris scale — ~926 chunks, ~396
--      q_a_pair-typed rows — scaled to the intended live corpus).
--   2. Confirm per-owner_kind row counts + that each partial HNSW index is used:
--        SET enable_seqscan = off;  -- force index consideration for the check
--        SELECT owner_kind, count(*) FROM record_embeddings GROUP BY owner_kind;
--
-- MEASUREMENT (EXPLAIN ANALYZE, warm cache, ≥5 runs, discard first):
--   EXPLAIN (ANALYZE, BUFFERS, TIMING)
--   SELECT * FROM public.hybrid_search(
--     query_embedding    => $1,           -- a real text-embedding-3-large(1024) vector
--     query_text         => 'representative bid question text',
--     similarity_threshold => 0.3,
--     limit_count        => 10,
--     include_superseded => false,
--     visibility_filter  => 'default',
--     application_type   => 'procurement'
--   );
--   Capture: total execution time; per-arm scan node (verify
--   "Index Scan using record_embeddings_<kind>_hnsw_idx", NOT a seq scan or a
--   bitmap over the whole table); the DISTINCT ON sort cost; the win_stats CTE cost.
--   Isolate the q_a_pair arm by also EXPLAIN-ing a type-narrowed call once the
--   type/scope param lands (forms path: hybrid_search over q_a_pair only).
--
--   Compare against the pre-refactor baseline captured on the SAME walked corpus
--   before M5 (three-inline-HNSW hybrid_search / search_qa_library timings).
--
-- PARTIAL-PER-owner_kind vs SINGLE-INDEX decision criteria:
--   Current design = one partial HNSW index per owner_kind (selective; each arm's
--   scan touches only its kind's rows). Prefer a SINGLE combined HNSW index over
--   record_embeddings(embedding) ONLY IF: (a) the planner fails to use the partial
--   indexes for the per-arm owner_kind predicate (check EXPLAIN), OR (b) index
--   build/maintenance cost of N partial indexes dominates at corpus scale. Prefer
--   KEEPING partial indexes (the default) if per-arm latency is dominated by a
--   single kind and cross-kind recall is acceptable — partial indexes give tighter,
--   per-grain-selective scans and cheaper rebuilds per kind. Record the chosen
--   posture + the EXPLAIN evidence in the {131.11} completion journal.
-- ============================================================================

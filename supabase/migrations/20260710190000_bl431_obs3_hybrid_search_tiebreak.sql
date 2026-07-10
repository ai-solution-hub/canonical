-- bl-431 OBS-3 (owner-ratified S460) — hybrid_search deterministic pagination
-- tie-breaker. Fast-path fix, separate from the ID-144 RPC-completion Task.
--
-- Bug: 20260702120000_id131_search_rpcs.sql:349's final
-- `ORDER BY deduped.similarity DESC` has no secondary key. similarity is
-- NUMERIC(4,3), so ties across distinct ids are likely (bounded 3-dp domain,
-- multiple ranking terms). The Surface-A limit-raising load-more
-- (use-corpus-search.ts:141-150,:254-262) depends on server-stable order
-- (BI-11/BI-20) — ties can shuffle across the LIMIT boundary between page
-- fetches, producing duplicate/missing rows on load-more.
--
-- Fix: CREATE OR REPLACE with the body byte-identical to
-- 20260702120000_id131_search_rpcs.sql (confirmed current/canonical — no later
-- migration replaces this function's body; 20260706170000 only references it
-- in comments while redefining unrelated q_a functions), except the final
-- ORDER BY gains `deduped.id` as a secondary key:
--   ORDER BY deduped.similarity DESC, deduped.id
-- The inner DISTINCT ON dedup (arms.id, arms.similarity DESC) was already
-- deterministic; only the OUTER sort was at fault.
--
-- No signature change (same 7 params, same defaults, same RETURNS TABLE) — no
-- api.hybrid_search wrapper regen and no type regen needed: api.hybrid_search
-- (scripts/generate-api-views.ts / 20260706150000_id131_api_views_regen2.sql)
-- is a thin SECURITY INVOKER wrapper (`SELECT * FROM public.hybrid_search(...)`)
-- that delegates by name to public.hybrid_search — a body-only CREATE OR
-- REPLACE on the delegate is transparent to it. Verified by inspection of the
-- wrapper body (no duplicated SQL) before authoring this migration.

CREATE OR REPLACE FUNCTION "public"."hybrid_search"("query_embedding" "extensions"."vector", "query_text" "text" DEFAULT ''::"text", "similarity_threshold" numeric DEFAULT 0.3, "limit_count" integer DEFAULT 10, "include_superseded" boolean DEFAULT false, "visibility_filter" character varying DEFAULT 'default'::character varying, "application_type" "text" DEFAULT 'procurement'::"text") RETURNS TABLE("id" "uuid", "title" "text", "suggested_title" "text", "summary" "text", "primary_domain" "text", "primary_subtopic" "text", "content_type" "text", "platform" "text", "author_name" "text", "source_domain" "text", "thumbnail_url" "text", "captured_date" timestamp with time zone, "ai_keywords" "text"[], "classification_confidence" numeric, "priority" "text", "metadata" "jsonb", "similarity" numeric, "snippet" "text", "created_by" "uuid", "verified_at" timestamp with time zone, "verified_by" "uuid")
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
  -- bl-431 OBS-3 fix: secondary key on id makes the outer sort total-order
  -- deterministic across identical-similarity ties, so Surface-A load-more
  -- (server-stable order, BI-11/BI-20) can't shuffle rows across the LIMIT
  -- boundary between page fetches.
  ORDER BY deduped.similarity DESC, deduped.id
  LIMIT limit_count;
END;
$$;

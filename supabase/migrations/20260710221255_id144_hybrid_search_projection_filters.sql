-- ID-144 {144.5} — public.hybrid_search RPC completion: 21-col/7-arg →
-- 24-col/12-arg. DROP + CREATE (signature change, not CREATE OR REPLACE).
--
-- Builds ON TOP of the bl-431 OBS-3 fast-path
-- (20260710190000_bl431_obs3_hybrid_search_tiebreak.sql) — this migration
-- sorts AFTER it (20260710221255 > 20260710190000) and recreates the body
-- from that migration verbatim, carrying forward its ORDER BY tie-breaker
-- (`deduped.similarity DESC, deduped.id`) unchanged. Recreating from the
-- earlier 20260702120000_id131_search_rpcs.sql body would silently revert
-- the tie-breaker and reintroduce the load-more pagination bug (TECH §5).
--
-- Adds (id-144 TECH §2, ratified S460):
--  - 3 projections appended after verified_by: scope_tag text[], source_url
--    text, owner_kind text (§2.1/§2.2). owner_kind is the grain
--    discriminator (record_embeddings.owner_kind vocabulary); content_type
--    is left UNCHANGED (arm 1 keeps its real editorial value, DR-050).
--  - 5 trailing DEFAULT NULL filter params: filter_kind, filter_domain,
--    filter_subtopic, filter_date_from, filter_date_to (§2.4), each with a
--    per-arm WHERE guard. 12 args is the ratified CAP (DR-052) — no
--    keyword-facet param (OQ-144-2 REJECTED, see TECH §2.7).
--
-- DR-035 (born-locked functions): DROP+CREATE fires the
-- dr035_born_locked_functions event trigger, so zero-anon-EXECUTE is
-- guaranteed automatically; the explicit REVOKE/GRANT below is
-- defence-in-depth only, matching 20260702120000_id131_search_rpcs.sql:356-358.
--
-- UK English throughout (DD/MM/YYYY). Authored 10/07/2026.

DROP FUNCTION public.hybrid_search(extensions.vector, text, numeric, integer, boolean, character varying, text);

CREATE FUNCTION "public"."hybrid_search"(
  "query_embedding" "extensions"."vector",
  "query_text" "text" DEFAULT ''::"text",
  "similarity_threshold" numeric DEFAULT 0.3,
  "limit_count" integer DEFAULT 10,
  "include_superseded" boolean DEFAULT false,
  "visibility_filter" character varying DEFAULT 'default'::character varying,
  "application_type" "text" DEFAULT 'procurement'::"text",
  "filter_kind" "text" DEFAULT NULL::"text",
  "filter_domain" "text" DEFAULT NULL::"text",
  "filter_subtopic" "text" DEFAULT NULL::"text",
  "filter_date_from" timestamp with time zone DEFAULT NULL::timestamp with time zone,
  "filter_date_to" timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS TABLE(
  "id" "uuid", "title" "text", "suggested_title" "text", "summary" "text",
  "primary_domain" "text", "primary_subtopic" "text", "content_type" "text",
  "platform" "text", "author_name" "text", "source_domain" "text",
  "thumbnail_url" "text", "captured_date" timestamp with time zone,
  "ai_keywords" "text"[], "classification_confidence" numeric, "priority" "text",
  "metadata" "jsonb", "similarity" numeric, "snippet" "text", "created_by" "uuid",
  "verified_at" timestamp with time zone, "verified_by" "uuid",
  "scope_tag" "text"[], "source_url" "text", "owner_kind" "text"
)
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
    -- id-144: no owner_kind/content_type conflation here (§1.4) — content_type
    -- keeps its real editorial value; owner_kind is the new honest grain key.
    -- filter_kind/domain/subtopic/date guards (§2.4) added; scope_tag/source_url
    -- are NULL for this grain (§2.1).
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
      rl.verified_by AS "verified_by",
      NULL::text[] AS "scope_tag",
      NULL::text AS "source_url",
      'source_document'::text AS "owner_kind"
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
      AND (filter_kind IS NULL OR filter_kind = 'document')
      AND (filter_domain IS NULL OR sd.primary_domain::text = filter_domain)
      AND (filter_subtopic IS NULL OR sd.primary_subtopic::text = filter_subtopic)
      AND (filter_date_from IS NULL OR sd.captured_date >= filter_date_from)
      AND (filter_date_to IS NULL OR sd.captured_date <= filter_date_to)

    UNION ALL

    -- ---- Arm 2: content_chunks — VERBATIM passage grain, COLLAPSED to its
    -- source_document identity (returns sd.id, NOT cc.id — §8 settled item, for
    -- citation + the two-step get). Vector read from record_embeddings
    -- (owner_kind='content_chunk'). Chunk inherits the parent SD publication_status
    -- for visibility; governance/verified via the parent SD facet.
    -- id-144: date filter maps to the parent SD's captured_date (chunk carries
    -- only created_at/updated_at, TECH §2.4).
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
      rl.verified_by AS "verified_by",
      NULL::text[] AS "scope_tag",
      NULL::text AS "source_url",
      'content_chunk'::text AS "owner_kind"
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
      AND (filter_kind IS NULL OR filter_kind = 'document')
      AND (filter_domain IS NULL OR sd.primary_domain::text = filter_domain)
      AND (filter_subtopic IS NULL OR sd.primary_subtopic::text = filter_subtopic)
      AND (filter_date_from IS NULL OR sd.captured_date >= filter_date_from)
      AND (filter_date_to IS NULL OR sd.captured_date <= filter_date_to)

    UNION ALL

    -- ---- Arm 3: q_a_pairs — the PRIMARY answer grain. Gets the answer-first
    -- PROFILE boost (qa_profile_boost) AND the win_stats boost (q_a_pair-only win
    -- signal — BI-26). Domain from the record_lifecycle facet (q_a_pairs carry no
    -- primary_domain). valid_to is the hard hot boundary (BI-20) + superseded_by;
    -- both honoured by include_superseded.
    -- id-144: projects qa.scope_tag (§2.1, the Item-3 safety projection); no
    -- subtopic on this grain so a non-null filter_subtopic naturally excludes
    -- answers (§2.4); date filter maps to qa.valid_from (temporal-validity start).
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
      rl.verified_by AS "verified_by",
      qa.scope_tag AS "scope_tag",
      NULL::text AS "source_url",
      'q_a_pair'::text AS "owner_kind"
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
      AND (filter_kind IS NULL OR filter_kind = 'answer')
      AND (filter_domain IS NULL OR COALESCE(rl.domain, 'unclassified')::text = filter_domain)
      AND (filter_subtopic IS NULL OR NULL::text = filter_subtopic)
      AND (filter_date_from IS NULL OR qa.valid_from >= filter_date_from)
      AND (filter_date_to IS NULL OR qa.valid_from <= filter_date_to)

    UNION ALL

    -- ---- Arm 4: reference_items — external evidence grain. Vector read from
    -- record_embeddings (owner_kind='reference_item'). reference_items is EXCLUDED
    -- from the record_lifecycle facet (BI-19) so verified_at/by are NULL, and it
    -- carries NO publication_status (global evidence layer, always visible); only
    -- superseded_by (M3) gates visibility here.
    -- id-144: projects ri.source_url (§2.1, NOT NULL column — closes the
    -- BI-13 link-target gap); date filter maps to ri.published_at.
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
      NULL::uuid AS "verified_by",
      NULL::text[] AS "scope_tag",
      ri.source_url AS "source_url",
      'reference_item'::text AS "owner_kind"
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
      AND (filter_kind IS NULL OR filter_kind = 'reference')
      AND (filter_domain IS NULL OR ri.primary_domain::text = filter_domain)
      AND (filter_subtopic IS NULL OR ri.primary_subtopic::text = filter_subtopic)
      AND (filter_date_from IS NULL OR ri.published_at >= filter_date_from)
      AND (filter_date_to IS NULL OR ri.published_at <= filter_date_to)
  ),
  -- Provenance de-duplication: content_chunk arm and source_document arm can both
  -- resolve to the same SD id — collapse to one hit, keeping the higher similarity
  -- (§8: one underlying fact → one hit). DISTINCT ON keeps the first row per id
  -- under the ORDER BY id, similarity DESC. arms.* auto-flows the 3 new
  -- projection columns through this CTE (id-144 §2.1).
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
    deduped.created_by, deduped.verified_at, deduped.verified_by,
    deduped.scope_tag, deduped.source_url, deduped.owner_kind
  FROM deduped
  -- bl-431 OBS-3 tie-breaker (CARRIED FORWARD, not re-derived): secondary key on
  -- id makes the outer sort total-order deterministic across identical-similarity
  -- ties, so Surface-A load-more (server-stable order, BI-11/BI-20) can't shuffle
  -- rows across the LIMIT boundary between page fetches.
  ORDER BY deduped.similarity DESC, deduped.id
  LIMIT limit_count;
END;
$$;

ALTER FUNCTION "public"."hybrid_search"(
  "extensions"."vector", "text", numeric, integer, boolean, character varying, "text",
  "text", "text", "text", timestamp with time zone, timestamp with time zone
) OWNER TO "postgres";

COMMENT ON FUNCTION "public"."hybrid_search"(
  "extensions"."vector", "text", numeric, integer, boolean, character varying, "text",
  "text", "text", "text", timestamp with time zone, timestamp with time zone
) IS 'id-144: 4-arm polymorphic corpus search (source_documents/content_chunks/q_a_pairs/reference_items), 24-col RETURNS TABLE (scope_tag/source_url/owner_kind projections added), 12 positional args (5 trailing server-side filters: filter_kind/filter_domain/filter_subtopic/filter_date_from/filter_date_to). Carries forward the bl-431 OBS-3 ORDER BY tie-breaker (similarity DESC, id) for deterministic load-more pagination.';

-- DR-035 defence-in-depth (the dr035_born_locked_functions event trigger already
-- guarantees zero-anon-EXECUTE on this fresh CREATE) — explicit REVOKE/GRANT
-- matching 20260702120000_id131_search_rpcs.sql:356-358.
REVOKE ALL ON FUNCTION "public"."hybrid_search"(
  "extensions"."vector", "text", numeric, integer, boolean, character varying, "text",
  "text", "text", "text", timestamp with time zone, timestamp with time zone
) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."hybrid_search"(
  "extensions"."vector", "text", numeric, integer, boolean, character varying, "text",
  "text", "text", "text", timestamp with time zone, timestamp with time zone
) TO "authenticated";

GRANT ALL ON FUNCTION "public"."hybrid_search"(
  "extensions"."vector", "text", numeric, integer, boolean, character varying, "text",
  "text", "text", "text", timestamp with time zone, timestamp with time zone
) TO "service_role";

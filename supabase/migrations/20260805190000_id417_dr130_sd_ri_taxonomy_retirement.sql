-- id-417 / DR-130 + DR-124: retire the subject-taxonomy axis from
-- source_documents / reference_items, drop the taxonomy tables, and unwind
-- reference_ingest's synthetic source_documents mint.
--
-- One batch per DR-032 (the exposure companion never ships as a follow-up).
-- Rulings executed here:
--   DR-130  — subject domains/subtopics retire platform-wide; the driving axes
--             are scope (scope_tag), semantics (embeddings + ai_keywords +
--             entities) and concept membership. sd/ri/frt domain columns and
--             taxonomy_domains/taxonomy_subtopics fall under it.
--   DR-124  — a reference item does NOT mint a source_documents row. The
--             reference_ingest sd-mint path is unwound; existing URL-minted
--             sd shells are deleted (synthetic data, pre-launch — S528 frame).
--   DR-125  — the (primary_domain, primary_subtopic) topic grain EXPIRED;
--             scope_tag is the sole topic grain (fallback deleted S531).
--   DR-093  — no backfill: dropped provenance columns (pipeline_run_id,
--             workspace_id — id-402 ruling, exactR=0/exactW=0; op_id is the
--             live forward provenance key) are dropped, never migrated.
--   Owner, S535/S536 — sd URL identity belongs to reference_items
--             (sd.source_url dropped); classification by-products
--             (summary, suggested_title, classification_confidence,
--             classification_reasoning, classified_at) retire with the
--             classification stage. sd.ai_keywords is KEPT (DR-130 axis 2).
--             hybrid_search keeps filter_kind, loses filter_domain/subtopic.
--
-- DB-side dependency census (measured on Platform staging rbwqewalexrzgxtvcqrh,
-- 2026-08-05): views api.{source_documents, reference_items,
-- form_requirement_templates, record_lifecycle, review_assignments,
-- taxonomy_domains, taxonomy_subtopics}; functions public+api
-- {hybrid_search, reference_ingest, reference_list, reference_search,
-- reference_get_verbatim}, public.{search_content ×2, search_content_chunks,
-- get_aggregate_win_rate_stats, coerce_empty_classification_to_null,
-- record_lifecycle_domain_sync}; indexes idx_source_documents_{source_url,
-- pipeline_run_id, workspace_id}, idx_reference_items_source_document_id,
-- idx_form_template_requirements_domain; no RLS qual and no realtime
-- publication touches any retired column.
--
-- NOTE public.reference_search was measured BROKEN at head (42703: column
-- ri.embedding does not exist — the inline vector was dropped by
-- 20260706120000_id131_drop_inline_vector_cols.sql and this function was never
-- re-pointed). Its replacement below reads record_embeddings.

-- ═════════════════════════════════════════════════════════════════════════
-- §1  Drop dependent api views (recreated minus retired columns in §12;
--     api.taxonomy_* are not recreated — their base tables go in §7)
-- ═════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS api.taxonomy_domains;
DROP VIEW IF EXISTS api.taxonomy_subtopics;
DROP VIEW IF EXISTS api.source_documents;
DROP VIEW IF EXISTS api.reference_items;
DROP VIEW IF EXISTS api.form_requirement_templates;
DROP VIEW IF EXISTS api.record_lifecycle;
DROP VIEW IF EXISTS api.review_assignments;

-- ═════════════════════════════════════════════════════════════════════════
-- §2  Drop functions standing on the retiring axis (api wrappers first —
--     they delegate to public), plus the two classification trigger legs
-- ═════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS api.hybrid_search(vector, text, numeric, integer, boolean, character varying, text, text, text, text, timestamp with time zone, timestamp with time zone);
DROP FUNCTION IF EXISTS api.reference_ingest(text, text, text, text, text, text, vector, timestamp with time zone, text, text, integer, text, jsonb, uuid);
DROP FUNCTION IF EXISTS api.reference_list(integer, integer, text, text, text, timestamp with time zone, timestamp with time zone);
DROP FUNCTION IF EXISTS api.reference_search(text, vector, integer);
DROP FUNCTION IF EXISTS api.reference_get_verbatim(uuid);

DROP FUNCTION IF EXISTS public.hybrid_search(vector, text, numeric, integer, boolean, character varying, text, text, text, text, timestamp with time zone, timestamp with time zone);
DROP FUNCTION IF EXISTS public.reference_ingest(text, text, text, text, text, text, vector, timestamp with time zone, text, text, integer, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.reference_list(integer, integer, text, text, text, timestamp with time zone, timestamp with time zone);
DROP FUNCTION IF EXISTS public.reference_search(text, vector, integer);
DROP FUNCTION IF EXISTS public.reference_get_verbatim(uuid);

-- IMS-era search RPCs: zero repo callers (measured — the MCP `find`
-- consolidation replaced search_content/search_content_chunks; only comment
-- mentions remain), bodies read sd.primary_domain/primary_subtopic and the
-- classification columns dropped below. Retired outright, not replaced.
DROP FUNCTION IF EXISTS public.search_content(vector, numeric, integer);
DROP FUNCTION IF EXISTS public.search_content(vector, double precision, integer);
DROP FUNCTION IF EXISTS public.search_content_chunks(vector, numeric, integer, uuid, boolean, integer, character varying);

-- Classification trigger legs. coerce_empty_classification_to_null exists
-- only to NULLIF the four sd domain columns; record_lifecycle_domain_sync
-- copies sd.primary_domain into record_lifecycle.domain (its only writer —
-- the column is dropped in §6).
DROP TRIGGER IF EXISTS trg_coerce_empty_classification_to_null ON public.source_documents;
DROP FUNCTION IF EXISTS public.coerce_empty_classification_to_null();
DROP TRIGGER IF EXISTS trg_record_lifecycle_domain_sync ON public.record_lifecycle;
DROP FUNCTION IF EXISTS public.record_lifecycle_domain_sync();

-- ═════════════════════════════════════════════════════════════════════════
-- §3  DR-124 unwind — drop the ri→sd provenance FK and delete the synthetic
--     URL-minted sd shells.
--
-- Identification: reference_ingest (and flow.py's URL/feed landing set —
-- flow.py:4028) mint sd.id = uuid5(_KH_PIPELINE_DOC_NS, 'sd:' || url) AND
-- store that same url in sd.source_url. Corpus/localfs documents mint from
-- 'sd:' || rel_path with source_url NULL (flow.py:2144, 3078), and app
-- uploads use gen_random_uuid() — so the predicate
--   sd.source_url IS NOT NULL
--   AND sd.id = uuid_generate_v5(NS, 'sd:' || sd.source_url)
-- selects exactly the URL-minted provenance shells and can never match a
-- real document. Row counts are NOT the justification (all Platform data is
-- synthetic, pre-launch); the deterministic identity is.
--
-- Cascade coverage (measured FKs): content_chunks / entity_mentions /
-- q_a_extractions / citations / ingestion_quality_log / record_lifecycle /
-- verification_history CASCADE; entity_relationships + sd.parent_id SET NULL.
-- record_embeddings has no FK (D7) → explicit delete. q_a_pairs.
-- source_document_id has NO FK constraint (measured) → defensive NULL
-- (0 matching rows measured on staging; belt-and-braces for other DBs).
-- ═════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.idx_reference_items_source_document_id;
ALTER TABLE public.reference_items
  DROP COLUMN IF EXISTS source_document_id;  -- FK reference_items_source_document_id_fkey falls with it

UPDATE public.q_a_pairs qp
   SET source_document_id = NULL
 WHERE qp.source_document_id IN (
   SELECT sd.id FROM public.source_documents sd
   WHERE sd.source_url IS NOT NULL
     AND sd.id = extensions.uuid_generate_v5(
           'fbfaf1ff-1ee4-583c-9757-1674465b2ec1'::uuid, 'sd:' || sd.source_url));

DELETE FROM public.record_embeddings re
 WHERE re.owner_kind = 'source_document'
   AND re.owner_id IN (
   SELECT sd.id FROM public.source_documents sd
   WHERE sd.source_url IS NOT NULL
     AND sd.id = extensions.uuid_generate_v5(
           'fbfaf1ff-1ee4-583c-9757-1674465b2ec1'::uuid, 'sd:' || sd.source_url));

DELETE FROM public.source_documents sd
 WHERE sd.source_url IS NOT NULL
   AND sd.id = extensions.uuid_generate_v5(
         'fbfaf1ff-1ee4-583c-9757-1674465b2ec1'::uuid, 'sd:' || sd.source_url);

-- ═════════════════════════════════════════════════════════════════════════
-- §4  source_documents column drops
--     - 4 domain columns: DR-130.
--     - pipeline_run_id / workspace_id: id-402 ruling (exactR=0/exactW=0;
--       op_id is the live forward provenance key; DR-093 no-backfill).
--     - source_url: owner ruling — URL identity belongs to reference_items.
--       (locator / storage_path / logical_path are NOT URL-identity columns:
--       locator serves the live folder-drop connector-binding family
--       (lib/upload/folder-drop.ts), storage_path is internal storage
--       identity, logical_path is the OKF path — all KEPT.)
--     - summary / suggested_title / classification_confidence /
--       classification_reasoning / classified_at: classification-stage
--       by-products; sole writers are lib/ai/classify.ts + flow.py's
--       classification stage, both deleted this wave. Owner: RETIRE > carry.
--     - ai_keywords KEPT (DR-130 axis 2: semantics = embeddings +
--       ai_keywords + entities).
-- ═════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.idx_source_documents_source_url;
DROP INDEX IF EXISTS public.idx_source_documents_pipeline_run_id;
DROP INDEX IF EXISTS public.idx_source_documents_workspace_id;

ALTER TABLE public.source_documents
  DROP COLUMN IF EXISTS primary_domain,
  DROP COLUMN IF EXISTS primary_subtopic,
  DROP COLUMN IF EXISTS secondary_domain,
  DROP COLUMN IF EXISTS secondary_subtopic,
  DROP COLUMN IF EXISTS pipeline_run_id,
  DROP COLUMN IF EXISTS workspace_id,
  DROP COLUMN IF EXISTS source_url,
  DROP COLUMN IF EXISTS summary,
  DROP COLUMN IF EXISTS suggested_title,
  DROP COLUMN IF EXISTS classification_confidence,
  DROP COLUMN IF EXISTS classification_reasoning,
  DROP COLUMN IF EXISTS classified_at;

-- ═════════════════════════════════════════════════════════════════════════
-- §5  reference_items column drops (DR-130; source_document_id already
--     dropped in §3 under DR-124)
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE public.reference_items
  DROP COLUMN IF EXISTS primary_domain,
  DROP COLUMN IF EXISTS primary_subtopic;

-- ═════════════════════════════════════════════════════════════════════════
-- §6  record_lifecycle.domain — forced consequence of DR-130: its ONLY
--     writer was the record_lifecycle_domain_sync trigger (§2) copying
--     sd.primary_domain; its readers were hybrid_search's q_a_pair arm and
--     get_aggregate_win_rate_stats' per-domain scope, both replaced below.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE public.record_lifecycle
  DROP COLUMN IF EXISTS domain;

-- ═════════════════════════════════════════════════════════════════════════
-- §7  taxonomy tables (DR-130). Measured inbound FKs at head: ONLY
--     taxonomy_subtopics.domain_id → taxonomy_domains (S528's
--     coverage_targets.domain_id was dropped with coverage_targets at
--     20260804143712). RLS policies, indexes, grants fall with the tables.
-- ═════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS public.taxonomy_subtopics;
DROP TABLE IF EXISTS public.taxonomy_domains;

-- ═════════════════════════════════════════════════════════════════════════
-- §8  form_requirement_templates taxonomy-value columns (measured
--     recommendation, authored): the coverage engine's domain-match leg
--     (template-coverage.ts:269-274) compares these against item-side
--     domains sourced from record_lifecycle.domain (q_a_pairs) and
--     ri.primary_domain — BOTH dropped above, so the requirement-side
--     columns have no matching counterpart left. Self-contained block.
-- ═════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.idx_form_template_requirements_domain;
ALTER TABLE public.form_requirement_templates
  DROP COLUMN IF EXISTS primary_domain,
  DROP COLUMN IF EXISTS primary_subtopic,
  DROP COLUMN IF EXISTS secondary_domain,
  DROP COLUMN IF EXISTS secondary_subtopic;

-- ═════════════════════════════════════════════════════════════════════════
-- §9  review_assignments.filter_domains (measured recommendation,
--     authored): its only read paths — app/api/review/queue/route.ts
--     assignment expansion and lib/mcp/tools/review.ts:333 count — filter
--     sd.primary_domain, dropped in §4; a stored filter that can never be
--     applied again. filter_content_types (content-type axis, LIVE pending
--     Q-B) and filter_freshness (freshness axis) are KEPT. Self-contained
--     block; strip if id-420's reviewer-assignment redesign supersedes it.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE public.review_assignments
  DROP COLUMN IF EXISTS filter_domains;

-- ═════════════════════════════════════════════════════════════════════════
-- §10 Replacement functions (public schema)
-- ═════════════════════════════════════════════════════════════════════════

-- §10a hybrid_search — filter_domain/filter_subtopic params REMOVED
-- (owner-confirmed; filter_kind KEPT), output columns primary_domain /
-- primary_subtopic / suggested_title / classification_confidence REMOVED
-- (their sources are dropped above). Arm mechanics otherwise carried
-- forward verbatim: win_stats boost, application_type profile boost,
-- provenance de-dup, deterministic tie-breaker. Arm 1 (sd, text-only —
-- BI-29) now scores on filename + ai_keywords only (suggested_title /
-- summary sources dropped); its summary/snippet project NULL.
CREATE FUNCTION public.hybrid_search(
  query_embedding vector,
  query_text text DEFAULT ''::text,
  similarity_threshold numeric DEFAULT 0.3,
  limit_count integer DEFAULT 10,
  include_superseded boolean DEFAULT false,
  visibility_filter character varying DEFAULT 'default'::character varying,
  application_type text DEFAULT 'procurement'::text,
  filter_kind text DEFAULT NULL::text,
  filter_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  filter_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS TABLE(
  id uuid, title text, summary text, content_type text, platform text,
  author_name text, source_domain text, thumbnail_url text,
  captured_date timestamp with time zone, ai_keywords text[], priority text,
  metadata jsonb, similarity numeric, snippet text, created_by uuid,
  verified_at timestamp with time zone, verified_by uuid, scope_tag text[],
  source_url text, owner_kind text)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  win_boost CONSTANT numeric := 0.03;
  min_win_citations CONSTANT integer := 2;
  embedding_model CONSTANT text := 'text-embedding-3-large';
  qa_profile_boost numeric;
BEGIN
  -- Ranking PROFILE selection by application_type (owner-ratified; carried
  -- forward unchanged from the id-144 body).
  qa_profile_boost := CASE application_type
    WHEN 'procurement' THEN 1.1
    ELSE 1.0
  END;

  RETURN QUERY
  WITH win_stats AS (
    -- Q&A-anchored win signal (BI-25/BI-26), carried forward unchanged.
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
    JOIN form_instances ft ON ft.id = fq.form_instance_id
    LEFT JOIN form_outcome_types fot ON fot.key = ft.outcome
    WHERE cc.cited_kind = 'q_a_pair'
    GROUP BY cc.cited_q_a_pair_id
  ),
  arms AS (
    -- ---- Arm 1: source_documents (PROVENANCE anchor; TEXT-ONLY match — BI-29).
    -- DR-130: suggested_title/summary sources dropped — scoring is
    -- filename + ai_keywords; summary/snippet are NULL for this arm.
    SELECT
      sd.id AS "id",
      sd.filename AS "title",
      NULL::text AS "summary",
      sd.content_type::text AS "content_type",
      NULL::text AS "platform",
      NULL::text AS "author_name",
      NULL::text AS "source_domain",
      NULL::text AS "thumbnail_url",
      sd.captured_date AS "captured_date",
      sd.ai_keywords AS "ai_keywords",
      NULL::text AS "priority",
      NULL::jsonb AS "metadata",
      LEAST(1.0, (
          CASE WHEN query_text <> '' AND sd.filename ILIKE '%' || query_text || '%' THEN 0.55
               ELSE 0.0 END
        + CASE WHEN query_text <> '' AND query_text = ANY(sd.ai_keywords) THEN 0.25
               WHEN query_text <> '' AND EXISTS (SELECT 1 FROM unnest(sd.ai_keywords) AS kw WHERE kw ILIKE '%' || query_text || '%') THEN 0.15
               ELSE 0.0 END
      ))::NUMERIC(4, 3) AS "similarity",
      NULL::text AS "snippet",
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
           sd.filename ILIKE '%' || query_text || '%'
        OR EXISTS (SELECT 1 FROM unnest(sd.ai_keywords) AS kw WHERE kw ILIKE '%' || query_text || '%')
      )
      AND CASE visibility_filter
            WHEN 'default' THEN sd.publication_status = 'published'
            WHEN 'all' THEN sd.publication_status <> 'archived'
            WHEN 'admin' THEN TRUE
            ELSE sd.publication_status = 'published'
          END
      AND (filter_kind IS NULL OR filter_kind = 'document')
      AND (filter_date_from IS NULL OR sd.captured_date >= filter_date_from)
      AND (filter_date_to IS NULL OR sd.captured_date <= filter_date_to)

    UNION ALL

    -- ---- Arm 2: content_chunks — VERBATIM passage grain, collapsed to its
    -- source_document identity. Carried forward minus the domain projections.
    SELECT
      cc.source_document_id AS "id",
      (sd.filename || ' — ' || COALESCE(cc.heading_text, '')) AS "title",
      substring(cc.content FROM 1 FOR 300) AS "summary",
      'content_chunk'::text AS "content_type",
      NULL::text AS "platform",
      NULL::text AS "author_name",
      NULL::text AS "source_domain",
      NULL::text AS "thumbnail_url",
      sd.captured_date AS "captured_date",
      sd.ai_keywords AS "ai_keywords",
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
      AND (filter_date_from IS NULL OR sd.captured_date >= filter_date_from)
      AND (filter_date_to IS NULL OR sd.captured_date <= filter_date_to)

    UNION ALL

    -- ---- Arm 3: q_a_pairs — PRIMARY answer grain. Carried forward minus the
    -- record_lifecycle.domain projection/filter (column dropped, §6).
    SELECT
      qa.id AS "id",
      qa.question_text AS "title",
      substring(qa.answer_standard FROM 1 FOR 300) AS "summary",
      'q_a_pair'::text AS "content_type",
      NULL::text AS "platform",
      NULL::text AS "author_name",
      NULL::text AS "source_domain",
      NULL::text AS "thumbnail_url",
      NULL::timestamp with time zone AS "captured_date",
      NULL::text[] AS "ai_keywords",
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
      AND (filter_date_from IS NULL OR qa.valid_from >= filter_date_from)
      AND (filter_date_to IS NULL OR qa.valid_from <= filter_date_to)

    UNION ALL

    -- ---- Arm 4: reference_items — external evidence grain. Carried forward
    -- minus the ri domain projections/filters (columns dropped, §5).
    SELECT
      ri.id AS "id",
      ri.title AS "title",
      ri.summary AS "summary",
      'reference_item'::text AS "content_type",
      NULL::text AS "platform",
      NULL::text AS "author_name",
      NULL::text AS "source_domain",
      NULL::text AS "thumbnail_url",
      NULL::timestamp with time zone AS "captured_date",
      NULL::text[] AS "ai_keywords",
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
      AND (filter_date_from IS NULL OR ri.published_at >= filter_date_from)
      AND (filter_date_to IS NULL OR ri.published_at <= filter_date_to)
  ),
  -- Provenance de-duplication (one underlying fact → one hit), carried forward.
  deduped AS (
    SELECT DISTINCT ON (arms.id) arms.*
    FROM arms
    ORDER BY arms.id, arms.similarity DESC
  )
  SELECT
    deduped.id, deduped.title, deduped.summary, deduped.content_type,
    deduped.platform, deduped.author_name, deduped.source_domain, deduped.thumbnail_url,
    deduped.captured_date, deduped.ai_keywords, deduped.priority, deduped.metadata,
    deduped.similarity, deduped.snippet, deduped.created_by,
    deduped.verified_at, deduped.verified_by,
    deduped.scope_tag, deduped.source_url, deduped.owner_kind
  FROM deduped
  -- bl-431 OBS-3 deterministic tie-breaker, carried forward.
  ORDER BY deduped.similarity DESC, deduped.id
  LIMIT limit_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.hybrid_search(vector, text, numeric, integer, boolean, character varying, text, text, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hybrid_search(vector, text, numeric, integer, boolean, character varying, text, text, timestamp with time zone, timestamp with time zone) TO authenticated, service_role;

-- §10b reference_ingest — DR-124: lands reference_items ONLY. No sd mint, no
-- doc-shell params (p_filename/p_mime_type/p_file_size/p_content_hash/
-- p_extraction_metadata existed only to dress the synthetic sd row), no
-- domain params (DR-130). Preserved: uuid5 idempotency on the SAME pipeline
-- namespace + 'ri:' seed (cross-path identity parity with flow.py:4029),
-- already_existed no-op converge, SECURITY DEFINER + pinned search_path,
-- 'research' layer constant (validated by trg_validate_reference_items_layer),
-- ingestion_source 'url_import', record_embeddings dual-write keyed on the
-- deterministic PK (DR-036), grant/revoke posture.
CREATE FUNCTION public.reference_ingest(
  p_source_url text,
  p_title text,
  p_body text,
  p_summary text,
  p_embedding vector,
  p_published_at timestamp with time zone,
  p_op_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(reference_id uuid, title text, summary text, source_url text, already_existed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  -- Server-side uuid5 PK. Namespace pinned to the Python pipeline constant
  -- _KH_PIPELINE_DOC_NS (flow.py) for cross-path identity parity.
  v_ri_id    uuid := extensions.uuid_generate_v5(
    'fbfaf1ff-1ee4-583c-9757-1674465b2ec1'::uuid, 'ri:' || p_source_url);
  v_existing uuid;
  v_embedding_model CONSTANT text := 'text-embedding-3-large';
BEGIN
  -- Idempotency: if the reference already exists, return it with
  -- already_existed = true and write NOTHING.
  SELECT ri.id INTO v_existing FROM public.reference_items ri WHERE ri.id = v_ri_id;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY
      SELECT ri.id, ri.title, ri.summary, ri.source_url, true
      FROM public.reference_items ri
      WHERE ri.id = v_ri_id;
    RETURN;
  END IF;

  -- DR-124: the reference item IS the record — no source_documents shell.
  INSERT INTO public.reference_items (
    id, title, body, summary, source_url, published_at, layer,
    ingestion_source, op_id)
  VALUES (
    v_ri_id, p_title, p_body, p_summary, p_source_url, p_published_at,
    'research',              -- v1 layer constant (validated by trg_validate_reference_items_layer)
    'url_import',            -- CHECK already admits this value (ID-75 schema)
    p_op_id)
  ON CONFLICT (id) DO NOTHING;  -- belt-and-braces idempotency vs a concurrent identical-URL race

  -- DR-036: the vector lands in the polymorphic record_embeddings store,
  -- keyed on the SAME deterministic PK so a re-ingest UPSERTs. Guarded on
  -- IS NOT NULL: callers tolerate embedding-generation failure with NULL.
  IF p_embedding IS NOT NULL THEN
    INSERT INTO public.record_embeddings (owner_kind, owner_id, model, embedding)
    VALUES ('reference_item', v_ri_id, v_embedding_model, p_embedding)
    ON CONFLICT (owner_kind, owner_id, model) DO UPDATE
      SET embedding = EXCLUDED.embedding,
          updated_at = now();
  END IF;

  RETURN QUERY
    SELECT ri.id, ri.title, ri.summary, ri.source_url, false
    FROM public.reference_items ri
    WHERE ri.id = v_ri_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.reference_ingest(text, text, text, text, vector, timestamp with time zone, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reference_ingest(text, text, text, text, vector, timestamp with time zone, uuid) TO authenticated, service_role;

-- §10c reference_list — domain filter params + domain/source_document_id
-- output columns removed (DR-130 / DR-124); otherwise carried forward.
CREATE FUNCTION public.reference_list(
  p_limit integer DEFAULT 48,
  p_offset integer DEFAULT 0,
  p_ingestion_source text DEFAULT NULL::text,
  p_published_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_published_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS TABLE(reference_id uuid, title text, summary_preview text, body_preview text, source_url text, published_at timestamp with time zone, layer text, ingestion_source text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    ri.id                                AS reference_id,
    ri.title,
    -- Previews: truncate to ~200 chars; summary is nullable, body is NOT NULL
    -- (byte-for-byte identical to reference_search)
    LEFT(COALESCE(ri.summary, ''), 200)  AS summary_preview,
    LEFT(ri.body, 200)                   AS body_preview,
    ri.source_url,
    ri.published_at,
    ri.layer,
    ri.ingestion_source
  FROM public.reference_items ri
  WHERE (p_ingestion_source IS NULL OR ri.ingestion_source = p_ingestion_source)
    AND (p_published_from IS NULL OR ri.published_at >= p_published_from)
    AND (p_published_to IS NULL OR ri.published_at <= p_published_to)
  ORDER BY ri.published_at DESC NULLS LAST, ri.id
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.reference_list(integer, integer, text, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reference_list(integer, integer, text, timestamp with time zone, timestamp with time zone) TO authenticated, service_role;

-- §10d reference_search — re-pointed at record_embeddings (the previous body
-- read ri.embedding, dropped by 20260706120000 — measured BROKEN at head:
-- 42703 on every call). Domain/source_document_id outputs removed.
CREATE FUNCTION public.reference_search(
  p_query text,
  p_query_embedding vector,
  p_limit integer DEFAULT 20)
RETURNS TABLE(reference_id uuid, title text, summary_preview text, body_preview text, embedding_score numeric, fulltext_score numeric, source_url text, published_at timestamp with time zone, layer text, ingestion_source text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_embedding_model CONSTANT text := 'text-embedding-3-large';
BEGIN
  RETURN QUERY
  WITH scored AS (
    SELECT
      ri.id                                                      AS reference_id,
      ri.title,
      -- Previews: truncate to ~200 chars; summary is nullable, body is NOT NULL
      LEFT(COALESCE(ri.summary, ''), 200)                        AS summary_preview,
      LEFT(ri.body, 200)                                         AS body_preview,
      -- Cosine similarity: 1 - distance (range 0..1, higher = more similar)
      (1.0 - (re.embedding <=> p_query_embedding))::numeric(5,4) AS embedding_score,
      -- Full-text rank over title + summary + body (normalisation option 2)
      ts_rank(
        to_tsvector(
          'english',
          ri.title
          || ' ' || COALESCE(ri.summary, '')
          || ' ' || ri.body
        ),
        plainto_tsquery('english', p_query),
        2
      )::numeric(5,4)                                            AS fulltext_score,
      ri.source_url,
      ri.published_at,
      ri.layer,
      ri.ingestion_source
    FROM public.reference_items ri
    JOIN public.record_embeddings re
      ON re.owner_kind = 'reference_item' AND re.owner_id = ri.id AND re.model = v_embedding_model
    WHERE re.embedding IS NOT NULL
  )
  SELECT
    s.reference_id,
    s.title,
    s.summary_preview,
    s.body_preview,
    s.embedding_score,
    s.fulltext_score,
    s.source_url,
    s.published_at,
    s.layer,
    s.ingestion_source
  FROM scored s
  -- Deterministic internal blend: embeddings dominate (0.6), fulltext breaks
  -- ties (0.4) — carried forward (N9 RESOLVED-S236).
  ORDER BY (COALESCE(s.embedding_score, 0) * 0.6 + s.fulltext_score * 0.4) DESC
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.reference_search(text, vector, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reference_search(text, vector, integer) TO authenticated, service_role;

-- §10e reference_get_verbatim — domain/source_document_id outputs removed;
-- embedding still deliberately omitted (BI-16 payload discipline).
CREATE FUNCTION public.reference_get_verbatim(p_reference_id uuid)
RETURNS TABLE(id uuid, title text, body text, summary text, source_url text, published_at timestamp with time zone, layer text, ingestion_source text, op_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    ri.id,
    ri.title,
    ri.body,
    ri.summary,
    ri.source_url,
    ri.published_at,
    ri.layer,
    ri.ingestion_source,
    ri.op_id,
    ri.created_at,
    ri.updated_at
  FROM public.reference_items ri
  WHERE ri.id = p_reference_id
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.reference_get_verbatim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reference_get_verbatim(uuid) TO authenticated, service_role;

-- §10f get_aggregate_win_rate_stats — same signature and return shape
-- (CREATE OR REPLACE); the per-domain scope grouping stood on
-- record_lifecycle.domain (dropped §6) and retires with the axis. The
-- function now returns the 'overall' scope row only.
CREATE OR REPLACE FUNCTION public.get_aggregate_win_rate_stats()
RETURNS TABLE(scope text, total_citations bigint, winning_citations bigint, losing_citations bigint, pending_citations bigint, win_rate numeric, unique_items_cited bigint, unique_procurements bigint, shortlist_total bigint, shortlist_passed bigint, shortlist_pass_rate numeric)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  WITH "citation_detail" AS (
    SELECT
      "cc"."cited_q_a_pair_id",
      "cc"."citing_form_response_id",
      "ft"."id" AS "form_instance_id",
      "ft"."outcome"                    AS "outcome",
      "fot"."counts_toward_win_rate"    AS "counts_toward_win_rate",
      "fot"."stage"                     AS "outcome_stage"
    FROM "public"."citations" "cc"
    JOIN "public"."form_responses" "br" ON "br"."id" = "cc"."citing_form_response_id"
    JOIN "public"."form_questions" "fq" ON "fq"."id" = "br"."question_id"
    JOIN "public"."form_instances" "ft" ON "ft"."id" = "fq"."form_instance_id"
    LEFT JOIN "public"."form_outcome_types" "fot" ON "fot"."key" = "ft"."outcome"
    WHERE "cc"."cited_kind" = 'q_a_pair'
  )
  SELECT
    'overall'::"text" AS "scope",
    COUNT(*)::bigint AS "total_citations",
    COUNT(*) FILTER (WHERE "cd"."outcome" = 'won')::bigint AS "winning_citations",
    COUNT(*) FILTER (WHERE "cd"."outcome" = 'lost')::bigint AS "losing_citations",
    COUNT(*) FILTER (WHERE COALESCE("cd"."counts_toward_win_rate", false) = false)::bigint AS "pending_citations",
    CASE
      WHEN COUNT(*) FILTER (WHERE "cd"."counts_toward_win_rate" = true) > 0 THEN
        ROUND(
          COUNT(*) FILTER (WHERE "cd"."outcome" = 'won')::numeric /
          COUNT(*) FILTER (WHERE "cd"."counts_toward_win_rate" = true)::numeric,
          2
        )
      ELSE 0
    END AS "win_rate",
    COUNT(DISTINCT "cd"."cited_q_a_pair_id")::bigint AS "unique_items_cited",
    COUNT(DISTINCT "cd"."form_instance_id")::bigint AS "unique_procurements",
    COUNT(*) FILTER (WHERE "cd"."outcome_stage" = 'shortlist')::bigint AS "shortlist_total",
    COUNT(*) FILTER (WHERE "cd"."outcome" = 'shortlisted')::bigint AS "shortlist_passed",
    CASE
      WHEN COUNT(*) FILTER (WHERE "cd"."outcome_stage" = 'shortlist') > 0 THEN
        ROUND(
          COUNT(*) FILTER (WHERE "cd"."outcome" = 'shortlisted')::numeric /
          COUNT(*) FILTER (WHERE "cd"."outcome_stage" = 'shortlist')::numeric,
          2
        )
      ELSE 0
    END AS "shortlist_pass_rate"
  FROM "citation_detail" "cd";
END;
$function$;

-- ═════════════════════════════════════════════════════════════════════════
-- §11 api-schema RPC wrappers for the new signatures (INVOKER, LANGUAGE sql,
--     named-arg delegation — generator parity; grants mirror the public fns)
-- ═════════════════════════════════════════════════════════════════════════

CREATE FUNCTION api.hybrid_search(
  query_embedding vector,
  query_text text DEFAULT ''::text,
  similarity_threshold numeric DEFAULT 0.3,
  limit_count integer DEFAULT 10,
  include_superseded boolean DEFAULT false,
  visibility_filter character varying DEFAULT 'default'::character varying,
  application_type text DEFAULT 'procurement'::text,
  filter_kind text DEFAULT NULL::text,
  filter_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  filter_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS TABLE(
  id uuid, title text, summary text, content_type text, platform text,
  author_name text, source_domain text, thumbnail_url text,
  captured_date timestamp with time zone, ai_keywords text[], priority text,
  metadata jsonb, similarity numeric, snippet text, created_by uuid,
  verified_at timestamp with time zone, verified_by uuid, scope_tag text[],
  source_url text, owner_kind text)
LANGUAGE sql
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT * FROM public.hybrid_search(query_embedding => query_embedding, query_text => query_text, similarity_threshold => similarity_threshold, limit_count => limit_count, include_superseded => include_superseded, visibility_filter => visibility_filter, application_type => application_type, filter_kind => filter_kind, filter_date_from => filter_date_from, filter_date_to => filter_date_to);
$function$;

REVOKE ALL ON FUNCTION api.hybrid_search(vector, text, numeric, integer, boolean, character varying, text, text, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.hybrid_search(vector, text, numeric, integer, boolean, character varying, text, text, timestamp with time zone, timestamp with time zone) TO authenticated, service_role;

CREATE FUNCTION api.reference_ingest(
  p_source_url text,
  p_title text,
  p_body text,
  p_summary text,
  p_embedding vector,
  p_published_at timestamp with time zone,
  p_op_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(reference_id uuid, title text, summary text, source_url text, already_existed boolean)
LANGUAGE sql
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT * FROM public.reference_ingest(p_source_url => p_source_url, p_title => p_title, p_body => p_body, p_summary => p_summary, p_embedding => p_embedding, p_published_at => p_published_at, p_op_id => p_op_id);
$function$;

REVOKE ALL ON FUNCTION api.reference_ingest(text, text, text, text, vector, timestamp with time zone, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.reference_ingest(text, text, text, text, vector, timestamp with time zone, uuid) TO authenticated, service_role;

CREATE FUNCTION api.reference_list(
  p_limit integer DEFAULT 48,
  p_offset integer DEFAULT 0,
  p_ingestion_source text DEFAULT NULL::text,
  p_published_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_published_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS TABLE(reference_id uuid, title text, summary_preview text, body_preview text, source_url text, published_at timestamp with time zone, layer text, ingestion_source text)
LANGUAGE sql
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT * FROM public.reference_list(p_limit => p_limit, p_offset => p_offset, p_ingestion_source => p_ingestion_source, p_published_from => p_published_from, p_published_to => p_published_to);
$function$;

REVOKE ALL ON FUNCTION api.reference_list(integer, integer, text, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.reference_list(integer, integer, text, timestamp with time zone, timestamp with time zone) TO authenticated, service_role;

CREATE FUNCTION api.reference_search(
  p_query text,
  p_query_embedding vector,
  p_limit integer DEFAULT 20)
RETURNS TABLE(reference_id uuid, title text, summary_preview text, body_preview text, embedding_score numeric, fulltext_score numeric, source_url text, published_at timestamp with time zone, layer text, ingestion_source text)
LANGUAGE sql
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT * FROM public.reference_search(p_query => p_query, p_query_embedding => p_query_embedding, p_limit => p_limit);
$function$;

REVOKE ALL ON FUNCTION api.reference_search(text, vector, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.reference_search(text, vector, integer) TO authenticated, service_role;

CREATE FUNCTION api.reference_get_verbatim(p_reference_id uuid)
RETURNS TABLE(id uuid, title text, body text, summary text, source_url text, published_at timestamp with time zone, layer text, ingestion_source text, op_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE sql
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT * FROM public.reference_get_verbatim(p_reference_id => p_reference_id);
$function$;

REVOKE ALL ON FUNCTION api.reference_get_verbatim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.reference_get_verbatim(uuid) TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- §12 Recreate the api views minus retired columns (generator parity:
--     security_invoker, explicit ordinal column lists, measured grants —
--     authenticated + service_role get S/I/U/D on all five; no anon)
-- ═════════════════════════════════════════════════════════════════════════

CREATE VIEW api.source_documents WITH (security_invoker = true) AS
  SELECT
    id,
    filename,
    original_filename,
    mime_type,
    file_size,
    content_hash,
    version,
    parent_id,
    storage_path,
    status,
    extracted_text,
    extraction_metadata,
    uploaded_by,
    created_at,
    archived_at,
    archived_by,
    op_id,
    extraction_method,
    ai_keywords,
    content_type,
    captured_date,
    summary_data,
    updated_by,
    updated_at,
    publication_status,
    origin_type,
    locator,
    retention_class,
    cadence,
    auth,
    admission_status,
    logical_path
  FROM public.source_documents;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.source_documents TO authenticated, service_role;

CREATE VIEW api.reference_items WITH (security_invoker = true) AS
  SELECT
    id,
    title,
    body,
    summary,
    source_url,
    published_at,
    layer,
    ingestion_source,
    op_id,
    created_at,
    updated_at,
    thumbnail_url,
    superseded_by
  FROM public.reference_items;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.reference_items TO authenticated, service_role;

CREATE VIEW api.form_requirement_templates WITH (security_invoker = true) AS
  SELECT
    id,
    template_name,
    template_version,
    template_type,
    section_ref,
    section_name,
    question_number,
    requirement_text,
    description,
    requirement_type,
    matching_keywords,
    matching_guidance,
    is_mandatory,
    is_current,
    sector_applicability,
    word_limit_guidance,
    display_order,
    created_at,
    updated_at
  FROM public.form_requirement_templates;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_requirement_templates TO authenticated, service_role;

CREATE VIEW api.record_lifecycle WITH (security_invoker = true) AS
  SELECT
    id,
    owner_kind,
    source_document_id,
    q_a_pair_id,
    owner_id,
    governance_review_status,
    governance_review_due,
    governance_reviewer_id,
    verified_at,
    verified_by,
    content_owner_id,
    freshness,
    freshness_checked_at,
    previous_freshness,
    lifecycle_type,
    expiry_date,
    next_review_date,
    review_cadence_days,
    created_at,
    updated_at
  FROM public.record_lifecycle;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.record_lifecycle TO authenticated, service_role;

CREATE VIEW api.review_assignments WITH (security_invoker = true) AS
  SELECT
    id,
    reviewer_id,
    assigned_by,
    assignment_type,
    filter_content_types,
    filter_freshness,
    filter_date_from,
    filter_date_to,
    item_count,
    status,
    notes,
    due_date,
    completed_at,
    created_at,
    updated_at
  FROM public.review_assignments;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.review_assignments TO authenticated, service_role;

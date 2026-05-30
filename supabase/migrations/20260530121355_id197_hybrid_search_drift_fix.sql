-- =============================================================================
-- ID-197 — staging-DB schema drift fix (two sub-issues, one fix vehicle)
-- =============================================================================
-- Sources of truth:
--   * docs/reference/product-backlog.json ID-197 (S283 CI triage, run 26659545901)
--   * docs/reference/backlog/197.md
--
-- Root causes (both: staging/prod DB body-rewrite lag after a column rename):
--
--   (1) hybrid_search + search_for_bid_response RPC bodies reference the stale
--       column `bq.project_id`. Migration 20260520120828 (T2/S246) executed
--       `ALTER TABLE public.bid_questions RENAME COLUMN project_id TO
--       workspace_id`. Postgres ALTER ... RENAME COLUMN does NOT rewrite
--       function bodies, so the win_stats CTE in both search RPCs continued to
--       reference `bq.project_id` and now errors SQLSTATE 42703
--       (`column bq.project_id does not exist`) on every call. The sibling RPC
--       `get_bid_question_stats_batch` was already corrected by migration
--       20260521100650; hybrid_search + search_for_bid_response were missed in
--       that wave. Their last CREATE was migration 20260430192325 (pre-rename).
--
--   (2) pipeline_runs.ended_at column is missing from the schema. The DLQ /
--       op-id integration suite selects this column
--       (__tests__/integration/cocoindex/persistent-failure-dlq.integration.test.ts:106,
--        __tests__/integration/cocoindex/op-id-stamping.integration.test.ts:178),
--       which produces SQLSTATE 42703 on the `.select('...ended_at')`. No
--       migration ever added `ended_at`; the squash CREATE TABLE
--       (20260416102457:3872-3891) defines started_at / completed_at / created_at
--       but no ended_at. Added here as nullable timestamptz (sibling-column type).
--
-- Function-attribute preservation (both RPCs): bodies copied verbatim from
-- migration 20260430192325 (S216 W3) — same signature, RETURNS TABLE shape,
-- LANGUAGE, volatility, SECURITY clause, SET search_path, grants and comment —
-- with the SINGLE change `bq.project_id` → `bq.workspace_id` in the win_stats
-- JOIN. CREATE OR REPLACE (not DROP+CREATE): the signature and return type are
-- unchanged, so REPLACE is sufficient and avoids dropping grants.
--
-- DDL note: per CLAUDE.md this must be applied via `supabase db push` (CLI),
-- never MCP execute_sql / apply_migration. Verify `cat supabase/.temp/project-ref`
-- == turayklvaunphgbgscat (staging) before push.
-- =============================================================================

SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- (2) pipeline_runs.ended_at — add missing column (idempotent)
-- ---------------------------------------------------------------------------
ALTER TABLE public.pipeline_runs
  ADD COLUMN IF NOT EXISTS ended_at timestamp with time zone;

COMMENT ON COLUMN public.pipeline_runs.ended_at IS
  'ID-197: terminal-state timestamp for a pipeline run. Added to resolve '
  'SQLSTATE 42703 in the DLQ / op-id integration suite which selects this '
  'column. Nullable; populated by the pipeline on terminal status.';

-- ---------------------------------------------------------------------------
-- (1a) hybrid_search — fix stale bq.project_id → bq.workspace_id
--      Verbatim copy of the 20260430192325 (S216 W3) body; ONLY change is the
--      win_stats JOIN column. Signature + return shape unchanged → REPLACE.
--      SECURITY INVOKER (NOT the DEFINER in 20260430192325): a later migration
--      20260506091039 (OPS-43.1 batch 3) ran ALTER FUNCTION hybrid_search
--      SECURITY INVOKER. CREATE OR REPLACE re-specifies the security clause, so
--      we set INVOKER here to preserve the live posture (DEFINER would revert
--      the OPS-43.1 hardening — a regression). search_for_bid_response was always
--      INVOKER (no SECDEF) and is untouched by that batch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_embedding vector,
  query_text text DEFAULT '',
  similarity_threshold numeric DEFAULT 0.3,
  limit_count integer DEFAULT 10,
  include_superseded boolean DEFAULT false,
  visibility_filter varchar DEFAULT 'default'
)
RETURNS TABLE(
  id uuid,
  title text,
  suggested_title text,
  summary text,
  primary_domain text,
  primary_subtopic text,
  content_type text,
  platform text,
  author_name text,
  source_domain text,
  thumbnail_url text,
  captured_date timestamp with time zone,
  ai_keywords text[],
  classification_confidence numeric,
  priority text,
  metadata jsonb,
  similarity numeric,
  snippet text,
  created_by uuid,
  verified_at timestamp with time zone,
  verified_by uuid
)
LANGUAGE plpgsql
STABLE SECURITY INVOKER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  win_boost CONSTANT numeric := 0.03;
  min_win_citations CONSTANT integer := 2;
BEGIN
  RETURN QUERY
  WITH win_stats AS (
    SELECT cc.content_item_id,
      COUNT(DISTINCT cc.bid_response_id)::integer AS total_citations,
      COUNT(DISTINCT cc.bid_response_id) FILTER (
        WHERE w.domain_metadata->>'outcome' = 'won'
      )::numeric / NULLIF(COUNT(DISTINCT cc.bid_response_id), 0) AS win_rate
    FROM content_citations cc
    JOIN bid_responses br ON br.id = cc.bid_response_id
    JOIN bid_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.workspace_id
    GROUP BY cc.content_item_id
  )
  SELECT
    ci.id, ci.title, ci.suggested_title, ci.summary,
    ci.primary_domain::text, ci.primary_subtopic::text, ci.content_type::text, ci.platform::text,
    ci.author_name::text, ci.source_domain::text, ci.thumbnail_url, ci.captured_date,
    ci.ai_keywords, ci.classification_confidence, ci.priority::text, ci.metadata,
    LEAST(1.0, (
      (1 - (ci.embedding <=> query_embedding)) * 0.70
      + CASE WHEN ci.suggested_title ILIKE '%' || query_text || '%' THEN 0.15
             WHEN ci.title ILIKE '%' || query_text || '%' THEN 0.15
             ELSE 0.0 END
      + CASE WHEN query_text = ANY(ci.ai_keywords) THEN 0.10
             WHEN EXISTS (SELECT 1 FROM unnest(ci.ai_keywords) AS kw WHERE kw ILIKE '%' || query_text || '%') THEN 0.05
             ELSE 0.0 END
      + CASE WHEN ci.summary ILIKE '%' || query_text || '%' THEN 0.03 ELSE 0.0 END
      + CASE WHEN ci.author_name ILIKE '%' || query_text || '%' THEN 0.02 ELSE 0.0 END
      + CASE WHEN ci.captured_date IS NOT NULL AND ci.captured_date > NOW() - INTERVAL '30 days'
             THEN 0.05 * (1.0 - EXTRACT(EPOCH FROM (NOW() - ci.captured_date)) / (30.0 * 86400.0))
             ELSE 0.0 END
    ) * CASE
        WHEN COALESCE(ws.total_citations, 0) >= min_win_citations
        THEN (1.0 + win_boost * COALESCE(ws.win_rate, 0.0))
        ELSE 1.0
      END
    )::NUMERIC(4, 3) AS similarity,
    CASE WHEN query_text IS NOT NULL AND query_text != '' AND ci.content IS NOT NULL
         AND position(lower(query_text) IN lower(ci.content)) > 0
         THEN substring(ci.content FROM greatest(1, position(lower(query_text) IN lower(ci.content)) - 80) FOR 200)
         ELSE NULL END AS snippet,
    ci.created_by,
    ci.verified_at,
    ci.verified_by
  FROM content_items ci
  LEFT JOIN win_stats ws ON ws.content_item_id = ci.id
  WHERE ci.embedding IS NOT NULL
    AND (include_superseded OR ci.superseded_by IS NULL)
    AND CASE visibility_filter
          WHEN 'default' THEN ci.publication_status = 'published'
          WHEN 'all' THEN ci.publication_status != 'archived'
          WHEN 'admin' THEN TRUE
          ELSE ci.publication_status = 'published'
        END
    AND (
      (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
      OR (
        query_text IS NOT NULL AND query_text != '' AND (
          ci.suggested_title ILIKE '%' || query_text || '%'
          OR ci.title ILIKE '%' || query_text || '%'
          OR ci.content ILIKE '%' || query_text || '%'
        )
      )
    )
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$function$;

COMMENT ON FUNCTION public.hybrid_search(
  vector, text, numeric, integer, boolean, varchar
) IS 'S216 W3 §5.2 Phase 3 + ID-197: hybrid full-text + vector search with visibility_filter. default=published-only, all=non-archived, admin=all states. Preserves include_superseded orthogonally. ID-197 fixes the win_stats JOIN column bq.project_id -> bq.workspace_id (T2/S246 rename, SQLSTATE 42703).';

-- ---------------------------------------------------------------------------
-- (1b) search_for_bid_response — identical bq.project_id defect, same fix.
--      Verbatim copy of the 20260430192325 (S216 W3) body; ONLY change is the
--      win_stats JOIN column. NEVER SECURITY DEFINER (S186 verifier L1).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_for_bid_response(
  query_embedding vector,
  query_text text DEFAULT '',
  limit_count integer DEFAULT 10,
  include_superseded boolean DEFAULT false,
  visibility_filter varchar DEFAULT 'default'
)
RETURNS TABLE(
  id uuid,
  title text,
  content text,
  brief text,
  detail text,
  primary_domain character varying,
  primary_subtopic character varying,
  content_type character varying,
  ai_keywords text[],
  similarity numeric
)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  win_boost CONSTANT numeric := 0.03;
  min_win_citations CONSTANT integer := 2;
BEGIN
  RETURN QUERY
  WITH win_stats AS (
    SELECT
      cc.content_item_id,
      COUNT(DISTINCT cc.bid_response_id)::integer AS total_citations,
      COUNT(DISTINCT cc.bid_response_id) FILTER (
        WHERE w.domain_metadata->>'outcome' = 'won'
      )::numeric / NULLIF(COUNT(DISTINCT cc.bid_response_id), 0) AS win_rate
    FROM content_citations cc
    JOIN bid_responses br ON br.id = cc.bid_response_id
    JOIN bid_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.workspace_id
    GROUP BY cc.content_item_id
  )
  SELECT
    ci.id, ci.title, ci.content, ci.brief, ci.detail,
    ci.primary_domain, ci.primary_subtopic, ci.content_type, ci.ai_keywords,
    LEAST(1.0, (
      (1 - (ci.embedding <=> query_embedding)) * 0.80
      + CASE WHEN query_text != '' AND ci.title ILIKE '%' || query_text || '%' THEN 0.10
             ELSE 0.0 END
      + CASE WHEN query_text != '' AND query_text = ANY(ci.ai_keywords) THEN 0.10
             ELSE 0.0 END
    ) * CASE
        WHEN COALESCE(ws.total_citations, 0) >= min_win_citations
        THEN (1.0 + win_boost * COALESCE(ws.win_rate, 0.0))
        ELSE 1.0
      END
    )::NUMERIC(4, 3) AS similarity
  FROM content_items ci
  LEFT JOIN win_stats ws ON ws.content_item_id = ci.id
  WHERE ci.embedding IS NOT NULL
    AND (1 - (ci.embedding <=> query_embedding)) > 0.25
    AND (include_superseded OR ci.superseded_by IS NULL)
    AND CASE visibility_filter
          WHEN 'default' THEN ci.publication_status = 'published'
          WHEN 'all' THEN ci.publication_status != 'archived'
          WHEN 'admin' THEN TRUE
          ELSE ci.publication_status = 'published'
        END
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$function$;

COMMENT ON FUNCTION public.search_for_bid_response(
  vector, text, integer, boolean, varchar
) IS 'S216 W3 §5.2 Phase 3 + ID-197: bid-response search with visibility_filter. default=published-only, all=non-archived, admin=all states. ID-197 fixes the win_stats JOIN column bq.project_id -> bq.workspace_id (T2/S246 rename, SQLSTATE 42703).';

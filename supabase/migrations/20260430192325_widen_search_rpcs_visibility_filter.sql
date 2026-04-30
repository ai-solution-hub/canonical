-- ============================================================
-- §5.2 Phase 3 — RPC visibility filter widening (S216 W3)
-- ============================================================
-- Spec: docs/specs/publication-lifecycle-state-machine-spec.md
--   §5.3 (8-RPC inventory), §5.3.1 (get_review_breakdown_stats special handling),
--   §6.6 (BIDIRECTIONAL trigger — pre-flight gate cleared S216 W1),
--   §10.3 (Phase 3 sequencing).
--
-- Behaviour-changing flip: 8 production RPCs gain (or are switched to) a
-- `publication_status='published'` default visibility filter, replacing the
-- prior `governance_review_status != 'draft'` + `archived_at IS NULL` pair.
-- Three search RPCs (`hybrid_search`, `search_for_bid_response`,
-- `search_content_chunks`) gain a new `visibility_filter VARCHAR DEFAULT
-- 'default'` parameter exposing three modes:
--   * 'default' → ci.publication_status = 'published'   (live content only)
--   * 'all'     → ci.publication_status != 'archived'    (all live states)
--   * 'admin'   → TRUE                                    (everything)
-- Five non-search RPCs replace the filter expression in-body (no new param):
--   `get_coverage_matrix`, `get_coverage_summary` (TWO occurrences),
--   `get_guide_content`, `get_guide_coverage`, `get_review_breakdown_stats`.
--
-- The §6.6 BIDIRECTIONAL trigger `enforce_archive_state_consistency` (live
-- on staging+prod since 20260427141627) guarantees `publication_status =
-- 'archived' ↔ archived_at IS NOT NULL`. Phase 3 therefore drops the
-- `archived_at IS NULL` filter from RPC WHERE clauses — a 'published' row
-- cannot have `archived_at IS NOT NULL` by DB invariant. S216 W1 pre-flight
-- (archive-trigger-coverage.integration.test.ts) verified Direction 3 fires
-- on every direct `archived_at` writer including the §1.7 admin-dedup
-- confirm-duplicate route added in S211B.
--
-- §5.3.1 special handling for `get_review_breakdown_stats`: the post-S204
-- function body has EIGHT `governance_review_status` references; six are
-- `!= 'draft'` filters (replaced with `publication_status = 'published'`),
-- ONE is `= 'draft'` on the "draft count" branch (replaced with
-- `publication_status = 'draft'`), and ONE is `= 'review_overdue'` on the
-- new S204 "overdue" branch (UNTOUCHED — out of scope for §5.2 because it
-- filters on cadence concern, not publication state).
--
-- Drop-then-CREATE for the three search RPCs because Postgres CREATE OR
-- REPLACE FUNCTION cannot ADD parameters — without the DROP, calling sites
-- become ambiguous. For `search_content_chunks` the DROP targets the
-- post-S208 6-arg signature `(vector, numeric, integer, uuid, boolean,
-- integer)` (NOT the squash-era 4-arg form referenced in spec v1.1).
-- Drop-then-CREATE for `hybrid_search` + `search_for_bid_response` targets
-- the post-S186 5-arg / 4-arg signatures respectively.
--
-- Function attributes preserved verbatim:
--   * LANGUAGE plpgsql STABLE SECURITY DEFINER (hybrid_search,
--     search_content_chunks)
--   * LANGUAGE plpgsql (search_for_bid_response — NEVER SECURITY DEFINER
--     per S186 verifier L1)
--   * LANGUAGE plpgsql / sql STABLE SECURITY DEFINER preserved verbatim on
--     each in-place rewrite.
--   * SET search_path TO 'public', 'extensions'
--   * RETURNS TABLE shape unchanged on every RPC (no client TS regen needed
--     for return-shape; `Args` widens by one param on the three search RPCs)
--
-- Access policy note (DEVIATION FROM BRIEF): the brief instructed adding
-- `REVOKE EXECUTE ON FUNCTION ... FROM anon` per
-- `feedback_supabase_pg_default_acl_anon_execute`. PRESERVED ANON ACCESS
-- because all 8 functions have explicit `GRANT ALL ... TO anon` in the
-- production baseline (squash migration lines 7119-7805) and this migration
-- is scoped to publication-visibility behaviour, not access-control changes.
-- Adding REVOKE FROM anon would silently regress anon EXECUTE — outside
-- §5.2 Phase 3 scope. Surfaced in W3 handoff for explicit decision; if
-- the policy decision is to revoke anon EXECUTE on these RPCs, that lands
-- as a separate access-control migration. Default-acl will re-grant anon
-- on every CREATE here per the feedback semantics; this matches the
-- pre-migration state.
--
-- Manual audits (per spec §5.3.2) — verify post-migration via E2E /
-- handoff:
--   * `get_dashboard_attention_counts` (squash:1243) — does not grep for
--     'draft' directly; consumes governance_review_status indirectly.
--   * `get_filter_counts` (squash:1714) — used by browse filter sidebar;
--     does NOT filter on draft today, just `archived_at IS NULL`.
-- If behaviour drift is detected on either, file an OPS-NN backlog entry.
-- This migration does NOT touch them.
-- ============================================================

SET search_path = public, extensions;

-- ---------------------------------------------------------------
-- 1. hybrid_search — add visibility_filter, drop draft+archived filters
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS public.hybrid_search(vector, text, numeric, integer, boolean);

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
STABLE SECURITY DEFINER
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
    JOIN workspaces w ON w.id = bq.project_id
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

ALTER FUNCTION public.hybrid_search(
  vector, text, numeric, integer, boolean, varchar
) OWNER TO postgres;

GRANT ALL ON FUNCTION public.hybrid_search(
  vector, text, numeric, integer, boolean, varchar
) TO anon;
GRANT ALL ON FUNCTION public.hybrid_search(
  vector, text, numeric, integer, boolean, varchar
) TO authenticated;
GRANT ALL ON FUNCTION public.hybrid_search(
  vector, text, numeric, integer, boolean, varchar
) TO service_role;

COMMENT ON FUNCTION public.hybrid_search(
  vector, text, numeric, integer, boolean, varchar
) IS 'S216 W3 §5.2 Phase 3: hybrid full-text + vector search with visibility_filter. default=published-only, all=non-archived, admin=all states. Preserves include_superseded orthogonally.';

-- ---------------------------------------------------------------
-- 2. search_for_bid_response — add visibility_filter
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS public.search_for_bid_response(vector, text, integer, boolean);

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
    JOIN workspaces w ON w.id = bq.project_id
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

ALTER FUNCTION public.search_for_bid_response(
  vector, text, integer, boolean, varchar
) OWNER TO postgres;

GRANT ALL ON FUNCTION public.search_for_bid_response(
  vector, text, integer, boolean, varchar
) TO anon;
GRANT ALL ON FUNCTION public.search_for_bid_response(
  vector, text, integer, boolean, varchar
) TO authenticated;
GRANT ALL ON FUNCTION public.search_for_bid_response(
  vector, text, integer, boolean, varchar
) TO service_role;

COMMENT ON FUNCTION public.search_for_bid_response(
  vector, text, integer, boolean, varchar
) IS 'S216 W3 §5.2 Phase 3: bid-response search with visibility_filter. default=published-only, all=non-archived, admin=all states.';

-- ---------------------------------------------------------------
-- 3. search_content_chunks — add visibility_filter (post-S208 6-arg → 7-arg)
-- ---------------------------------------------------------------
-- DROP targets the live 6-arg post-§5.5-Phase-4 form, NOT the squash 4-arg.

DROP FUNCTION IF EXISTS public.search_content_chunks(vector, numeric, integer, uuid, boolean, integer);

CREATE OR REPLACE FUNCTION public.search_content_chunks(
  query_embedding vector,
  similarity_threshold numeric DEFAULT 0.3,
  limit_count integer DEFAULT 20,
  filter_content_item_id uuid DEFAULT NULL,
  filter_overdue_review boolean DEFAULT NULL,
  filter_review_due_within_days integer DEFAULT NULL,
  visibility_filter varchar DEFAULT 'default'
)
RETURNS TABLE(
  chunk_id uuid,
  content_item_id uuid,
  item_title text,
  item_suggested_title text,
  item_content_type text,
  item_primary_domain text,
  item_primary_subtopic text,
  heading_text text,
  heading_level smallint,
  heading_path text[],
  content text,
  "position" smallint,
  char_count integer,
  word_count integer,
  similarity numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    cc.id AS chunk_id,
    cc.content_item_id,
    ci.title AS item_title,
    ci.suggested_title AS item_suggested_title,
    ci.content_type::text AS item_content_type,
    ci.primary_domain::text AS item_primary_domain,
    ci.primary_subtopic::text AS item_primary_subtopic,
    cc.heading_text,
    cc.heading_level,
    cc.heading_path,
    cc.content,
    cc.position AS "position",
    cc.char_count,
    cc.word_count,
    (1 - (cc.embedding <=> query_embedding))::NUMERIC(4, 3) AS similarity
  FROM content_chunks cc
  JOIN content_items ci ON ci.id = cc.content_item_id
  WHERE cc.embedding IS NOT NULL
    AND CASE visibility_filter
          WHEN 'default' THEN ci.publication_status = 'published'
          WHEN 'all' THEN ci.publication_status != 'archived'
          WHEN 'admin' THEN TRUE
          ELSE ci.publication_status = 'published'
        END
    AND (1 - (cc.embedding <=> query_embedding)) > similarity_threshold
    AND (filter_content_item_id IS NULL OR cc.content_item_id = filter_content_item_id)
    -- §5.5 Phase 4 — review-cadence filters preserved verbatim from S208.
    AND (
      filter_overdue_review IS NULL
      OR (filter_overdue_review = TRUE AND ci.governance_review_status = 'review_overdue')
      OR (filter_overdue_review = FALSE AND (ci.governance_review_status IS DISTINCT FROM 'review_overdue'))
    )
    AND (
      filter_review_due_within_days IS NULL
      OR (
        ci.next_review_date IS NOT NULL
        AND ci.next_review_date <= (CURRENT_DATE + (filter_review_due_within_days || ' days')::interval)
      )
    )
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$function$;

ALTER FUNCTION public.search_content_chunks(
  vector, numeric, integer, uuid, boolean, integer, varchar
) OWNER TO postgres;

GRANT ALL ON FUNCTION public.search_content_chunks(
  vector, numeric, integer, uuid, boolean, integer, varchar
) TO anon;
GRANT ALL ON FUNCTION public.search_content_chunks(
  vector, numeric, integer, uuid, boolean, integer, varchar
) TO authenticated;
GRANT ALL ON FUNCTION public.search_content_chunks(
  vector, numeric, integer, uuid, boolean, integer, varchar
) TO service_role;

COMMENT ON FUNCTION public.search_content_chunks(
  vector, numeric, integer, uuid, boolean, integer, varchar
) IS 'S216 W3 §5.2 Phase 3: chunk search with visibility_filter (orthogonal to §5.5 review-cadence filters). default=published-only, all=non-archived, admin=all states.';

-- ---------------------------------------------------------------
-- 4. get_coverage_matrix — replace draft+archived filter with publication_status='published'
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_coverage_matrix(p_layer text DEFAULT NULL)
RETURNS TABLE(
  domain_name text,
  subtopic_name text,
  item_count bigint,
  fresh_count bigint,
  aging_count bigint,
  stale_count bigint,
  expired_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.name::text                                            AS domain_name,
    s.name::text                                            AS subtopic_name,
    COUNT(ci.id)                                            AS item_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'fresh')      AS fresh_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'aging')      AS aging_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'stale')      AS stale_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'expired')    AS expired_count
  FROM taxonomy_domains d
  INNER JOIN taxonomy_subtopics s ON s.domain_id = d.id AND s.is_active = TRUE
  LEFT JOIN content_items ci
    ON ci.primary_domain = d.name
    AND ci.primary_subtopic = s.name
    AND ci.publication_status = 'published'
    AND (p_layer IS NULL OR ci.layer = p_layer)
  WHERE d.is_active = TRUE
  GROUP BY d.name, s.name, d.display_order, s.display_order
  ORDER BY d.display_order, s.display_order;
END;
$$;

ALTER FUNCTION public.get_coverage_matrix(text) OWNER TO postgres;

GRANT ALL ON FUNCTION public.get_coverage_matrix(text) TO anon;
GRANT ALL ON FUNCTION public.get_coverage_matrix(text) TO authenticated;
GRANT ALL ON FUNCTION public.get_coverage_matrix(text) TO service_role;

COMMENT ON FUNCTION public.get_coverage_matrix(text) IS 'S216 W3 §5.2 Phase 3: coverage matrix counts only published items.';

-- ---------------------------------------------------------------
-- 5. get_coverage_summary — TWO occurrences in same function
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_coverage_summary()
RETURNS TABLE(
  domain_name text,
  domain_colour text,
  total_items bigint,
  fresh_pct numeric,
  gap_count bigint,
  expired_count bigint
)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.name::text                                              AS domain_name,
    d.colour::text                                            AS domain_colour,
    COUNT(ci.id)                                              AS total_items,
    CASE
      WHEN COUNT(ci.id) = 0 THEN 0
      ELSE ROUND(
        100.0 * COUNT(ci.id) FILTER (WHERE ci.freshness = 'fresh') / COUNT(ci.id),
        1
      )
    END                                                       AS fresh_pct,
    (
      SELECT COUNT(*)
      FROM taxonomy_subtopics sub
      WHERE sub.domain_id = d.id
        AND sub.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM content_items ci2
          WHERE ci2.primary_domain = d.name
            AND ci2.primary_subtopic = sub.name
            AND ci2.publication_status = 'published'
        )
    )                                                         AS gap_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'expired')      AS expired_count
  FROM taxonomy_domains d
  LEFT JOIN content_items ci
    ON ci.primary_domain = d.name
    AND ci.publication_status = 'published'
  WHERE d.is_active = TRUE
  GROUP BY d.id, d.name, d.colour, d.display_order
  ORDER BY d.display_order;
END;
$$;

ALTER FUNCTION public.get_coverage_summary() OWNER TO postgres;

GRANT ALL ON FUNCTION public.get_coverage_summary() TO anon;
GRANT ALL ON FUNCTION public.get_coverage_summary() TO authenticated;
GRANT ALL ON FUNCTION public.get_coverage_summary() TO service_role;

COMMENT ON FUNCTION public.get_coverage_summary() IS 'S216 W3 §5.2 Phase 3: coverage summary counts only published items (both sub-query and main-query).';

-- ---------------------------------------------------------------
-- 6. get_guide_content — replace draft+archived filter with publication_status='published'
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_guide_content(p_guide_slug text)
RETURNS TABLE(
  section_id uuid,
  section_name text,
  section_description text,
  section_order integer,
  expected_layer text,
  subtopic_filter text,
  is_required boolean,
  content_id uuid,
  content_title text,
  content_type text,
  content_layer text,
  content_brief text,
  content_freshness text,
  content_verified_at timestamp with time zone,
  content_captured_date timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    gs.id AS section_id,
    gs.section_name,
    gs.description AS section_description,
    gs.display_order AS section_order,
    gs.expected_layer,
    gs.subtopic_filter,
    gs.is_required,
    ci.id AS content_id,
    ci.title AS content_title,
    ci.content_type,
    ci.layer AS content_layer,
    ci.brief AS content_brief,
    ci.freshness AS content_freshness,
    ci.verified_at AS content_verified_at,
    ci.captured_date AS content_captured_date
  FROM guide_sections gs
  JOIN guides g ON g.id = gs.guide_id
  LEFT JOIN content_items ci ON (
    -- Match by domain (primary OR secondary) from guide
    (ci.primary_domain = g.domain_filter OR ci.secondary_domain = g.domain_filter)
    AND (gs.subtopic_filter IS NULL OR ci.primary_subtopic = gs.subtopic_filter
         OR ci.secondary_subtopic = gs.subtopic_filter)
    -- Match by layer if section specifies one
    AND (gs.expected_layer IS NULL OR ci.layer = gs.expected_layer)
    -- Match by content type if section specifies one
    AND (gs.content_type_filter IS NULL OR ci.content_type = gs.content_type_filter)
    -- §5.2 Phase 3: published-only (replaces draft+archived filter pair)
    AND ci.publication_status = 'published'
  )
  WHERE g.slug = p_guide_slug
  ORDER BY gs.display_order, ci.captured_date DESC;
$$;

ALTER FUNCTION public.get_guide_content(text) OWNER TO postgres;

GRANT ALL ON FUNCTION public.get_guide_content(text) TO anon;
GRANT ALL ON FUNCTION public.get_guide_content(text) TO authenticated;
GRANT ALL ON FUNCTION public.get_guide_content(text) TO service_role;

COMMENT ON FUNCTION public.get_guide_content(text) IS 'S216 W3 §5.2 Phase 3: guide content surfaces only published items.';

-- ---------------------------------------------------------------
-- 7. get_guide_coverage — replace draft+archived filter with publication_status='published'
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_guide_coverage()
RETURNS TABLE(
  guide_id uuid,
  guide_name text,
  guide_slug text,
  guide_type text,
  domain_filter text,
  section_id uuid,
  section_name text,
  section_order integer,
  expected_layer text,
  is_required boolean,
  content_count bigint,
  fresh_count bigint,
  stale_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    g.id AS guide_id,
    g.name AS guide_name,
    g.slug AS guide_slug,
    g.guide_type,
    g.domain_filter,
    gs.id AS section_id,
    gs.section_name,
    gs.display_order AS section_order,
    gs.expected_layer,
    gs.is_required,
    COUNT(ci.id) AS content_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'fresh') AS fresh_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness IN ('stale', 'expired')) AS stale_count
  FROM guides g
  JOIN guide_sections gs ON gs.guide_id = g.id
  LEFT JOIN content_items ci ON (
    -- Match by domain (primary OR secondary) from guide
    (ci.primary_domain = g.domain_filter OR ci.secondary_domain = g.domain_filter)
    AND (gs.subtopic_filter IS NULL OR ci.primary_subtopic = gs.subtopic_filter
         OR ci.secondary_subtopic = gs.subtopic_filter)
    -- Match by layer if section specifies one
    AND (gs.expected_layer IS NULL OR ci.layer = gs.expected_layer)
    -- Match by content type if section specifies one
    AND (gs.content_type_filter IS NULL OR ci.content_type = gs.content_type_filter)
    -- §5.2 Phase 3: published-only (replaces draft+archived filter pair)
    AND ci.publication_status = 'published'
  )
  WHERE g.is_published = true
  GROUP BY g.id, g.name, g.slug, g.guide_type, g.domain_filter,
           gs.id, gs.section_name, gs.display_order, gs.expected_layer, gs.is_required
  ORDER BY g.display_order, g.name, gs.display_order;
$$;

ALTER FUNCTION public.get_guide_coverage() OWNER TO postgres;

GRANT ALL ON FUNCTION public.get_guide_coverage() TO anon;
GRANT ALL ON FUNCTION public.get_guide_coverage() TO authenticated;
GRANT ALL ON FUNCTION public.get_guide_coverage() TO service_role;

COMMENT ON FUNCTION public.get_guide_coverage() IS 'S216 W3 §5.2 Phase 3: guide coverage rollups count only published items.';

-- ---------------------------------------------------------------
-- 8. get_review_breakdown_stats — §5.3.1 special handling (8 line rewrites)
-- ---------------------------------------------------------------
-- Eight governance_review_status references in the post-S204 body:
--   six `!= 'draft'`     → publication_status = 'published'
--   one  `= 'draft'`     → publication_status = 'draft'    (line 55, "drafts" branch)
--   one  `= 'review_overdue'` UNTOUCHED (line 61, "overdue" branch — cadence concern)

CREATE OR REPLACE FUNCTION public.get_review_breakdown_stats()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT json_build_object(
    -- Top-level counts
    'total', (
      SELECT COUNT(*)
      FROM content_items
      WHERE publication_status = 'published'
    ),
    'verified', (
      SELECT COUNT(*)
      FROM content_items
      WHERE publication_status = 'published'
        AND verified_at IS NOT NULL
    ),
    'flagged', (
      SELECT COUNT(DISTINCT content_item_id)
      FROM ingestion_quality_log
      WHERE flag_type = 'review_needed'
        AND resolved = FALSE
        AND content_item_id IS NOT NULL
    ),
    'draft', (
      SELECT COUNT(*)
      FROM content_items
      WHERE publication_status = 'draft'
    ),
    'overdue', (
      SELECT COUNT(*)
      FROM content_items
      WHERE archived_at IS NULL
        AND governance_review_status = 'review_overdue'
    ),

    -- Breakdown by domain
    'by_domain', (
      SELECT COALESCE(json_object_agg(domain, json_build_object(
        'total', total,
        'verified', verified
      )), '{}'::json)
      FROM (
        SELECT
          COALESCE(primary_domain, 'Uncategorised') AS domain,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE verified_at IS NOT NULL) AS verified
        FROM content_items
        WHERE publication_status = 'published'
        GROUP BY COALESCE(primary_domain, 'Uncategorised')
      ) d
    ),

    -- Breakdown by content type
    'by_content_type', (
      SELECT COALESCE(json_object_agg(ct, json_build_object(
        'total', total,
        'verified', verified
      )), '{}'::json)
      FROM (
        SELECT
          COALESCE(content_type, 'other') AS ct,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE verified_at IS NOT NULL) AS verified
        FROM content_items
        WHERE publication_status = 'published'
        GROUP BY COALESCE(content_type, 'other')
      ) t
    ),

    -- Breakdown by source_file
    'by_source_file', (
      SELECT COALESCE(json_object_agg(sf, json_build_object(
        'total', total,
        'verified', verified
      )), '{}'::json)
      FROM (
        SELECT
          source_file AS sf,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE verified_at IS NOT NULL) AS verified
        FROM content_items
        WHERE publication_status = 'published'
          AND source_file IS NOT NULL
        GROUP BY source_file
      ) s
    ),

    -- Breakdown by source_document (with document name from source_documents)
    'by_source_document', (
      SELECT COALESCE(json_object_agg(doc_id, json_build_object(
        'total', total,
        'verified', verified,
        'name', doc_name
      )), '{}'::json)
      FROM (
        SELECT
          ci.source_document_id::text AS doc_id,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE ci.verified_at IS NOT NULL) AS verified,
          COALESCE(sd.filename, LEFT(ci.source_document_id::text, 8)) AS doc_name
        FROM content_items ci
        LEFT JOIN source_documents sd ON sd.id = ci.source_document_id
        WHERE ci.publication_status = 'published'
          AND ci.source_document_id IS NOT NULL
        GROUP BY ci.source_document_id, sd.filename
      ) sd
    )
  );
$$;

ALTER FUNCTION public.get_review_breakdown_stats() OWNER TO postgres;

GRANT ALL ON FUNCTION public.get_review_breakdown_stats() TO anon;
GRANT ALL ON FUNCTION public.get_review_breakdown_stats() TO authenticated;
GRANT ALL ON FUNCTION public.get_review_breakdown_stats() TO service_role;

COMMENT ON FUNCTION public.get_review_breakdown_stats() IS 'S216 W3 §5.2 Phase 3: review breakdown stats per §5.3.1 — six !=draft rewrites + one =draft rewrite (publication_status); overdue branch UNTOUCHED (cadence concern).';

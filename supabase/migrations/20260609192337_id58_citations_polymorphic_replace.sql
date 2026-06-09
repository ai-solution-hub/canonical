-- ID-58 {58.5} — citations polymorphic REPLACE migration (SERIAL ROOT of the ID-58 wave).
--
-- Creates the new polymorphic `public.citations` table that REPLACES `content_citations`
-- (the old table is NOT dropped here — that is {58.11}, the last subtask of the wave).
-- Re-points the `update_citation_count()` trigger fn + its two triggers, and the four
-- win-rate RPCs, from `content_citations` onto `public.citations`.
--
-- Hard pre-req (R2): `public.form_responses` must exist (the {64.14} bid->form rename has
-- landed; staging verified non-null). The citing FK targets `form_responses`.
--
-- v1 DORMANT (D1): the q_a_pair cited path (cited_q_a_pair_id / cited_q_a_pair_version /
-- the q_a_pair partial-unique + read indexes) ships present-but-unused; gated by bl-74.
--
-- Spec slice: TECH.md "Migration — citations REPLACE DDL" + re-point trigger (Inv-14)
-- + re-point 4 RPCs (Inv-16..19). PRODUCT Inv-1,2,3,5,6,8,9,11,12,14,16,17,18,19,21,23,24.

-- Resolve the `extensions`-schema `vector` type at parse time for the RPC re-point below
-- (the migration apply connection does not include `extensions` on its search_path by
-- default; mirrors 20260530121355_id197_…:42).
SET search_path = public, extensions;

-- ──────────────────────────────────────────────────────────────────────────────
-- (1) Polymorphic kind enums (Inv-1, Inv-5)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TYPE public.cited_target_kind  AS ENUM ('content_item', 'q_a_pair');
CREATE TYPE public.citing_entity_kind AS ENUM ('form_response');

-- ──────────────────────────────────────────────────────────────────────────────
-- (2) The citations table
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.citations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- citing side (Inv-5, Inv-6)
  citing_kind             public.citing_entity_kind NOT NULL DEFAULT 'form_response',
  citing_form_response_id uuid NULL,

  -- cited side (Inv-1, Inv-2, Inv-3)
  cited_kind              public.cited_target_kind  NOT NULL,
  cited_content_item_id   uuid NULL,
  cited_q_a_pair_id       uuid NULL,                 -- DORMANT v1 (D1)

  -- version-on-cite (Inv-11, Inv-12, Inv-13) — denormalised revision pointers
  cited_version           integer NULL,             -- content_item path: content_history.version at cite time
  cited_q_a_pair_version  integer NULL,             -- DORMANT v1 (D1): q_a_pair_history.version

  -- citation type (Inv-8, Inv-9)
  citation_type           text NOT NULL DEFAULT 'reference',

  -- span anchoring (D-S330-1)
  cited_text              text NULL,
  cited_location_kind     text NULL,
  cited_start             integer NULL,
  cited_end               integer NULL,

  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL,

  -- one-of CHECK on cited side (Inv-2): exactly one cited FK populated, matching cited_kind
  CONSTRAINT citations_cited_one_of_chk CHECK (
         (cited_kind = 'content_item' AND cited_content_item_id IS NOT NULL AND cited_q_a_pair_id IS NULL)
      OR (cited_kind = 'q_a_pair'     AND cited_q_a_pair_id     IS NOT NULL AND cited_content_item_id IS NULL)
  ),

  -- one-of CHECK on citing side (Inv-6)
  CONSTRAINT citations_citing_one_of_chk CHECK (
    citing_kind = 'form_response' AND citing_form_response_id IS NOT NULL
  ),

  -- citation_type value CHECK (Inv-8)
  CONSTRAINT citations_citation_type_chk
    CHECK (citation_type IN ('reference', 'copied', 'adapted', 'inspired')),

  -- span location kind value CHECK (D-S330-1)
  CONSTRAINT citations_cited_location_kind_chk
    CHECK (cited_location_kind IN ('block', 'char', 'page')),

  -- FK constraints
  CONSTRAINT citations_citing_form_response_id_fkey
    FOREIGN KEY (citing_form_response_id) REFERENCES public.form_responses(id) ON DELETE CASCADE,
  CONSTRAINT citations_cited_content_item_id_fkey
    FOREIGN KEY (cited_content_item_id) REFERENCES public.content_items(id) ON DELETE CASCADE,
  CONSTRAINT citations_cited_q_a_pair_id_fkey
    FOREIGN KEY (cited_q_a_pair_id) REFERENCES public.q_a_pairs(id) ON DELETE CASCADE,
  CONSTRAINT citations_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.citations IS
  'ID-58 polymorphic citations: replaces content_citations. cited side = content_item|q_a_pair (q_a_pair DORMANT v1, bl-74); citing side = form_response. Version-on-cite + span anchoring (D-S330-1).';

-- ──────────────────────────────────────────────────────────────────────────────
-- (3) Indexes (Inv-21) — per-kind partial-unique dedup + per-kind read indexes
-- ──────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX citations_uniq_form_response_content_item
  ON public.citations (citing_form_response_id, cited_content_item_id)
  WHERE cited_kind = 'content_item';
CREATE UNIQUE INDEX citations_uniq_form_response_q_a_pair
  ON public.citations (citing_form_response_id, cited_q_a_pair_id)
  WHERE cited_kind = 'q_a_pair';      -- DORMANT-path index; harmless while unused

CREATE INDEX idx_citations_cited_content_item ON public.citations (cited_content_item_id)
  WHERE cited_kind = 'content_item';
CREATE INDEX idx_citations_cited_q_a_pair ON public.citations (cited_q_a_pair_id)
  WHERE cited_kind = 'q_a_pair';
CREATE INDEX idx_citations_citing_form_response ON public.citations (citing_form_response_id);
CREATE INDEX idx_citations_created_by ON public.citations (created_by);

-- ──────────────────────────────────────────────────────────────────────────────
-- (4) RLS (Inv-23) — same role matrix as content_citations
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.citations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view citations" ON public.citations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Editors and admins can manage citations" ON public.citations
  FOR INSERT TO authenticated WITH CHECK (public.get_user_role() = ANY (ARRAY['admin','editor']));
CREATE POLICY "Editors and admins can update citations" ON public.citations
  FOR UPDATE TO authenticated USING (public.get_user_role() = ANY (ARRAY['admin','editor']));
CREATE POLICY "Admins can delete citations" ON public.citations
  FOR DELETE TO authenticated USING (public.get_user_role() = 'admin');

-- ──────────────────────────────────────────────────────────────────────────────
-- (5) Grants (Inv-24) — REVOKE-from-anon hygiene (the old table carried GRANT ALL TO anon)
-- ──────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON TABLE public.citations FROM anon;        -- belt-and-braces; no GRANT … TO anon issued
GRANT  ALL ON TABLE public.citations TO authenticated, service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- (6) Re-point trigger fn (Inv-14) — key on cited_content_item_id, count content_item rows
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_citation_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  target_id uuid;
  new_count int;
BEGIN
  target_id := COALESCE(NEW.cited_content_item_id, OLD.cited_content_item_id);

  -- q_a_pair-cited rows (or rows with no content target) do not touch content_items.citation_count
  IF target_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*)::int INTO new_count
  FROM public.citations
  WHERE cited_kind = 'content_item' AND cited_content_item_id = target_id;

  UPDATE public.content_items
  SET citation_count = new_count
  WHERE id = target_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.update_citation_count() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.update_citation_count() TO service_role;

CREATE TRIGGER trg_citation_count_insert AFTER INSERT ON public.citations
  FOR EACH ROW EXECUTE FUNCTION public.update_citation_count();
CREATE TRIGGER trg_citation_count_delete AFTER DELETE ON public.citations
  FOR EACH ROW EXECUTE FUNCTION public.update_citation_count();

-- ──────────────────────────────────────────────────────────────────────────────
-- (7) Re-point the 4 win-rate RPCs (Inv-16..19)
--     Bodies preserved byte-for-byte from the AUTHORITATIVE live staging definitions
--     except the mechanical citations-table re-point:
--       FROM content_citations cc            -> FROM public.citations cc + cited_kind='content_item'
--       cc.content_item_id                   -> cc.cited_content_item_id
--       cc.bid_response_id                   -> cc.citing_form_response_id
--     (JOINs already use form_responses/form_questions post-{64.14}.)
-- ──────────────────────────────────────────────────────────────────────────────

-- Inv-16: get_aggregate_win_rate_stats() — SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.get_aggregate_win_rate_stats()
 RETURNS TABLE(scope text, total_citations bigint, winning_citations bigint, losing_citations bigint, pending_citations bigint, win_rate numeric, unique_items_cited bigint, unique_bids bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY

  WITH citation_detail AS (
    SELECT
      ci.primary_domain,
      cc.cited_content_item_id,
      cc.citing_form_response_id,
      bq.workspace_id,
      w.domain_metadata->>'outcome' as bid_outcome
    FROM public.citations cc
    JOIN content_items ci ON ci.id = cc.cited_content_item_id
    JOIN form_responses br ON br.id = cc.citing_form_response_id
    JOIN form_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.workspace_id
    WHERE cc.cited_kind = 'content_item'
  ),
  domain_stats AS (
    SELECT
      primary_domain as scope,
      COUNT(*)::bigint as total_citations,
      COUNT(*) FILTER (WHERE bid_outcome = 'won')::bigint as winning_citations,
      COUNT(*) FILTER (WHERE bid_outcome = 'lost')::bigint as losing_citations,
      COUNT(*) FILTER (WHERE bid_outcome IS NULL
                        OR bid_outcome NOT IN ('won', 'lost', 'withdrawn'))::bigint as pending_citations,
      CASE
        WHEN COUNT(*) FILTER (WHERE bid_outcome IN ('won', 'lost')) > 0 THEN
          ROUND(
            COUNT(*) FILTER (WHERE bid_outcome = 'won')::numeric /
            COUNT(*) FILTER (WHERE bid_outcome IN ('won', 'lost'))::numeric,
            2
          )
        ELSE 0
      END as win_rate,
      COUNT(DISTINCT cited_content_item_id)::bigint as unique_items_cited,
      COUNT(DISTINCT workspace_id)::bigint as unique_bids
    FROM citation_detail
    GROUP BY primary_domain
  ),
  overall AS (
    SELECT
      'overall'::text as scope,
      COUNT(*)::bigint as total_citations,
      COUNT(*) FILTER (WHERE bid_outcome = 'won')::bigint as winning_citations,
      COUNT(*) FILTER (WHERE bid_outcome = 'lost')::bigint as losing_citations,
      COUNT(*) FILTER (WHERE bid_outcome IS NULL
                        OR bid_outcome NOT IN ('won', 'lost', 'withdrawn'))::bigint as pending_citations,
      CASE
        WHEN COUNT(*) FILTER (WHERE bid_outcome IN ('won', 'lost')) > 0 THEN
          ROUND(
            COUNT(*) FILTER (WHERE bid_outcome = 'won')::numeric /
            COUNT(*) FILTER (WHERE bid_outcome IN ('won', 'lost'))::numeric,
            2
          )
        ELSE 0
      END as win_rate,
      COUNT(DISTINCT cited_content_item_id)::bigint as unique_items_cited,
      COUNT(DISTINCT workspace_id)::bigint as unique_bids
    FROM citation_detail
  )
  SELECT * FROM overall
  UNION ALL
  SELECT * FROM domain_stats
  ORDER BY scope;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_aggregate_win_rate_stats() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_aggregate_win_rate_stats() TO authenticated, service_role;

-- Inv-17: get_content_win_rate(p_content_item_id uuid) — SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.get_content_win_rate(p_content_item_id uuid)
 RETURNS TABLE(total_citations bigint, winning_citations bigint, losing_citations bigint, pending_citations bigint, win_rate numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  WITH citation_outcomes AS (
    SELECT
      cc.cited_content_item_id,
      cc.citing_form_response_id,
      bq.workspace_id,
      w.domain_metadata->>'outcome' as bid_outcome
    FROM public.citations cc
    JOIN form_responses br ON br.id = cc.citing_form_response_id
    JOIN form_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.workspace_id
    WHERE cc.cited_kind = 'content_item' AND cc.cited_content_item_id = p_content_item_id
  )
  SELECT
    COUNT(*)::bigint as total_citations,
    COUNT(*) FILTER (WHERE bid_outcome = 'won')::bigint as winning_citations,
    COUNT(*) FILTER (WHERE bid_outcome = 'lost')::bigint as losing_citations,
    COUNT(*) FILTER (WHERE bid_outcome IS NULL
                      OR bid_outcome NOT IN ('won', 'lost', 'withdrawn'))::bigint as pending_citations,
    CASE
      WHEN COUNT(*) FILTER (WHERE bid_outcome IN ('won', 'lost')) > 0 THEN
        ROUND(
          COUNT(*) FILTER (WHERE bid_outcome = 'won')::numeric /
          COUNT(*) FILTER (WHERE bid_outcome IN ('won', 'lost'))::numeric,
          2
        )
      ELSE 0
    END as win_rate
  FROM citation_outcomes;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_content_win_rate(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_content_win_rate(uuid) TO authenticated, service_role;

-- Inv-18: hybrid_search(...) — SECURITY INVOKER, STABLE
CREATE OR REPLACE FUNCTION public.hybrid_search(query_embedding vector, query_text text DEFAULT ''::text, similarity_threshold numeric DEFAULT 0.3, limit_count integer DEFAULT 10, include_superseded boolean DEFAULT false, visibility_filter character varying DEFAULT 'default'::character varying)
 RETURNS TABLE(id uuid, title text, suggested_title text, summary text, primary_domain text, primary_subtopic text, content_type text, platform text, author_name text, source_domain text, thumbnail_url text, captured_date timestamp with time zone, ai_keywords text[], classification_confidence numeric, priority text, metadata jsonb, similarity numeric, snippet text, created_by uuid, verified_at timestamp with time zone, verified_by uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  win_boost CONSTANT numeric := 0.03;
  min_win_citations CONSTANT integer := 2;
BEGIN
  RETURN QUERY
  WITH win_stats AS (
    SELECT cc.cited_content_item_id AS content_item_id,
      COUNT(DISTINCT cc.citing_form_response_id)::integer AS total_citations,
      COUNT(DISTINCT cc.citing_form_response_id) FILTER (
        WHERE w.domain_metadata->>'outcome' = 'won'
      )::numeric / NULLIF(COUNT(DISTINCT cc.citing_form_response_id), 0) AS win_rate
    FROM public.citations cc
    JOIN form_responses br ON br.id = cc.citing_form_response_id
    JOIN form_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.workspace_id
    WHERE cc.cited_kind = 'content_item'
    GROUP BY cc.cited_content_item_id
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

REVOKE EXECUTE ON FUNCTION public.hybrid_search(vector, text, numeric, integer, boolean, character varying) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.hybrid_search(vector, text, numeric, integer, boolean, character varying) TO authenticated, service_role;

-- Inv-19: search_for_form_response(...) — SECURITY INVOKER (NEVER SECURITY DEFINER — S186 L1)
--   Name already form_* post-{64.14}/{64.16}.
CREATE OR REPLACE FUNCTION public.search_for_form_response(query_embedding vector, query_text text DEFAULT ''::text, limit_count integer DEFAULT 10, include_superseded boolean DEFAULT false, visibility_filter character varying DEFAULT 'default'::character varying)
 RETURNS TABLE(id uuid, title text, content text, brief text, detail text, primary_domain character varying, primary_subtopic character varying, content_type character varying, ai_keywords text[], similarity numeric)
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
      cc.cited_content_item_id AS content_item_id,
      COUNT(DISTINCT cc.citing_form_response_id)::integer AS total_citations,
      COUNT(DISTINCT cc.citing_form_response_id) FILTER (
        WHERE w.domain_metadata->>'outcome' = 'won'
      )::numeric / NULLIF(COUNT(DISTINCT cc.citing_form_response_id), 0) AS win_rate
    FROM public.citations cc
    JOIN form_responses br ON br.id = cc.citing_form_response_id
    JOIN form_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.workspace_id
    WHERE cc.cited_kind = 'content_item'
    GROUP BY cc.cited_content_item_id
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

REVOKE EXECUTE ON FUNCTION public.search_for_form_response(vector, text, integer, boolean, character varying) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.search_for_form_response(vector, text, integer, boolean, character varying) TO authenticated, service_role;

-- ============================================================
-- search_content_chunks — review-cadence filter params (S208 §5.5 Phase 4)
-- ============================================================
-- Spec: docs/specs/p0-document-control-lifecycle-spec.md §8.2 (OQ-5 Option A)
-- Plan: docs/plans/§5.5-phase-4-mcp-tool-filter-params-plan.md WP1
--
-- Extends the existing 4-arg search_content_chunks(query_embedding,
-- similarity_threshold, limit_count, filter_content_item_id) RPC with two new
-- optional review-cadence filter params:
--
--   * filter_overdue_review BOOLEAN DEFAULT NULL
--       When TRUE, restrict results to chunks from items with
--       governance_review_status = 'review_overdue'. NULL = no filter.
--
--   * filter_review_due_within_days INTEGER DEFAULT NULL
--       When set, restrict results to chunks from items whose next_review_date
--       is within this many days from CURRENT_DATE. NULL = no filter.
--
-- Both filters are applied at RPC level via the existing JOIN to
-- content_items (zero round-trip cost — see spec §8.2). Backwards-compatible:
-- existing 4-arg callers (TS/MCP) work unchanged because the new params
-- default to NULL.
--
-- Drop-then-CREATE pattern: Postgres CREATE OR REPLACE FUNCTION cannot ADD
-- parameters; without a DROP, calling sites become ambiguous. Mirrors the
-- pattern used by 20260421223339_add_include_superseded_to_search_rpcs.sql.
--
-- Preserves the original function attributes verbatim from
-- 20260416102457_pre_squash_reconciliation.sql:
--   - LANGUAGE plpgsql STABLE SECURITY DEFINER
--   - SET search_path TO 'public', 'extensions'
--   - Identical RETURNS TABLE shape (no schema change to client TS types)
--   - GRANTs to anon/authenticated/service_role
-- ============================================================

SET search_path = public, extensions;

-- Drop the existing 4-arg signature so callers re-resolve cleanly to the new
-- 6-arg form. Idempotent — safe under migration replay (DROP IF EXISTS).
DROP FUNCTION IF EXISTS public.search_content_chunks(vector, numeric, integer, uuid);

CREATE OR REPLACE FUNCTION public.search_content_chunks(
  query_embedding vector,
  similarity_threshold numeric DEFAULT 0.3,
  limit_count integer DEFAULT 20,
  filter_content_item_id uuid DEFAULT NULL,
  filter_overdue_review boolean DEFAULT NULL,
  filter_review_due_within_days integer DEFAULT NULL
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
    AND ci.archived_at IS NULL
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
    AND (1 - (cc.embedding <=> query_embedding)) > similarity_threshold
    AND (filter_content_item_id IS NULL OR cc.content_item_id = filter_content_item_id)
    -- §5.5 Phase 4 — review-cadence filters. Both NULL by default → no-op for
    -- existing callers. When set, AND-compose with the existing predicates.
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
  vector, numeric, integer, uuid, boolean, integer
) OWNER TO postgres;

GRANT ALL ON FUNCTION public.search_content_chunks(
  vector, numeric, integer, uuid, boolean, integer
) TO anon;
GRANT ALL ON FUNCTION public.search_content_chunks(
  vector, numeric, integer, uuid, boolean, integer
) TO authenticated;
GRANT ALL ON FUNCTION public.search_content_chunks(
  vector, numeric, integer, uuid, boolean, integer
) TO service_role;

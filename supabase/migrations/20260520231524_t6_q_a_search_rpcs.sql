-- =============================================================================
-- T6 WP2 — q_a_search + q_a_get_verbatim RPCs
-- =============================================================================
--
-- Scope: PLAN.md §4.6 sub-task 4. Two-step list/preview + get/verbatim retrieval
-- pattern per S16 §6.1. Sub-tasks 1-3 (schema) shipped in WP1 migration
-- 20260520225456_t6_q_a_pairs_full_schema.sql.
--
-- Sources of truth:
--   * docs/specs/canonical-pipeline-implementation-plan/PLAN.md §4.6 sub-task 4
--   * docs/plans/phase-0-investigation/architecture/05-qa-flow.md §7.2-§7.3
--     (q_a_search two-step pattern; N9 RESOLVED-S236 separate embedding_score +
--     fulltext_score columns — NOT a blended single score)
--   * docs/plans/phase-0-investigation/0.9-spike-S16-qa-schema-design.md §6.1
--     (two-step list/preview + get/verbatim pattern — S16 §6.1 design principles)
--   * docs/specs/rls-pattern/PRODUCT.md P-4 (per-function REVOKE EXECUTE FROM anon)
--   * Reference pattern: hybrid_search RPC at
--     supabase/migrations/20260430192325_widen_search_rpcs_visibility_filter.sql
--     NOTE: hybrid_search uses GRANT ALL TO anon — this migration corrects that
--     antipattern per CLAUDE.md "Supabase auto-grants anon EXECUTE" gotcha.
--   * CLAUDE.md Supabase gotchas:
--     - anon EXECUTE auto-grant (pg_default_acl makes REVOKE FROM PUBLIC a no-op)
--     - function search_path = public, extensions (mandatory for all PL/pgSQL)
--     - embedding vector serialisation (caller concern, not DB-level)
--
-- RPC design decisions:
--   1. q_a_search: hybrid ranking using embedding cosine + fulltext ts_rank.
--      Blend: embedding * 0.6 + fulltext * 0.4 (embeddings dominate; fulltext breaks
--      ties). Scores returned as SEPARATE columns (N9 RESOLVED-S236) so the MCP
--      caller/UI can surface per-method tunability signal.
--   2. q_a_search: scope filtering is CALLER-SIDE. RPC returns scope_tag +
--      publication_status as pass-through columns; caller filters by overlap:
--        WHERE scope_tag && caller_scope_tags
--      This avoids encoding workspace context inside the DB function (per S249 prompt).
--   3. q_a_get_verbatim: returns full q_a_pair shape EXCLUDING question_embedding
--      (payload-size discipline per S16 §6.1). No publication_status filter (caller may
--      legitimately fetch superseded/archived pairs via the superseded_by lineage).
--   4. SECURITY DEFINER: required so the function can run with stable search_path;
--      grants control what callers can invoke it.
--   5. STABLE (not VOLATILE): no writes; read-only function.
--
-- Scoring approach for q_a_search:
--   * embedding_score: 1 - (question_embedding <=> p_query_embedding)  [cosine similarity]
--   * fulltext_score: ts_rank over question_text + COALESCE(answer_standard,'') + alternate
--     phrasings. COALESCE is defensive; answer_standard is NOT NULL post-WP1 but guard
--     ensures this function remains correct if that constraint is ever relaxed.
--   * Both scores cast to NUMERIC(5,4) — 4 decimal places, consistent with
--     question_matches.embedding_score + question_matches.fulltext_score column shapes
--     from 05-qa-flow.md §7.3.
--   * Internal ORDER BY: weighted blend (embedding * 0.6 + fulltext * 0.4).
--     Not exposed as a return column — callers receive the raw per-method scores
--     and apply their own blend or display them separately (per N9 rationale).
--
-- GRANT/REVOKE type signature note:
--   Postgres stores vector(1024) as type 'vector' in the catalog. REVOKE/GRANT must
--   use bare 'vector' (without size), matching the ALTER FUNCTION convention used by
--   hybrid_search at line 197 of the reference migration.
--
-- Apply log:
--   * (pending staging apply by orchestrator)
--

-- =============================================================================
-- 1. FUNCTION public.q_a_search
-- =============================================================================
--
-- Two-step retrieval Step 1: ranked preview list with per-method scores.
-- The MCP q_a_search tool calls this; caller applies scope_tag && filter.
-- Returns rows WHERE publication_status = 'published' AND question_embedding IS NOT NULL.

CREATE OR REPLACE FUNCTION public.q_a_search(
  p_query          text,
  p_query_embedding vector(1024),
  p_limit          integer DEFAULT 20
)
RETURNS TABLE (
  pair_id                   uuid,
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
  WITH scored AS (
    SELECT
      qap.id                                                               AS pair_id,
      -- Preview: truncate to ~200 chars; LEFT() is safe on NULL but question_text is NOT NULL
      LEFT(qap.question_text, 200)                                         AS question_text_preview,
      -- answer_standard is NOT NULL post-WP1; COALESCE is defensive
      LEFT(COALESCE(qap.answer_standard, ''), 200)                         AS answer_standard_preview,
      -- Cosine similarity: 1 - distance (range 0..1, higher = more similar)
      (1.0 - (qap.question_embedding <=> p_query_embedding))::numeric(5,4) AS embedding_score,
      -- Full-text rank over question + answer + alternate phrasings
      -- ts_rank returns 0 when no plainto_tsquery match
      -- normalisation option 2: divide by 1 + log(ndoc) — bounds rank in practice
      ts_rank(
        to_tsvector(
          'english',
          qap.question_text
          || ' ' || COALESCE(qap.answer_standard, '')
          || ' ' || array_to_string(qap.alternate_question_phrasings, ' ')
        ),
        plainto_tsquery('english', p_query),
        2
      )::numeric(5,4)                                                      AS fulltext_score,
      qap.scope_tag,
      qap.publication_status
    FROM public.q_a_pairs qap
    WHERE qap.question_embedding IS NOT NULL
      AND qap.publication_status = 'published'
  )
  SELECT
    s.pair_id,
    s.question_text_preview,
    s.answer_standard_preview,
    s.embedding_score,
    s.fulltext_score,
    s.scope_tag,
    s.publication_status
  FROM scored s
  -- Deterministic internal blend: embeddings dominate (0.6), fulltext breaks ties (0.4)
  -- Not exposed as a return column; callers receive raw per-method scores (N9 RESOLVED-S236)
  ORDER BY (s.embedding_score * 0.6 + s.fulltext_score * 0.4) DESC
  LIMIT p_limit;
END;
$$;

-- Ownership
ALTER FUNCTION public.q_a_search(text, vector, integer) OWNER TO postgres;

-- RLS-PATTERN P-4: explicit REVOKE from anon.
-- pg_default_acl auto-grants EXECUTE to anon on every new public.* function.
-- REVOKE FROM PUBLIC alone is a no-op against the anon role (pg_default_acl precedence).
-- Must be an explicit REVOKE FROM anon.
REVOKE EXECUTE ON FUNCTION public.q_a_search(text, vector, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.q_a_search(text, vector, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.q_a_search(text, vector, integer) IS
  'T6 WP2 — PLAN.md §4.6 sub-task 4. Two-step retrieval Step 1: ranked preview list. '
  'Returns embedding_score + fulltext_score as SEPARATE columns per N9 RESOLVED-S236 '
  '(05-qa-flow.md §7.3). Scope filtering is caller-side (scope_tag pass-through). '
  'Internal ORDER BY uses weighted blend embedding*0.6 + fulltext*0.4 but that blend '
  'is NOT returned — callers see raw scores and apply own blend/display policy.';

-- =============================================================================
-- 2. FUNCTION public.q_a_get_verbatim
-- =============================================================================
--
-- Two-step retrieval Step 2: full row for a specific pair, excluding question_embedding
-- (payload-size discipline per S16 §6.1 "AI-consumer-first").
-- No publication_status filter — caller may legitimately fetch any lifecycle state
-- (e.g. resolving superseded_by lineage chain for version-on-cite per §6.0.3).

CREATE OR REPLACE FUNCTION public.q_a_get_verbatim(
  p_pair_id uuid
)
RETURNS TABLE (
  id                           uuid,
  question_text                text,
  alternate_question_phrasings text[],
  answer_standard              text,
  answer_advanced              text,
  scope_tag                    text[],
  anti_scope_tag               text[],
  source_workspace_id          uuid,
  origin_kind                  text,
  publication_status           text,
  superseded_by                uuid,
  valid_from                   timestamptz,
  valid_to                     timestamptz,
  created_at                   timestamptz,
  updated_at                   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    qap.id,
    qap.question_text,
    qap.alternate_question_phrasings,
    qap.answer_standard,
    qap.answer_advanced,
    qap.scope_tag,
    qap.anti_scope_tag,
    qap.source_workspace_id,
    qap.origin_kind,
    qap.publication_status,
    qap.superseded_by,
    qap.valid_from,
    qap.valid_to,
    qap.created_at,
    qap.updated_at
  -- question_embedding deliberately omitted (payload-size discipline per S16 §6.1)
  FROM public.q_a_pairs qap
  WHERE qap.id = p_pair_id
  LIMIT 1;
END;
$$;

-- Ownership
ALTER FUNCTION public.q_a_get_verbatim(uuid) OWNER TO postgres;

-- RLS-PATTERN P-4: explicit REVOKE from anon (same pattern as q_a_search above)
REVOKE EXECUTE ON FUNCTION public.q_a_get_verbatim(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.q_a_get_verbatim(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.q_a_get_verbatim(uuid) IS
  'T6 WP2 — PLAN.md §4.6 sub-task 4. Two-step retrieval Step 2: full q_a_pair row '
  'for a specific pair_id. question_embedding deliberately excluded (payload-size '
  'discipline per S16 §6.1). No publication_status filter — caller may fetch any '
  'lifecycle state including superseded/archived (lineage resolution).';

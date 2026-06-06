-- Session-level search_path so the unqualified vector type/operators resolve at
-- DDL time (S318 fix — same pattern as the M1 migration, {75.5}).
SET search_path = public, extensions;

-- =============================================================================
-- ID-75 M2 (WP-B) — reference_search + reference_get_verbatim RPCs
-- =============================================================================
--
-- Scope: docs/specs/ID-75-pullmd-cocoindex/TECH.md §3 WP-B. Two-step list/preview
-- + get/verbatim retrieval pattern over public.reference_items (M1 schema shipped
-- in 20260606121451_id75_reference_items_layer.sql, {75.5}).
--
-- Sources of truth:
--   * docs/specs/ID-75-pullmd-cocoindex/TECH.md §3 WP-B (BI-16: mirror
--     q_a_search / q_a_get_verbatim exactly; 32-q-a-pair.md §5)
--   * Precedent migration: supabase/migrations/20260520231524_t6_q_a_search_rpcs.sql
--     (N9 RESOLVED-S236 separate embedding_score + fulltext_score columns —
--     NOT a blended single score)
--   * docs/specs/rls-pattern/PRODUCT.md P-4 (per-function REVOKE EXECUTE FROM anon)
--   * CLAUDE.md Supabase gotchas:
--     - anon EXECUTE auto-grant (pg_default_acl makes REVOKE FROM PUBLIC a no-op)
--     - function search_path = public, extensions (mandatory for all PL/pgSQL)
--     - embedding vector serialisation (caller concern, not DB-level)
--
-- RPC design decisions:
--   1. reference_search: hybrid ranking using embedding cosine + fulltext ts_rank.
--      Blend: embedding * 0.6 + fulltext * 0.4 (embeddings dominate; fulltext breaks
--      ties). Scores returned as SEPARATE columns (N9 RESOLVED-S236) so the MCP
--      caller/UI can surface per-method tunability signal.
--   2. reference_search returns every BI-16 contract field: classification
--      (primary_domain, primary_subtopic, layer), acquisition origin
--      (ingestion_source), and provenance chain head (source_document_id).
--   3. Fulltext is computed over title || ' ' || COALESCE(summary,'') || ' ' || body
--      at query time. Corpus is small v1 — a GIN expression index is the NAMED
--      scale upgrade and is deliberately NOT added here (TECH §3 WP-B).
--   4. reference_get_verbatim: returns full reference_items shape EXCLUDING
--      embedding (AI-consumer-first payload discipline, BI-16).
--   5. SECURITY DEFINER: required so the function can run with stable search_path;
--      grants control what callers can invoke it.
--   6. STABLE (not VOLATILE): no writes; read-only function.
--   7. STRUCTURAL (BI-16 two-surface separation): neither RPC touches
--      content_items / q_a_pairs, and no existing canonical RPC is modified.
--      MCP tool design over these RPCs belongs to ID-71.
--
-- Scoring approach for reference_search:
--   * embedding_score: 1 - (embedding <=> p_query_embedding)  [cosine similarity]
--   * fulltext_score: ts_rank over title + COALESCE(summary,'') + body,
--     normalisation option 2 (divide by 1 + log(ndoc)) — bounds rank in practice.
--   * Both scores cast to NUMERIC(5,4) — 4 decimal places, consistent with the
--     q_a_search precedent column shapes.
--   * Internal ORDER BY: weighted blend (embedding * 0.6 + fulltext * 0.4).
--     Not exposed as a return column — callers receive the raw per-method scores
--     and apply their own blend or display them separately (per N9 rationale).
--
-- GRANT/REVOKE type signature note:
--   Postgres stores vector(1024) as type 'vector' in the catalog. REVOKE/GRANT must
--   use bare 'vector' (without size), per the T6 precedent note
--   (migration-revoke-guard.yml lints anon EXECUTE).
--
-- Apply log:
--   * 2026-06-06 — applied to staging (turayklvaunphgbgscat) via supabase db push.
--

-- =============================================================================
-- 1. FUNCTION public.reference_search
-- =============================================================================
--
-- Two-step retrieval Step 1: ranked preview list with per-method scores.
-- Returns rows WHERE embedding IS NOT NULL.

CREATE OR REPLACE FUNCTION public.reference_search(
  p_query           text,
  p_query_embedding vector(1024),
  p_limit           integer DEFAULT 20
)
RETURNS TABLE (
  reference_id       uuid,
  title              text,
  summary_preview    text,
  body_preview       text,
  embedding_score    numeric(5,4),
  fulltext_score     numeric(5,4),
  source_url         text,
  published_at       timestamptz,
  primary_domain     text,
  primary_subtopic   text,
  layer              text,
  ingestion_source   text,
  source_document_id uuid
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
      ri.id                                                      AS reference_id,
      ri.title,
      -- Previews: truncate to ~200 chars; summary is nullable, body is NOT NULL
      LEFT(COALESCE(ri.summary, ''), 200)                        AS summary_preview,
      LEFT(ri.body, 200)                                         AS body_preview,
      -- Cosine similarity: 1 - distance (range 0..1, higher = more similar)
      (1.0 - (ri.embedding <=> p_query_embedding))::numeric(5,4) AS embedding_score,
      -- Full-text rank over title + summary + body
      -- ts_rank returns 0 when no plainto_tsquery match
      -- normalisation option 2: divide by 1 + log(ndoc) — bounds rank in practice
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
      ri.primary_domain,
      ri.primary_subtopic,
      ri.layer,
      ri.ingestion_source,
      ri.source_document_id
    FROM public.reference_items ri
    WHERE ri.embedding IS NOT NULL
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
    s.primary_domain,
    s.primary_subtopic,
    s.layer,
    s.ingestion_source,
    s.source_document_id
  FROM scored s
  -- Deterministic internal blend: embeddings dominate (0.6), fulltext breaks ties (0.4)
  -- Not exposed as a return column; callers receive raw per-method scores (N9 RESOLVED-S236)
  ORDER BY (s.embedding_score * 0.6 + s.fulltext_score * 0.4) DESC
  LIMIT p_limit;
END;
$$;

-- Ownership
ALTER FUNCTION public.reference_search(text, vector, integer) OWNER TO postgres;

-- RLS-PATTERN P-4: explicit REVOKE from anon.
-- pg_default_acl auto-grants EXECUTE to anon on every new public.* function.
-- REVOKE FROM PUBLIC alone is a no-op against the anon role (pg_default_acl precedence).
-- Must be an explicit REVOKE FROM anon.
-- ALSO REVOKE FROM PUBLIC: on this database the built-in CREATE FUNCTION default
-- leaves a PUBLIC EXECUTE entry (=X/postgres) in proacl, through which anon would
-- inherit EXECUTE even after the explicit anon REVOKE (verified against the T6
-- precedent functions' proacl on staging, which carry no PUBLIC entry).
REVOKE EXECUTE ON FUNCTION public.reference_search(text, vector, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reference_search(text, vector, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.reference_search(text, vector, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.reference_search(text, vector, integer) IS
  'ID-75 M2 — TECH.md §3 WP-B. Two-step retrieval Step 1: ranked preview list over '
  'reference_items. Returns embedding_score + fulltext_score as SEPARATE columns per '
  'N9 RESOLVED-S236 (q_a_search precedent). Internal ORDER BY uses weighted blend '
  'embedding*0.6 + fulltext*0.4 but that blend is NOT returned — callers see raw '
  'scores and apply own blend/display policy. Never blends reference rows into '
  'content_items/q_a_pairs results (BI-16 two-surface separation).';

-- =============================================================================
-- 2. FUNCTION public.reference_get_verbatim
-- =============================================================================
--
-- Two-step retrieval Step 2: full reference_items row for a specific id, excluding
-- embedding (AI-consumer-first payload discipline per BI-16).

CREATE OR REPLACE FUNCTION public.reference_get_verbatim(
  p_reference_id uuid
)
RETURNS TABLE (
  id                 uuid,
  title              text,
  body               text,
  summary            text,
  source_url         text,
  published_at       timestamptz,
  primary_domain     text,
  primary_subtopic   text,
  layer              text,
  source_document_id uuid,
  ingestion_source   text,
  op_id              uuid,
  created_at         timestamptz,
  updated_at         timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ri.id,
    ri.title,
    ri.body,
    ri.summary,
    ri.source_url,
    ri.published_at,
    ri.primary_domain,
    ri.primary_subtopic,
    ri.layer,
    ri.source_document_id,
    ri.ingestion_source,
    ri.op_id,
    ri.created_at,
    ri.updated_at
  -- embedding deliberately omitted (AI-consumer-first payload discipline, BI-16)
  FROM public.reference_items ri
  WHERE ri.id = p_reference_id
  LIMIT 1;
END;
$$;

-- Ownership
ALTER FUNCTION public.reference_get_verbatim(uuid) OWNER TO postgres;

-- RLS-PATTERN P-4: explicit REVOKE from anon + PUBLIC (same pattern and rationale
-- as reference_search above)
REVOKE EXECUTE ON FUNCTION public.reference_get_verbatim(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reference_get_verbatim(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reference_get_verbatim(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.reference_get_verbatim(uuid) IS
  'ID-75 M2 — TECH.md §3 WP-B. Two-step retrieval Step 2: full reference_items row '
  'for a specific reference_id. embedding deliberately excluded (AI-consumer-first '
  'payload discipline, BI-16). MCP tool design over this RPC belongs to ID-71.';

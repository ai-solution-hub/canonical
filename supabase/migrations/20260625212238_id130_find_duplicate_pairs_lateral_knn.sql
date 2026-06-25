-- ID-130 follow-up (S422): rewrite public.find_duplicate_pairs to stop timing out.
--
-- WHY: the squash-baseline body did an O(n^2) self CROSS JOIN of content_items,
-- computing a pgvector cosine distance for every pair before ORDER BY ... LIMIT.
-- The LIMIT bounded only the OUTPUT, not the work. Once the procurement corpus
-- grew (~1.7k embedded items on staging => ~1.4M pairs) the scan blew past the
-- 8s statement_timeout on the `authenticated` role the api wrapper runs under,
-- failing MCP eval l4 FC-44 (find_duplicates: "canceling statement due to
-- statement timeout"). Prod (few items) still passed — a pure data-volume blow-up.
--
-- WHAT: rewrite as a per-row LATERAL kNN. For each candidate ci1 we ask the
-- existing HNSW cosine index (idx_content_items_embedding) for its nearest
-- neighbours by embedding only (no id/threshold predicate inside the ORDER BY,
-- so the index drives the scan), bounded by a per-row candidate cap. Symmetric-
-- pair de-dup (ci1.id < nbr.id) + the similarity threshold are applied in the
-- OUTER query, preserving the original orientation (id1 = smaller id) and the
-- global "top limit_count by similarity" semantics. Complexity drops from
-- O(n^2) to ~O(n * k * log n).
--
-- RECALL TRADE-OFF: a pair is emitted iff the larger-id duplicate lands in the
-- smaller-id row's top-K nearest neighbours. For genuine duplicates (similarity
-- >= 0.95, the default) the two embeddings are mutually nearest, so K=50 is far
-- more than enough; the only pairs that could be missed are ones where a row has
-- >50 neighbours all closer than its duplicate — not a real duplicate-detection
-- scenario. This is a deliberate, documented approximation, not a regression of
-- intent (the tool surfaces likely duplicates for human review, not an exhaustive
-- all-pairs report).
--
-- Signature + RETURNS TABLE are byte-identical to the prior definition, so the
-- generated api.find_duplicate_pairs INVOKER wrapper (which does
-- `SELECT * FROM public.find_duplicate_pairs(...)`) is unaffected — no api regen.

CREATE OR REPLACE FUNCTION "public"."find_duplicate_pairs"(
  "similarity_threshold" numeric DEFAULT 0.95,
  "p_domain" "text" DEFAULT NULL::"text",
  "limit_count" integer DEFAULT 50
)
RETURNS TABLE(
  "id1" "uuid", "title1" "text", "type1" character varying, "domain1" character varying,
  "id2" "uuid", "title2" "text", "type2" character varying, "domain2" character varying,
  "similarity" numeric
)
  LANGUAGE "plpgsql"
  SET "search_path" TO 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ci1.id AS id1,
    COALESCE(ci1.suggested_title, ci1.title) AS title1,
    ci1.content_type AS type1,
    ci1.primary_domain AS domain1,
    nbr.id AS id2,
    COALESCE(nbr.suggested_title, nbr.title) AS title2,
    nbr.content_type AS type2,
    nbr.primary_domain AS domain2,
    nbr.similarity AS similarity
  FROM content_items ci1
  CROSS JOIN LATERAL (
    -- Nearest neighbours of ci1 by embedding only, so the HNSW cosine index
    -- (idx_content_items_embedding) drives this scan. Mild equality/IS-NULL
    -- filters are index-compatible (pgvector iterative scan / over-fetch).
    SELECT
      ci2.id,
      ci2.suggested_title,
      ci2.title,
      ci2.content_type,
      ci2.primary_domain,
      (1 - (ci1.embedding <=> ci2.embedding))::numeric(4, 3) AS similarity
    FROM content_items ci2
    WHERE ci2.id <> ci1.id
      AND ci2.archived_at IS NULL
      AND ci2.embedding IS NOT NULL
      AND (p_domain IS NULL OR ci2.primary_domain = p_domain)
    ORDER BY ci1.embedding <=> ci2.embedding
    -- Per-row candidate cap, bounded to [20,100] so a large limit_count can't
    -- reintroduce a runaway per-row scan. Duplicate clusters are tiny, so 20-100
    -- nearest neighbours per row is ample to fill the global top limit_count.
    LIMIT LEAST(GREATEST(limit_count, 20), 100)
  ) nbr
  WHERE ci1.archived_at IS NULL
    AND ci1.embedding IS NOT NULL
    AND (p_domain IS NULL OR ci1.primary_domain = p_domain)
    AND ci1.id < nbr.id                       -- emit each unordered pair once
    AND nbr.similarity >= similarity_threshold
  ORDER BY nbr.similarity DESC
  LIMIT limit_count;
END;
$$;

ALTER FUNCTION "public"."find_duplicate_pairs"("similarity_threshold" numeric, "p_domain" "text", "limit_count" integer) OWNER TO "postgres";

-- Belt (not the fix): give the function its own generous statement budget so a
-- direct call from a short-timeout role can't be killed mid-scan. The LATERAL
-- rewrite is what makes it fast; this just covers the tail.
ALTER FUNCTION "public"."find_duplicate_pairs"("similarity_threshold" numeric, "p_domain" "text", "limit_count" integer) SET "statement_timeout" TO '30s';

-- ID-111.6 — Author reference_list RPC (public + api), additive-only.
-- Default-list / browse RPC over public.reference_items: filterable, paginated,
-- published_at-ordered. Companion to reference_search (ranked) and
-- reference_get_verbatim (single-row). reference_list is a NEW name; this migration
-- touches NO existing object (B-25 hard invariant — additive-only, no DROP/ALTER on any
-- existing reference RPC).
--
-- Preview expressions copied byte-for-byte from reference_search in the squash baseline
-- (20260617130000): summary_preview = LEFT(COALESCE(ri.summary, ''), 200),
-- body_preview = LEFT(ri.body, 200).
--
-- Deliberately NO `WHERE embedding IS NOT NULL` (B-12): the default browse list MUST
-- surface embedding-null rows (a reference is listable before its embedding lands),
-- unlike reference_search which requires an embedding to score.
--
-- Both schemas are MANDATORY (ID-115): clients .rpc('reference_list') route to
-- api.reference_list at runtime; a public-only create 404s at runtime while local SQL
-- tests pass. api.reference_list is a thin INVOKER wrapper mirroring api.reference_search.

CREATE OR REPLACE FUNCTION "public"."reference_list"("p_limit" integer DEFAULT 48, "p_offset" integer DEFAULT 0, "p_primary_domain" "text" DEFAULT NULL::"text", "p_primary_subtopic" "text" DEFAULT NULL::"text", "p_ingestion_source" "text" DEFAULT NULL::"text", "p_published_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_published_to" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("reference_id" "uuid", "title" "text", "summary_preview" "text", "body_preview" "text", "source_url" "text", "published_at" timestamp with time zone, "primary_domain" "text", "primary_subtopic" "text", "layer" "text", "ingestion_source" "text", "source_document_id" "uuid")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
    ri.primary_domain,
    ri.primary_subtopic,
    ri.layer,
    ri.ingestion_source,
    ri.source_document_id
  FROM public.reference_items ri
  WHERE (p_primary_domain IS NULL OR ri.primary_domain = p_primary_domain)
    AND (p_primary_subtopic IS NULL OR ri.primary_subtopic = p_primary_subtopic)
    AND (p_ingestion_source IS NULL OR ri.ingestion_source = p_ingestion_source)
    AND (p_published_from IS NULL OR ri.published_at >= p_published_from)
    AND (p_published_to IS NULL OR ri.published_at <= p_published_to)
  ORDER BY ri.published_at DESC NULLS LAST, ri.id
  LIMIT p_limit OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."reference_list"("p_limit" integer, "p_offset" integer, "p_primary_domain" "text", "p_primary_subtopic" "text", "p_ingestion_source" "text", "p_published_from" timestamp with time zone, "p_published_to" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reference_list"("p_limit" integer, "p_offset" integer, "p_primary_domain" "text", "p_primary_subtopic" "text", "p_ingestion_source" "text", "p_published_from" timestamp with time zone, "p_published_to" timestamp with time zone) IS 'ID-111 — default-list / browse RPC over reference_items. Filterable (domain, subtopic, ingestion_source, published_at range), paginated (limit/offset), ordered published_at DESC NULLS LAST, id. Unlike reference_search this includes embedding-null rows (B-12). Preview columns identical to reference_search.';


CREATE OR REPLACE FUNCTION "api"."reference_list"("p_limit" integer DEFAULT 48, "p_offset" integer DEFAULT 0, "p_primary_domain" "text" DEFAULT NULL::"text", "p_primary_subtopic" "text" DEFAULT NULL::"text", "p_ingestion_source" "text" DEFAULT NULL::"text", "p_published_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_published_to" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("reference_id" "uuid", "title" "text", "summary_preview" "text", "body_preview" "text", "source_url" "text", "published_at" timestamp with time zone, "primary_domain" "text", "primary_subtopic" "text", "layer" "text", "ingestion_source" "text", "source_document_id" "uuid")
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.reference_list(p_limit => p_limit, p_offset => p_offset, p_primary_domain => p_primary_domain, p_primary_subtopic => p_primary_subtopic, p_ingestion_source => p_ingestion_source, p_published_from => p_published_from, p_published_to => p_published_to);
$$;


ALTER FUNCTION "api"."reference_list"("p_limit" integer, "p_offset" integer, "p_primary_domain" "text", "p_primary_subtopic" "text", "p_ingestion_source" "text", "p_published_from" timestamp with time zone, "p_published_to" timestamp with time zone) OWNER TO "postgres";


REVOKE ALL ON FUNCTION "public"."reference_list"("p_limit" integer, "p_offset" integer, "p_primary_domain" "text", "p_primary_subtopic" "text", "p_ingestion_source" "text", "p_published_from" timestamp with time zone, "p_published_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reference_list"("p_limit" integer, "p_offset" integer, "p_primary_domain" "text", "p_primary_subtopic" "text", "p_ingestion_source" "text", "p_published_from" timestamp with time zone, "p_published_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reference_list"("p_limit" integer, "p_offset" integer, "p_primary_domain" "text", "p_primary_subtopic" "text", "p_ingestion_source" "text", "p_published_from" timestamp with time zone, "p_published_to" timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION "api"."reference_list"("p_limit" integer, "p_offset" integer, "p_primary_domain" "text", "p_primary_subtopic" "text", "p_ingestion_source" "text", "p_published_from" timestamp with time zone, "p_published_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."reference_list"("p_limit" integer, "p_offset" integer, "p_primary_domain" "text", "p_primary_subtopic" "text", "p_ingestion_source" "text", "p_published_from" timestamp with time zone, "p_published_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "api"."reference_list"("p_limit" integer, "p_offset" integer, "p_primary_domain" "text", "p_primary_subtopic" "text", "p_ingestion_source" "text", "p_published_from" timestamp with time zone, "p_published_to" timestamp with time zone) TO "service_role";

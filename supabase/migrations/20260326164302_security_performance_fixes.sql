


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";






CREATE OR REPLACE FUNCTION "public"."auto_version_content_history"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.version := COALESCE(
        (SELECT MAX(version) FROM content_history WHERE content_item_id = NEW.content_item_id),
        0
    ) + 1;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_version_content_history"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bid_response_auto_version"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only increment if response content actually changed
    IF NEW.response_text IS DISTINCT FROM OLD.response_text
       OR NEW.response_text_advanced IS DISTINCT FROM OLD.response_text_advanced
       OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
      NEW.version := OLD.version + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."bid_response_auto_version"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_assign_content_owner"("p_item_ids" "uuid"[], "p_owner_id" "uuid", "p_assigned_by" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  updated_count int;
BEGIN
  UPDATE content_items
    SET content_owner_id = p_owner_id,
        updated_by = p_assigned_by,
        updated_at = now()
    WHERE id = ANY(p_item_ids);

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;


ALTER FUNCTION "public"."bulk_assign_content_owner"("p_item_ids" "uuid"[], "p_owner_id" "uuid", "p_assigned_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_delete_tags"("p_tags" "text"[], "p_type" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_affected int;
  v_role text;
BEGIN
  -- Require admin role
  SELECT get_user_role() INTO v_role;
  IF v_role IS NULL OR v_role != 'admin' THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  IF array_length(p_tags, 1) IS NULL OR array_length(p_tags, 1) = 0 THEN
    RETURN 0;
  END IF;

  IF p_type = 'ai' THEN
    -- Remove all specified tags from ai_keywords
    UPDATE content_items
    SET ai_keywords = (
      SELECT COALESCE(array_agg(kw), '{}')
      FROM unnest(ai_keywords) AS kw
      WHERE kw != ALL(p_tags)
    )
    WHERE ai_keywords && p_tags;

    GET DIAGNOSTICS v_affected = ROW_COUNT;

  ELSIF p_type = 'user' THEN
    UPDATE content_items
    SET user_tags = (
      SELECT COALESCE(array_agg(t), '{}')
      FROM unnest(user_tags) AS t
      WHERE t != ALL(p_tags)
    )
    WHERE user_tags && p_tags;

    GET DIAGNOSTICS v_affected = ROW_COUNT;

  ELSE
    RAISE EXCEPTION 'Invalid p_type: %. Must be ''ai'' or ''user''.', p_type;
  END IF;

  RETURN v_affected;
END;
$$;


ALTER FUNCTION "public"."bulk_delete_tags"("p_tags" "text"[], "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_merge_tags"("p_sources" "text"[], "p_target" "text", "p_type" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_affected int;
  v_role text;
BEGIN
  -- Require admin role
  SELECT get_user_role() INTO v_role;
  IF v_role IS NULL OR v_role != 'admin' THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  IF array_length(p_sources, 1) IS NULL OR array_length(p_sources, 1) = 0 THEN
    RETURN 0;
  END IF;

  IF p_type = 'ai' THEN
    -- For each item that has any of the source tags:
    -- 1. Remove all source tags
    -- 2. Add the target tag
    -- 3. Deduplicate the final array
    UPDATE content_items
    SET ai_keywords = (
      SELECT array_agg(DISTINCT kw ORDER BY kw)
      FROM (
        -- Keep existing keywords that are NOT source tags
        SELECT unnest(ai_keywords) AS kw
        EXCEPT
        SELECT unnest(p_sources)
        UNION
        -- Add the target tag
        SELECT p_target
      ) sub
    )
    WHERE ai_keywords && p_sources;

    GET DIAGNOSTICS v_affected = ROW_COUNT;

  ELSIF p_type = 'user' THEN
    UPDATE content_items
    SET user_tags = (
      SELECT array_agg(DISTINCT t ORDER BY t)
      FROM (
        SELECT unnest(user_tags) AS t
        EXCEPT
        SELECT unnest(p_sources)
        UNION
        SELECT p_target
      ) sub
    )
    WHERE user_tags && p_sources;

    GET DIAGNOSTICS v_affected = ROW_COUNT;

  ELSE
    RAISE EXCEPTION 'Invalid p_type: %. Must be ''ai'' or ''user''.', p_type;
  END IF;

  RETURN v_affected;
END;
$$;


ALTER FUNCTION "public"."bulk_merge_tags"("p_sources" "text"[], "p_target" "text", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_content_exists"("ids" "uuid"[]) RETURNS TABLE("id" "uuid", "item_exists" boolean)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT
    unnest_id AS id,
    EXISTS(SELECT 1 FROM content_items ci WHERE ci.id = unnest_id) AS item_exists
  FROM unnest(ids) AS unnest_id;
$$;


ALTER FUNCTION "public"."check_content_exists"("ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_duplicate_entity_mentions"("p_canonical_name" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Delete duplicate mentions, keeping the row with highest confidence
  -- (or earliest created_at as tiebreaker).
  WITH duplicates AS (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY canonical_name, entity_type, content_item_id
        ORDER BY confidence DESC NULLS LAST, created_at ASC
      ) AS rn
    FROM entity_mentions
    WHERE canonical_name = p_canonical_name
  )
  DELETE FROM entity_mentions
  WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."delete_duplicate_entity_mentions"("p_canonical_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_duplicate_entity_mentions"("p_canonical_name" "text") IS 'Delete duplicate entity_mentions rows for a given canonical_name, keeping the highest-confidence row per (canonical_name, entity_type, content_item_id).';



CREATE OR REPLACE FUNCTION "public"."delete_tag"("p_tag" "text", "p_type" "text") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  affected INTEGER;
BEGIN
  IF p_type = 'user' THEN
    UPDATE content_items
    SET user_tags = array_remove(user_tags, p_tag),
        updated_at = NOW()
    WHERE p_tag = ANY(user_tags);
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSIF p_type = 'ai' THEN
    UPDATE content_items
    SET ai_keywords = array_remove(ai_keywords, p_tag),
        updated_at = NOW()
    WHERE p_tag = ANY(ai_keywords);
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'Invalid tag type: %. Must be ''user'' or ''ai''.', p_type;
  END IF;
  RETURN affected;
END;
$$;


ALTER FUNCTION "public"."delete_tag"("p_tag" "text", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."detect_reupload"("p_filename" "text", "p_uploaded_by" "uuid", "p_content_hash" "text") RETURNS TABLE("match_type" "text", "existing_document_id" "uuid", "existing_version" integer, "existing_content_hash" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT
    CASE
      WHEN sd.content_hash = p_content_hash THEN 'identical'
      ELSE 'new_version'
    END AS match_type,
    sd.id AS existing_document_id,
    sd.version AS existing_version,
    sd.content_hash AS existing_content_hash
  FROM source_documents sd
  WHERE sd.filename = p_filename
    AND sd.uploaded_by = p_uploaded_by
    AND sd.archived_at IS NULL
  ORDER BY sd.version DESC
  LIMIT 1;
$$;


ALTER FUNCTION "public"."detect_reupload"("p_filename" "text", "p_uploaded_by" "uuid", "p_content_hash" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."content_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "content_type" character varying(50) NOT NULL,
    "platform" character varying(30),
    "source_url" "text",
    "author_name" character varying(255),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "embedding" "public"."vector"(1024),
    "starred" boolean DEFAULT false,
    "quality_score" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_by" "uuid",
    "brief" "text",
    "detail" "text",
    "reference" "text",
    "source_document" "text",
    "source_bid" "uuid",
    "parent_id" "uuid",
    "source_domain" character varying(100),
    "thumbnail_url" "text",
    "file_path" "text",
    "primary_domain" character varying(50),
    "primary_subtopic" character varying(50),
    "secondary_domain" character varying(50),
    "secondary_subtopic" character varying(50),
    "classification_confidence" numeric,
    "classified_at" timestamp with time zone,
    "classification_reasoning" "text",
    "suggested_title" "text",
    "ai_summary" "text",
    "ai_keywords" "text"[],
    "summary_data" "jsonb",
    "user_tags" "text"[],
    "priority" character varying(10),
    "captured_date" timestamp with time zone,
    "freshness" character varying(20) DEFAULT 'fresh'::character varying,
    "freshness_checked_at" timestamp with time zone,
    "lifecycle_type" character varying(30) DEFAULT 'evergreen'::character varying,
    "expiry_date" timestamp with time zone,
    "previous_freshness" character varying,
    "verified_at" timestamp with time zone,
    "verified_by" "uuid",
    "governance_review_status" "text",
    "governance_review_due" timestamp with time zone,
    "governance_reviewer_id" "uuid",
    "answer_standard" "text",
    "answer_advanced" "text",
    "notes" "text",
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "archive_reason" "text",
    "content_owner_id" "uuid",
    "source_document_id" "uuid",
    "quality_score_updated_at" timestamp with time zone,
    "previous_quality_score" integer,
    "citation_count" integer DEFAULT 0 NOT NULL,
    "source_file" "text",
    "layer" character varying(50),
    CONSTRAINT "chk_content_items_citation_count_non_negative" CHECK (("citation_count" >= 0)),
    CONSTRAINT "content_items_content_type_check" CHECK ((("content_type")::"text" = ANY ((ARRAY['article'::character varying, 'note'::character varying, 'document'::character varying, 'bookmark'::character varying, 'q_a_pair'::character varying, 'case_study'::character varying, 'policy'::character varying, 'methodology'::character varying, 'cv'::character varying, 'company_info'::character varying])::"text"[]))),
    CONSTRAINT "content_items_governance_review_status_check" CHECK ((("governance_review_status" IS NULL) OR ("governance_review_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'reverted'::"text", 'changes_requested'::"text", 'draft'::"text"])))),
    CONSTRAINT "content_items_platform_check" CHECK ((("platform")::"text" = ANY ((ARRAY['web'::character varying, 'email'::character varying, 'manual'::character varying, 'upload'::character varying, 'extraction'::character varying, 'other'::character varying])::"text"[]))),
    CONSTRAINT "content_items_previous_freshness_check" CHECK ((("previous_freshness" IS NULL) OR (("previous_freshness")::"text" = ANY ((ARRAY['fresh'::character varying, 'aging'::character varying, 'stale'::character varying, 'expired'::character varying])::"text"[])))),
    CONSTRAINT "content_items_quality_score_range" CHECK ((("quality_score" >= 0) AND ("quality_score" <= 100))),
    CONSTRAINT "content_items_valid_content_type" CHECK ((("content_type")::"text" = ANY (ARRAY[('article'::character varying)::"text", ('blog'::character varying)::"text", ('pdf'::character varying)::"text", ('note'::character varying)::"text", ('research'::character varying)::"text", ('other'::character varying)::"text", ('q_a_pair'::character varying)::"text", ('case_study'::character varying)::"text", ('policy'::character varying)::"text", ('certification'::character varying)::"text", ('compliance'::character varying)::"text", ('methodology'::character varying)::"text", ('capability'::character varying)::"text", ('product_description'::character varying)::"text", ('document'::character varying)::"text"])))
);


ALTER TABLE "public"."content_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."content_items"."notes" IS 'Editorial guidance and internal notes — not included in search or AI responses';



COMMENT ON COLUMN "public"."content_items"."content_owner_id" IS 'User responsible for keeping this content current. Receives targeted freshness and governance notifications.';



COMMENT ON COLUMN "public"."content_items"."source_document_id" IS 'FK to the source_documents row that produced this content item. Used for lineage tracking and re-ingestion diffing.';



CREATE OR REPLACE FUNCTION "public"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text" DEFAULT 'any'::"text") RETURNS SETOF "public"."content_items"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN;
END;
$$;


ALTER FUNCTION "public"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_duplicate_pairs"("similarity_threshold" numeric DEFAULT 0.95, "p_domain" "text" DEFAULT NULL::"text", "limit_count" integer DEFAULT 50) RETURNS TABLE("id1" "uuid", "title1" "text", "type1" character varying, "domain1" character varying, "id2" "uuid", "title2" "text", "type2" character varying, "domain2" character varying, "similarity" numeric)
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
    ci2.id AS id2,
    COALESCE(ci2.suggested_title, ci2.title) AS title2,
    ci2.content_type AS type2,
    ci2.primary_domain AS domain2,
    (1 - (ci1.embedding <=> ci2.embedding))::NUMERIC(4, 3) AS similarity
  FROM content_items ci1
  CROSS JOIN content_items ci2
  WHERE ci1.id < ci2.id
    AND ci1.archived_at IS NULL
    AND ci2.archived_at IS NULL
    AND ci1.embedding IS NOT NULL
    AND ci2.embedding IS NOT NULL
    AND (p_domain IS NULL OR ci1.primary_domain = p_domain)
    AND (p_domain IS NULL OR ci2.primary_domain = p_domain)
    AND (1 - (ci1.embedding <=> ci2.embedding)) >= similarity_threshold
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$$;


ALTER FUNCTION "public"."find_duplicate_pairs"("similarity_threshold" numeric, "p_domain" "text", "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_duplicate_tags"("p_type" "text") RETURNS TABLE("canonical" "text", "variants" "text"[], "variant_count" integer, "total_usage" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  -- Require authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_type = 'ai' THEN
    -- Case duplicates
    RETURN QUERY
    SELECT
      lower(tag) AS canonical,
      array_agg(DISTINCT tag ORDER BY tag) AS variants,
      count(DISTINCT tag)::int AS variant_count,
      count(*)::bigint AS total_usage
    FROM content_items, LATERAL unnest(ai_keywords) AS tag
    GROUP BY lower(tag)
    HAVING count(DISTINCT tag) > 1

    UNION ALL

    -- Plural/singular pairs (simple 's' suffix)
    SELECT
      t1.tag AS canonical,
      ARRAY[t1.tag, t1.tag || 's'] AS variants,
      2 AS variant_count,
      (t1.cnt + t2.cnt)::bigint AS total_usage
    FROM (
      SELECT tag, count(*) AS cnt
      FROM content_items, LATERAL unnest(ai_keywords) AS tag
      GROUP BY tag
    ) t1
    INNER JOIN (
      SELECT tag, count(*) AS cnt
      FROM content_items, LATERAL unnest(ai_keywords) AS tag
      GROUP BY tag
    ) t2 ON t2.tag = t1.tag || 's'
    -- Exclude pairs already captured as case duplicates
    WHERE lower(t1.tag) != lower(t2.tag);

  ELSIF p_type = 'user' THEN
    RETURN QUERY
    SELECT
      lower(tag) AS canonical,
      array_agg(DISTINCT tag ORDER BY tag) AS variants,
      count(DISTINCT tag)::int AS variant_count,
      count(*)::bigint AS total_usage
    FROM content_items, LATERAL unnest(user_tags) AS tag
    GROUP BY lower(tag)
    HAVING count(DISTINCT tag) > 1

    UNION ALL

    SELECT
      t1.tag AS canonical,
      ARRAY[t1.tag, t1.tag || 's'] AS variants,
      2 AS variant_count,
      (t1.cnt + t2.cnt)::bigint AS total_usage
    FROM (
      SELECT tag, count(*) AS cnt
      FROM content_items, LATERAL unnest(user_tags) AS tag
      GROUP BY tag
    ) t1
    INNER JOIN (
      SELECT tag, count(*) AS cnt
      FROM content_items, LATERAL unnest(user_tags) AS tag
      GROUP BY tag
    ) t2 ON t2.tag = t1.tag || 's'
    WHERE lower(t1.tag) != lower(t2.tag);

  ELSE
    RAISE EXCEPTION 'Invalid p_type: %. Must be ''ai'' or ''user''.', p_type;
  END IF;
END;
$$;


ALTER FUNCTION "public"."find_duplicate_tags"("p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_similar_content"("query_embedding" "public"."vector", "similarity_threshold" double precision DEFAULT 0.7, "limit_count" integer DEFAULT 10) RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "similarity" numeric, "content_type" character varying, "platform" character varying, "author_name" character varying, "source_domain" character varying)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT ci.id, ci.title, ci.content,
    (1 - (ci.embedding <=> query_embedding))::NUMERIC(4, 3) as similarity,
    ci.content_type, ci.platform, ci.author_name, ci.source_domain
  FROM content_items ci
  WHERE ci.embedding IS NOT NULL
    AND ci.archived_at IS NULL
    AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
  ORDER BY ci.embedding <=> query_embedding
  LIMIT limit_count;
END;
$$;


ALTER FUNCTION "public"."find_similar_content"("query_embedding" "public"."vector", "similarity_threshold" double precision, "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_tag_counts"() RETURNS TABLE("tag" "text", "count" bigint, "source" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT unnest(user_tags) AS tag, COUNT(*) AS count, 'user'::TEXT AS source
  FROM content_items
  WHERE user_tags IS NOT NULL AND array_length(user_tags, 1) > 0
  GROUP BY tag
  UNION ALL
  SELECT unnest(ai_keywords) AS tag, COUNT(*) AS count, 'ai'::TEXT AS source
  FROM content_items
  WHERE ai_keywords IS NOT NULL AND array_length(ai_keywords, 1) > 0
  GROUP BY tag
  ORDER BY count DESC, tag ASC;
$$;


ALTER FUNCTION "public"."get_all_tag_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_audit_content_items"("p_domain" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 500) RETURNS TABLE("id" "uuid", "title" "text", "suggested_title" "text", "content_type" "text", "primary_domain" "text", "content_length" integer, "ai_summary" "text", "ai_keywords" "text"[], "classification_confidence" double precision, "freshness" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT
    ci.id,
    ci.title,
    ci.suggested_title,
    ci.content_type,
    ci.primary_domain,
    COALESCE(char_length(ci.content), 0)::int AS content_length,
    ci.ai_summary,
    ci.ai_keywords,
    ci.classification_confidence,
    ci.freshness
  FROM content_items ci
  WHERE ci.archived_at IS NULL
    AND (p_domain IS NULL OR ci.primary_domain = p_domain)
  ORDER BY ci.updated_at DESC
  LIMIT p_limit;
$$;


ALTER FUNCTION "public"."get_audit_content_items"("p_domain" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_author_analysis"("limit_count" integer DEFAULT 10) RETURNS TABLE("author" "text", "item_count" bigint, "domains" "text"[], "latest" timestamp with time zone)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN;
END;
$$;


ALTER FUNCTION "public"."get_author_analysis"("limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bid_question_stats_batch"("p_project_ids" "uuid"[]) RETURNS TABLE("project_id" "uuid", "total_questions" bigint, "strong_match_count" bigint, "partial_match_count" bigint, "needs_sme_count" bigint, "no_content_count" bigint, "unmatched_count" bigint, "drafted_count" bigint, "complete_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    bq.project_id,
    COUNT(*)::BIGINT AS total_questions,
    COUNT(*) FILTER (WHERE confidence_posture = 'strong_match')::BIGINT AS strong_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'partial_match')::BIGINT AS partial_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'needs_sme')::BIGINT AS needs_sme_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'no_content')::BIGINT AS no_content_count,
    COUNT(*) FILTER (WHERE confidence_posture IS NULL)::BIGINT AS unmatched_count,
    COUNT(*) FILTER (WHERE status = 'ai_drafted')::BIGINT AS drafted_count,
    COUNT(*) FILTER (WHERE status = 'complete')::BIGINT AS complete_count
  FROM bid_questions bq
  WHERE bq.project_id = ANY(p_project_ids)
  GROUP BY bq.project_id;
$$;


ALTER FUNCTION "public"."get_bid_question_stats_batch"("p_project_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bid_summary"("bid_workspace_id" "uuid") RETURNS json
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT json_build_object(
    'workspace_id', bid_workspace_id,
    'total_questions', (SELECT COUNT(*) FROM bid_questions WHERE project_id = bid_workspace_id),
    'status_breakdown', (
      SELECT json_agg(json_build_object('status', status, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT status, COUNT(*) AS cnt FROM bid_questions WHERE project_id = bid_workspace_id GROUP BY status) sub),
    'confidence_breakdown', (
      SELECT json_agg(json_build_object('posture', confidence_posture, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT confidence_posture, COUNT(*) AS cnt FROM bid_questions
        WHERE project_id = bid_workspace_id AND confidence_posture IS NOT NULL GROUP BY confidence_posture) sub),
    'responses_count', (
      SELECT COUNT(*) FROM bid_responses br JOIN bid_questions bq ON bq.id = br.question_id WHERE bq.project_id = bid_workspace_id),
    'review_status_breakdown', (
      SELECT json_agg(json_build_object('status', review_status, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT br.review_status, COUNT(*) AS cnt FROM bid_responses br
        JOIN bid_questions bq ON bq.id = br.question_id WHERE bq.project_id = bid_workspace_id GROUP BY br.review_status) sub),
    'sections', (
      SELECT json_agg(json_build_object('section', section_name, 'question_count', cnt, 'completed', completed_cnt) ORDER BY min_seq)
      FROM (SELECT bq.section_name, COUNT(*) AS cnt, COUNT(*) FILTER (WHERE bq.status = 'complete') AS completed_cnt,
        MIN(bq.section_sequence) AS min_seq FROM bid_questions bq WHERE bq.project_id = bid_workspace_id GROUP BY bq.section_name) sub)
  );
$$;


ALTER FUNCTION "public"."get_bid_summary"("bid_workspace_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_capture_activity"("days_back" integer DEFAULT 30) RETURNS TABLE("period" timestamp with time zone, "count" bigint)
    LANGUAGE "sql"
    AS $$
  SELECT NULL::TIMESTAMPTZ, 0::BIGINT WHERE FALSE;
$$;


ALTER FUNCTION "public"."get_capture_activity"("days_back" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_content_gaps"() RETURNS json
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN json_build_object(
    'sparse_subtopics', (
      SELECT json_agg(json_build_object('domain', primary_domain, 'subtopic', primary_subtopic, 'count', cnt, 'latest', latest) ORDER BY cnt ASC)
      FROM (SELECT primary_domain, primary_subtopic, COUNT(*) AS cnt, MAX(captured_date) AS latest
        FROM content_items WHERE primary_domain IS NOT NULL AND primary_subtopic IS NOT NULL AND archived_at IS NULL
        GROUP BY primary_domain, primary_subtopic HAVING COUNT(*) < 5) sub),
    'stale_subtopics', (
      SELECT json_agg(json_build_object('domain', primary_domain, 'subtopic', primary_subtopic,
        'count', cnt, 'latest', latest, 'days_since', EXTRACT(DAY FROM NOW() - latest)::INT) ORDER BY latest ASC)
        FROM (SELECT primary_domain, primary_subtopic, COUNT(*) AS cnt, MAX(captured_date) AS latest
        FROM content_items WHERE primary_domain IS NOT NULL AND primary_subtopic IS NOT NULL AND archived_at IS NULL
        GROUP BY primary_domain, primary_subtopic HAVING MAX(captured_date) < NOW() - INTERVAL '30 days') sub),
    'domain_summary', (
      SELECT json_agg(json_build_object('domain', primary_domain, 'total_items', cnt,
        'subtopic_count', subtopics, 'latest', latest, 'avg_confidence', avg_conf) ORDER BY cnt DESC)
      FROM (SELECT primary_domain, COUNT(*) AS cnt, COUNT(DISTINCT primary_subtopic) AS subtopics,
        MAX(captured_date) AS latest, ROUND(AVG(classification_confidence)::NUMERIC, 3) AS avg_conf
        FROM content_items WHERE primary_domain IS NOT NULL AND archived_at IS NULL GROUP BY primary_domain) sub)
  );
END;
$$;


ALTER FUNCTION "public"."get_content_gaps"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_content_owner_stats"() RETURNS TABLE("owner_id" "uuid", "total_items" integer, "fresh_count" integer, "aging_count" integer, "stale_count" integer, "expired_count" integer, "unverified_count" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT
    content_owner_id AS owner_id,
    count(*)::int AS total_items,
    count(*) FILTER (WHERE freshness = 'fresh')::int AS fresh_count,
    count(*) FILTER (WHERE freshness IN ('aging', 'ageing'))::int AS aging_count,
    count(*) FILTER (WHERE freshness = 'stale')::int AS stale_count,
    count(*) FILTER (WHERE freshness = 'expired')::int AS expired_count,
    count(*) FILTER (WHERE verified_at IS NULL)::int AS unverified_count
  FROM content_items
  WHERE content_owner_id IS NOT NULL
    AND archived_at IS NULL
  GROUP BY content_owner_id;
$$;


ALTER FUNCTION "public"."get_content_owner_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") RETURNS TABLE("total_citations" bigint, "winning_citations" bigint, "win_rate" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH citation_outcomes AS (
    SELECT
      cc.content_item_id,
      cc.bid_response_id,
      bq.project_id,
      w.domain_metadata->>'outcome' as bid_outcome
    FROM content_citations cc
    JOIN bid_responses br ON br.id = cc.bid_response_id
    JOIN bid_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.project_id
    WHERE cc.content_item_id = p_content_item_id
  )
  SELECT
    COUNT(*)::bigint as total_citations,
    COUNT(*) FILTER (WHERE bid_outcome = 'won')::bigint as winning_citations,
    CASE
      WHEN COUNT(*) > 0 THEN
        ROUND((COUNT(*) FILTER (WHERE bid_outcome = 'won'))::numeric / COUNT(*)::numeric, 2)
      ELSE 0
    END as win_rate
  FROM citation_outcomes;
END;
$$;


ALTER FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_coverage_matrix"("p_layer" "text" DEFAULT NULL::"text") RETURNS TABLE("domain_name" "text", "subtopic_name" "text", "item_count" bigint, "fresh_count" bigint, "aging_count" bigint, "stale_count" bigint, "expired_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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
    AND ci.archived_at IS NULL
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
    AND (p_layer IS NULL OR ci.layer = p_layer)
  WHERE d.is_active = TRUE
  GROUP BY d.name, s.name, d.display_order, s.display_order
  ORDER BY d.display_order, s.display_order;
END;
$$;


ALTER FUNCTION "public"."get_coverage_matrix"("p_layer" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_coverage_summary"() RETURNS TABLE("domain_name" "text", "domain_colour" "text", "total_items" bigint, "fresh_pct" numeric, "gap_count" bigint, "expired_count" bigint)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
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
            AND ci2.archived_at IS NULL
            AND (ci2.governance_review_status IS NULL OR ci2.governance_review_status != 'draft')
        )
    )                                                         AS gap_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'expired')      AS expired_count
  FROM taxonomy_domains d
  LEFT JOIN content_items ci
    ON ci.primary_domain = d.name
    AND ci.archived_at IS NULL
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
  WHERE d.is_active = TRUE
  GROUP BY d.id, d.name, d.colour, d.display_order
  ORDER BY d.display_order;
END;
$$;


ALTER FUNCTION "public"."get_coverage_summary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_document_version_chain"("p_document_id" "uuid") RETURNS TABLE("id" "uuid", "filename" "text", "original_filename" "text", "mime_type" character varying, "file_size" integer, "content_hash" "text", "version" integer, "parent_id" "uuid", "storage_path" "text", "status" character varying, "uploaded_by" "uuid", "created_at" timestamp with time zone, "content_item_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  -- Walk up the chain to find the root document
  WITH RECURSIVE chain AS (
    -- Start from the given document
    SELECT sd.* FROM source_documents sd WHERE sd.id = p_document_id
    UNION ALL
    -- Walk to parent
    SELECT sd.* FROM source_documents sd
    JOIN chain c ON sd.id = c.parent_id
  ),
  -- Also walk down the chain from root to find all descendants
  root AS (
    SELECT id FROM chain WHERE parent_id IS NULL
    LIMIT 1
  ),
  full_chain AS (
    SELECT sd.* FROM source_documents sd
    WHERE sd.id = (SELECT id FROM root)
    UNION ALL
    SELECT sd.* FROM source_documents sd
    JOIN full_chain fc ON sd.parent_id = fc.id
  )
  SELECT
    fc.id,
    fc.filename,
    fc.original_filename,
    fc.mime_type,
    fc.file_size,
    fc.content_hash,
    fc.version,
    fc.parent_id,
    fc.storage_path,
    fc.status,
    fc.uploaded_by,
    fc.created_at,
    (SELECT count(*) FROM content_items ci WHERE ci.source_document_id = fc.id) AS content_item_count
  FROM full_chain fc
  ORDER BY fc.version ASC;
$$;


ALTER FUNCTION "public"."get_document_version_chain"("p_document_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_domain_subtopic_counts"() RETURNS TABLE("primary_domain" "text", "primary_subtopic" "text", "item_count" bigint)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT ci.primary_domain::TEXT, ci.primary_subtopic::TEXT, COUNT(*) AS item_count
  FROM content_items ci
  WHERE ci.primary_domain IS NOT NULL
    AND ci.archived_at IS NULL
  GROUP BY ci.primary_domain, ci.primary_subtopic 
  ORDER BY ci.primary_domain, item_count DESC;
END;
$$;


ALTER FUNCTION "public"."get_domain_subtopic_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_entity_name_counts"() RETURNS TABLE("canonical_name" "text", "mention_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT canonical_name, count(*) as mention_count
  FROM entity_mentions
  GROUP BY canonical_name
  ORDER BY mention_count DESC
  LIMIT 50;
$$;


ALTER FUNCTION "public"."get_entity_name_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") RETURNS TABLE("source_entity" "text", "relationship_type" "text", "target_entity" "text", "source_item_id" "uuid", "confidence" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    er.source_entity,
    er.relationship_type,
    er.target_entity,
    er.source_item_id,
    er.confidence
  FROM entity_relationships er
  WHERE er.source_entity ILIKE '%' || p_entity_name || '%'
     OR er.target_entity ILIKE '%' || p_entity_name || '%'
  ORDER BY er.confidence DESC, er.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") IS 'Query entity relationships by entity name (matches both source and target)';



CREATE OR REPLACE FUNCTION "public"."get_entity_summary"("p_entity_name" "text" DEFAULT NULL::"text", "p_entity_type" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT NULL::integer) RETURNS TABLE("canonical_name" "text", "entity_type" "text", "mention_count" bigint, "content_item_ids" "uuid"[], "related_entities" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH mention_counts AS (
    SELECT
      em.canonical_name,
      COALESCE(em.entity_type_override, em.entity_type) AS entity_type,
      COUNT(*) as mention_count,
      ARRAY_AGG(DISTINCT em.content_item_id) as content_item_ids
    FROM entity_mentions em
    WHERE
      (p_entity_name IS NULL OR em.canonical_name ILIKE '%' || p_entity_name || '%')
      AND (p_entity_type IS NULL OR COALESCE(em.entity_type_override, em.entity_type) = p_entity_type)
    GROUP BY em.canonical_name, COALESCE(em.entity_type_override, em.entity_type)
  ),
  ranked AS (
    SELECT
      mc.*,
      ROW_NUMBER() OVER (ORDER BY mc.mention_count DESC) as rn
    FROM mention_counts mc
  ),
  bounded AS (
    SELECT * FROM ranked
    WHERE p_limit IS NULL OR rn <= p_limit
  ),
  related AS (
    SELECT
      b.canonical_name,
      b.entity_type,
      COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object(
          'relationship', er.relationship_type,
          'target', er.target_entity
        )) FILTER (WHERE er.id IS NOT NULL),
        '[]'::jsonb
      ) ||
      COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object(
          'relationship', er2.relationship_type,
          'source', er2.source_entity
        )) FILTER (WHERE er2.id IS NOT NULL),
        '[]'::jsonb
      ) as related_entities
    FROM bounded b
    LEFT JOIN entity_relationships er ON er.source_entity = b.canonical_name
    LEFT JOIN entity_relationships er2 ON er2.target_entity = b.canonical_name
    GROUP BY b.canonical_name, b.entity_type
  )
  SELECT
    b.canonical_name,
    b.entity_type,
    b.mention_count,
    b.content_item_ids,
    COALESCE(r.related_entities, '[]'::jsonb)
  FROM bounded b
  LEFT JOIN related r ON r.canonical_name = b.canonical_name AND r.entity_type = b.entity_type
  ORDER BY b.mention_count DESC;
END;
$$;


ALTER FUNCTION "public"."get_entity_summary"("p_entity_name" "text", "p_entity_type" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_entity_summary"("p_entity_name" "text", "p_entity_type" "text", "p_limit" integer) IS 'Query entity mentions with counts, content items, and related entities. Uses COALESCE(entity_type_override, entity_type) for effective type.';



CREATE OR REPLACE FUNCTION "public"."get_filter_counts"() RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN jsonb_build_object(
    'domain', COALESCE((SELECT jsonb_object_agg(primary_domain, cnt) FROM (SELECT primary_domain, COUNT(*) as cnt FROM content_items WHERE primary_domain IS NOT NULL AND archived_at IS NULL GROUP BY primary_domain) d), '{}'::jsonb),
    'content_type', COALESCE((SELECT jsonb_object_agg(content_type, cnt) FROM (SELECT content_type, COUNT(*) as cnt FROM content_items WHERE content_type IS NOT NULL AND archived_at IS NULL GROUP BY content_type) t), '{}'::jsonb),
    'platform', COALESCE((SELECT jsonb_object_agg(platform, cnt) FROM (SELECT platform, COUNT(*) as cnt FROM content_items WHERE platform IS NOT NULL AND archived_at IS NULL GROUP BY platform) p), '{}'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."get_filter_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_freshness_breakdown"() RETURNS TABLE("freshness" "text", "count" bigint)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT ci.freshness::text, COUNT(*) 
  FROM content_items ci
  WHERE ci.freshness IS NOT NULL 
    AND ci.archived_at IS NULL
  GROUP BY ci.freshness;
END;
$$;


ALTER FUNCTION "public"."get_freshness_breakdown"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_grouped_activity_feed"("p_limit" integer DEFAULT 10, "p_is_admin" boolean DEFAULT false, "p_before" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("id" "uuid", "type" "text", "entity_type" "text", "entity_id" "uuid", "summary" "text", "user_id" "uuid", "latest_at" timestamp with time zone, "earliest_at" timestamp with time zone, "event_count" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH history_events AS (
    -- Each content_history row is an individual event (no grouping).
    SELECT
      ch.id,
      CASE
        WHEN ch.change_type = 'rollback' THEN 'rollback'
        ELSE ch.change_type
      END AS type,
      'content_item'::text AS entity_type,
      ch.content_item_id AS entity_id,
      COALESCE(ch.change_summary, 'Version ' || ch.version::text) AS summary,
      ch.created_by AS user_id,
      ch.created_at AS latest_at,
      ch.created_at AS earliest_at,
      1 AS event_count
    FROM content_history ch
    WHERE (p_before IS NULL OR ch.created_at < p_before)
    ORDER BY ch.created_at DESC
    LIMIT p_limit * 3
  ),

  quality_grouped AS (
    -- Group quality flags by flag_type + severity within calendar-day buckets.
    SELECT
      iql.flag_type,
      iql.severity,
      date_trunc('day', iql.created_at) AS day_bucket,
      MAX(iql.created_at) AS latest_at,
      MIN(iql.created_at) AS earliest_at,
      COUNT(*)::integer AS event_count
    FROM ingestion_quality_log iql
    WHERE p_is_admin = true
      AND (p_before IS NULL OR iql.created_at < p_before)
    GROUP BY
      iql.flag_type,
      iql.severity,
      date_trunc('day', iql.created_at)
    ORDER BY MAX(iql.created_at) DESC
    LIMIT p_limit * 2
  ),

  quality_events AS (
    -- Resolve representative id and entity_id from the grouped results.
    SELECT
      (
        SELECT sub.id
        FROM ingestion_quality_log sub
        WHERE sub.flag_type = qg.flag_type
          AND sub.severity = qg.severity
          AND date_trunc('day', sub.created_at) = qg.day_bucket
        ORDER BY sub.created_at DESC
        LIMIT 1
      ) AS id,
      'quality_flag'::text AS type,
      'content_item'::text AS entity_type,
      (
        SELECT sub.content_item_id
        FROM ingestion_quality_log sub
        WHERE sub.flag_type = qg.flag_type
          AND sub.severity = qg.severity
          AND date_trunc('day', sub.created_at) = qg.day_bucket
        ORDER BY sub.created_at DESC
        LIMIT 1
      ) AS entity_id,
      qg.severity || ': ' || REPLACE(qg.flag_type, '_', ' ') AS summary,
      NULL::uuid AS user_id,
      qg.latest_at,
      qg.earliest_at,
      qg.event_count
    FROM quality_grouped qg
  )

  SELECT * FROM history_events
  UNION ALL
  SELECT * FROM quality_events
  ORDER BY latest_at DESC
  LIMIT p_limit;
$$;


ALTER FUNCTION "public"."get_grouped_activity_feed"("p_limit" integer, "p_is_admin" boolean, "p_before" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_guide_content"("p_guide_slug" "text") RETURNS TABLE("section_id" "uuid", "section_name" "text", "section_description" "text", "section_order" integer, "expected_layer" "text", "subtopic_filter" "text", "is_required" boolean, "content_id" "uuid", "content_title" "text", "content_type" "text", "content_layer" "text", "content_brief" "text", "content_freshness" "text", "content_verified_at" timestamp with time zone, "content_captured_date" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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
    ci.metadata->>'layer' AS content_layer,
    ci.brief AS content_brief,
    ci.freshness AS content_freshness,
    ci.verified_at AS content_verified_at,
    ci.captured_date AS content_captured_date
  FROM guide_sections gs
  JOIN guides g ON g.id = gs.guide_id
  LEFT JOIN content_items ci ON (
    -- Match by domain (from guide) + subtopic (from section)
    ci.primary_domain = g.domain_filter
    AND (gs.subtopic_filter IS NULL OR ci.primary_subtopic = gs.subtopic_filter)
    -- Match by layer if section specifies one
    AND (gs.expected_layer IS NULL OR ci.metadata->>'layer' = gs.expected_layer)
    -- Match by content type if section specifies one
    AND (gs.content_type_filter IS NULL OR ci.content_type = gs.content_type_filter)
    -- Exclude drafts (correction 4: proper NULL handling)
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
    -- Exclude archived items (correction 3)
    AND ci.archived_at IS NULL
  )
  WHERE g.slug = p_guide_slug
  ORDER BY gs.display_order, ci.captured_date DESC;
$$;


ALTER FUNCTION "public"."get_guide_content"("p_guide_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_guide_coverage"() RETURNS TABLE("guide_id" "uuid", "guide_name" "text", "guide_slug" "text", "guide_type" "text", "domain_filter" "text", "section_id" "uuid", "section_name" "text", "section_order" integer, "expected_layer" "text", "is_required" boolean, "content_count" bigint, "fresh_count" bigint, "stale_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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
    ci.primary_domain = g.domain_filter
    AND (gs.subtopic_filter IS NULL OR ci.primary_subtopic = gs.subtopic_filter)
    AND (gs.expected_layer IS NULL OR ci.metadata->>'layer' = gs.expected_layer)
    AND (gs.content_type_filter IS NULL OR ci.content_type = gs.content_type_filter)
    AND ci.archived_at IS NULL
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
  )
  WHERE g.is_published = true
  GROUP BY g.id, g.name, g.slug, g.guide_type, g.domain_filter,
           gs.id, gs.section_name, gs.display_order, gs.expected_layer, gs.is_required
  ORDER BY g.display_order, g.name, gs.display_order;
$$;


ALTER FUNCTION "public"."get_guide_coverage"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "color" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "type" "text" DEFAULT 'project'::"text",
    "domain_metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_archived" boolean DEFAULT false,
    "status" character varying(30),
    CONSTRAINT "projects_status_check" CHECK ((("status" IS NULL) OR (("status")::"text" = ANY (ARRAY['draft'::"text", 'questions_extracted'::"text", 'matching'::"text", 'drafting'::"text", 'in_review'::"text", 'ready_for_export'::"text", 'submitted'::"text", 'won'::"text", 'lost'::"text", 'withdrawn'::"text"])))),
    CONSTRAINT "workspaces_type_check" CHECK (("type" = ANY (ARRAY['bid'::"text", 'kb_section'::"text"])))
);


ALTER TABLE "public"."workspaces" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_item_workspaces"("p_item_id" "uuid") RETURNS SETOF "public"."workspaces"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT w.* FROM workspaces w
  JOIN content_item_workspaces ciw ON ciw.workspace_id = w.id
  WHERE ciw.content_item_id = p_item_id AND w.is_archived = false
  ORDER BY w.name;
$$;


ALTER FUNCTION "public"."get_item_workspaces"("p_item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_items_with_quality_flags"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
    SELECT DISTINCT iql.content_item_id
    FROM ingestion_quality_log iql
    JOIN content_items ci ON iql.content_item_id = ci.id
    WHERE iql.resolved = FALSE
      AND iql.content_item_id IS NOT NULL
      AND ci.archived_at IS NULL;
$$;


ALTER FUNCTION "public"."get_items_with_quality_flags"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_popular_keywords"("limit_count" integer DEFAULT 20) RETURNS TABLE("keyword" "text", "count" bigint)
    LANGUAGE "sql"
    AS $$
  SELECT NULL::TEXT, 0::BIGINT WHERE FALSE;
$$;


ALTER FUNCTION "public"."get_popular_keywords"("limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_quality_issue_counts"() RETURNS TABLE("flag_type" "text", "severity" "text", "open_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
    SELECT
        iql.flag_type,
        iql.severity,
        COUNT(*) AS open_count
    FROM ingestion_quality_log iql
    LEFT JOIN content_items ci ON iql.content_item_id = ci.id
    WHERE iql.resolved = FALSE
      AND (ci.id IS NULL OR ci.archived_at IS NULL)
    GROUP BY iql.flag_type, iql.severity
    ORDER BY
        CASE iql.severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END,
        iql.flag_type;
$$;


ALTER FUNCTION "public"."get_quality_issue_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_reading_patterns"("days_back" integer DEFAULT 30) RETURNS json
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN '{}'::json;
END;
$$;


ALTER FUNCTION "public"."get_reading_patterns"("days_back" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tag_counts_filtered"("p_type" "text", "p_min_count" integer DEFAULT 1, "p_search" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("tag" "text", "count" bigint, "source" "text", "total_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_total bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Clamp limits
  IF p_limit > 500 THEN p_limit := 500; END IF;
  IF p_limit < 1 THEN p_limit := 50; END IF;
  IF p_offset < 0 THEN p_offset := 0; END IF;

  IF p_type = 'ai' THEN
    -- Get total matching count first
    SELECT count(*) INTO v_total
    FROM (
      SELECT t.tag
      FROM content_items ci, LATERAL unnest(ci.ai_keywords) AS t(tag)
      GROUP BY t.tag
      HAVING count(*) >= p_min_count
        AND (p_search IS NULL OR t.tag ILIKE '%' || p_search || '%')
    ) sub;

    RETURN QUERY
    SELECT
      t.tag::text,
      count(*)::bigint,
      'ai'::text AS source,
      v_total AS total_count
    FROM content_items ci, LATERAL unnest(ci.ai_keywords) AS t(tag)
    GROUP BY t.tag
    HAVING count(*) >= p_min_count
      AND (p_search IS NULL OR t.tag ILIKE '%' || p_search || '%')
    ORDER BY count(*) DESC, t.tag
    LIMIT p_limit
    OFFSET p_offset;

  ELSIF p_type = 'user' THEN
    SELECT count(*) INTO v_total
    FROM (
      SELECT t.tag
      FROM content_items ci, LATERAL unnest(ci.user_tags) AS t(tag)
      GROUP BY t.tag
      HAVING count(*) >= p_min_count
        AND (p_search IS NULL OR t.tag ILIKE '%' || p_search || '%')
    ) sub;

    RETURN QUERY
    SELECT
      t.tag::text,
      count(*)::bigint,
      'user'::text AS source,
      v_total AS total_count
    FROM content_items ci, LATERAL unnest(ci.user_tags) AS t(tag)
    GROUP BY t.tag
    HAVING count(*) >= p_min_count
      AND (p_search IS NULL OR t.tag ILIKE '%' || p_search || '%')
    ORDER BY count(*) DESC, t.tag
    LIMIT p_limit
    OFFSET p_offset;

  ELSE
    RAISE EXCEPTION 'Invalid p_type: %. Must be ''ai'' or ''user''.', p_type;
  END IF;
END;
$$;


ALTER FUNCTION "public"."get_tag_counts_filtered"("p_type" "text", "p_min_count" integer, "p_search" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tags_by_domain"("p_type" "text") RETURNS TABLE("domain" "text", "tag" "text", "count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_type = 'ai' THEN
    RETURN QUERY
    SELECT
      COALESCE(ci.primary_domain, 'Uncategorised')::text AS domain,
      t.tag::text,
      count(*)::bigint
    FROM content_items ci, LATERAL unnest(ci.ai_keywords) AS t(tag)
    GROUP BY ci.primary_domain, t.tag
    ORDER BY ci.primary_domain NULLS LAST, count(*) DESC, t.tag;

  ELSIF p_type = 'user' THEN
    RETURN QUERY
    SELECT
      COALESCE(ci.primary_domain, 'Uncategorised')::text AS domain,
      t.tag::text,
      count(*)::bigint
    FROM content_items ci, LATERAL unnest(ci.user_tags) AS t(tag)
    GROUP BY ci.primary_domain, t.tag
    ORDER BY ci.primary_domain NULLS LAST, count(*) DESC, t.tag;

  ELSE
    RAISE EXCEPTION 'Invalid p_type: %. Must be ''ai'' or ''user''.', p_type;
  END IF;
END;
$$;


ALTER FUNCTION "public"."get_tags_by_domain"("p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_template_summary"("p_template_id" "uuid") RETURNS TABLE("total_fields" bigint, "confirmed_fields" bigint, "rejected_fields" bigint, "unmapped_fields" bigint, "unreviewed_fields" bigint, "filled_fields" bigint, "pending_fields" bigint, "skipped_fields" bigint, "failed_fields" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
    SELECT
        COUNT(*)::BIGINT AS total_fields,
        COUNT(*) FILTER (WHERE mapping_status = 'confirmed' OR mapping_status = 'manual')::BIGINT AS confirmed_fields,
        COUNT(*) FILTER (WHERE mapping_status = 'rejected')::BIGINT AS rejected_fields,
        COUNT(*) FILTER (WHERE mapping_status = 'unmapped')::BIGINT AS unmapped_fields,
        COUNT(*) FILTER (WHERE mapping_status = 'unreviewed')::BIGINT AS unreviewed_fields,
        COUNT(*) FILTER (WHERE fill_status = 'filled')::BIGINT AS filled_fields,
        COUNT(*) FILTER (WHERE fill_status = 'pending')::BIGINT AS pending_fields,
        COUNT(*) FILTER (WHERE fill_status = 'skipped')::BIGINT AS skipped_fields,
        COUNT(*) FILTER (WHERE fill_status = 'failed')::BIGINT AS failed_fields
    FROM public.template_fields
    WHERE template_id = p_template_id;
$$;


ALTER FUNCTION "public"."get_template_summary"("p_template_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_top_authors"("limit_count" integer DEFAULT 10) RETURNS TABLE("author" "text", "count" bigint)
    LANGUAGE "sql"
    AS $$
  SELECT NULL::TEXT, 0::BIGINT WHERE FALSE;
$$;


ALTER FUNCTION "public"."get_top_authors"("limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_topic_deep_dive"("topic_name" "text") RETURNS json
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN '{}'::json;
END;
$$;


ALTER FUNCTION "public"."get_topic_deep_dive"("topic_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_topic_layers"("p_topic_id" "text") RETURNS TABLE("id" "uuid", "title" "text", "content_type" "text", "primary_domain" "text", "metadata" "jsonb", "layer" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT DISTINCT ON (ci.layer)
    ci.id,
    ci.title,
    ci.content_type,
    ci.primary_domain,
    ci.metadata,
    ci.layer
  FROM content_items ci
  LEFT JOIN layer_vocabulary lv ON lv.key = ci.layer
  WHERE ci.metadata->>'topic_id' = p_topic_id
  ORDER BY ci.layer, COALESCE(lv.display_order, 999), ci.title;
$$;


ALTER FUNCTION "public"."get_topic_layers"("p_topic_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_trend_analysis"("days_back" integer DEFAULT 30, "bucket_size" "text" DEFAULT 'day'::"text") RETURNS TABLE("period" timestamp with time zone, "count" bigint, "content_types" json)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN;
END;
$$;


ALTER FUNCTION "public"."get_trend_analysis"("days_back" integer, "bucket_size" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unique_authors"() RETURNS TABLE("author" "text", "count" bigint)
    LANGUAGE "sql"
    AS $$
  SELECT NULL::TEXT, 0::BIGINT WHERE FALSE;
$$;


ALTER FUNCTION "public"."get_unique_authors"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_role"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    user_role TEXT;
BEGIN
    SELECT role INTO user_role
    FROM user_roles
    WHERE user_id = auth.uid();

    RETURN COALESCE(user_role, 'viewer');
END;
$$;


ALTER FUNCTION "public"."get_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_tag_counts"() RETURNS TABLE("tag" "text", "count" bigint)
    LANGUAGE "sql"
    AS $$
  SELECT NULL::TEXT, 0::BIGINT WHERE FALSE;
$$;


ALTER FUNCTION "public"."get_user_tag_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_workspace_counts"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(jsonb_object_agg(name, cnt), '{}'::jsonb)
  FROM (
    SELECT w.name, COUNT(*) as cnt
    FROM content_item_workspaces ciw
    JOIN workspaces w ON w.id = ciw.workspace_id
    WHERE w.is_archived = false
    GROUP BY w.name
    ORDER BY cnt DESC
  ) sub;
$$;


ALTER FUNCTION "public"."get_workspace_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_workspace_item_counts"() RETURNS TABLE("workspace_id" "uuid", "item_count" bigint, "last_activity" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT w.id AS workspace_id, COUNT(ciw.id) AS item_count,
    MAX(ciw.assigned_at) AS last_activity
  FROM workspaces w
  LEFT JOIN content_item_workspaces ciw ON ciw.workspace_id = w.id
  GROUP BY w.id;
$$;


ALTER FUNCTION "public"."get_workspace_item_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user_role"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'viewer')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hybrid_search"("query_embedding" "public"."vector", "query_text" "text", "similarity_threshold" double precision DEFAULT 0.3, "limit_count" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "title" "text", "suggested_title" "text", "ai_summary" "text", "primary_domain" character varying, "primary_subtopic" character varying, "content_type" character varying, "platform" character varying, "author_name" character varying, "source_domain" character varying, "thumbnail_url" "text", "captured_date" timestamp with time zone, "ai_keywords" "text"[], "classification_confidence" numeric, "priority" character varying, "metadata" "jsonb", "similarity" numeric, "snippet" "text", "created_by" "uuid")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
    ci.id, ci.title, ci.suggested_title, ci.ai_summary,
    ci.primary_domain, ci.primary_subtopic, ci.content_type, ci.platform,
    ci.author_name, ci.source_domain, ci.thumbnail_url, ci.captured_date,
    ci.ai_keywords, ci.classification_confidence, ci.priority, ci.metadata,
    LEAST(1.0, (
      (1 - (ci.embedding <=> query_embedding)) * 0.70
      + CASE WHEN ci.suggested_title ILIKE '%' || query_text || '%' THEN 0.15
             WHEN ci.title ILIKE '%' || query_text || '%' THEN 0.15
             ELSE 0.0 END
      + CASE WHEN query_text = ANY(ci.ai_keywords) THEN 0.10
             WHEN EXISTS (SELECT 1 FROM unnest(ci.ai_keywords) AS kw WHERE kw ILIKE '%' || query_text || '%') THEN 0.05
             ELSE 0.0 END
      + CASE WHEN ci.ai_summary ILIKE '%' || query_text || '%' THEN 0.03 ELSE 0.0 END
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
    ci.created_by
  FROM content_items ci
  LEFT JOIN win_stats ws ON ws.content_item_id = ci.id
  WHERE ci.embedding IS NOT NULL
    AND ci.archived_at IS NULL
    AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$$;


ALTER FUNCTION "public"."hybrid_search"("query_embedding" "public"."vector", "query_text" "text", "similarity_threshold" double precision, "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hybrid_search"("query_text" "text", "query_embedding" "public"."vector", "match_count" integer DEFAULT 20, "full_text_weight" double precision DEFAULT 1.0, "semantic_weight" double precision DEFAULT 1.0, "rrf_k" integer DEFAULT 50) RETURNS TABLE("id" "uuid", "title" "text", "body" "text", "content_type" "text", "domain" "text", "created_by" "uuid", "similarity" double precision, "rank" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN;
END;
$$;


ALTER FUNCTION "public"."hybrid_search"("query_text" "text", "query_embedding" "public"."vector", "match_count" integer, "full_text_weight" double precision, "semantic_weight" double precision, "rrf_k" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_mentions_updated integer := 0;
  v_rel_sources_updated integer := 0;
  v_rel_targets_updated integer := 0;
  v_duplicates_removed integer := 0;
BEGIN
  -- Validate inputs
  IF p_target_name IS NULL OR p_target_name = '' THEN
    RAISE EXCEPTION 'Target name must not be empty';
  END IF;

  IF p_source_names IS NULL OR array_length(p_source_names, 1) IS NULL THEN
    RAISE EXCEPTION 'Source names array must not be empty';
  END IF;

  -- 1. Update entity_mentions: rename canonical_name to target and set type override
  UPDATE entity_mentions
  SET canonical_name = p_target_name,
      entity_type_override = p_entity_type
  WHERE canonical_name = ANY(p_source_names);

  GET DIAGNOSTICS v_mentions_updated = ROW_COUNT;

  -- 2. Update entity_relationships: source_entity references
  UPDATE entity_relationships
  SET source_entity = p_target_name
  WHERE source_entity = ANY(p_source_names);

  GET DIAGNOSTICS v_rel_sources_updated = ROW_COUNT;

  -- 3. Update entity_relationships: target_entity references
  UPDATE entity_relationships
  SET target_entity = p_target_name
  WHERE target_entity = ANY(p_source_names);

  GET DIAGNOSTICS v_rel_targets_updated = ROW_COUNT;

  -- 4. Delete duplicate mentions (same canonical_name + entity_type + content_item_id)
  --    Keep the row with highest confidence (or earliest created_at as tiebreaker)
  WITH duplicates AS (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY canonical_name, COALESCE(entity_type_override, entity_type), content_item_id
        ORDER BY confidence DESC NULLS LAST, created_at ASC
      ) AS rn
    FROM entity_mentions
    WHERE canonical_name = p_target_name
  )
  DELETE FROM entity_mentions
  WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

  GET DIAGNOSTICS v_duplicates_removed = ROW_COUNT;

  -- Return result summary as JSON
  RETURN jsonb_build_object(
    'merged', true,
    'target', p_target_name,
    'entity_type', p_entity_type,
    'mentions_updated', v_mentions_updated,
    'relationship_sources_updated', v_rel_sources_updated,
    'relationship_targets_updated', v_rel_targets_updated,
    'duplicates_removed', v_duplicates_removed
  );
END;
$$;


ALTER FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") IS 'Atomically merge multiple entities into one canonical form. Updates mentions, relationships, and deduplicates — all within a single transaction.';



CREATE OR REPLACE FUNCTION "public"."merge_item_metadata"("item_id" "uuid", "new_metadata" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN '{}'::jsonb;
END;
$$;


ALTER FUNCTION "public"."merge_item_metadata"("item_id" "uuid", "new_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."merge_tags"("p_source" "text", "p_target" "text", "p_type" "text") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  affected INTEGER;
BEGIN
  IF p_type = 'user' THEN
    UPDATE content_items
    SET user_tags = array_append(user_tags, p_target),
        updated_at = NOW()
    WHERE p_source = ANY(user_tags) AND NOT (p_target = ANY(user_tags));

    UPDATE content_items
    SET user_tags = array_remove(user_tags, p_source),
        updated_at = NOW()
    WHERE p_source = ANY(user_tags);
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSIF p_type = 'ai' THEN
    UPDATE content_items
    SET ai_keywords = array_append(ai_keywords, p_target),
        updated_at = NOW()
    WHERE p_source = ANY(ai_keywords) AND NOT (p_target = ANY(ai_keywords));

    UPDATE content_items
    SET ai_keywords = array_remove(ai_keywords, p_source),
        updated_at = NOW()
    WHERE p_source = ANY(ai_keywords);
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'Invalid tag type: %. Must be ''user'' or ''ai''.', p_type;
  END IF;
  RETURN affected;
END;
$$;


ALTER FUNCTION "public"."merge_tags"("p_source" "text", "p_target" "text", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_all_freshness"() RETURNS TABLE("total_count" integer, "fresh_count" integer, "aging_count" integer, "stale_count" integer, "expired_count" integer)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_now timestamptz := now();
  v_total int := 0;
  v_fresh int := 0;
  v_aging int := 0;
  v_stale int := 0;
  v_expired int := 0;
BEGIN
  -- Snapshot current freshness before recalculation
  UPDATE content_items
  SET previous_freshness = freshness
  WHERE archived_at IS NULL;

  -- bid_discovered: always fresh
  UPDATE content_items
  SET freshness = 'fresh', freshness_checked_at = v_now
  WHERE lifecycle_type = 'bid_discovered'
    AND archived_at IS NULL
    AND (freshness IS DISTINCT FROM 'fresh');

  -- date_bound: based on expiry_date
  UPDATE content_items
  SET freshness = CASE
    WHEN expiry_date IS NULL THEN 'aging'
    WHEN expiry_date < v_now THEN 'expired'
    WHEN expiry_date < v_now + interval '1 month' THEN 'stale'
    WHEN expiry_date < v_now + interval '3 months' THEN 'aging'
    ELSE 'fresh'
  END,
  freshness_checked_at = v_now
  WHERE lifecycle_type = 'date_bound'
    AND archived_at IS NULL;

  -- regulation: based on months since updated_at
  UPDATE content_items
  SET freshness = CASE
    WHEN updated_at IS NULL THEN 'stale'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 6 THEN 'fresh'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 9 THEN 'aging'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 12 THEN 'stale'
    ELSE 'expired'
  END,
  freshness_checked_at = v_now
  WHERE lifecycle_type = 'regulation'
    AND archived_at IS NULL;

  -- evergreen + null lifecycle_type: based on months since updated_at
  UPDATE content_items
  SET freshness = CASE
    WHEN updated_at IS NULL THEN 'stale'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 12 THEN 'fresh'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 18 THEN 'aging'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 24 THEN 'stale'
    ELSE 'expired'
  END,
  freshness_checked_at = v_now
  WHERE (lifecycle_type = 'evergreen' OR lifecycle_type IS NULL)
    AND archived_at IS NULL;

  -- Count final states (excluding archived)
  SELECT COUNT(*) FILTER (WHERE freshness = 'fresh'),
         COUNT(*) FILTER (WHERE freshness = 'aging'),
         COUNT(*) FILTER (WHERE freshness = 'stale'),
         COUNT(*) FILTER (WHERE freshness = 'expired'),
         COUNT(*)
  INTO v_fresh, v_aging, v_stale, v_expired, v_total
  FROM content_items
  WHERE archived_at IS NULL;

  RETURN QUERY SELECT v_total, v_fresh, v_aging, v_stale, v_expired;
END;
$$;


ALTER FUNCTION "public"."recalculate_all_freshness"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rename_tag"("p_old" "text", "p_new" "text", "p_type" "text") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  affected INTEGER;
BEGIN
  IF p_type = 'user' THEN
    UPDATE content_items
    SET user_tags = array_replace(user_tags, p_old, p_new),
        updated_at = NOW()
    WHERE p_old = ANY(user_tags);
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSIF p_type = 'ai' THEN
    UPDATE content_items
    SET ai_keywords = array_replace(ai_keywords, p_old, p_new),
        updated_at = NOW()
    WHERE p_old = ANY(ai_keywords);
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'Invalid tag type: %. Must be ''user'' or ''ai''.', p_type;
  END IF;
  RETURN affected;
END;
$$;


ALTER FUNCTION "public"."rename_tag"("p_old" "text", "p_new" "text", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_quality_scan"("p_batch_name" "text" DEFAULT ('quality-scan-'::"text" || "to_char"("now"(), 'YYYYMMDD-HH24MISS'::"text"))) RETURNS TABLE("issue_type" "text", "items_found" bigint, "flags_created" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_missing_domain BIGINT := 0;
    v_missing_domain_flagged BIGINT := 0;
    v_low_confidence BIGINT := 0;
    v_low_confidence_flagged BIGINT := 0;
    v_empty_source_url BIGINT := 0;
    v_empty_content BIGINT := 0;
    v_empty_content_flagged BIGINT := 0;
BEGIN
    -- 1. Missing domain classification
    SELECT COUNT(*) INTO v_missing_domain
    FROM content_items
    WHERE primary_domain IS NULL;

    INSERT INTO ingestion_quality_log (content_item_id, flag_type, severity, details, ingestion_batch)
    SELECT
        ci.id,
        'classification_low',
        'warning',
        jsonb_build_object(
            'confidence', COALESCE(ci.classification_confidence, 0),
            'reason', 'Missing domain classification',
            'scan_source', 'run_quality_scan'
        ),
        p_batch_name
    FROM content_items ci
    WHERE ci.primary_domain IS NULL
      AND ci.id NOT IN (
          SELECT iql.content_item_id
          FROM ingestion_quality_log iql
          WHERE iql.flag_type = 'classification_low'
            AND iql.resolved = FALSE
            AND iql.content_item_id IS NOT NULL
      );

    GET DIAGNOSTICS v_missing_domain_flagged = ROW_COUNT;

    -- 2. Low classification confidence (< 0.30)
    SELECT COUNT(*) INTO v_low_confidence
    FROM content_items
    WHERE primary_domain IS NOT NULL
      AND classification_confidence IS NOT NULL
      AND classification_confidence < 0.30;

    INSERT INTO ingestion_quality_log (content_item_id, flag_type, severity, details, ingestion_batch)
    SELECT
        ci.id,
        'classification_low',
        'info',
        jsonb_build_object(
            'confidence', ci.classification_confidence,
            'domain', ci.primary_domain,
            'subtopic', ci.primary_subtopic,
            'reason', 'Very low classification confidence (< 0.30)',
            'scan_source', 'run_quality_scan'
        ),
        p_batch_name
    FROM content_items ci
    WHERE ci.primary_domain IS NOT NULL
      AND ci.classification_confidence IS NOT NULL
      AND ci.classification_confidence < 0.30
      AND ci.id NOT IN (
          SELECT iql.content_item_id
          FROM ingestion_quality_log iql
          WHERE iql.flag_type = 'classification_low'
            AND iql.resolved = FALSE
            AND iql.content_item_id IS NOT NULL
      );

    GET DIAGNOSTICS v_low_confidence_flagged = ROW_COUNT;

    -- 3. Empty-string source_url (fix in-place)
    UPDATE content_items
    SET source_url = NULL
    WHERE source_url = '';

    GET DIAGNOSTICS v_empty_source_url = ROW_COUNT;

    UPDATE content_items
    SET source_domain = NULL
    WHERE source_domain = '';

    -- 4. Empty content field
    SELECT COUNT(*) INTO v_empty_content
    FROM content_items
    WHERE content IS NULL OR TRIM(content) = '';

    INSERT INTO ingestion_quality_log (content_item_id, flag_type, severity, details, ingestion_batch)
    SELECT
        ci.id,
        'missing_content',
        'error',
        jsonb_build_object(
            'reason', 'Content field is empty or NULL',
            'scan_source', 'run_quality_scan'
        ),
        p_batch_name
    FROM content_items ci
    WHERE (ci.content IS NULL OR TRIM(ci.content) = '')
      AND ci.id NOT IN (
          SELECT iql.content_item_id
          FROM ingestion_quality_log iql
          WHERE iql.flag_type = 'missing_content'
            AND iql.resolved = FALSE
            AND iql.content_item_id IS NOT NULL
      );

    GET DIAGNOSTICS v_empty_content_flagged = ROW_COUNT;

    -- Return summary
    RETURN QUERY VALUES
        ('missing_domain_classification', v_missing_domain, v_missing_domain_flagged),
        ('low_confidence_classification', v_low_confidence, v_low_confidence_flagged),
        ('empty_string_source_url_fixed', v_empty_source_url, 0::BIGINT),
        ('empty_content', v_empty_content, v_empty_content_flagged);
END;
$$;


ALTER FUNCTION "public"."run_quality_scan"("p_batch_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_content"("query_embedding" "public"."vector", "similarity_threshold" double precision DEFAULT 0.3, "limit_count" integer DEFAULT 50) RETURNS TABLE("id" "uuid", "title" "text", "suggested_title" "text", "ai_summary" "text", "primary_domain" character varying, "primary_subtopic" character varying, "content_type" character varying, "platform" character varying, "author_name" character varying, "source_domain" character varying, "thumbnail_url" "text", "captured_date" timestamp with time zone, "ai_keywords" "text"[], "classification_confidence" numeric, "similarity" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT ci.id, ci.title, ci.suggested_title, ci.ai_summary,
    ci.primary_domain, ci.primary_subtopic, ci.content_type, ci.platform,
    ci.author_name, ci.source_domain, ci.thumbnail_url, ci.captured_date,
    ci.ai_keywords, ci.classification_confidence,
    (1 - (ci.embedding <=> query_embedding))::NUMERIC(4, 3) AS similarity
  FROM content_items ci
  WHERE ci.embedding IS NOT NULL
    AND ci.archived_at IS NULL
    AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
  ORDER BY ci.embedding <=> query_embedding
  LIMIT limit_count;
END;
$$;


ALTER FUNCTION "public"."search_content"("query_embedding" "public"."vector", "similarity_threshold" double precision, "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_for_bid_response"("query_embedding" "public"."vector", "query_text" "text" DEFAULT ''::"text", "limit_count" integer DEFAULT 10) RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "brief" "text", "detail" "text", "primary_domain" character varying, "primary_subtopic" character varying, "content_type" character varying, "ai_keywords" "text"[], "similarity" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
    AND ci.archived_at IS NULL
    AND (1 - (ci.embedding <=> query_embedding)) > 0.25
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$$;


ALTER FUNCTION "public"."search_for_bid_response"("query_embedding" "public"."vector", "query_text" "text", "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_for_bid_response"("question_id" "uuid", "query_embedding" "public"."vector", "match_count" integer DEFAULT 10, "domain_filter" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "title" "text", "body" "text", "brief" "text", "detail" "text", "content_type" "text", "domain" "text", "quality_score" real, "similarity" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN;
END;
$$;


ALTER FUNCTION "public"."search_for_bid_response"("question_id" "uuid", "query_embedding" "public"."vector", "match_count" integer, "domain_filter" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_config"("setting" "text", "value" "text", "is_local" boolean) RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT pg_catalog.set_config(setting, value, is_local);
$$;


ALTER FUNCTION "public"."set_config"("setting" "text", "value" "text", "is_local" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snapshot_bid_response_history"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.response_text IS DISTINCT FROM NEW.response_text
     OR OLD.response_text_advanced IS DISTINCT FROM NEW.response_text_advanced
     OR OLD.metadata IS DISTINCT FROM NEW.metadata THEN

    INSERT INTO bid_response_history (
      response_id, version, response_text, response_text_advanced,
      review_status, metadata, source_content_ids, edited_by, change_reason
    ) VALUES (
      OLD.id, OLD.version, OLD.response_text, OLD.response_text_advanced,
      OLD.review_status, OLD.metadata, OLD.source_content_ids,
      COALESCE(auth.uid(), NEW.last_edited_by),
      current_setting('app.change_reason', true)
    );
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."snapshot_bid_response_history"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."suggest_tags"("p_prefix" "text", "p_type" "text") RETURNS TABLE("tag" "text", "count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT tag, COUNT(*) AS count
  FROM (
    SELECT unnest(CASE WHEN p_type = 'user' THEN user_tags
                       WHEN p_type = 'ai'   THEN ai_keywords
                  END) AS tag
    FROM content_items
    WHERE CASE WHEN p_type = 'user'
               THEN user_tags IS NOT NULL AND array_length(user_tags, 1) > 0
               WHEN p_type = 'ai'
               THEN ai_keywords IS NOT NULL AND array_length(ai_keywords, 1) > 0
               ELSE FALSE
          END
  ) expanded
  WHERE tag ILIKE (p_prefix || '%')
  GROUP BY tag
  ORDER BY count DESC, tag ASC
  LIMIT 10;
$$;


ALTER FUNCTION "public"."suggest_tags"("p_prefix" "text", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_bid_status_to_jsonb"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.type = 'bid' AND NEW.status IS NOT NULL THEN
    NEW.domain_metadata := COALESCE(NEW.domain_metadata, '{}'::jsonb)
      || jsonb_build_object('status', NEW.status);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_bid_status_to_jsonb"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."toggle_star"("item_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."toggle_star"("item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."toggle_star"("p_item_id" "uuid", "p_starred" boolean) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  UPDATE content_items
  SET starred = p_starred,
      updated_at = now()
  WHERE id = p_item_id;
$$;


ALTER FUNCTION "public"."toggle_star"("p_item_id" "uuid", "p_starred" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_citation_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  target_id uuid;
  new_count int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_id := OLD.content_item_id;
  ELSE
    target_id := NEW.content_item_id;
  END IF;

  SELECT count(*)::int INTO new_count
  FROM content_citations
  WHERE content_item_id = target_id;

  -- Write to proper column instead of JSONB
  UPDATE content_items
  SET citation_count = new_count
  WHERE id = target_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."update_citation_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_layer_key"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  IF NEW.layer IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM layer_vocabulary WHERE key = NEW.layer) THEN
      RAISE EXCEPTION 'Invalid layer key: %. Must exist in layer_vocabulary.', NEW.layer;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_layer_key"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bid_questions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "section_name" "text",
    "section_sequence" integer,
    "question_sequence" integer,
    "question_text" "text" NOT NULL,
    "word_limit" integer,
    "evaluation_weight" real,
    "confidence_posture" "text",
    "matched_content_ids" "uuid"[],
    "status" "text" DEFAULT 'pending'::"text",
    "has_variants" boolean DEFAULT false,
    "assigned_to" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "template_requirement_id" "uuid",
    CONSTRAINT "bid_questions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'drafted'::"text", 'reviewed'::"text", 'final'::"text", 'skipped'::"text", 'complete'::"text"])))
);


ALTER TABLE "public"."bid_questions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bid_response_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "response_id" "uuid" NOT NULL,
    "version" integer NOT NULL,
    "response_text" "text",
    "response_text_advanced" "text",
    "review_status" character varying NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "source_content_ids" "uuid"[],
    "edited_by" "uuid",
    "change_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bid_response_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bid_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question_id" "uuid" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "response_text" "text",
    "response_text_advanced" "text",
    "source_content_ids" "uuid"[],
    "review_status" character varying DEFAULT 'draft'::character varying NOT NULL,
    "drafted_by" "uuid",
    "last_edited_by" "uuid",
    "approved_by" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "overall_score" numeric(5,1),
    CONSTRAINT "chk_bid_responses_overall_score_range" CHECK ((("overall_score" IS NULL) OR (("overall_score" >= (0)::numeric) AND ("overall_score" <= (100)::numeric))))
);


ALTER TABLE "public"."bid_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_citations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_item_id" "uuid" NOT NULL,
    "bid_response_id" "uuid" NOT NULL,
    "citation_type" "text" DEFAULT 'reference'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    CONSTRAINT "content_citations_citation_type_check" CHECK (("citation_type" = ANY (ARRAY['reference'::"text", 'copied'::"text", 'adapted'::"text", 'inspired'::"text"])))
);


ALTER TABLE "public"."content_citations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_item_id" "uuid",
    "version" integer NOT NULL,
    "title" "text",
    "content" "text",
    "brief" "text",
    "detail" "text",
    "reference" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "change_summary" "text",
    "change_type" character varying,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "content_history_change_type_check" CHECK ((("change_type")::"text" = ANY (ARRAY['create'::"text", 'edit'::"text", 'ai_update'::"text", 'import'::"text", 'merge'::"text", 'rollback'::"text", 'archive'::"text", 'delete'::"text", 'metadata_change'::"text", 'owner_change'::"text"])))
);


ALTER TABLE "public"."content_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_item_workspaces" (
    "content_item_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"(),
    "id" "uuid" DEFAULT "gen_random_uuid"()
);


ALTER TABLE "public"."content_item_workspaces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" character varying(50) NOT NULL,
    "name" character varying(200) NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "content_type" character varying(50) NOT NULL,
    "title_template" "text" DEFAULT ''::"text" NOT NULL,
    "content_template" "text" DEFAULT ''::"text" NOT NULL,
    "brief_template" "text",
    "suggested_domain" character varying(100) DEFAULT NULL::character varying,
    "default_tags" "text"[] DEFAULT '{}'::"text"[],
    "display_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."content_templates" OWNER TO "postgres";


COMMENT ON TABLE "public"."content_templates" IS 'Content creation templates that pre-fill the create form with suggested structure and metadata.';



CREATE TABLE IF NOT EXISTS "public"."coverage_targets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "metric_name" "text" NOT NULL,
    "target_value" numeric NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone,
    CONSTRAINT "coverage_targets_metric_check" CHECK (("metric_name" = ANY (ARRAY['item_count'::"text", 'fresh_pct'::"text", 'max_expired'::"text"])))
);


ALTER TABLE "public"."coverage_targets" OWNER TO "postgres";


COMMENT ON TABLE "public"."coverage_targets" IS 'Per-domain coverage targets. Extensible metric model — add new metric_name values via CHECK constraint update.';



COMMENT ON COLUMN "public"."coverage_targets"."metric_name" IS 'Target metric: item_count (minimum items), fresh_pct (minimum freshness 0-100), max_expired (maximum expired items)';



COMMENT ON COLUMN "public"."coverage_targets"."target_value" IS 'Numeric target value. Interpretation depends on metric_name.';



CREATE TABLE IF NOT EXISTS "public"."digests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "item_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."digests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."entity_mentions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_item_id" "uuid" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_name" "text" NOT NULL,
    "canonical_name" "text" NOT NULL,
    "confidence" numeric(3,2) DEFAULT 1.0,
    "context_snippet" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "entity_type_override" "text",
    "normalisation_version" integer DEFAULT 1,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "entity_mentions_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))),
    CONSTRAINT "entity_mentions_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['organisation'::"text", 'certification'::"text", 'regulation'::"text", 'framework'::"text", 'capability'::"text", 'person'::"text", 'technology'::"text", 'project'::"text", 'sector'::"text", 'product'::"text"])))
);


ALTER TABLE "public"."entity_mentions" OWNER TO "postgres";


COMMENT ON TABLE "public"."entity_mentions" IS 'Entities extracted from content items by AI classification';



COMMENT ON COLUMN "public"."entity_mentions"."entity_name" IS 'Original entity name as found in text';



COMMENT ON COLUMN "public"."entity_mentions"."canonical_name" IS 'Normalised form for deduplication (e.g. "ISO 27001" not "ISO27001")';



COMMENT ON COLUMN "public"."entity_mentions"."context_snippet" IS 'Short excerpt showing where the entity was found';



COMMENT ON COLUMN "public"."entity_mentions"."entity_type_override" IS 'Admin-set entity type that overrides AI-extracted type. NULL = use entity_type.';



COMMENT ON COLUMN "public"."entity_mentions"."normalisation_version" IS 'Version of canonicalise() rules applied. Allows selective re-normalisation.';



COMMENT ON COLUMN "public"."entity_mentions"."metadata" IS 'Structured metadata for entity-level properties. For certifications: version, issuing_body, expiry_date, scope, certificate_number, holder. For frameworks: round, status, expiry_date, lot, supplier_id.';



CREATE TABLE IF NOT EXISTS "public"."entity_relationships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_entity" "text" NOT NULL,
    "relationship_type" "text" NOT NULL,
    "target_entity" "text" NOT NULL,
    "source_item_id" "uuid",
    "confidence" numeric(3,2) DEFAULT 1.0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "entity_relationships_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))),
    CONSTRAINT "entity_relationships_relationship_type_check" CHECK (("relationship_type" = ANY (ARRAY['holds'::"text", 'complies_with'::"text", 'delivers_to'::"text", 'uses'::"text", 'demonstrated_by'::"text", 'requires'::"text", 'part_of'::"text", 'supersedes'::"text", 'references'::"text", 'evidences'::"text"])))
);


ALTER TABLE "public"."entity_relationships" OWNER TO "postgres";


COMMENT ON TABLE "public"."entity_relationships" IS 'Relationships between entities extracted from content';



COMMENT ON COLUMN "public"."entity_relationships"."source_entity" IS 'Canonical name of the source entity';



COMMENT ON COLUMN "public"."entity_relationships"."target_entity" IS 'Canonical name of the target entity';



COMMENT ON COLUMN "public"."entity_relationships"."source_item_id" IS 'Content item where this relationship was found';



CREATE TABLE IF NOT EXISTS "public"."governance_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain" "text" NOT NULL,
    "posture" "text" DEFAULT 'open'::"text" NOT NULL,
    "reviewer_id" "uuid",
    "timeout_days" integer DEFAULT 7,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "quality_score_threshold" integer DEFAULT 40,
    "auto_flag_on_quality_drop" boolean DEFAULT true,
    "auto_flag_on_freshness_transition" boolean DEFAULT true,
    "auto_flag_cooldown_days" integer DEFAULT 7,
    CONSTRAINT "governance_config_posture_check" CHECK (("posture" = ANY (ARRAY['open'::"text", 'review_on_change'::"text"])))
);


ALTER TABLE "public"."governance_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."guide_sections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "guide_id" "uuid" NOT NULL,
    "section_name" "text" NOT NULL,
    "description" "text",
    "expected_layer" "text",
    "subtopic_filter" "text",
    "content_type_filter" "text",
    "display_order" integer DEFAULT 0 NOT NULL,
    "is_required" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."guide_sections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."guides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "guide_type" "text" DEFAULT 'sector'::"text" NOT NULL,
    "domain_filter" "text",
    "icon" "text",
    "color" "text",
    "display_order" integer DEFAULT 0 NOT NULL,
    "is_published" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "guides_type_check" CHECK (("guide_type" = ANY (ARRAY['sector'::"text", 'product'::"text", 'company'::"text", 'research'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."guides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ingestion_quality_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_item_id" "uuid",
    "flag_type" "text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "severity" "text" DEFAULT 'warning'::"text",
    "ingestion_batch" "text",
    CONSTRAINT "ingestion_quality_log_flag_type_check" CHECK (("flag_type" = ANY (ARRAY['duplicate'::"text", 'low_quality'::"text", 'missing_field'::"text", 'review_needed'::"text", 'stale'::"text", 'conflicting'::"text"]))),
    CONSTRAINT "ingestion_quality_log_severity_check" CHECK (("severity" = ANY (ARRAY['error'::"text", 'warning'::"text", 'info'::"text"])))
);


ALTER TABLE "public"."ingestion_quality_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."layer_vocabulary" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" character varying(50) NOT NULL,
    "label" character varying(100) NOT NULL,
    "description" "text",
    "display_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."layer_vocabulary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text",
    "read_at" timestamp with time zone,
    "dismissed_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '24:00:00'::interval),
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "notifications_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['content_item'::"text", 'digest'::"text", 'template_requirement'::"text", 'domain'::"text", 'source_document'::"text", 'entity_mention'::"text"]))),
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['governance_review_needed'::"text", 'governance_approve'::"text", 'governance_request_changes'::"text", 'governance_revert'::"text", 'quality_flag'::"text", 'digest_ready'::"text", 'freshness_transition'::"text", 'coverage_alert'::"text", 'content_gap'::"text", 'owner_content_stale'::"text", 'owner_content_updated'::"text", 'owner_assignment'::"text", 'source_document_updated'::"text", 'date_expiry_approaching'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pipeline_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pipeline_name" "text" NOT NULL,
    "status" "text" DEFAULT 'running'::"text",
    "items_processed" integer DEFAULT 0,
    "items_created" integer DEFAULT 0,
    "items_updated" integer DEFAULT 0,
    "items_skipped" integer DEFAULT 0,
    "error_log" "jsonb" DEFAULT '[]'::"jsonb",
    "started_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "created_by" "uuid",
    "cost" numeric,
    "result" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "progress" "jsonb" DEFAULT '{}'::"jsonb",
    "source_filename" "text",
    "workspace_id" "uuid",
    CONSTRAINT "pipeline_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."pipeline_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."processing_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "priority" integer DEFAULT 0,
    "attempts" integer DEFAULT 0,
    "max_attempts" integer DEFAULT 3,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "result" "jsonb",
    CONSTRAINT "processing_queue_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "processing_queue_task_type_check" CHECK (("task_type" = ANY (ARRAY['embed'::"text", 'classify'::"text", 'extract_qa'::"text", 'summarise'::"text", 'validate'::"text", 'reprocess'::"text"])))
);


ALTER TABLE "public"."processing_queue" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."quality_issues_pending" AS
 SELECT "iql"."id",
    "iql"."content_item_id",
    "iql"."flag_type",
    "iql"."details",
    "iql"."resolved",
    "iql"."created_at",
    "iql"."severity",
    "iql"."ingestion_batch",
    "ci"."title" AS "item_title"
   FROM ("public"."ingestion_quality_log" "iql"
     JOIN "public"."content_items" "ci" ON (("iql"."content_item_id" = "ci"."id")))
  WHERE ("iql"."resolved" = false);


ALTER VIEW "public"."quality_issues_pending" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."read_marks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_item_id" "uuid",
    "read_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid"
);


ALTER TABLE "public"."read_marks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reviewer_id" "uuid" NOT NULL,
    "assigned_by" "uuid" NOT NULL,
    "assignment_type" "text" DEFAULT 'manual'::"text" NOT NULL,
    "filter_domains" "text"[] DEFAULT '{}'::"text"[],
    "filter_content_types" "text"[] DEFAULT '{}'::"text"[],
    "filter_freshness" "text"[] DEFAULT '{}'::"text"[],
    "filter_date_from" timestamp with time zone,
    "filter_date_to" timestamp with time zone,
    "item_count" integer,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "notes" "text",
    "due_date" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "review_assignments_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "review_assignments_type_check" CHECK (("assignment_type" = ANY (ARRAY['manual'::"text", 'round_robin'::"text", 'self_assigned'::"text"])))
);


ALTER TABLE "public"."review_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."source_document_diffs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "old_document_id" "uuid" NOT NULL,
    "new_document_id" "uuid" NOT NULL,
    "diff_type" "text" NOT NULL,
    "old_content" "text",
    "new_content" "text",
    "old_question" "text",
    "new_question" "text",
    "similarity_score" double precision,
    "affected_content_item_id" "uuid",
    "status" "text" DEFAULT 'pending_review'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "created_by" "uuid",
    "reviewer_note" "text",
    CONSTRAINT "different_documents" CHECK (("old_document_id" <> "new_document_id")),
    CONSTRAINT "source_document_diffs_diff_type_check" CHECK (("diff_type" = ANY (ARRAY['added'::"text", 'removed'::"text", 'modified'::"text", 'unchanged'::"text"]))),
    CONSTRAINT "source_document_diffs_status_check" CHECK (("status" = ANY (ARRAY['pending_review'::"text", 'applied'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."source_document_diffs" OWNER TO "postgres";


COMMENT ON TABLE "public"."source_document_diffs" IS 'Stores Q&A pair-level diffs between source document versions. Each row represents one matched or unmatched pair.';



COMMENT ON COLUMN "public"."source_document_diffs"."reviewed_at" IS 'Timestamp when the entry status was last changed from pending_review';



COMMENT ON COLUMN "public"."source_document_diffs"."reviewed_by" IS 'User who last changed the entry status';



COMMENT ON COLUMN "public"."source_document_diffs"."created_by" IS 'User who triggered the diff computation';



COMMENT ON COLUMN "public"."source_document_diffs"."reviewer_note" IS 'Free-text reviewer annotation explaining the review decision for this diff entry';



CREATE TABLE IF NOT EXISTS "public"."source_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "filename" "text" NOT NULL,
    "original_filename" "text" NOT NULL,
    "mime_type" character varying NOT NULL,
    "file_size" integer NOT NULL,
    "content_hash" "text" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "parent_id" "uuid",
    "storage_path" "text" NOT NULL,
    "status" character varying DEFAULT 'uploaded'::character varying NOT NULL,
    "extracted_text" "text",
    "extraction_metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "workspace_id" "uuid",
    "pipeline_run_id" "uuid",
    "uploaded_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    CONSTRAINT "source_documents_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['uploaded'::character varying, 'processing'::character varying, 'processed'::character varying, 'failed'::character varying])::"text"[])))
);


ALTER TABLE "public"."source_documents" OWNER TO "postgres";


COMMENT ON TABLE "public"."source_documents" IS 'Tracks uploaded source documents with version history. Each row is a specific version of a document. The parent_id chain links versions together.';



CREATE TABLE IF NOT EXISTS "public"."taxonomy_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "display_order" integer DEFAULT 0,
    "colour" "text",
    "is_active" boolean DEFAULT true,
    "provenance" "text",
    "recommended_by" "text",
    "recommended_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."taxonomy_domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."taxonomy_subtopics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "display_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "provenance" "text",
    "recommended_by" "text",
    "recommended_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."taxonomy_subtopics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."template_completions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "job_id" "uuid",
    "storage_path" "text" NOT NULL,
    "fields_filled" integer NOT NULL,
    "fields_skipped" integer DEFAULT 0,
    "fields_failed" integer DEFAULT 0,
    "file_size" integer,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."template_completions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."template_fields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "field_type" "text" NOT NULL,
    "table_index" integer,
    "row_index" integer,
    "col_index" integer,
    "question_text" "text",
    "section_name" "text",
    "word_limit" integer,
    "placeholder_text" "text",
    "question_id" "uuid",
    "mapping_status" "text" DEFAULT 'unreviewed'::"text" NOT NULL,
    "mapping_confidence" real,
    "fill_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "fill_error" "text",
    "sequence" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "template_fields_field_type_check" CHECK (("field_type" = ANY (ARRAY['empty_cell'::"text", 'placeholder'::"text", 'highlighted'::"text"]))),
    CONSTRAINT "template_fields_fill_status_check" CHECK (("fill_status" = ANY (ARRAY['pending'::"text", 'filled'::"text", 'skipped'::"text", 'failed'::"text"]))),
    CONSTRAINT "template_fields_mapping_status_check" CHECK (("mapping_status" = ANY (ARRAY['unreviewed'::"text", 'confirmed'::"text", 'rejected'::"text", 'manual'::"text", 'unmapped'::"text"])))
);


ALTER TABLE "public"."template_fields" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."template_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_name" "text" NOT NULL,
    "template_version" "text",
    "template_type" "text" NOT NULL,
    "section_ref" "text" NOT NULL,
    "section_name" "text" NOT NULL,
    "question_number" integer,
    "requirement_text" "text" NOT NULL,
    "description" "text",
    "requirement_type" "text" NOT NULL,
    "primary_domain" character varying,
    "primary_subtopic" character varying,
    "secondary_domain" character varying,
    "secondary_subtopic" character varying,
    "matching_keywords" "text"[],
    "matching_guidance" "text",
    "requirement_embedding" "public"."vector"(1024),
    "is_mandatory" boolean DEFAULT true,
    "is_current" boolean DEFAULT true,
    "sector_applicability" "text"[],
    "word_limit_guidance" integer,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "template_requirements_requirement_type_check" CHECK (("requirement_type" = ANY (ARRAY['policy'::"text", 'statement'::"text", 'evidence'::"text", 'data'::"text", 'narrative'::"text", 'declaration'::"text", 'reference'::"text"]))),
    CONSTRAINT "template_requirements_template_type_check" CHECK (("template_type" = ANY (ARRAY['sq'::"text", 'rfp'::"text", 'eqq'::"text", 'pqq'::"text", 'gcloud'::"text", 'method_statement'::"text", 'dos'::"text", 'dps'::"text", 'framework'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."template_requirements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "filename" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_size" integer NOT NULL,
    "mime_type" "text" NOT NULL,
    "status" "text" DEFAULT 'uploaded'::"text" NOT NULL,
    "field_count" integer,
    "mapped_count" integer DEFAULT 0,
    "structure_path" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "templates_mime_type_check" CHECK (("mime_type" = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'::"text")),
    CONSTRAINT "templates_status_check" CHECK (("status" = ANY (ARRAY['uploaded'::"text", 'analysing'::"text", 'analysed'::"text", 'analysis_failed'::"text", 'filling'::"text", 'completed'::"text", 'fill_failed'::"text"])))
);


ALTER TABLE "public"."templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "granted_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "display_name" "text",
    CONSTRAINT "user_roles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'editor'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."verification_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_item_id" "uuid" NOT NULL,
    "action_type" character varying(20) NOT NULL,
    "note" "text",
    "performed_by" "uuid" NOT NULL,
    "performed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "verification_history_action_type_check" CHECK ((("action_type")::"text" = ANY ((ARRAY['verify'::character varying, 'unverify'::character varying, 'flag'::character varying])::"text"[])))
);


ALTER TABLE "public"."verification_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."verification_history" IS 'Audit trail of verification actions on content items. Each verify, unverify, or flag action creates a row.';



COMMENT ON COLUMN "public"."verification_history"."content_item_id" IS 'The content item this verification action relates to';



COMMENT ON COLUMN "public"."verification_history"."action_type" IS 'Action taken: verify (mark as verified), unverify (remove verification), flag (raise quality concern)';



COMMENT ON COLUMN "public"."verification_history"."note" IS 'Optional reviewer note, max 500 characters enforced at application layer';



COMMENT ON COLUMN "public"."verification_history"."performed_by" IS 'UUID of the user who performed the action';



COMMENT ON COLUMN "public"."verification_history"."performed_at" IS 'Timestamp when the action was performed';



ALTER TABLE ONLY "public"."bid_questions"
    ADD CONSTRAINT "bid_questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bid_questions"
    ADD CONSTRAINT "bid_questions_project_question_unique" UNIQUE ("project_id", "question_text");



ALTER TABLE ONLY "public"."bid_response_history"
    ADD CONSTRAINT "bid_response_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bid_response_history"
    ADD CONSTRAINT "bid_response_history_response_id_version_key" UNIQUE ("response_id", "version");



ALTER TABLE ONLY "public"."bid_responses"
    ADD CONSTRAINT "bid_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_citations"
    ADD CONSTRAINT "content_citations_content_item_id_bid_response_id_key" UNIQUE ("content_item_id", "bid_response_id");



ALTER TABLE ONLY "public"."content_citations"
    ADD CONSTRAINT "content_citations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_history"
    ADD CONSTRAINT "content_history_content_item_id_version_key" UNIQUE ("content_item_id", "version");



ALTER TABLE ONLY "public"."content_history"
    ADD CONSTRAINT "content_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_item_workspaces"
    ADD CONSTRAINT "content_item_projects_pkey" PRIMARY KEY ("content_item_id", "workspace_id");



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_templates"
    ADD CONSTRAINT "content_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_templates"
    ADD CONSTRAINT "content_templates_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."coverage_targets"
    ADD CONSTRAINT "coverage_targets_domain_metric_unique" UNIQUE ("domain_id", "metric_name");



ALTER TABLE ONLY "public"."coverage_targets"
    ADD CONSTRAINT "coverage_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."digests"
    ADD CONSTRAINT "digests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entity_mentions"
    ADD CONSTRAINT "entity_mentions_canonical_name_entity_type_content_item_id_key" UNIQUE ("canonical_name", "entity_type", "content_item_id");



ALTER TABLE ONLY "public"."entity_mentions"
    ADD CONSTRAINT "entity_mentions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entity_relationships"
    ADD CONSTRAINT "entity_relationships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."governance_config"
    ADD CONSTRAINT "governance_config_domain_key" UNIQUE ("domain");



ALTER TABLE ONLY "public"."governance_config"
    ADD CONSTRAINT "governance_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guide_sections"
    ADD CONSTRAINT "guide_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guides"
    ADD CONSTRAINT "guides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guides"
    ADD CONSTRAINT "guides_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."ingestion_quality_log"
    ADD CONSTRAINT "ingestion_quality_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."layer_vocabulary"
    ADD CONSTRAINT "layer_vocabulary_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."layer_vocabulary"
    ADD CONSTRAINT "layer_vocabulary_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipeline_runs"
    ADD CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."processing_queue"
    ADD CONSTRAINT "processing_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."read_marks"
    ADD CONSTRAINT "read_marks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_assignments"
    ADD CONSTRAINT "review_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."source_document_diffs"
    ADD CONSTRAINT "source_document_diffs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."source_documents"
    ADD CONSTRAINT "source_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."taxonomy_domains"
    ADD CONSTRAINT "taxonomy_domains_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."taxonomy_domains"
    ADD CONSTRAINT "taxonomy_domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."taxonomy_subtopics"
    ADD CONSTRAINT "taxonomy_subtopics_domain_id_name_key" UNIQUE ("domain_id", "name");



ALTER TABLE ONLY "public"."taxonomy_subtopics"
    ADD CONSTRAINT "taxonomy_subtopics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_completions"
    ADD CONSTRAINT "template_completions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_fields"
    ADD CONSTRAINT "template_fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_requirements"
    ADD CONSTRAINT "template_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_requirements"
    ADD CONSTRAINT "template_requirements_template_name_template_version_sectio_key" UNIQUE ("template_name", "template_version", "section_ref", "question_number");



ALTER TABLE ONLY "public"."templates"
    ADD CONSTRAINT "templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."verification_history"
    ADD CONSTRAINT "verification_history_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_bid_questions_project" ON "public"."bid_questions" USING "btree" ("project_id");



CREATE INDEX "idx_bid_questions_status" ON "public"."bid_questions" USING "btree" ("status");



CREATE INDEX "idx_bid_response_history_edited_by" ON "public"."bid_response_history" USING "btree" ("edited_by");



CREATE INDEX "idx_bid_response_history_response" ON "public"."bid_response_history" USING "btree" ("response_id", "version" DESC);



CREATE INDEX "idx_bid_responses_overall_score" ON "public"."bid_responses" USING "btree" ("overall_score" DESC NULLS LAST) WHERE ("overall_score" IS NOT NULL);



CREATE INDEX "idx_bid_responses_question" ON "public"."bid_responses" USING "btree" ("question_id", "version" DESC);



CREATE INDEX "idx_content_citations_item" ON "public"."content_citations" USING "btree" ("content_item_id");



CREATE INDEX "idx_content_citations_response" ON "public"."content_citations" USING "btree" ("bid_response_id");



CREATE INDEX "idx_content_history_item" ON "public"."content_history" USING "btree" ("content_item_id", "version" DESC);



CREATE INDEX "idx_content_items_archived" ON "public"."content_items" USING "btree" ("archived_at");



CREATE INDEX "idx_content_items_content_owner_id" ON "public"."content_items" USING "btree" ("content_owner_id") WHERE ("content_owner_id" IS NOT NULL);



CREATE INDEX "idx_content_items_content_type" ON "public"."content_items" USING "btree" ("content_type");



CREATE INDEX "idx_content_items_created_at" ON "public"."content_items" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_content_items_embedding" ON "public"."content_items" USING "hnsw" ("embedding" "public"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



CREATE INDEX "idx_content_items_freshness" ON "public"."content_items" USING "btree" ("freshness");



CREATE INDEX "idx_content_items_governance" ON "public"."content_items" USING "btree" ("governance_review_status");



CREATE INDEX "idx_content_items_is_starred" ON "public"."content_items" USING "btree" ("starred") WHERE ("starred" = true);



CREATE INDEX "idx_content_items_layer" ON "public"."content_items" USING "btree" ("layer") WHERE ("layer" IS NOT NULL);



CREATE INDEX "idx_content_items_lifecycle_type" ON "public"."content_items" USING "btree" ("lifecycle_type");



CREATE INDEX "idx_content_items_metadata" ON "public"."content_items" USING "gin" ("metadata");



CREATE INDEX "idx_content_items_metadata_gin" ON "public"."content_items" USING "gin" ("metadata" "jsonb_path_ops");



CREATE INDEX "idx_content_items_owner_freshness" ON "public"."content_items" USING "btree" ("content_owner_id", "freshness") WHERE (("content_owner_id" IS NOT NULL) AND (("freshness")::"text" = ANY ((ARRAY['stale'::character varying, 'expired'::character varying])::"text"[])));



CREATE INDEX "idx_content_items_primary_domain" ON "public"."content_items" USING "btree" ("primary_domain");



CREATE INDEX "idx_content_items_primary_subtopic" ON "public"."content_items" USING "btree" ("primary_subtopic");



CREATE INDEX "idx_content_items_qa_type" ON "public"."content_items" USING "btree" ("content_type") WHERE (("content_type")::"text" = 'q_a_pair'::"text");



CREATE INDEX "idx_content_items_quality_score" ON "public"."content_items" USING "btree" ("quality_score") WHERE ("archived_at" IS NULL);



CREATE INDEX "idx_content_items_source_bid" ON "public"."content_items" USING "btree" ("source_bid");



CREATE INDEX "idx_content_items_source_document_id" ON "public"."content_items" USING "btree" ("source_document_id") WHERE ("source_document_id" IS NOT NULL);



CREATE INDEX "idx_content_items_source_file" ON "public"."content_items" USING "btree" ("source_file") WHERE ("source_file" IS NOT NULL);



CREATE INDEX "idx_content_items_starred" ON "public"."content_items" USING "btree" ("id") WHERE ("starred" = true);



CREATE INDEX "idx_content_items_topic_id" ON "public"."content_items" USING "btree" ((("metadata" ->> 'topic_id'::"text"))) WHERE (("metadata" ->> 'topic_id'::"text") IS NOT NULL);



CREATE INDEX "idx_content_items_unverified" ON "public"."content_items" USING "btree" ("created_at" DESC) WHERE ("verified_at" IS NULL);



CREATE INDEX "idx_entity_mentions_canonical" ON "public"."entity_mentions" USING "btree" ("canonical_name", "entity_type");



CREATE INDEX "idx_entity_mentions_canonical_lower" ON "public"."entity_mentions" USING "btree" ("lower"("canonical_name"));



CREATE INDEX "idx_entity_mentions_content" ON "public"."entity_mentions" USING "btree" ("content_item_id");



CREATE INDEX "idx_entity_mentions_metadata_expiry" ON "public"."entity_mentions" USING "btree" ((("metadata" ->> 'expiry_date'::"text"))) WHERE (("metadata" ->> 'expiry_date'::"text") IS NOT NULL);



CREATE INDEX "idx_entity_mentions_type" ON "public"."entity_mentions" USING "btree" ("entity_type");



CREATE INDEX "idx_entity_relationships_content" ON "public"."entity_relationships" USING "btree" ("source_item_id");



CREATE INDEX "idx_entity_relationships_source" ON "public"."entity_relationships" USING "btree" ("source_entity");



CREATE INDEX "idx_entity_relationships_target" ON "public"."entity_relationships" USING "btree" ("target_entity");



CREATE INDEX "idx_entity_relationships_type" ON "public"."entity_relationships" USING "btree" ("relationship_type");



CREATE INDEX "idx_governance_config_created_by" ON "public"."governance_config" USING "btree" ("created_by");



CREATE INDEX "idx_governance_config_reviewer_id" ON "public"."governance_config" USING "btree" ("reviewer_id");



CREATE INDEX "idx_governance_config_updated_by" ON "public"."governance_config" USING "btree" ("updated_by");



CREATE INDEX "idx_guide_sections_guide_id" ON "public"."guide_sections" USING "btree" ("guide_id");



CREATE INDEX "idx_guide_sections_order" ON "public"."guide_sections" USING "btree" ("guide_id", "display_order");



CREATE INDEX "idx_guides_slug" ON "public"."guides" USING "btree" ("slug");



CREATE INDEX "idx_guides_type" ON "public"."guides" USING "btree" ("guide_type");



CREATE INDEX "idx_layer_vocabulary_active_order" ON "public"."layer_vocabulary" USING "btree" ("display_order") WHERE ("is_active" = true);



CREATE INDEX "idx_notifications_entity" ON "public"."notifications" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC) WHERE (("read_at" IS NULL) AND ("dismissed_at" IS NULL));



CREATE INDEX "idx_pipeline_runs_created_by_created_at" ON "public"."pipeline_runs" USING "btree" ("created_by", "created_at" DESC);



CREATE INDEX "idx_pipeline_runs_workspace_id" ON "public"."pipeline_runs" USING "btree" ("workspace_id") WHERE ("workspace_id" IS NOT NULL);



CREATE INDEX "idx_processing_queue_status" ON "public"."processing_queue" USING "btree" ("status", "priority" DESC, "created_at");



CREATE INDEX "idx_processing_queue_task_type" ON "public"."processing_queue" USING "btree" ("task_type");



CREATE INDEX "idx_quality_log_content_item" ON "public"."ingestion_quality_log" USING "btree" ("content_item_id");



CREATE INDEX "idx_read_marks_user" ON "public"."read_marks" USING "btree" ("user_id");



CREATE INDEX "idx_review_assignments_reviewer" ON "public"."review_assignments" USING "btree" ("reviewer_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_review_assignments_status" ON "public"."review_assignments" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_source_document_diffs_affected_item" ON "public"."source_document_diffs" USING "btree" ("affected_content_item_id") WHERE ("affected_content_item_id" IS NOT NULL);



CREATE INDEX "idx_source_document_diffs_new_doc" ON "public"."source_document_diffs" USING "btree" ("new_document_id");



CREATE INDEX "idx_source_document_diffs_old_doc" ON "public"."source_document_diffs" USING "btree" ("old_document_id");



CREATE INDEX "idx_source_document_diffs_reviewed_by" ON "public"."source_document_diffs" USING "btree" ("reviewed_by") WHERE ("reviewed_by" IS NOT NULL);



CREATE INDEX "idx_source_document_diffs_status" ON "public"."source_document_diffs" USING "btree" ("status") WHERE ("status" = 'pending_review'::"text");



CREATE INDEX "idx_source_documents_content_hash" ON "public"."source_documents" USING "btree" ("content_hash");



CREATE INDEX "idx_source_documents_filename_uploaded_by" ON "public"."source_documents" USING "btree" ("filename", "uploaded_by");



CREATE INDEX "idx_source_documents_parent_id" ON "public"."source_documents" USING "btree" ("parent_id") WHERE ("parent_id" IS NOT NULL);



CREATE INDEX "idx_taxonomy_subtopics_domain" ON "public"."taxonomy_subtopics" USING "btree" ("domain_id");



CREATE INDEX "idx_template_completions_created_by" ON "public"."template_completions" USING "btree" ("created_by");



CREATE INDEX "idx_template_completions_job_id" ON "public"."template_completions" USING "btree" ("job_id");



CREATE INDEX "idx_template_completions_template" ON "public"."template_completions" USING "btree" ("template_id");



CREATE INDEX "idx_template_fields_mapping" ON "public"."template_fields" USING "btree" ("template_id", "mapping_status");



CREATE INDEX "idx_template_fields_question" ON "public"."template_fields" USING "btree" ("question_id");



CREATE INDEX "idx_template_fields_template" ON "public"."template_fields" USING "btree" ("template_id");



CREATE INDEX "idx_template_reqs_current" ON "public"."template_requirements" USING "btree" ("template_name", "is_current") WHERE ("is_current" = true);



CREATE INDEX "idx_template_reqs_domain" ON "public"."template_requirements" USING "btree" ("primary_domain", "primary_subtopic");



CREATE INDEX "idx_template_reqs_sector" ON "public"."template_requirements" USING "gin" ("sector_applicability");



CREATE INDEX "idx_template_reqs_template" ON "public"."template_requirements" USING "btree" ("template_name", "template_version");



CREATE INDEX "idx_templates_created_by" ON "public"."templates" USING "btree" ("created_by");



CREATE INDEX "idx_templates_project" ON "public"."templates" USING "btree" ("project_id");



CREATE INDEX "idx_templates_status" ON "public"."templates" USING "btree" ("status");



CREATE INDEX "idx_verification_history_item" ON "public"."verification_history" USING "btree" ("content_item_id", "performed_at" DESC);



CREATE INDEX "idx_verification_history_user" ON "public"."verification_history" USING "btree" ("performed_by", "performed_at" DESC);



CREATE INDEX "idx_workspaces_type" ON "public"."workspaces" USING "btree" ("type");



CREATE INDEX "idx_workspaces_type_archived" ON "public"."workspaces" USING "btree" ("type", "is_archived");



CREATE INDEX "idx_workspaces_type_status" ON "public"."workspaces" USING "btree" ("type", "status") WHERE ("type" = 'bid'::"text");



CREATE OR REPLACE TRIGGER "bid_response_history_snapshot" BEFORE UPDATE ON "public"."bid_responses" FOR EACH ROW EXECUTE FUNCTION "public"."snapshot_bid_response_history"();



CREATE OR REPLACE TRIGGER "bid_response_set_version" BEFORE INSERT OR UPDATE ON "public"."bid_responses" FOR EACH ROW EXECUTE FUNCTION "public"."bid_response_auto_version"();



CREATE OR REPLACE TRIGGER "set_bid_questions_updated_at" BEFORE UPDATE ON "public"."bid_questions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_bid_responses_updated_at" BEFORE UPDATE ON "public"."bid_responses" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_content_history_version" BEFORE INSERT ON "public"."content_history" FOR EACH ROW EXECUTE FUNCTION "public"."auto_version_content_history"();



CREATE OR REPLACE TRIGGER "set_content_items_updated_at" BEFORE UPDATE ON "public"."content_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_governance_config_updated_at" BEFORE UPDATE ON "public"."governance_config" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_projects_updated_at" BEFORE UPDATE ON "public"."workspaces" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_review_assignments_updated_at" BEFORE UPDATE ON "public"."review_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_template_fields_updated_at" BEFORE UPDATE ON "public"."template_fields" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_template_requirements_updated_at" BEFORE UPDATE ON "public"."template_requirements" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_templates_updated_at" BEFORE UPDATE ON "public"."templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_user_roles_updated_at" BEFORE UPDATE ON "public"."user_roles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "sync_bid_status" BEFORE INSERT OR UPDATE ON "public"."workspaces" FOR EACH ROW EXECUTE FUNCTION "public"."sync_bid_status_to_jsonb"();



CREATE OR REPLACE TRIGGER "trg_citation_count_delete" AFTER DELETE ON "public"."content_citations" FOR EACH ROW EXECUTE FUNCTION "public"."update_citation_count"();



CREATE OR REPLACE TRIGGER "trg_citation_count_insert" AFTER INSERT ON "public"."content_citations" FOR EACH ROW EXECUTE FUNCTION "public"."update_citation_count"();



CREATE OR REPLACE TRIGGER "trg_validate_layer_key" BEFORE INSERT OR UPDATE OF "layer" ON "public"."content_items" FOR EACH ROW EXECUTE FUNCTION "public"."validate_layer_key"();



ALTER TABLE ONLY "public"."bid_questions"
    ADD CONSTRAINT "bid_questions_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bid_questions"
    ADD CONSTRAINT "bid_questions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bid_questions"
    ADD CONSTRAINT "bid_questions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bid_questions"
    ADD CONSTRAINT "bid_questions_template_requirement_id_fkey" FOREIGN KEY ("template_requirement_id") REFERENCES "public"."template_requirements"("id");



ALTER TABLE ONLY "public"."bid_response_history"
    ADD CONSTRAINT "bid_response_history_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bid_response_history"
    ADD CONSTRAINT "bid_response_history_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."bid_responses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bid_responses"
    ADD CONSTRAINT "bid_responses_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bid_responses"
    ADD CONSTRAINT "bid_responses_drafted_by_fkey" FOREIGN KEY ("drafted_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bid_responses"
    ADD CONSTRAINT "bid_responses_last_edited_by_fkey" FOREIGN KEY ("last_edited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bid_responses"
    ADD CONSTRAINT "bid_responses_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."bid_questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_citations"
    ADD CONSTRAINT "content_citations_bid_response_id_fkey" FOREIGN KEY ("bid_response_id") REFERENCES "public"."bid_responses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_citations"
    ADD CONSTRAINT "content_citations_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_history"
    ADD CONSTRAINT "content_history_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content_history"
    ADD CONSTRAINT "content_history_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."content_item_workspaces"
    ADD CONSTRAINT "content_item_projects_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_item_workspaces"
    ADD CONSTRAINT "content_item_projects_project_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_item_workspaces"
    ADD CONSTRAINT "content_item_workspaces_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_source_bid_fkey" FOREIGN KEY ("source_bid") REFERENCES "public"."workspaces"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."coverage_targets"
    ADD CONSTRAINT "coverage_targets_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."taxonomy_domains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."entity_mentions"
    ADD CONSTRAINT "entity_mentions_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."entity_relationships"
    ADD CONSTRAINT "entity_relationships_source_item_id_fkey" FOREIGN KEY ("source_item_id") REFERENCES "public"."content_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."governance_config"
    ADD CONSTRAINT "governance_config_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."governance_config"
    ADD CONSTRAINT "governance_config_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."governance_config"
    ADD CONSTRAINT "governance_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."guide_sections"
    ADD CONSTRAINT "guide_sections_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "public"."guides"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."guides"
    ADD CONSTRAINT "guides_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."ingestion_quality_log"
    ADD CONSTRAINT "ingestion_quality_log_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."pipeline_runs"
    ADD CONSTRAINT "pipeline_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."pipeline_runs"
    ADD CONSTRAINT "pipeline_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."read_marks"
    ADD CONSTRAINT "read_marks_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."read_marks"
    ADD CONSTRAINT "read_marks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."review_assignments"
    ADD CONSTRAINT "review_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."review_assignments"
    ADD CONSTRAINT "review_assignments_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."source_document_diffs"
    ADD CONSTRAINT "source_document_diffs_affected_content_item_id_fkey" FOREIGN KEY ("affected_content_item_id") REFERENCES "public"."content_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_document_diffs"
    ADD CONSTRAINT "source_document_diffs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_document_diffs"
    ADD CONSTRAINT "source_document_diffs_new_document_id_fkey" FOREIGN KEY ("new_document_id") REFERENCES "public"."source_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."source_document_diffs"
    ADD CONSTRAINT "source_document_diffs_old_document_id_fkey" FOREIGN KEY ("old_document_id") REFERENCES "public"."source_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."source_document_diffs"
    ADD CONSTRAINT "source_document_diffs_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_documents"
    ADD CONSTRAINT "source_documents_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."source_documents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_documents"
    ADD CONSTRAINT "source_documents_pipeline_run_id_fkey" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_documents"
    ADD CONSTRAINT "source_documents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."taxonomy_subtopics"
    ADD CONSTRAINT "taxonomy_subtopics_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."taxonomy_domains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."template_completions"
    ADD CONSTRAINT "template_completions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."template_completions"
    ADD CONSTRAINT "template_completions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."processing_queue"("id");



ALTER TABLE ONLY "public"."template_completions"
    ADD CONSTRAINT "template_completions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."template_fields"
    ADD CONSTRAINT "template_fields_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."bid_questions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."template_fields"
    ADD CONSTRAINT "template_fields_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."templates"
    ADD CONSTRAINT "templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."templates"
    ADD CONSTRAINT "templates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."verification_history"
    ADD CONSTRAINT "verification_history_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;



CREATE POLICY "Admin: DELETE layer_vocabulary" ON "public"."layer_vocabulary" FOR DELETE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "Admin: INSERT layer_vocabulary" ON "public"."layer_vocabulary" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "Admin: UPDATE layer_vocabulary" ON "public"."layer_vocabulary" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text")) WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "Admins can delete citations" ON "public"."content_citations" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admins can delete entity mentions" ON "public"."entity_mentions" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admins can delete entity relationships" ON "public"."entity_relationships" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admins can delete guides" ON "public"."guides" FOR DELETE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "Admins can delete source documents" ON "public"."source_documents" FOR DELETE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "All authenticated: SELECT layer_vocabulary" ON "public"."layer_vocabulary" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read guide sections" ON "public"."guide_sections" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."guides" "g"
  WHERE (("g"."id" = "guide_sections"."guide_id") AND (("g"."is_published" = true) OR (( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"))))));



CREATE POLICY "Authenticated users can read guides" ON "public"."guides" FOR SELECT TO "authenticated" USING ((("is_published" = true) OR (( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text")));



CREATE POLICY "Authenticated users can view bid response history" ON "public"."bid_response_history" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view citations" ON "public"."content_citations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view diffs" ON "public"."source_document_diffs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view entity mentions" ON "public"."entity_mentions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view entity relationships" ON "public"."entity_relationships" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view source documents" ON "public"."source_documents" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Editors and admins can create source documents" ON "public"."source_documents" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['editor'::"text", 'admin'::"text"])));



CREATE POLICY "Editors and admins can delete guide sections" ON "public"."guide_sections" FOR DELETE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can insert entity mentions" ON "public"."entity_mentions" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can insert entity relationships" ON "public"."entity_relationships" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can insert guide sections" ON "public"."guide_sections" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can insert guides" ON "public"."guides" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can manage citations" ON "public"."content_citations" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can update citations" ON "public"."content_citations" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can update entity mentions" ON "public"."entity_mentions" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can update entity relationships" ON "public"."entity_relationships" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can update guide sections" ON "public"."guide_sections" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can update guides" ON "public"."guides" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can update source documents" ON "public"."source_documents" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['editor'::"text", 'admin'::"text"])));



CREATE POLICY "Editors can delete diffs" ON "public"."source_document_diffs" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['editor'::"text", 'admin'::"text"]))))));



CREATE POLICY "Editors can insert diffs" ON "public"."source_document_diffs" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['editor'::"text", 'admin'::"text"]))))));



CREATE POLICY "Editors can update diffs" ON "public"."source_document_diffs" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['editor'::"text", 'admin'::"text"]))))));



ALTER TABLE "public"."bid_questions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bid_questions_delete" ON "public"."bid_questions" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "bid_questions_insert" ON "public"."bid_questions" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "bid_questions_select" ON "public"."bid_questions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "bid_questions_update" ON "public"."bid_questions" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."bid_response_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bid_responses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bid_responses_delete" ON "public"."bid_responses" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "bid_responses_insert" ON "public"."bid_responses" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "bid_responses_select" ON "public"."bid_responses" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "bid_responses_update" ON "public"."bid_responses" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "ciw_delete" ON "public"."content_item_workspaces" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "ciw_insert" ON "public"."content_item_workspaces" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "ciw_select" ON "public"."content_item_workspaces" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "ciw_update" ON "public"."content_item_workspaces" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"]))) WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."content_citations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_history_insert" ON "public"."content_history" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "content_history_select" ON "public"."content_history" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."content_item_workspaces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_items_delete" ON "public"."content_items" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "content_items_insert" ON "public"."content_items" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "content_items_select" ON "public"."content_items" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "content_items_update" ON "public"."content_items" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."content_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_templates_admin_delete" ON "public"."content_templates" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "content_templates_admin_manage" ON "public"."content_templates" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "content_templates_admin_update" ON "public"."content_templates" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "content_templates_select" ON "public"."content_templates" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."coverage_targets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coverage_targets_admin_delete" ON "public"."coverage_targets" FOR DELETE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "coverage_targets_admin_insert" ON "public"."coverage_targets" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "coverage_targets_admin_update" ON "public"."coverage_targets" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text")) WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "coverage_targets_select" ON "public"."coverage_targets" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."digests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "digests_delete" ON "public"."digests" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "digests_insert" ON "public"."digests" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "digests_select" ON "public"."digests" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."entity_mentions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."entity_relationships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."governance_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "governance_config_delete" ON "public"."governance_config" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "governance_config_insert" ON "public"."governance_config" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "governance_config_select" ON "public"."governance_config" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "governance_config_update" ON "public"."governance_config" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."guide_sections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."guides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ingestion_quality_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."layer_vocabulary" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_delete" ON "public"."notifications" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "notifications_insert" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "notifications_select" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "notifications_update" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."pipeline_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pipeline_runs_insert" ON "public"."pipeline_runs" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "pipeline_runs_select" ON "public"."pipeline_runs" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."processing_queue" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "processing_queue_insert" ON "public"."processing_queue" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "processing_queue_select" ON "public"."processing_queue" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "processing_queue_update" ON "public"."processing_queue" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "quality_log_insert" ON "public"."ingestion_quality_log" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "quality_log_select" ON "public"."ingestion_quality_log" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "quality_log_update" ON "public"."ingestion_quality_log" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."read_marks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read_marks_delete" ON "public"."read_marks" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "read_marks_insert" ON "public"."read_marks" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "read_marks_select" ON "public"."read_marks" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."review_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "review_assignments_delete" ON "public"."review_assignments" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "review_assignments_insert" ON "public"."review_assignments" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "review_assignments_select" ON "public"."review_assignments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "review_assignments_update" ON "public"."review_assignments" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."source_document_diffs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."source_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."taxonomy_domains" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "taxonomy_domains_insert" ON "public"."taxonomy_domains" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "taxonomy_domains_select" ON "public"."taxonomy_domains" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "taxonomy_domains_update" ON "public"."taxonomy_domains" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."taxonomy_subtopics" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "taxonomy_subtopics_insert" ON "public"."taxonomy_subtopics" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "taxonomy_subtopics_select" ON "public"."taxonomy_subtopics" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "taxonomy_subtopics_update" ON "public"."taxonomy_subtopics" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."template_completions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "template_completions_insert" ON "public"."template_completions" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "template_completions_select" ON "public"."template_completions" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."template_fields" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "template_fields_delete" ON "public"."template_fields" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "template_fields_insert" ON "public"."template_fields" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "template_fields_select" ON "public"."template_fields" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "template_fields_update" ON "public"."template_fields" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."template_requirements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "template_requirements_delete" ON "public"."template_requirements" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "template_requirements_insert" ON "public"."template_requirements" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "template_requirements_select" ON "public"."template_requirements" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "template_requirements_update" ON "public"."template_requirements" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "templates_delete" ON "public"."templates" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "templates_insert" ON "public"."templates" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "templates_select" ON "public"."templates" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "templates_update" ON "public"."templates" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_roles_delete" ON "public"."user_roles" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "user_roles_insert" ON "public"."user_roles" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "user_roles_select_own" ON "public"."user_roles" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR ("public"."get_user_role"() = 'admin'::"text")));



CREATE POLICY "user_roles_update" ON "public"."user_roles" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."verification_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "verification_history_insert" ON "public"."verification_history" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "verification_history_select" ON "public"."verification_history" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."workspaces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspaces_delete" ON "public"."workspaces" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "workspaces_insert" ON "public"."workspaces" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "workspaces_select" ON "public"."workspaces" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "workspaces_update" ON "public"."workspaces" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"]))) WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


SET SESSION AUTHORIZATION "postgres";
RESET SESSION AUTHORIZATION;






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "service_role";




















































































































































































GRANT ALL ON FUNCTION "public"."auto_version_content_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_version_content_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_version_content_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bid_response_auto_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."bid_response_auto_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bid_response_auto_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_assign_content_owner"("p_item_ids" "uuid"[], "p_owner_id" "uuid", "p_assigned_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."bulk_assign_content_owner"("p_item_ids" "uuid"[], "p_owner_id" "uuid", "p_assigned_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_assign_content_owner"("p_item_ids" "uuid"[], "p_owner_id" "uuid", "p_assigned_by" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_delete_tags"("p_tags" "text"[], "p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bulk_delete_tags"("p_tags" "text"[], "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_delete_tags"("p_tags" "text"[], "p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_merge_tags"("p_sources" "text"[], "p_target" "text", "p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bulk_merge_tags"("p_sources" "text"[], "p_target" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_merge_tags"("p_sources" "text"[], "p_target" "text", "p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_content_exists"("ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."check_content_exists"("ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_content_exists"("ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_duplicate_entity_mentions"("p_canonical_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_duplicate_entity_mentions"("p_canonical_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_duplicate_entity_mentions"("p_canonical_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_tag"("p_tag" "text", "p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_tag"("p_tag" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_tag"("p_tag" "text", "p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."detect_reupload"("p_filename" "text", "p_uploaded_by" "uuid", "p_content_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."detect_reupload"("p_filename" "text", "p_uploaded_by" "uuid", "p_content_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."detect_reupload"("p_filename" "text", "p_uploaded_by" "uuid", "p_content_hash" "text") TO "service_role";



GRANT ALL ON TABLE "public"."content_items" TO "anon";
GRANT ALL ON TABLE "public"."content_items" TO "authenticated";
GRANT ALL ON TABLE "public"."content_items" TO "service_role";



GRANT ALL ON FUNCTION "public"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."find_duplicate_pairs"("similarity_threshold" numeric, "p_domain" "text", "limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."find_duplicate_pairs"("similarity_threshold" numeric, "p_domain" "text", "limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_duplicate_pairs"("similarity_threshold" numeric, "p_domain" "text", "limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."find_duplicate_tags"("p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."find_duplicate_tags"("p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_duplicate_tags"("p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."find_similar_content"("query_embedding" "public"."vector", "similarity_threshold" double precision, "limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."find_similar_content"("query_embedding" "public"."vector", "similarity_threshold" double precision, "limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_similar_content"("query_embedding" "public"."vector", "similarity_threshold" double precision, "limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_tag_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_tag_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_tag_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_audit_content_items"("p_domain" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_audit_content_items"("p_domain" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_audit_content_items"("p_domain" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_author_analysis"("limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_author_analysis"("limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_author_analysis"("limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_bid_question_stats_batch"("p_project_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_bid_question_stats_batch"("p_project_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bid_question_stats_batch"("p_project_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_bid_summary"("bid_workspace_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_bid_summary"("bid_workspace_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bid_summary"("bid_workspace_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_capture_activity"("days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_capture_activity"("days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_capture_activity"("days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_content_gaps"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_content_gaps"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_content_gaps"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_content_owner_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_content_owner_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_content_owner_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_coverage_matrix"("p_layer" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_coverage_matrix"("p_layer" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_coverage_matrix"("p_layer" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_coverage_summary"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_coverage_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_coverage_summary"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_document_version_chain"("p_document_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_document_version_chain"("p_document_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_document_version_chain"("p_document_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_domain_subtopic_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_domain_subtopic_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_domain_subtopic_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_entity_name_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_entity_name_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_entity_name_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_entity_summary"("p_entity_name" "text", "p_entity_type" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_entity_summary"("p_entity_name" "text", "p_entity_type" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_entity_summary"("p_entity_name" "text", "p_entity_type" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_filter_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_filter_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_filter_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_freshness_breakdown"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_freshness_breakdown"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_freshness_breakdown"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_grouped_activity_feed"("p_limit" integer, "p_is_admin" boolean, "p_before" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_grouped_activity_feed"("p_limit" integer, "p_is_admin" boolean, "p_before" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_grouped_activity_feed"("p_limit" integer, "p_is_admin" boolean, "p_before" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_guide_content"("p_guide_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_guide_content"("p_guide_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_guide_content"("p_guide_slug" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_guide_coverage"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_guide_coverage"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_guide_coverage"() TO "service_role";



GRANT ALL ON TABLE "public"."workspaces" TO "anon";
GRANT ALL ON TABLE "public"."workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."workspaces" TO "service_role";



GRANT ALL ON FUNCTION "public"."get_item_workspaces"("p_item_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_item_workspaces"("p_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_item_workspaces"("p_item_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_items_with_quality_flags"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_items_with_quality_flags"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_items_with_quality_flags"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_popular_keywords"("limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_popular_keywords"("limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_popular_keywords"("limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_quality_issue_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_quality_issue_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_quality_issue_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_reading_patterns"("days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_reading_patterns"("days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_reading_patterns"("days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tag_counts_filtered"("p_type" "text", "p_min_count" integer, "p_search" "text", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_tag_counts_filtered"("p_type" "text", "p_min_count" integer, "p_search" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tag_counts_filtered"("p_type" "text", "p_min_count" integer, "p_search" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tags_by_domain"("p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_tags_by_domain"("p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tags_by_domain"("p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_template_summary"("p_template_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_template_summary"("p_template_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_template_summary"("p_template_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_top_authors"("limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_top_authors"("limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_top_authors"("limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_topic_deep_dive"("topic_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_topic_deep_dive"("topic_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_topic_deep_dive"("topic_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_topic_layers"("p_topic_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_topic_layers"("p_topic_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_topic_layers"("p_topic_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_trend_analysis"("days_back" integer, "bucket_size" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_trend_analysis"("days_back" integer, "bucket_size" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_trend_analysis"("days_back" integer, "bucket_size" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unique_authors"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_unique_authors"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unique_authors"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_tag_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_tag_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_tag_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_workspace_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_workspace_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_workspace_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_workspace_item_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_workspace_item_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_workspace_item_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hybrid_search"("query_embedding" "public"."vector", "query_text" "text", "similarity_threshold" double precision, "limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."hybrid_search"("query_embedding" "public"."vector", "query_text" "text", "similarity_threshold" double precision, "limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hybrid_search"("query_embedding" "public"."vector", "query_text" "text", "similarity_threshold" double precision, "limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."hybrid_search"("query_text" "text", "query_embedding" "public"."vector", "match_count" integer, "full_text_weight" double precision, "semantic_weight" double precision, "rrf_k" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."hybrid_search"("query_text" "text", "query_embedding" "public"."vector", "match_count" integer, "full_text_weight" double precision, "semantic_weight" double precision, "rrf_k" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hybrid_search"("query_text" "text", "query_embedding" "public"."vector", "match_count" integer, "full_text_weight" double precision, "semantic_weight" double precision, "rrf_k" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."merge_item_metadata"("item_id" "uuid", "new_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."merge_item_metadata"("item_id" "uuid", "new_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_item_metadata"("item_id" "uuid", "new_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."merge_tags"("p_source" "text", "p_target" "text", "p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."merge_tags"("p_source" "text", "p_target" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_tags"("p_source" "text", "p_target" "text", "p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."recalculate_all_freshness"() TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_all_freshness"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_all_freshness"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rename_tag"("p_old" "text", "p_new" "text", "p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rename_tag"("p_old" "text", "p_new" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rename_tag"("p_old" "text", "p_new" "text", "p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."run_quality_scan"("p_batch_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."run_quality_scan"("p_batch_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_quality_scan"("p_batch_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."search_content"("query_embedding" "public"."vector", "similarity_threshold" double precision, "limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_content"("query_embedding" "public"."vector", "similarity_threshold" double precision, "limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_content"("query_embedding" "public"."vector", "similarity_threshold" double precision, "limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_for_bid_response"("query_embedding" "public"."vector", "query_text" "text", "limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_for_bid_response"("query_embedding" "public"."vector", "query_text" "text", "limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_for_bid_response"("query_embedding" "public"."vector", "query_text" "text", "limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_for_bid_response"("question_id" "uuid", "query_embedding" "public"."vector", "match_count" integer, "domain_filter" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."search_for_bid_response"("question_id" "uuid", "query_embedding" "public"."vector", "match_count" integer, "domain_filter" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_for_bid_response"("question_id" "uuid", "query_embedding" "public"."vector", "match_count" integer, "domain_filter" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_config"("setting" "text", "value" "text", "is_local" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."set_config"("setting" "text", "value" "text", "is_local" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_config"("setting" "text", "value" "text", "is_local" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."snapshot_bid_response_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."snapshot_bid_response_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."snapshot_bid_response_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."suggest_tags"("p_prefix" "text", "p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."suggest_tags"("p_prefix" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."suggest_tags"("p_prefix" "text", "p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_bid_status_to_jsonb"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_bid_status_to_jsonb"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_bid_status_to_jsonb"() TO "service_role";



GRANT ALL ON FUNCTION "public"."toggle_star"("item_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."toggle_star"("item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."toggle_star"("item_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."toggle_star"("p_item_id" "uuid", "p_starred" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."toggle_star"("p_item_id" "uuid", "p_starred" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."toggle_star"("p_item_id" "uuid", "p_starred" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_citation_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_citation_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_citation_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_layer_key"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_layer_key"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_layer_key"() TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";












GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "service_role";















GRANT ALL ON TABLE "public"."bid_questions" TO "anon";
GRANT ALL ON TABLE "public"."bid_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."bid_questions" TO "service_role";



GRANT ALL ON TABLE "public"."bid_response_history" TO "anon";
GRANT ALL ON TABLE "public"."bid_response_history" TO "authenticated";
GRANT ALL ON TABLE "public"."bid_response_history" TO "service_role";



GRANT ALL ON TABLE "public"."bid_responses" TO "anon";
GRANT ALL ON TABLE "public"."bid_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."bid_responses" TO "service_role";



GRANT ALL ON TABLE "public"."content_citations" TO "anon";
GRANT ALL ON TABLE "public"."content_citations" TO "authenticated";
GRANT ALL ON TABLE "public"."content_citations" TO "service_role";



GRANT ALL ON TABLE "public"."content_history" TO "anon";
GRANT ALL ON TABLE "public"."content_history" TO "authenticated";
GRANT ALL ON TABLE "public"."content_history" TO "service_role";



GRANT ALL ON TABLE "public"."content_item_workspaces" TO "anon";
GRANT ALL ON TABLE "public"."content_item_workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."content_item_workspaces" TO "service_role";



GRANT ALL ON TABLE "public"."content_templates" TO "anon";
GRANT ALL ON TABLE "public"."content_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."content_templates" TO "service_role";



GRANT ALL ON TABLE "public"."coverage_targets" TO "anon";
GRANT ALL ON TABLE "public"."coverage_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."coverage_targets" TO "service_role";



GRANT ALL ON TABLE "public"."digests" TO "anon";
GRANT ALL ON TABLE "public"."digests" TO "authenticated";
GRANT ALL ON TABLE "public"."digests" TO "service_role";



GRANT ALL ON TABLE "public"."entity_mentions" TO "anon";
GRANT ALL ON TABLE "public"."entity_mentions" TO "authenticated";
GRANT ALL ON TABLE "public"."entity_mentions" TO "service_role";



GRANT ALL ON TABLE "public"."entity_relationships" TO "anon";
GRANT ALL ON TABLE "public"."entity_relationships" TO "authenticated";
GRANT ALL ON TABLE "public"."entity_relationships" TO "service_role";



GRANT ALL ON TABLE "public"."governance_config" TO "anon";
GRANT ALL ON TABLE "public"."governance_config" TO "authenticated";
GRANT ALL ON TABLE "public"."governance_config" TO "service_role";



GRANT ALL ON TABLE "public"."guide_sections" TO "anon";
GRANT ALL ON TABLE "public"."guide_sections" TO "authenticated";
GRANT ALL ON TABLE "public"."guide_sections" TO "service_role";



GRANT ALL ON TABLE "public"."guides" TO "anon";
GRANT ALL ON TABLE "public"."guides" TO "authenticated";
GRANT ALL ON TABLE "public"."guides" TO "service_role";



GRANT ALL ON TABLE "public"."ingestion_quality_log" TO "anon";
GRANT ALL ON TABLE "public"."ingestion_quality_log" TO "authenticated";
GRANT ALL ON TABLE "public"."ingestion_quality_log" TO "service_role";



GRANT ALL ON TABLE "public"."layer_vocabulary" TO "anon";
GRANT ALL ON TABLE "public"."layer_vocabulary" TO "authenticated";
GRANT ALL ON TABLE "public"."layer_vocabulary" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_runs" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_runs" TO "service_role";



GRANT ALL ON TABLE "public"."processing_queue" TO "anon";
GRANT ALL ON TABLE "public"."processing_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."processing_queue" TO "service_role";



GRANT ALL ON TABLE "public"."quality_issues_pending" TO "anon";
GRANT ALL ON TABLE "public"."quality_issues_pending" TO "authenticated";
GRANT ALL ON TABLE "public"."quality_issues_pending" TO "service_role";



GRANT ALL ON TABLE "public"."read_marks" TO "anon";
GRANT ALL ON TABLE "public"."read_marks" TO "authenticated";
GRANT ALL ON TABLE "public"."read_marks" TO "service_role";



GRANT ALL ON TABLE "public"."review_assignments" TO "anon";
GRANT ALL ON TABLE "public"."review_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."review_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."source_document_diffs" TO "anon";
GRANT ALL ON TABLE "public"."source_document_diffs" TO "authenticated";
GRANT ALL ON TABLE "public"."source_document_diffs" TO "service_role";



GRANT ALL ON TABLE "public"."source_documents" TO "anon";
GRANT ALL ON TABLE "public"."source_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."source_documents" TO "service_role";



GRANT ALL ON TABLE "public"."taxonomy_domains" TO "anon";
GRANT ALL ON TABLE "public"."taxonomy_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."taxonomy_domains" TO "service_role";



GRANT ALL ON TABLE "public"."taxonomy_subtopics" TO "anon";
GRANT ALL ON TABLE "public"."taxonomy_subtopics" TO "authenticated";
GRANT ALL ON TABLE "public"."taxonomy_subtopics" TO "service_role";



GRANT ALL ON TABLE "public"."template_completions" TO "anon";
GRANT ALL ON TABLE "public"."template_completions" TO "authenticated";
GRANT ALL ON TABLE "public"."template_completions" TO "service_role";



GRANT ALL ON TABLE "public"."template_fields" TO "anon";
GRANT ALL ON TABLE "public"."template_fields" TO "authenticated";
GRANT ALL ON TABLE "public"."template_fields" TO "service_role";



GRANT ALL ON TABLE "public"."template_requirements" TO "anon";
GRANT ALL ON TABLE "public"."template_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."template_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."templates" TO "anon";
GRANT ALL ON TABLE "public"."templates" TO "authenticated";
GRANT ALL ON TABLE "public"."templates" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."verification_history" TO "anon";
GRANT ALL ON TABLE "public"."verification_history" TO "authenticated";
GRANT ALL ON TABLE "public"."verification_history" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































--
-- Dumped schema changes for auth and storage
--

CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user_role"();



CREATE POLICY "Authenticated users can read templates" ON "storage"."objects" FOR SELECT TO "authenticated" USING (("bucket_id" = 'templates'::"text"));



CREATE POLICY "Authenticated users can upload templates" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (("bucket_id" = 'templates'::"text"));



CREATE POLICY "Editors and admins can delete templates" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'templates'::"text") AND (( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"]))));



CREATE POLICY "Editors and admins can update templates" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'templates'::"text") AND (( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"]))));




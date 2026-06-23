


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


CREATE SCHEMA IF NOT EXISTS "api";


ALTER SCHEMA "api" OWNER TO "postgres";


COMMENT ON SCHEMA "api" IS 'Exposed Data API schema (PostgREST schema isolation, ID-115). security_invoker views (1:1 over public base tables, explicit FK-verbatim column lists) + INVOKER RPC entrypoints / thin INVOKER wrappers over the public SECURITY DEFINER fns. public is UNEXPOSED — the PGRST106 boundary. Objects are generator-produced (scripts/generate-api-views.ts) into the sibling _api_views_and_rpcs migration.';



CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



-- pg_graphql intentionally omitted: not required (ID-115 api-only exposure). Prod has no
-- pg_graphql, so a fresh-apply must not create it, else prod/staging schema parity diverges.
-- Aligned during the Platform staging-branch standup (S407, 2026-06-23).






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE TYPE "public"."cited_target_kind" AS ENUM (
    'content_item',
    'q_a_pair'
);


ALTER TYPE "public"."cited_target_kind" OWNER TO "postgres";


CREATE TYPE "public"."citing_entity_kind" AS ENUM (
    'form_response'
);


ALTER TYPE "public"."citing_entity_kind" OWNER TO "postgres";


CREATE TYPE "public"."outcome_signal" AS ENUM (
    'win',
    'fail',
    'loop',
    'refusal'
);


ALTER TYPE "public"."outcome_signal" OWNER TO "postgres";


COMMENT ON TYPE "public"."outcome_signal" IS 'ID-104 T14 — ratified recordAiCall() outcome signal (win|fail|loop|refusal). Mirrors OutcomeSignal in lib/eval/contract.ts. Extensible via ALTER TYPE … ADD VALUE.';



CREATE OR REPLACE FUNCTION "api"."_test_delete_broken_auth_user"("probe_id" "uuid") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public._test_delete_broken_auth_user(probe_id => probe_id);
$$;


ALTER FUNCTION "api"."_test_delete_broken_auth_user"("probe_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."_test_insert_broken_auth_user"("probe_id" "uuid", "probe_email" "text") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public._test_insert_broken_auth_user(probe_id => probe_id, probe_email => probe_email);
$$;


ALTER FUNCTION "api"."_test_insert_broken_auth_user"("probe_id" "uuid", "probe_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."bulk_delete_tags"("p_tags" "text"[], "p_type" "text") RETURNS integer
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.bulk_delete_tags(p_tags => p_tags, p_type => p_type);
$$;


ALTER FUNCTION "api"."bulk_delete_tags"("p_tags" "text"[], "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."bulk_merge_tags"("p_sources" "text"[], "p_target" "text", "p_type" "text") RETURNS integer
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.bulk_merge_tags(p_sources => p_sources, p_target => p_target, p_type => p_type);
$$;


ALTER FUNCTION "api"."bulk_merge_tags"("p_sources" "text"[], "p_target" "text", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."check_content_exists"("ids" "uuid"[]) RETURNS TABLE("id" "uuid", "item_exists" boolean)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.check_content_exists(ids => ids);
$$;


ALTER FUNCTION "api"."check_content_exists"("ids" "uuid"[]) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."processing_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" integer DEFAULT 0 NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 3 NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "result" "jsonb",
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "idempotency_key" "text",
    CONSTRAINT "processing_queue_job_type_check" CHECK (("job_type" = ANY (ARRAY['embed'::"text", 'classify'::"text", 'extract_qa'::"text", 'summarise'::"text", 'validate'::"text", 'reprocess'::"text", 'template_fill'::"text", 'template_analyse'::"text", 'bid_draft_all'::"text", 'form_draft_all'::"text", 'batch_reclassify'::"text", 'markdown_batch'::"text"]))),
    CONSTRAINT "processing_queue_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text", 'dead_lettered'::"text"])))
);


ALTER TABLE "public"."processing_queue" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."claim_next_job"() RETURNS SETOF "public"."processing_queue"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.claim_next_job();
$$;


ALTER FUNCTION "api"."claim_next_job"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."cleanup_filtered_articles"() RETURNS integer
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.cleanup_filtered_articles();
$$;


ALTER FUNCTION "api"."cleanup_filtered_articles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."count_auth_users"() RETURNS bigint
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.count_auth_users();
$$;


ALTER FUNCTION "api"."count_auth_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."delete_tag"("p_tag" "text", "p_type" "text") RETURNS integer
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.delete_tag(p_tag => p_tag, p_type => p_type);
$$;


ALTER FUNCTION "api"."delete_tag"("p_tag" "text", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."filter_by_keywords"("search_terms" "text"[]) RETURNS SETOF "uuid"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.filter_by_keywords(search_terms => search_terms);
$$;


ALTER FUNCTION "api"."filter_by_keywords"("search_terms" "text"[]) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "content_type" character varying(50) NOT NULL,
    "platform" character varying(30),
    "source_url" "text",
    "author_name" character varying(255),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "embedding" "extensions"."vector"(1024),
    "starred" boolean DEFAULT false NOT NULL,
    "quality_score" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_by" "uuid",
    "brief" "text",
    "detail" "text",
    "reference" "text",
    "source_domain" character varying(100),
    "thumbnail_url" "text",
    "file_path" "text",
    "primary_domain" character varying(50) DEFAULT 'unclassified'::character varying NOT NULL,
    "primary_subtopic" character varying(50) DEFAULT 'unclassified'::character varying NOT NULL,
    "secondary_domain" character varying(50),
    "secondary_subtopic" character varying(50),
    "classification_confidence" numeric,
    "classified_at" timestamp with time zone,
    "classification_reasoning" "text",
    "suggested_title" "text",
    "summary" "text",
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
    "content_text_hash" "text" GENERATED ALWAYS AS ("md5"(TRIM(BOTH FROM "regexp_replace"("regexp_replace"("lower"(TRIM(BOTH FROM "content")), '[^\w\s]'::"text", ''::"text", 'g'::"text"), '\s+'::"text", ' '::"text", 'g'::"text")))) STORED,
    "classification_model" "text",
    "embedding_model" "text",
    "dedup_status" "text" DEFAULT 'clean'::"text" NOT NULL,
    "superseded_by" "uuid",
    "next_review_date" "date",
    "review_cadence_days" integer,
    "publication_status" "text" DEFAULT 'published'::"text" NOT NULL,
    "ingestion_source" "text",
    "op_id" "uuid",
    CONSTRAINT "chk_content_items_citation_count_non_negative" CHECK (("citation_count" >= 0)),
    CONSTRAINT "content_items_dedup_status_check" CHECK (("dedup_status" = ANY (ARRAY['clean'::"text", 'suspected_duplicate'::"text", 'confirmed_duplicate'::"text", 'confirmed_unique'::"text", 'superseded'::"text"]))),
    CONSTRAINT "content_items_governance_review_status_check" CHECK ((("governance_review_status" IS NULL) OR ("governance_review_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'reverted'::"text", 'changes_requested'::"text", 'review_overdue'::"text"])))),
    CONSTRAINT "content_items_platform_check" CHECK ((("platform")::"text" = ANY (ARRAY[('web'::character varying)::"text", ('email'::character varying)::"text", ('manual'::character varying)::"text", ('upload'::character varying)::"text", ('extraction'::character varying)::"text", ('other'::character varying)::"text"]))),
    CONSTRAINT "content_items_previous_freshness_check" CHECK ((("previous_freshness" IS NULL) OR (("previous_freshness")::"text" = ANY (ARRAY[('fresh'::character varying)::"text", ('aging'::character varying)::"text", ('stale'::character varying)::"text", ('expired'::character varying)::"text"])))),
    CONSTRAINT "content_items_publication_status_check" CHECK ((("publication_status" IS NULL) OR ("publication_status" = ANY (ARRAY['draft'::"text", 'in_review'::"text", 'published'::"text", 'archived'::"text"])))),
    CONSTRAINT "content_items_quality_score_range" CHECK ((("quality_score" >= 0) AND ("quality_score" <= 100))),
    CONSTRAINT "content_items_review_cadence_days_check" CHECK ((("review_cadence_days" IS NULL) OR (("review_cadence_days" >= 1) AND ("review_cadence_days" <= 1095)))),
    CONSTRAINT "content_items_superseded_by_not_self" CHECK ((("superseded_by" IS NULL) OR ("superseded_by" <> "id"))),
    CONSTRAINT "content_items_valid_content_type" CHECK ((("content_type")::"text" = ANY (ARRAY['article'::"text", 'blog'::"text", 'pdf'::"text", 'note'::"text", 'research'::"text", 'other'::"text", 'q_a_pair'::"text", 'case_study'::"text", 'policy'::"text", 'certification'::"text", 'compliance'::"text", 'methodology'::"text", 'capability'::"text", 'product_description'::"text", 'document'::"text"])))
);


ALTER TABLE "public"."content_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."content_items"."content_owner_id" IS 'User responsible for keeping this content current. Receives targeted freshness and governance notifications.';



COMMENT ON COLUMN "public"."content_items"."source_document_id" IS 'FK to the source_documents row that produced this content item. Used for lineage tracking and re-ingestion diffing.';



COMMENT ON COLUMN "public"."content_items"."dedup_status" IS 'S183 WP2 — OPS-3 Phase 1. Soft-block dedup flag. clean = default, suspected_duplicate = detected at ingest, confirmed_duplicate / confirmed_unique = admin-reviewed via UI (S184).';



COMMENT ON COLUMN "public"."content_items"."superseded_by" IS 'UUID of the content_items row that supersedes this one. Minimum viable model per docs/specs/supersession-model-spec.md — chains, branches, merges, cross-workspace semantics all deliberately out of scope. NULL means "current". Default search filters this out unless the caller opts in via include_superseded=true.';



COMMENT ON COLUMN "public"."content_items"."publication_status" IS 'Publication lifecycle state per §5.2 spec. Values: draft, in_review, published, archived. NOT NULL with DEFAULT ''published''. CHECK enum enforced by content_items_publication_status_check.';



COMMENT ON COLUMN "public"."content_items"."ingestion_source" IS 'Canonical ingest provenance (renamed from ingest_source per S236). Read by trg_content_items_ensure_v1_history to set content_history.change_reason. Note: the v1-history metadata key remains ''ingest_source'' for history-row continuity.';



COMMENT ON COLUMN "public"."content_items"."op_id" IS 'Cocoindex per-flow op_id; T8 (docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-4)';



COMMENT ON CONSTRAINT "content_items_valid_content_type" ON "public"."content_items" IS 'Canonical content_type values. Must stay in sync with VALID_CONTENT_TYPES in lib/validation/schemas.ts. See SI-L3 fix.';



CREATE OR REPLACE FUNCTION "api"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text" DEFAULT 'any'::"text") RETURNS SETOF "public"."content_items"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.filter_by_keywords(keyword_list => keyword_list, match_mode => match_mode);
$$;


ALTER FUNCTION "api"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."find_duplicate_pairs"("similarity_threshold" numeric DEFAULT 0.95, "p_domain" "text" DEFAULT NULL::"text", "limit_count" integer DEFAULT 50) RETURNS TABLE("id1" "uuid", "title1" "text", "type1" character varying, "domain1" character varying, "id2" "uuid", "title2" "text", "type2" character varying, "domain2" character varying, "similarity" numeric)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.find_duplicate_pairs(similarity_threshold => similarity_threshold, p_domain => p_domain, limit_count => limit_count);
$$;


ALTER FUNCTION "api"."find_duplicate_pairs"("similarity_threshold" numeric, "p_domain" "text", "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."find_duplicate_tags"("p_type" "text") RETURNS TABLE("canonical" "text", "variants" "text"[], "variant_count" integer, "total_usage" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.find_duplicate_tags(p_type => p_type);
$$;


ALTER FUNCTION "api"."find_duplicate_tags"("p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."find_exact_duplicates"("p_content_hash" "text", "p_exclude_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "title" "text")
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.find_exact_duplicates(p_content_hash => p_content_hash, p_exclude_id => p_exclude_id);
$$;


ALTER FUNCTION "api"."find_exact_duplicates"("p_content_hash" "text", "p_exclude_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."find_related_items"("p_item_id" "uuid", "p_similarity_threshold" double precision DEFAULT 0.6, "p_limit_count" integer DEFAULT 6) RETURNS TABLE("id" "uuid", "title" "text", "suggested_title" "text", "summary" "text", "primary_domain" "text", "primary_subtopic" "text", "content_type" character varying, "platform" character varying, "author_name" character varying, "source_domain" character varying, "thumbnail_url" "text", "captured_date" timestamp with time zone, "ai_keywords" "text"[], "classification_confidence" double precision, "priority" character varying, "user_tags" "text"[], "similarity" numeric)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.find_related_items(p_item_id => p_item_id, p_similarity_threshold => p_similarity_threshold, p_limit_count => p_limit_count);
$$;


ALTER FUNCTION "api"."find_related_items"("p_item_id" "uuid", "p_similarity_threshold" double precision, "p_limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."find_similar_content"("query_embedding" "extensions"."vector", "similarity_threshold" double precision DEFAULT 0.7, "limit_count" integer DEFAULT 10) RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "similarity" numeric, "content_type" character varying, "platform" character varying, "author_name" character varying, "source_domain" character varying)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.find_similar_content(query_embedding => query_embedding, similarity_threshold => similarity_threshold, limit_count => limit_count);
$$;


ALTER FUNCTION "api"."find_similar_content"("query_embedding" "extensions"."vector", "similarity_threshold" double precision, "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."find_similar_content"("query_embedding" "extensions"."vector", "similarity_threshold" numeric DEFAULT 0.5, "limit_count" integer DEFAULT 10) RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "similarity" numeric, "content_type" character varying, "platform" character varying, "author_name" character varying, "source_domain" character varying)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.find_similar_content(query_embedding => query_embedding, similarity_threshold => similarity_threshold, limit_count => limit_count);
$$;


ALTER FUNCTION "api"."find_similar_content"("query_embedding" "extensions"."vector", "similarity_threshold" numeric, "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_aggregate_win_rate_stats"() RETURNS TABLE("scope" "text", "total_citations" bigint, "winning_citations" bigint, "losing_citations" bigint, "pending_citations" bigint, "win_rate" numeric, "unique_items_cited" bigint, "unique_bids" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_aggregate_win_rate_stats();
$$;


ALTER FUNCTION "api"."get_aggregate_win_rate_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_all_tag_counts"() RETURNS TABLE("tag" "text", "count" bigint, "source" "text")
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_all_tag_counts();
$$;


ALTER FUNCTION "api"."get_all_tag_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_author_analysis"("p_author_name" "text") RETURNS json
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.get_author_analysis(p_author_name => p_author_name);
$$;


ALTER FUNCTION "api"."get_author_analysis"("p_author_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_content_gaps"() RETURNS json
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.get_content_gaps();
$$;


ALTER FUNCTION "api"."get_content_gaps"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_content_owner_stats"() RETURNS TABLE("owner_id" "uuid", "total_items" integer, "fresh_count" integer, "aging_count" integer, "stale_count" integer, "expired_count" integer, "unverified_count" integer)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_content_owner_stats();
$$;


ALTER FUNCTION "api"."get_content_owner_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_content_win_rate"("p_content_item_id" "uuid") RETURNS TABLE("total_citations" bigint, "winning_citations" bigint, "losing_citations" bigint, "pending_citations" bigint, "win_rate" numeric)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_content_win_rate(p_content_item_id => p_content_item_id);
$$;


ALTER FUNCTION "api"."get_content_win_rate"("p_content_item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_coverage_matrix"("p_layer" "text" DEFAULT NULL::"text") RETURNS TABLE("domain_name" "text", "subtopic_name" "text", "item_count" bigint, "fresh_count" bigint, "aging_count" bigint, "stale_count" bigint, "expired_count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_coverage_matrix(p_layer => p_layer);
$$;


ALTER FUNCTION "api"."get_coverage_matrix"("p_layer" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_coverage_summary"() RETURNS TABLE("domain_name" "text", "domain_colour" "text", "total_items" bigint, "fresh_pct" numeric, "gap_count" bigint, "expired_count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_coverage_summary();
$$;


ALTER FUNCTION "api"."get_coverage_summary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text" DEFAULT 'viewer'::"text") RETURNS json
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.get_dashboard_attention_counts(p_user_id => p_user_id, p_role => p_role);
$$;


ALTER FUNCTION "api"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feed_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "url" "text" NOT NULL,
    "source_type" character varying DEFAULT 'rss'::character varying NOT NULL,
    "polling_interval_minutes" integer DEFAULT 30 NOT NULL,
    "last_polled_at" timestamp with time zone,
    "last_polled_status" character varying,
    "last_polled_error" "text",
    "etag" "text",
    "last_modified" "text",
    "consecutive_failures" integer DEFAULT 0 NOT NULL,
    "article_count" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "feed_sources_last_polled_status_check" CHECK ((("last_polled_status")::"text" = ANY (ARRAY[('success'::character varying)::"text", ('error'::character varying)::"text", ('timeout'::character varying)::"text", ('not_modified'::character varying)::"text"]))),
    CONSTRAINT "feed_sources_source_type_check" CHECK ((("source_type")::"text" = ANY (ARRAY[('rss'::character varying)::"text", ('web'::character varying)::"text", ('api'::character varying)::"text"])))
);


ALTER TABLE "public"."feed_sources" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_due_feed_sources"("max_sources" integer DEFAULT 5) RETURNS SETOF "public"."feed_sources"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_due_feed_sources(max_sources => max_sources);
$$;


ALTER FUNCTION "api"."get_due_feed_sources"("max_sources" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_entity_list_aggregated"("p_type" "text" DEFAULT NULL::"text", "p_search" "text" DEFAULT NULL::"text", "p_variants_only" boolean DEFAULT false, "p_type_conflicts" boolean DEFAULT false, "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS json
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.get_entity_list_aggregated(p_type => p_type, p_search => p_search, p_variants_only => p_variants_only, p_type_conflicts => p_type_conflicts, p_limit => p_limit, p_offset => p_offset);
$$;


ALTER FUNCTION "api"."get_entity_list_aggregated"("p_type" "text", "p_search" "text", "p_variants_only" boolean, "p_type_conflicts" boolean, "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_entity_summary"("p_entity_name" "text" DEFAULT NULL::"text", "p_entity_type" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT NULL::integer) RETURNS TABLE("canonical_name" "text", "entity_type" "text", "mention_count" bigint, "content_item_ids" "uuid"[], "related_entities" "jsonb")
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_entity_summary(p_entity_name => p_entity_name, p_entity_type => p_entity_type, p_limit => p_limit);
$$;


ALTER FUNCTION "api"."get_entity_summary"("p_entity_name" "text", "p_entity_type" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_filter_counts"() RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.get_filter_counts();
$$;


ALTER FUNCTION "api"."get_filter_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_filter_ratio_trend"("p_workspace_id" "uuid", "p_granularity" "text" DEFAULT 'daily'::"text", "p_period_days" integer DEFAULT 90) RETURNS TABLE("date" "text", "total" bigint, "passed" bigint, "filtered" bigint, "ratio" integer)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_filter_ratio_trend(p_workspace_id => p_workspace_id, p_granularity => p_granularity, p_period_days => p_period_days);
$$;


ALTER FUNCTION "api"."get_filter_ratio_trend"("p_workspace_id" "uuid", "p_granularity" "text", "p_period_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_form_question_stats"("p_project_id" "uuid") RETURNS TABLE("total_questions" bigint, "strong_match_count" bigint, "partial_match_count" bigint, "needs_sme_count" bigint, "no_content_count" bigint, "unmatched_count" bigint, "drafted_count" bigint, "complete_count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_form_question_stats(p_project_id => p_project_id);
$$;


ALTER FUNCTION "api"."get_form_question_stats"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_form_question_stats_batch"("p_project_ids" "uuid"[]) RETURNS TABLE("workspace_id" "uuid", "total_questions" bigint, "strong_match_count" bigint, "partial_match_count" bigint, "needs_sme_count" bigint, "no_content_count" bigint, "unmatched_count" bigint, "drafted_count" bigint, "complete_count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_form_question_stats_batch(p_project_ids => p_project_ids);
$$;


ALTER FUNCTION "api"."get_form_question_stats_batch"("p_project_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_freshness_breakdown"() RETURNS TABLE("freshness" "text", "count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_freshness_breakdown();
$$;


ALTER FUNCTION "api"."get_freshness_breakdown"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_grouped_activity_feed"("p_limit" integer DEFAULT 10, "p_is_admin" boolean DEFAULT false, "p_before" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("id" "uuid", "type" "text", "entity_type" "text", "entity_id" "uuid", "summary" "text", "user_id" "uuid", "latest_at" timestamp with time zone, "earliest_at" timestamp with time zone, "event_count" integer)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_grouped_activity_feed(p_limit => p_limit, p_is_admin => p_is_admin, p_before => p_before);
$$;


ALTER FUNCTION "api"."get_grouped_activity_feed"("p_limit" integer, "p_is_admin" boolean, "p_before" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_guide_content"("p_guide_slug" "text") RETURNS TABLE("section_id" "uuid", "section_name" "text", "section_description" "text", "section_order" integer, "expected_layer" "text", "subtopic_filter" "text", "is_required" boolean, "content_id" "uuid", "content_title" "text", "content_type" "text", "content_layer" "text", "content_brief" "text", "content_freshness" "text", "content_verified_at" timestamp with time zone, "content_captured_date" timestamp with time zone)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_guide_content(p_guide_slug => p_guide_slug);
$$;


ALTER FUNCTION "api"."get_guide_content"("p_guide_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_guide_coverage"() RETURNS TABLE("guide_id" "uuid", "guide_name" "text", "guide_slug" "text", "guide_type" "text", "domain_filter" "text", "section_id" "uuid", "section_name" "text", "section_order" integer, "expected_layer" "text", "is_required" boolean, "content_count" bigint, "fresh_count" bigint, "stale_count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_guide_coverage();
$$;


ALTER FUNCTION "api"."get_guide_coverage"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "color" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "domain_metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_archived" boolean DEFAULT false,
    "status" character varying(30),
    "created_by" "uuid",
    "updated_by" "uuid",
    "icon" "text",
    "application_type_id" "uuid" NOT NULL
);


ALTER TABLE "public"."workspaces" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_item_workspaces"("p_item_id" "uuid") RETURNS SETOF "public"."workspaces"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_item_workspaces(p_item_id => p_item_id);
$$;


ALTER FUNCTION "api"."get_item_workspaces"("p_item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_items_with_quality_flags"() RETURNS SETOF "uuid"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_items_with_quality_flags();
$$;


ALTER FUNCTION "api"."get_items_with_quality_flags"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_popular_keywords"("p_limit" integer DEFAULT 10) RETURNS TABLE("keyword" "text", "item_count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_popular_keywords(p_limit => p_limit);
$$;


ALTER FUNCTION "api"."get_popular_keywords"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_quality_issue_counts"() RETURNS TABLE("flag_type" "text", "severity" "text", "open_count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_quality_issue_counts();
$$;


ALTER FUNCTION "api"."get_quality_issue_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_reading_patterns"("p_days" integer DEFAULT 30) RETURNS json
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.get_reading_patterns(p_days => p_days);
$$;


ALTER FUNCTION "api"."get_reading_patterns"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_review_breakdown_stats"() RETURNS json
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.get_review_breakdown_stats();
$$;


ALTER FUNCTION "api"."get_review_breakdown_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_tag_counts_filtered"("p_type" "text", "p_min_count" integer DEFAULT 1, "p_search" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("tag" "text", "count" bigint, "source" "text", "total_count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_tag_counts_filtered(p_type => p_type, p_min_count => p_min_count, p_search => p_search, p_limit => p_limit, p_offset => p_offset);
$$;


ALTER FUNCTION "api"."get_tag_counts_filtered"("p_type" "text", "p_min_count" integer, "p_search" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_tags_by_domain"("p_type" "text") RETURNS TABLE("domain" "text", "tag" "text", "count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_tags_by_domain(p_type => p_type);
$$;


ALTER FUNCTION "api"."get_tags_by_domain"("p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_topic_deep_dive"("p_keyword" "text") RETURNS json
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.get_topic_deep_dive(p_keyword => p_keyword);
$$;


ALTER FUNCTION "api"."get_topic_deep_dive"("p_keyword" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_topic_layers"("p_topic_id" "text") RETURNS TABLE("id" "uuid", "title" "text", "content_type" "text", "primary_domain" "text", "metadata" "jsonb", "layer" "text")
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_topic_layers(p_topic_id => p_topic_id);
$$;


ALTER FUNCTION "api"."get_topic_layers"("p_topic_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_trend_analysis"("p_days" integer DEFAULT 30, "p_min_count" integer DEFAULT 2) RETURNS TABLE("keyword" "text", "current_count" bigint, "previous_count" bigint, "growth_rate" numeric, "domains" "text"[])
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_trend_analysis(p_days => p_days, p_min_count => p_min_count);
$$;


ALTER FUNCTION "api"."get_trend_analysis"("p_days" integer, "p_min_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_unique_authors"() RETURNS TABLE("author_name" "text", "count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_unique_authors();
$$;


ALTER FUNCTION "api"."get_unique_authors"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_user_display_names"("user_ids" "uuid"[]) RETURNS TABLE("user_id" "uuid", "display_name" "text")
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.get_user_display_names(user_ids => user_ids);
$$;


ALTER FUNCTION "api"."get_user_display_names"("user_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_user_tag_counts"() RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.get_user_tag_counts();
$$;


ALTER FUNCTION "api"."get_user_tag_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."hybrid_search"("query_embedding" "extensions"."vector", "query_text" "text" DEFAULT ''::"text", "similarity_threshold" numeric DEFAULT 0.3, "limit_count" integer DEFAULT 10, "include_superseded" boolean DEFAULT false, "visibility_filter" character varying DEFAULT 'default'::character varying) RETURNS TABLE("id" "uuid", "title" "text", "suggested_title" "text", "summary" "text", "primary_domain" "text", "primary_subtopic" "text", "content_type" "text", "platform" "text", "author_name" "text", "source_domain" "text", "thumbnail_url" "text", "captured_date" timestamp with time zone, "ai_keywords" "text"[], "classification_confidence" numeric, "priority" "text", "metadata" "jsonb", "similarity" numeric, "snippet" "text", "created_by" "uuid", "verified_at" timestamp with time zone, "verified_by" "uuid")
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.hybrid_search(query_embedding => query_embedding, query_text => query_text, similarity_threshold => similarity_threshold, limit_count => limit_count, include_superseded => include_superseded, visibility_filter => visibility_filter);
$$;


ALTER FUNCTION "api"."hybrid_search"("query_embedding" "extensions"."vector", "query_text" "text", "similarity_threshold" numeric, "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."list_public_tables"() RETURNS SETOF "text"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.list_public_tables();
$$;


ALTER FUNCTION "api"."list_public_tables"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.merge_entities(p_source_names => p_source_names, p_target_name => p_target_name, p_entity_type => p_entity_type);
$$;


ALTER FUNCTION "api"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."merge_item_metadata"("p_item_id" "uuid", "p_new_data" "jsonb") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.merge_item_metadata(p_item_id => p_item_id, p_new_data => p_new_data);
$$;


ALTER FUNCTION "api"."merge_item_metadata"("p_item_id" "uuid", "p_new_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."merge_tags"("p_source" "text", "p_target" "text", "p_type" "text") RETURNS integer
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.merge_tags(p_source => p_source, p_target => p_target, p_type => p_type);
$$;


ALTER FUNCTION "api"."merge_tags"("p_source" "text", "p_target" "text", "p_type" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."q_a_extractions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_content_item_id" "uuid",
    "extractor_kind" "text" NOT NULL,
    "extracted_question_text" "text" NOT NULL,
    "extracted_answer_text" "text",
    "extraction_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "promoted_to_pair_id" "uuid",
    "invalidated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "op_id" "uuid",
    "expected_response_kind" "text",
    "evaluation_criteria" "text",
    "evidence_requirements" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "scope_tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "alternate_question_phrasings" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "q_a_extractions_expected_response_kind_check" CHECK (("expected_response_kind" = ANY (ARRAY['mandatory'::"text", 'optional'::"text"]))),
    CONSTRAINT "q_a_extractions_extractor_kind_check" CHECK (("extractor_kind" = ANY (ARRAY['prior_bid_response'::"text", 'llm_extraction'::"text", 'yaml_frontmatter_v1'::"text", 'markdown_heading_v1'::"text"])))
);


ALTER TABLE "public"."q_a_extractions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."q_a_extractions"."op_id" IS 'Cocoindex per-flow op_id; T8 (docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-4)';



CREATE OR REPLACE FUNCTION "api"."q_a_extractions_promotion_candidates"() RETURNS SETOF "public"."q_a_extractions"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.q_a_extractions_promotion_candidates();
$$;


ALTER FUNCTION "api"."q_a_extractions_promotion_candidates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."q_a_get_verbatim"("p_pair_id" "uuid") RETURNS TABLE("id" "uuid", "question_text" "text", "alternate_question_phrasings" "text"[], "answer_standard" "text", "answer_advanced" "text", "scope_tag" "text"[], "anti_scope_tag" "text"[], "source_workspace_id" "uuid", "origin_kind" "text", "publication_status" "text", "superseded_by" "uuid", "valid_from" timestamp with time zone, "valid_to" timestamp with time zone, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.q_a_get_verbatim(p_pair_id => p_pair_id);
$$;


ALTER FUNCTION "api"."q_a_get_verbatim"("p_pair_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."q_a_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer DEFAULT 20) RETURNS TABLE("pair_id" "uuid", "question_text_preview" "text", "answer_standard_preview" "text", "embedding_score" numeric, "fulltext_score" numeric, "scope_tag" "text"[], "publication_status" "text")
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.q_a_search(p_query => p_query, p_query_embedding => p_query_embedding, p_limit => p_limit);
$$;


ALTER FUNCTION "api"."q_a_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."question_match_recompute"("p_form_question_id" "uuid", "p_query" "text", "p_query_embedding" "extensions"."vector", "p_question_kind" "text", "p_scope_tag" "text"[], "p_anti_scope_tag" "text"[], "p_limit" integer DEFAULT 20) RETURNS integer
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.question_match_recompute(p_form_question_id => p_form_question_id, p_query => p_query, p_query_embedding => p_query_embedding, p_question_kind => p_question_kind, p_scope_tag => p_scope_tag, p_anti_scope_tag => p_anti_scope_tag, p_limit => p_limit);
$$;


ALTER FUNCTION "api"."question_match_recompute"("p_form_question_id" "uuid", "p_query" "text", "p_query_embedding" "extensions"."vector", "p_question_kind" "text", "p_scope_tag" "text"[], "p_anti_scope_tag" "text"[], "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."question_match_search"("p_form_question_id" "uuid", "p_question_kind" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 20) RETURNS TABLE("q_a_pair_id" "uuid", "question_text_preview" "text", "answer_standard_preview" "text", "embedding_score" numeric, "fulltext_score" numeric, "scope_tag" "text"[], "publication_status" "text")
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.question_match_search(p_form_question_id => p_form_question_id, p_question_kind => p_question_kind, p_limit => p_limit);
$$;


ALTER FUNCTION "api"."question_match_search"("p_form_question_id" "uuid", "p_question_kind" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."reap_stuck_jobs"("p_timeout_seconds" integer) RETURNS integer
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.reap_stuck_jobs(p_timeout_seconds => p_timeout_seconds);
$$;


ALTER FUNCTION "api"."reap_stuck_jobs"("p_timeout_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."recalculate_all_freshness"() RETURNS TABLE("total_count" integer, "fresh_count" integer, "aging_count" integer, "stale_count" integer, "expired_count" integer)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.recalculate_all_freshness();
$$;


ALTER FUNCTION "api"."recalculate_all_freshness"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."reference_get_verbatim"("p_reference_id" "uuid") RETURNS TABLE("id" "uuid", "title" "text", "body" "text", "summary" "text", "source_url" "text", "published_at" timestamp with time zone, "primary_domain" "text", "primary_subtopic" "text", "layer" "text", "source_document_id" "uuid", "ingestion_source" "text", "op_id" "uuid", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.reference_get_verbatim(p_reference_id => p_reference_id);
$$;


ALTER FUNCTION "api"."reference_get_verbatim"("p_reference_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."reference_ingest"("p_source_url" "text", "p_title" "text", "p_body" "text", "p_summary" "text", "p_primary_domain" "text", "p_primary_subtopic" "text", "p_embedding" "extensions"."vector", "p_published_at" timestamp with time zone, "p_filename" "text", "p_mime_type" "text", "p_file_size" integer, "p_content_hash" "text", "p_extraction_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_op_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("reference_id" "uuid", "source_document_id" "uuid", "title" "text", "summary" "text", "source_url" "text", "primary_domain" "text", "primary_subtopic" "text", "already_existed" boolean)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.reference_ingest(p_source_url => p_source_url, p_title => p_title, p_body => p_body, p_summary => p_summary, p_primary_domain => p_primary_domain, p_primary_subtopic => p_primary_subtopic, p_embedding => p_embedding, p_published_at => p_published_at, p_filename => p_filename, p_mime_type => p_mime_type, p_file_size => p_file_size, p_content_hash => p_content_hash, p_extraction_metadata => p_extraction_metadata, p_op_id => p_op_id);
$$;


ALTER FUNCTION "api"."reference_ingest"("p_source_url" "text", "p_title" "text", "p_body" "text", "p_summary" "text", "p_primary_domain" "text", "p_primary_subtopic" "text", "p_embedding" "extensions"."vector", "p_published_at" timestamp with time zone, "p_filename" "text", "p_mime_type" "text", "p_file_size" integer, "p_content_hash" "text", "p_extraction_metadata" "jsonb", "p_op_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."reference_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer DEFAULT 20) RETURNS TABLE("reference_id" "uuid", "title" "text", "summary_preview" "text", "body_preview" "text", "embedding_score" numeric, "fulltext_score" numeric, "source_url" "text", "published_at" timestamp with time zone, "primary_domain" "text", "primary_subtopic" "text", "layer" "text", "ingestion_source" "text", "source_document_id" "uuid")
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.reference_search(p_query => p_query, p_query_embedding => p_query_embedding, p_limit => p_limit);
$$;


ALTER FUNCTION "api"."reference_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."rename_tag"("p_old" "text", "p_new" "text", "p_type" "text") RETURNS integer
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.rename_tag(p_old => p_old, p_new => p_new, p_type => p_type);
$$;


ALTER FUNCTION "api"."rename_tag"("p_old" "text", "p_new" "text", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."search_for_form_response"("query_embedding" "extensions"."vector", "query_text" "text" DEFAULT ''::"text", "limit_count" integer DEFAULT 10, "include_superseded" boolean DEFAULT false, "visibility_filter" character varying DEFAULT 'default'::character varying) RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "brief" "text", "detail" "text", "primary_domain" character varying, "primary_subtopic" character varying, "content_type" character varying, "ai_keywords" "text"[], "similarity" numeric)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.search_for_form_response(query_embedding => query_embedding, query_text => query_text, limit_count => limit_count, include_superseded => include_superseded, visibility_filter => visibility_filter);
$$;


ALTER FUNCTION "api"."search_for_form_response"("query_embedding" "extensions"."vector", "query_text" "text", "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."set_config"("setting" "text", "value" "text", "is_local" boolean) RETURNS "text"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.set_config(setting => setting, value => value, is_local => is_local);
$$;


ALTER FUNCTION "api"."set_config"("setting" "text", "value" "text", "is_local" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."suggest_tags"("p_prefix" "text", "p_type" "text") RETURNS TABLE("tag" "text", "count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT * FROM public.suggest_tags(p_prefix => p_prefix, p_type => p_type);
$$;


ALTER FUNCTION "api"."suggest_tags"("p_prefix" "text", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."toggle_star"("item_id" "uuid") RETURNS boolean
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.toggle_star(item_id => item_id);
$$;


ALTER FUNCTION "api"."toggle_star"("item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."toggle_star"("p_item_id" "uuid", "p_starred" boolean) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT public.toggle_star(p_item_id => p_item_id, p_starred => p_starred);
$$;


ALTER FUNCTION "api"."toggle_star"("p_item_id" "uuid", "p_starred" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_test_delete_broken_auth_user"("probe_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'auth'
    AS $$
BEGIN
  IF probe_id::text NOT LIKE '00000000-0000-4000-8000-%' THEN
    RAISE EXCEPTION
      'refusing to delete probe row outside the test UUID range (got %)',
      probe_id;
  END IF;

  DELETE FROM public.user_roles WHERE user_id = probe_id;
  DELETE FROM auth.identities WHERE user_id = probe_id;
  DELETE FROM auth.users WHERE id = probe_id;
END;
$$;


ALTER FUNCTION "public"."_test_delete_broken_auth_user"("probe_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_test_delete_broken_auth_user"("probe_id" "uuid") IS 'S156 WP-1 test helper — DO NOT call from production code. Hard-deletes the matching probe row including any user_roles + auth.identities children. Hard-locked to UUIDs in the 00000000-0000-4000-8000-%% range.';



CREATE OR REPLACE FUNCTION "public"."_test_insert_broken_auth_user"("probe_id" "uuid", "probe_email" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'auth'
    AS $$
BEGIN
  IF probe_id::text NOT LIKE '00000000-0000-4000-8000-%' THEN
    RAISE EXCEPTION
      'refusing to insert probe row outside the test UUID range (got %)',
      probe_id;
  END IF;

  -- Deliberately omit the 8 token columns so they default to NULL.
  -- This is the EXACT shape that broke S156 — the test exists to prove
  -- that GoTrue's admin API tolerates it (post-S156 fix) or to catch a
  -- regression if the corrective migration is ever reverted.
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    probe_id,
    'authenticated', 'authenticated',
    probe_email,
    '!s156-probe-no-login!',
    NOW(), NOW(), NOW(),
    '{}'::jsonb, '{}'::jsonb,
    false, false, false
  )
  ON CONFLICT (id) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."_test_insert_broken_auth_user"("probe_id" "uuid", "probe_email" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_test_insert_broken_auth_user"("probe_id" "uuid", "probe_email" "text") IS 'S156 WP-1 test helper — DO NOT call from production code. Inserts a deliberately-broken auth.users row (NULL token columns, no identities row) for the S156 regression test. Hard-locked to UUIDs in the 00000000-0000-4000-8000-%% range.';



CREATE OR REPLACE FUNCTION "public"."auto_version_content_history"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
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
    SET "search_path" TO 'public', 'extensions'
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
    LANGUAGE "plpgsql"
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
    LANGUAGE "plpgsql"
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
    LANGUAGE "plpgsql"
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
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT
    unnest_id AS id,
    EXISTS(SELECT 1 FROM content_items ci WHERE ci.id = unnest_id) AS item_exists
  FROM unnest(ids) AS unnest_id;
$$;


ALTER FUNCTION "public"."check_content_exists"("ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_job"() RETURNS SETOF "public"."processing_queue"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  UPDATE public.processing_queue
  SET status = 'processing', started_at = NOW()
  WHERE id = (
    SELECT id FROM processing_queue
    WHERE status = 'pending' AND updated_at <= NOW()
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;


ALTER FUNCTION "public"."claim_next_job"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_filtered_articles"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM feed_articles
  WHERE passed = false
    AND created_at < now() - interval '90 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_filtered_articles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."coerce_empty_classification_to_null"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  NEW.primary_domain := NULLIF(NEW.primary_domain, '');
  NEW.primary_subtopic := NULLIF(NEW.primary_subtopic, '');
  NEW.secondary_domain := NULLIF(NEW.secondary_domain, '');
  NEW.secondary_subtopic := NULLIF(NEW.secondary_subtopic, '');
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."coerce_empty_classification_to_null"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."coerce_null_token_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  -- Coerce each of the 8 GoTrue-scanned token columns from NULL to ''.
  -- These are the exact columns that break `auth.admin.listUsers` /
  -- `auth.admin.getUserById` with `sql: Scan error on column "<col>":
  -- converting NULL to string is unsupported` when NULL. Keep this list
  -- in lockstep with __tests__/migrations/auth-users-insert-guard.test.ts
  -- (REQUIRED_TOKEN_COLUMNS).
  NEW.confirmation_token          := COALESCE(NEW.confirmation_token,          '');
  NEW.recovery_token              := COALESCE(NEW.recovery_token,              '');
  NEW.email_change_token_new      := COALESCE(NEW.email_change_token_new,      '');
  NEW.email_change_token_current  := COALESCE(NEW.email_change_token_current,  '');
  NEW.email_change                := COALESCE(NEW.email_change,                '');
  NEW.phone_change                := COALESCE(NEW.phone_change,                '');
  NEW.phone_change_token          := COALESCE(NEW.phone_change_token,          '');
  NEW.reauthentication_token      := COALESCE(NEW.reauthentication_token,      '');
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."coerce_null_token_columns"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."coerce_null_token_columns"() IS 'S156/S157 runtime guard: coerce NULL to '''' on the 8 GoTrue-scanned token columns of auth.users, so raw-SQL insert/update paths cannot reproduce the listUsers/getUserById scan-error failure mode. See docs/audits/s156-gotrue-upstream-investigation.md for the upstream status review. Function lives in public schema because auth schema disallows DDL from the postgres role; trigger on auth.users follows the same pattern as the existing on_auth_user_created trigger.';



CREATE OR REPLACE FUNCTION "public"."content_history_auto_version"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  NEW.version := COALESCE(
    (SELECT MAX(version) FROM content_history WHERE content_item_id = NEW.content_item_id),
    0
  ) + 1;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."content_history_auto_version"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_auth_users"() RETURNS bigint
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT count(*) FROM auth.users;
$$;


ALTER FUNCTION "public"."count_auth_users"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."count_auth_users"() IS 'Service-role probe helper: returns count(*) FROM auth.users. Used by scripts/verify-user-profiles-parity.ts. WP-G3.4 (kh-prod-readiness-S8). Spec §4.6.';



CREATE OR REPLACE FUNCTION "public"."delete_duplicate_entity_mentions"("p_canonical_name" "text") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
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
    SET "search_path" TO 'public', 'extensions'
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
    LANGUAGE "sql" STABLE
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


CREATE OR REPLACE FUNCTION "public"."enforce_archive_state_consistency"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  -- Direction 1: publication_status set to 'archived' → ensure archived_at populated
  IF NEW.publication_status = 'archived' AND NEW.archived_at IS NULL THEN
    NEW.archived_at := NOW();
  END IF;

  -- Direction 2: publication_status changes AWAY from 'archived' → clear archived_at
  IF NEW.publication_status != 'archived' AND OLD.publication_status = 'archived' THEN
    NEW.archived_at := NULL;
  END IF;

  -- Direction 3: archived_at set non-NULL by legacy path → ensure publication_status='archived'
  -- This handles: app/api/items/[id]/archive/route.ts (primary archive route),
  -- lib/mcp/tools/governance.ts delete_content_item archive mode,
  -- lib/supersession/set.ts (per §6.5 wiring).
  IF NEW.archived_at IS NOT NULL
     AND (OLD.archived_at IS NULL OR OLD.archived_at IS DISTINCT FROM NEW.archived_at)
     AND NEW.publication_status != 'archived'
  THEN
    NEW.publication_status := 'archived';
  END IF;

  -- Direction 4: archived_at cleared by legacy path → require explicit publication_status restore
  -- Auto-restoring publication_status would lose information (was it 'published' or 'draft'?
  -- Legacy un-archive paths don't track this). Instead, raise NOTICE and leave publication_status
  -- as-is. Production code MUST update publication_status explicitly when un-archiving.
  IF NEW.archived_at IS NULL
     AND OLD.archived_at IS NOT NULL
     AND NEW.publication_status = 'archived'
  THEN
    RAISE NOTICE 'enforce_archive_state_consistency: archived_at cleared but publication_status remains ''archived''. Caller must set publication_status explicitly to ''published'' or ''draft''. Item: %', NEW.id;
    -- Defensive: leave publication_status='archived' so item remains hidden until app fixes it
    -- (better stale-hidden than stale-visible)
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_archive_state_consistency"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enforce_archive_state_consistency"() IS 'Bidirectional invariant: publication_status=''archived'' ↔ archived_at IS NOT NULL. Per §5.2 spec §6.6. Four directions documented inline.';



CREATE OR REPLACE FUNCTION "public"."ensure_v1_history_at_commit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_v1_exists BOOLEAN;
  v_change_reason TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.content_history
    WHERE content_item_id = NEW.id AND version = 1
  ) INTO v_v1_exists;

  IF v_v1_exists THEN
    RETURN NULL;
  END IF;

  -- Single CASE expression (Wave 3 fix M-4): if ingestion_source is set, emit
  -- canonical 'initial_ingest'; otherwise fall back to legacy
  -- 'auto_v1_on_insert' for null/legacy rows.
  v_change_reason := CASE
    WHEN NEW.ingestion_source IS NOT NULL THEN 'initial_ingest'
    ELSE 'auto_v1_on_insert'
  END;

  INSERT INTO public.content_history (
    content_item_id, version, title, content,
    brief, detail, reference,
    change_type, change_reason, change_summary,
    metadata, created_by, created_at
  ) VALUES (
    NEW.id, 1,
    COALESCE(NEW.title, '(untitled)'),
    COALESCE(NEW.content, ''),
    NEW.brief, NEW.detail, NEW.reference,
    'create',
    v_change_reason,
    'v1 written by trg_content_items_ensure_v1_history',
    jsonb_build_object(
      'auto', true,
      'via', 'trigger',
      -- metadata key kept as 'ingest_source' for history-row continuity; underlying column renamed to ingestion_source
      'ingest_source', NEW.ingestion_source,
      'trigger_name', 'trg_content_items_ensure_v1_history'
    ),
    COALESCE(NEW.created_by, 'a0000000-0000-4000-8000-000000000001'::uuid),
    NEW.created_at
  );
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."ensure_v1_history_at_commit"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ensure_v1_history_at_commit"() IS '
WP-A4 Option D rewrite of the S186 deferred trigger function.

To roll back to the S186 design (pre-Option-D), execute:

  CREATE OR REPLACE FUNCTION public.ensure_v1_history_at_commit()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, extensions
  AS $S186$
  DECLARE
    v_v1_exists BOOLEAN;
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM public.content_history
      WHERE content_item_id = NEW.id AND version = 1
    ) INTO v_v1_exists;

    IF v_v1_exists THEN
      RETURN NULL;
    END IF;

    INSERT INTO public.content_history (
      content_item_id, version, title, content,
      brief, detail, reference,
      change_type, change_reason, change_summary,
      metadata, created_by, created_at
    ) VALUES (
      NEW.id, 1,
      COALESCE(NEW.title, ''(untitled)''),
      COALESCE(NEW.content, ''''),
      NEW.brief, NEW.detail, NEW.reference,
      ''create'',
      ''auto_v1_on_insert'',
      ''Auto-created v1 history row (no app-level write detected)'',
      jsonb_build_object(
        ''auto'', true,
        ''via'', ''trigger'',
        ''trigger_name'', ''trg_content_items_ensure_v1_history''
      ),
      COALESCE(NEW.created_by, ''a0000000-0000-4000-8000-000000000001''::uuid),
      NEW.created_at
    );
    RETURN NULL;
  END;
  $S186$;

Then drop the column: ALTER TABLE public.content_items DROP COLUMN ingestion_source;

Note: the literal S186 body above is reconstructed from the migration file
20260422060118_ensure_content_items_v1_history.sql; verify against that
migration before rollback.
';



CREATE OR REPLACE FUNCTION "public"."filter_by_keywords"("search_terms" "text"[]) RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
SELECT id FROM content_items
WHERE (
  SELECT bool_and(
    array_to_string(COALESCE(ai_keywords, '{}'), ' ') ILIKE '%' || kw || '%'
    OR COALESCE(title, '') ILIKE '%' || kw || '%'
    OR COALESCE(summary, '') ILIKE '%' || kw || '%'
    OR COALESCE(author_name, '') ILIKE '%' || kw || '%'
  ) FROM unnest(search_terms) AS kw
);
$$;


ALTER FUNCTION "public"."filter_by_keywords"("search_terms" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text" DEFAULT 'any'::"text") RETURNS SETOF "public"."content_items"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
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
    LANGUAGE "plpgsql"
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


CREATE OR REPLACE FUNCTION "public"."find_exact_duplicates"("p_content_hash" "text", "p_exclude_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "title" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT ci.id, ci.title
  FROM content_items ci
  WHERE ci.content_text_hash = p_content_hash
    AND ci.archived_at IS NULL
    AND (p_exclude_id IS NULL OR ci.id <> p_exclude_id)
  LIMIT 10;
$$;


ALTER FUNCTION "public"."find_exact_duplicates"("p_content_hash" "text", "p_exclude_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_related_items"("p_item_id" "uuid", "p_similarity_threshold" double precision DEFAULT 0.6, "p_limit_count" integer DEFAULT 6) RETURNS TABLE("id" "uuid", "title" "text", "suggested_title" "text", "summary" "text", "primary_domain" "text", "primary_subtopic" "text", "content_type" character varying, "platform" character varying, "author_name" character varying, "source_domain" character varying, "thumbnail_url" "text", "captured_date" timestamp with time zone, "ai_keywords" "text"[], "classification_confidence" double precision, "priority" character varying, "user_tags" "text"[], "similarity" numeric)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  WITH source AS (
    SELECT embedding
    FROM content_items
    WHERE content_items.id = p_item_id
  )
  SELECT
    ci.id,
    ci.title,
    ci.suggested_title,
    ci.summary,
    ci.primary_domain,
    ci.primary_subtopic,
    ci.content_type,
    ci.platform,
    ci.author_name,
    ci.source_domain,
    ci.thumbnail_url,
    ci.captured_date,
    ci.ai_keywords,
    ci.classification_confidence,
    ci.priority,
    ci.user_tags,
    ROUND((1 - (ci.embedding <=> source.embedding))::numeric, 4) AS similarity
  FROM content_items ci, source
  WHERE ci.id != p_item_id
    AND ci.archived_at IS NULL
    AND ci.embedding IS NOT NULL
    AND source.embedding IS NOT NULL
    AND (1 - (ci.embedding <=> source.embedding)) >= p_similarity_threshold
  ORDER BY ci.embedding <=> source.embedding ASC
  LIMIT p_limit_count;
$$;


ALTER FUNCTION "public"."find_related_items"("p_item_id" "uuid", "p_similarity_threshold" double precision, "p_limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_similar_content"("query_embedding" "extensions"."vector", "similarity_threshold" double precision DEFAULT 0.7, "limit_count" integer DEFAULT 10) RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "similarity" numeric, "content_type" character varying, "platform" character varying, "author_name" character varying, "source_domain" character varying)
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


ALTER FUNCTION "public"."find_similar_content"("query_embedding" "extensions"."vector", "similarity_threshold" double precision, "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_similar_content"("query_embedding" "extensions"."vector", "similarity_threshold" numeric DEFAULT 0.5, "limit_count" integer DEFAULT 10) RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "similarity" numeric, "content_type" character varying, "platform" character varying, "author_name" character varying, "source_domain" character varying)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
SELECT ci.id, ci.title, ci.content,
  (1 - (ci.embedding <=> query_embedding))::NUMERIC(4, 3) as similarity,
  ci.content_type, ci.platform, ci.author_name, ci.source_domain
FROM content_items ci
WHERE ci.embedding IS NOT NULL
  AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
ORDER BY ci.embedding <=> query_embedding
LIMIT limit_count;
$$;


ALTER FUNCTION "public"."find_similar_content"("query_embedding" "extensions"."vector", "similarity_threshold" numeric, "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_aggregate_win_rate_stats"() RETURNS TABLE("scope" "text", "total_citations" bigint, "winning_citations" bigint, "losing_citations" bigint, "pending_citations" bigint, "win_rate" numeric, "unique_items_cited" bigint, "unique_bids" bigint)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
$$;


ALTER FUNCTION "public"."get_aggregate_win_rate_stats"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_aggregate_win_rate_stats"() IS 'ID-84.1 (S319) — overall + per-domain citation win-rate aggregator. CTE select/join and two COUNT(DISTINCT ...) refs fixed from the dropped bid_questions.project_id column to workspace_id (T2 rename rot, SQLSTATE 42703). Return shape unchanged; caller app/api/analytics/win-rate.';



CREATE OR REPLACE FUNCTION "public"."get_all_tag_counts"() RETURNS TABLE("tag" "text", "count" bigint, "source" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
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


CREATE OR REPLACE FUNCTION "public"."get_audit_content_items"("p_domain" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 500) RETURNS TABLE("id" "uuid", "title" "text", "suggested_title" "text", "content_type" "text", "primary_domain" "text", "content_length" integer, "summary" "text", "ai_keywords" "text"[], "classification_confidence" double precision, "freshness" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT
    ci.id,
    ci.title,
    ci.suggested_title,
    ci.content_type,
    ci.primary_domain,
    COALESCE(char_length(ci.content), 0)::int AS content_length,
    ci.summary,
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


CREATE OR REPLACE FUNCTION "public"."get_author_analysis"("p_author_name" "text") RETURNS json
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
SELECT json_build_object(
  'author_name', p_author_name,
  'total_items', (SELECT COUNT(*) FROM content_items WHERE author_name ILIKE p_author_name),
  'first_item', (SELECT MIN(captured_date) FROM content_items WHERE author_name ILIKE p_author_name),
  'latest_item', (SELECT MAX(captured_date) FROM content_items WHERE author_name ILIKE p_author_name),
  'avg_confidence', (SELECT ROUND(AVG(classification_confidence)::NUMERIC, 3) FROM content_items
    WHERE author_name ILIKE p_author_name AND classification_confidence IS NOT NULL),
  'domain_breakdown', (
    SELECT json_agg(json_build_object('domain', primary_domain, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT primary_domain, COUNT(*) AS cnt FROM content_items
      WHERE author_name ILIKE p_author_name AND primary_domain IS NOT NULL GROUP BY primary_domain) sub),
  'subtopic_breakdown', (
    SELECT json_agg(json_build_object('subtopic', primary_subtopic, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT primary_subtopic, COUNT(*) AS cnt FROM content_items
      WHERE author_name ILIKE p_author_name AND primary_subtopic IS NOT NULL GROUP BY primary_subtopic) sub),
  'top_keywords', (
    SELECT json_agg(json_build_object('keyword', kw, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT kw, COUNT(*) AS cnt FROM content_items ci, unnest(ci.ai_keywords) AS kw
      WHERE ci.author_name ILIKE p_author_name GROUP BY kw ORDER BY cnt DESC LIMIT 10) sub),
  'content_types', (
    SELECT json_agg(json_build_object('type', content_type, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT content_type, COUNT(*) AS cnt FROM content_items
      WHERE author_name ILIKE p_author_name GROUP BY content_type) sub),
  'recent_items', (
    SELECT json_agg(json_build_object('id', id, 'title', COALESCE(suggested_title, title),
      'content_type', content_type, 'captured_date', captured_date, 'primary_subtopic', primary_subtopic) ORDER BY captured_date DESC)
    FROM (SELECT id, suggested_title, title, content_type, captured_date, primary_subtopic FROM content_items
      WHERE author_name ILIKE p_author_name ORDER BY captured_date DESC LIMIT 5) sub)
);
$$;


ALTER FUNCTION "public"."get_author_analysis"("p_author_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_capture_activity"("days_back" integer DEFAULT 30) RETURNS TABLE("period" timestamp with time zone, "count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
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
    LANGUAGE "sql" STABLE
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


CREATE OR REPLACE FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") RETURNS TABLE("total_citations" bigint, "winning_citations" bigint, "losing_citations" bigint, "pending_citations" bigint, "win_rate" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
$$;


ALTER FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") IS 'ID-84.1 (S319) — per-content-item citation win-rate. CTE join fixed from the dropped bid_questions.project_id column to workspace_id (T2 rename rot, SQLSTATE 42703). Return shape and parameter name unchanged.';



CREATE OR REPLACE FUNCTION "public"."get_coverage_matrix"("p_layer" "text" DEFAULT NULL::"text") RETURNS TABLE("domain_name" "text", "subtopic_name" "text", "item_count" bigint, "fresh_count" bigint, "aging_count" bigint, "stale_count" bigint, "expired_count" bigint)
    LANGUAGE "plpgsql"
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
    AND ci.publication_status = 'published'
    AND (p_layer IS NULL OR ci.layer = p_layer)
  WHERE d.is_active = TRUE
  GROUP BY d.name, s.name, d.display_order, s.display_order
  ORDER BY d.display_order, s.display_order;
END;
$$;


ALTER FUNCTION "public"."get_coverage_matrix"("p_layer" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_coverage_matrix"("p_layer" "text") IS 'S216 W3 §5.2 Phase 3: coverage matrix counts only published items.';



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


ALTER FUNCTION "public"."get_coverage_summary"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_coverage_summary"() IS 'S216 W3 §5.2 Phase 3: coverage summary counts only published items (both sub-query and main-query).';



CREATE OR REPLACE FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text" DEFAULT 'viewer'::"text") RETURNS json
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  result json;
  v_governance_review_count integer := 0;
  v_unverified_count integer;
  v_quality_flag_count integer := 0;
  v_stale_count integer;
  v_expired_count integer;
  v_fresh_count integer;
  v_aging_count integer;
  v_unread_notification_count integer;
  v_expiring_content_date_count integer;
  v_coverage_gap_count integer;
BEGIN
  -- Governance review count (editors + admins only)
  IF p_role IN ('admin', 'editor') THEN
    SELECT COUNT(*) INTO v_governance_review_count
    FROM content_items
    WHERE archived_at IS NULL
      AND governance_review_status = 'pending';

    -- Quality flag count (editors + admins only)
    SELECT COUNT(DISTINCT content_item_id) INTO v_quality_flag_count
    FROM ingestion_quality_log iql
    JOIN content_items ci ON iql.content_item_id = ci.id
    WHERE iql.resolved = FALSE
      AND iql.content_item_id IS NOT NULL
      AND ci.archived_at IS NULL;
  END IF;

  -- Unverified count
  SELECT COUNT(*) INTO v_unverified_count
  FROM content_items
  WHERE archived_at IS NULL
    AND verified_at IS NULL;

  -- Freshness breakdown (single scan)
  SELECT
    COUNT(*) FILTER (WHERE freshness = 'fresh'),
    COUNT(*) FILTER (WHERE freshness = 'aging'),
    COUNT(*) FILTER (WHERE freshness = 'stale'),
    COUNT(*) FILTER (WHERE freshness = 'expired')
  INTO v_fresh_count, v_aging_count, v_stale_count, v_expired_count
  FROM content_items
  WHERE archived_at IS NULL
    AND freshness IS NOT NULL;

  -- Unread notifications
  SELECT COUNT(*) INTO v_unread_notification_count
  FROM notifications
  WHERE user_id = p_user_id
    AND dismissed_at IS NULL
    AND read_at IS NULL
    AND (expires_at IS NULL OR expires_at > NOW());

  -- Expiring content dates (within 30 days)
  SELECT COUNT(*) INTO v_expiring_content_date_count
  FROM content_items
  WHERE archived_at IS NULL
    AND expiry_date IS NOT NULL
    AND expiry_date <= NOW() + INTERVAL '30 days';

  -- Coverage gaps: active subtopics with zero content items
  SELECT COUNT(*) INTO v_coverage_gap_count
  FROM taxonomy_subtopics ts
  WHERE ts.is_active = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM content_items ci
      WHERE ci.primary_subtopic = ts.name
        AND ci.archived_at IS NULL
    );

  SELECT json_build_object(
    'governance_review_count', v_governance_review_count,
    'unverified_count', v_unverified_count,
    'quality_flag_count', v_quality_flag_count,
    'stale_content_count', v_stale_count,
    'expired_content_count', v_expired_count,
    'expiring_content_date_count', v_expiring_content_date_count,
    'unread_notification_count', v_unread_notification_count,
    'coverage_gap_count', v_coverage_gap_count,
    'freshness_summary', json_build_object(
      'fresh', v_fresh_count,
      'aging', v_aging_count,
      'stale', v_stale_count,
      'expired', v_expired_count
    )
  ) INTO result;

  RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_document_version_chain"("p_document_id" "uuid") RETURNS TABLE("id" "uuid", "filename" "text", "original_filename" "text", "mime_type" character varying, "file_size" integer, "content_hash" "text", "version" integer, "parent_id" "uuid", "storage_path" "text", "status" character varying, "uploaded_by" "uuid", "created_at" timestamp with time zone, "content_item_count" bigint)
    LANGUAGE "sql" STABLE
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


CREATE OR REPLACE FUNCTION "public"."get_due_feed_sources"("max_sources" integer DEFAULT 5) RETURNS SETOF "public"."feed_sources"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT *
  FROM feed_sources
  WHERE is_active = true
    AND consecutive_failures < 10
    AND (
      last_polled_at IS NULL
      OR last_polled_at + (
        polling_interval_minutes * POWER(2, LEAST(consecutive_failures, 6))
        || ' minutes'
      )::interval < now()
    )
  ORDER BY last_polled_at ASC NULLS FIRST
  LIMIT max_sources;
$$;


ALTER FUNCTION "public"."get_due_feed_sources"("max_sources" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_entity_co_occurrence"("p_limit" integer DEFAULT 20, "p_min_count" integer DEFAULT 2, "p_entity_type" "text" DEFAULT NULL::"text") RETURNS TABLE("entity_a" "text", "type_a" "text", "entity_b" "text", "type_b" "text", "shared_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  WITH filtered_mentions AS (
    -- Deduplicate: one row per (canonical_name, content_item_id)
    SELECT DISTINCT ON (canonical_name, content_item_id)
      canonical_name,
      COALESCE(entity_type_override, entity_type) AS effective_type,
      content_item_id
    FROM entity_mentions
    WHERE (p_entity_type IS NULL OR entity_type = p_entity_type
           OR entity_type_override = p_entity_type)
  ),
  pairs AS (
    SELECT
      LEAST(a.canonical_name, b.canonical_name) AS entity_a,
      CASE WHEN a.canonical_name < b.canonical_name THEN a.effective_type
           ELSE b.effective_type END AS type_a,
      GREATEST(a.canonical_name, b.canonical_name) AS entity_b,
      CASE WHEN a.canonical_name < b.canonical_name THEN b.effective_type
           ELSE a.effective_type END AS type_b,
      a.content_item_id
    FROM filtered_mentions a
    JOIN filtered_mentions b
      ON a.content_item_id = b.content_item_id
      AND a.canonical_name < b.canonical_name
  )
  SELECT
    p.entity_a,
    p.type_a,
    p.entity_b,
    p.type_b,
    COUNT(DISTINCT p.content_item_id) AS shared_count
  FROM pairs p
  GROUP BY p.entity_a, p.type_a, p.entity_b, p.type_b
  HAVING COUNT(DISTINCT p.content_item_id) >= p_min_count
  ORDER BY shared_count DESC
  LIMIT LEAST(p_limit, 50);
$$;


ALTER FUNCTION "public"."get_entity_co_occurrence"("p_limit" integer, "p_min_count" integer, "p_entity_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_entity_list_aggregated"("p_type" "text" DEFAULT NULL::"text", "p_search" "text" DEFAULT NULL::"text", "p_variants_only" boolean DEFAULT false, "p_type_conflicts" boolean DEFAULT false, "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS json
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  result json;
BEGIN
  WITH entity_agg AS (
    SELECT
      em.canonical_name,
      COALESCE(
        MAX(em.entity_type_override),
        MAX(em.entity_type)
      ) AS effective_type,
      COUNT(*) AS mention_count,
      COUNT(DISTINCT em.entity_name) AS variant_count,
      array_agg(DISTINCT em.entity_name) AS variant_names,
      -- types_seen_count: deduplicated count across both entity_type and
      -- entity_type_override columns. Uses a subquery to UNION the two sources
      -- and COUNT(DISTINCT), matching the JS code's Set-based deduplication.
      (SELECT COUNT(DISTINCT t) FROM (
        SELECT entity_type AS t FROM entity_mentions WHERE canonical_name = em.canonical_name
        UNION
        SELECT entity_type_override FROM entity_mentions WHERE canonical_name = em.canonical_name AND entity_type_override IS NOT NULL
      ) sub) AS types_seen_count,
      array_agg(DISTINCT em.entity_type) ||
        array_agg(DISTINCT em.entity_type_override) FILTER (WHERE em.entity_type_override IS NOT NULL) AS types_seen_raw
    FROM entity_mentions em
    WHERE
      (p_type IS NULL OR em.entity_type = p_type
       OR (em.entity_type_override IS NOT NULL AND em.entity_type_override = p_type)
       OR (em.entity_type_override IS NULL AND em.entity_type = p_type))
      AND (p_search IS NULL OR em.canonical_name ILIKE '%' || p_search || '%')
    GROUP BY em.canonical_name
  ),
  filtered AS (
    SELECT *
    FROM entity_agg ea
    WHERE
      (NOT p_variants_only OR ea.variant_count > 1)
      AND (NOT p_type_conflicts OR ea.types_seen_count > 1)
  ),
  with_rels AS (
    SELECT
      f.*,
      COALESCE(rc.rel_count, 0) AS relationship_count
    FROM filtered f
    LEFT JOIN (
      SELECT entity_name, COUNT(*) AS rel_count
      FROM (
        SELECT source_entity AS entity_name FROM entity_relationships
        WHERE source_entity IN (SELECT canonical_name FROM filtered)
        UNION ALL
        SELECT target_entity AS entity_name FROM entity_relationships
        WHERE target_entity IN (SELECT canonical_name FROM filtered)
      ) combined
      GROUP BY entity_name
    ) rc ON rc.entity_name = f.canonical_name
  ),
  total_count AS (
    SELECT COUNT(*) AS cnt FROM with_rels
  ),
  paged AS (
    SELECT *
    FROM with_rels
    ORDER BY mention_count DESC
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT json_build_object(
    'entities', (
      SELECT COALESCE(json_agg(json_build_object(
        'canonical_name', p.canonical_name,
        'entity_type', p.effective_type,
        'mention_count', p.mention_count,
        'variant_count', p.variant_count,
        'variant_names', p.variant_names,
        'relationship_count', p.relationship_count,
        'has_type_conflict', (p.types_seen_count > 1),
        'types_seen', (
          SELECT array_agg(DISTINCT t)
          FROM unnest(p.types_seen_raw) AS t
          WHERE t IS NOT NULL
        )
      ) ORDER BY p.mention_count DESC), '[]'::json)
      FROM paged p
    ),
    'total', (SELECT cnt FROM total_count)
  ) INTO result;

  RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_entity_list_aggregated"("p_type" "text", "p_search" "text", "p_variants_only" boolean, "p_type_conflicts" boolean, "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_entity_name_counts"() RETURNS TABLE("canonical_name" "text", "mention_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT canonical_name, count(*) as mention_count
  FROM entity_mentions
  GROUP BY canonical_name
  ORDER BY mention_count DESC
  LIMIT 50;
$$;


ALTER FUNCTION "public"."get_entity_name_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") RETURNS TABLE("source_entity" "text", "relationship_type" "text", "target_entity" "text", "source_item_id" "uuid", "confidence" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
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
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
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
    'domain', COALESCE(
      (
        SELECT jsonb_object_agg(primary_domain, cnt)
        FROM (
          SELECT primary_domain, COUNT(*) AS cnt
          FROM content_items
          WHERE primary_domain IS NOT NULL
            AND publication_status = 'published'
          GROUP BY primary_domain
        ) d
      ),
      '{}'::jsonb
    ),
    'content_type', COALESCE(
      (
        SELECT jsonb_object_agg(content_type, cnt)
        FROM (
          SELECT content_type, COUNT(*) AS cnt
          FROM content_items
          WHERE content_type IS NOT NULL
            AND publication_status = 'published'
          GROUP BY content_type
        ) t
      ),
      '{}'::jsonb
    ),
    'platform', COALESCE(
      (
        SELECT jsonb_object_agg(platform, cnt)
        FROM (
          SELECT platform, COUNT(*) AS cnt
          FROM content_items
          WHERE platform IS NOT NULL
            AND publication_status = 'published'
          GROUP BY platform
        ) p
      ),
      '{}'::jsonb
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_filter_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_filter_ratio_trend"("p_workspace_id" "uuid", "p_granularity" "text" DEFAULT 'daily'::"text", "p_period_days" integer DEFAULT 90) RETURNS TABLE("date" "text", "total" bigint, "passed" bigint, "filtered" bigint, "ratio" integer)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT
    CASE WHEN p_granularity = 'weekly'
         THEN date_trunc('week', ingested_at)::date::text
         ELSE date_trunc('day', ingested_at)::date::text
    END AS date,
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE passed)::bigint AS passed,
    COUNT(*) FILTER (WHERE NOT passed)::bigint AS filtered,
    CASE WHEN COUNT(*) > 0
         THEN ROUND(COUNT(*) FILTER (WHERE passed)::numeric / COUNT(*) * 100)::int
         ELSE 0
    END AS ratio
  FROM feed_articles
  WHERE workspace_id = p_workspace_id
    AND ingested_at >= now() - (p_period_days || ' days')::interval
  GROUP BY 1
  ORDER BY 1 ASC;
$$;


ALTER FUNCTION "public"."get_filter_ratio_trend"("p_workspace_id" "uuid", "p_granularity" "text", "p_period_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_form_question_stats"("p_project_id" "uuid") RETURNS TABLE("total_questions" bigint, "strong_match_count" bigint, "partial_match_count" bigint, "needs_sme_count" bigint, "no_content_count" bigint, "unmatched_count" bigint, "drafted_count" bigint, "complete_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT
    COUNT(*)::BIGINT AS total_questions,
    COUNT(*) FILTER (WHERE confidence_posture = 'strong_match')::BIGINT AS strong_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'partial_match')::BIGINT AS partial_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'needs_sme')::BIGINT AS needs_sme_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'no_content')::BIGINT AS no_content_count,
    COUNT(*) FILTER (WHERE confidence_posture IS NULL)::BIGINT AS unmatched_count,
    COUNT(*) FILTER (WHERE status = 'ai_drafted')::BIGINT AS drafted_count,
    COUNT(*) FILTER (WHERE status = 'complete')::BIGINT AS complete_count
  FROM form_questions
  WHERE workspace_id = p_project_id;
$$;


ALTER FUNCTION "public"."get_form_question_stats"("p_project_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_form_question_stats"("p_project_id" "uuid") IS 'ID-84.1 (S319) — single-workspace question-stats aggregator. Body fixed from the dropped bid_questions.project_id column to workspace_id (T2 rename rot, SQLSTATE 42703 since S247 prod-apply). Parameter name p_project_id preserved for caller signature stability (T2 carve-out per no-bid-regression-guard.test.ts).';



CREATE OR REPLACE FUNCTION "public"."get_form_question_stats_batch"("p_project_ids" "uuid"[]) RETURNS TABLE("workspace_id" "uuid", "total_questions" bigint, "strong_match_count" bigint, "partial_match_count" bigint, "needs_sme_count" bigint, "no_content_count" bigint, "unmatched_count" bigint, "drafted_count" bigint, "complete_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT
    bq.workspace_id,
    COUNT(*)::BIGINT AS total_questions,
    COUNT(*) FILTER (WHERE confidence_posture = 'strong_match')::BIGINT AS strong_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'partial_match')::BIGINT AS partial_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'needs_sme')::BIGINT     AS needs_sme_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'no_content')::BIGINT    AS no_content_count,
    COUNT(*) FILTER (WHERE confidence_posture IS NULL)::BIGINT           AS unmatched_count,
    COUNT(*) FILTER (WHERE status = 'ai_drafted')::BIGINT                AS drafted_count,
    COUNT(*) FILTER (WHERE status = 'complete')::BIGINT                  AS complete_count
  FROM form_questions bq
  WHERE bq.workspace_id = ANY(p_project_ids)
  GROUP BY bq.workspace_id;
$$;


ALTER FUNCTION "public"."get_form_question_stats_batch"("p_project_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_form_question_stats_batch"("p_project_ids" "uuid"[]) IS 'ID-22 (S250 WP2) — batch question-stats aggregator. Returns one row per workspace_id (renamed from project_id S250 to align with T2 column rename). Parameter name `p_project_ids` preserved for caller signature stability (T2 carve-out per no-bid-regression-guard.test.ts ALLOWLIST). Pre-S250 function body referenced bq.project_id and silently errored on prod post-T2 (SQLSTATE 42703); this migration fixes both the broken body and the return-shape misalignment.';



CREATE OR REPLACE FUNCTION "public"."get_form_summary"("bid_workspace_id" "uuid") RETURNS json
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT json_build_object(
    'workspace_id', bid_workspace_id,
    'total_questions', (SELECT COUNT(*) FROM form_questions WHERE workspace_id = bid_workspace_id),
    'status_breakdown', (
      SELECT json_agg(json_build_object('status', status, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT status, COUNT(*) AS cnt FROM form_questions WHERE workspace_id = bid_workspace_id GROUP BY status) sub),
    'confidence_breakdown', (
      SELECT json_agg(json_build_object('posture', confidence_posture, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT confidence_posture, COUNT(*) AS cnt FROM form_questions
        WHERE workspace_id = bid_workspace_id AND confidence_posture IS NOT NULL GROUP BY confidence_posture) sub),
    'responses_count', (
      SELECT COUNT(*) FROM form_responses br JOIN form_questions bq ON bq.id = br.question_id WHERE bq.workspace_id = bid_workspace_id),
    'review_status_breakdown', (
      SELECT json_agg(json_build_object('status', review_status, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT br.review_status, COUNT(*) AS cnt FROM form_responses br
        JOIN form_questions bq ON bq.id = br.question_id WHERE bq.workspace_id = bid_workspace_id GROUP BY br.review_status) sub),
    'sections', (
      SELECT json_agg(json_build_object('section', section_name, 'question_count', cnt, 'completed', completed_cnt) ORDER BY min_seq)
      FROM (SELECT bq.section_name, COUNT(*) AS cnt, COUNT(*) FILTER (WHERE bq.status = 'complete') AS completed_cnt,
        MIN(bq.section_sequence) AS min_seq FROM form_questions bq WHERE bq.workspace_id = bid_workspace_id GROUP BY bq.section_name) sub)
  );
$$;


ALTER FUNCTION "public"."get_form_summary"("bid_workspace_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_form_summary"("bid_workspace_id" "uuid") IS 'ID-84.1 (S319) — workspace rollup JSON. Six body sites fixed from the dropped bid_questions.project_id column to workspace_id (T2 rename rot, SQLSTATE 42703). No current rpc() call-sites (ops43 audit) — redefined for catalogue hygiene and prod parity.';



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
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
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
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."get_guide_content"("p_guide_slug" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_guide_content"("p_guide_slug" "text") IS 'S216 W3 §5.2 Phase 3: guide content surfaces only published items.';



CREATE OR REPLACE FUNCTION "public"."get_guide_coverage"() RETURNS TABLE("guide_id" "uuid", "guide_name" "text", "guide_slug" "text", "guide_type" "text", "domain_filter" "text", "section_id" "uuid", "section_name" "text", "section_order" integer, "expected_layer" "text", "is_required" boolean, "content_count" bigint, "fresh_count" bigint, "stale_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."get_guide_coverage"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_guide_coverage"() IS 'S216 W3 §5.2 Phase 3: guide coverage rollups count only published items.';



CREATE OR REPLACE FUNCTION "public"."get_item_workspaces"("p_item_id" "uuid") RETURNS SETOF "public"."workspaces"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT w.* FROM workspaces w
  JOIN content_item_workspaces ciw ON ciw.workspace_id = w.id
  WHERE ciw.content_item_id = p_item_id AND w.is_archived = false
  ORDER BY w.name;
$$;


ALTER FUNCTION "public"."get_item_workspaces"("p_item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_items_with_quality_flags"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE
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


CREATE OR REPLACE FUNCTION "public"."get_popular_keywords"("p_limit" integer DEFAULT 10) RETURNS TABLE("keyword" "text", "item_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
SELECT kw AS keyword, COUNT(*) AS item_count FROM content_items, unnest(ai_keywords) AS kw
WHERE ai_keywords IS NOT NULL GROUP BY kw ORDER BY item_count DESC LIMIT p_limit;
$$;


ALTER FUNCTION "public"."get_popular_keywords"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_quality_issue_counts"() RETURNS TABLE("flag_type" "text", "severity" "text", "open_count" bigint)
    LANGUAGE "sql" STABLE
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


CREATE OR REPLACE FUNCTION "public"."get_reading_patterns"("p_days" integer DEFAULT 30) RETURNS json
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
SELECT json_build_object(
  'period_days', p_days,
  'total_items', (SELECT COUNT(*) FROM content_items WHERE captured_date >= NOW() - (p_days || ' days')::INTERVAL),
  'items_read', (SELECT COUNT(DISTINCT rm.content_item_id) FROM read_marks rm
    JOIN content_items ci ON ci.id = rm.content_item_id WHERE rm.read_at >= NOW() - (p_days || ' days')::INTERVAL),
  'reading_velocity', (SELECT ROUND(COUNT(DISTINCT rm.content_item_id)::NUMERIC / GREATEST(p_days, 1), 1)
    FROM read_marks rm WHERE rm.read_at >= NOW() - (p_days || ' days')::INTERVAL),
  'domain_reading', (
    SELECT json_agg(json_build_object('domain', domain, 'total', total, 'read', read_count,
      'read_pct', CASE WHEN total > 0 THEN ROUND(read_count::NUMERIC / total * 100, 1) ELSE 0 END) ORDER BY total DESC)
    FROM (SELECT ci.primary_domain AS domain, COUNT(*) AS total, COUNT(rm.id) AS read_count
      FROM content_items ci LEFT JOIN read_marks rm ON ci.id = rm.content_item_id
      WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL AND ci.primary_domain IS NOT NULL
      GROUP BY ci.primary_domain) sub),
  'type_reading', (
    SELECT json_agg(json_build_object('type', content_type, 'total', total, 'read', read_count) ORDER BY total DESC)
    FROM (SELECT ci.content_type, COUNT(*) AS total, COUNT(rm.id) AS read_count
      FROM content_items ci LEFT JOIN read_marks rm ON ci.id = rm.content_item_id
      WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL GROUP BY ci.content_type) sub),
  'daily_reading', (
    SELECT json_agg(json_build_object('date', read_date, 'count', cnt) ORDER BY read_date DESC)
    FROM (SELECT DATE(rm.read_at) AS read_date, COUNT(*) AS cnt FROM read_marks rm
      WHERE rm.read_at >= NOW() - (p_days || ' days')::INTERVAL GROUP BY DATE(rm.read_at) ORDER BY read_date DESC) sub)
);
$$;


ALTER FUNCTION "public"."get_reading_patterns"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_review_breakdown_stats"() RETURNS json
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."get_review_breakdown_stats"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_review_breakdown_stats"() IS 'S216 W3 §5.2 Phase 3: review breakdown stats per §5.3.1 — six !=draft rewrites + one =draft rewrite (publication_status); overdue branch UNTOUCHED (cadence concern).';



CREATE OR REPLACE FUNCTION "public"."get_source_documents"() RETURNS TABLE("source_document" "text", "count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
    SELECT source_document, COUNT(*) as count FROM content_items
    WHERE source_document IS NOT NULL GROUP BY source_document ORDER BY count DESC;
$$;


ALTER FUNCTION "public"."get_source_documents"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tag_counts_filtered"("p_type" "text", "p_min_count" integer DEFAULT 1, "p_search" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("tag" "text", "count" bigint, "source" "text", "total_count" bigint)
    LANGUAGE "plpgsql"
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
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
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
    SET "search_path" TO 'public', 'extensions'
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


CREATE OR REPLACE FUNCTION "public"."get_top_authors"("p_limit" integer DEFAULT 8) RETURNS TABLE("author_name" "text", "item_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
SELECT author_name::TEXT, COUNT(*) AS item_count FROM content_items
WHERE author_name IS NOT NULL AND author_name != '' GROUP BY author_name ORDER BY item_count DESC LIMIT p_limit;
$$;


ALTER FUNCTION "public"."get_top_authors"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_topic_deep_dive"("p_keyword" "text") RETURNS json
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
SELECT json_build_object(
  'keyword', p_keyword,
  'total_items', (SELECT COUNT(*) FROM content_items WHERE ai_keywords @> ARRAY[lower(p_keyword)]),
  'domain_distribution', (
    SELECT json_agg(json_build_object('domain', primary_domain, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT primary_domain, COUNT(*) AS cnt FROM content_items
      WHERE ai_keywords @> ARRAY[lower(p_keyword)] AND primary_domain IS NOT NULL GROUP BY primary_domain) sub),
  'top_authors', (
    SELECT json_agg(json_build_object('author', author_name, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT author_name, COUNT(*) AS cnt FROM content_items
      WHERE ai_keywords @> ARRAY[lower(p_keyword)] AND author_name IS NOT NULL AND author_name != ''
      GROUP BY author_name ORDER BY cnt DESC LIMIT 10) sub),
  'timeline', (
    SELECT json_agg(json_build_object('month', month, 'count', cnt) ORDER BY month DESC)
    FROM (SELECT date_trunc('month', captured_date) AS month, COUNT(*) AS cnt FROM content_items
      WHERE ai_keywords @> ARRAY[lower(p_keyword)] GROUP BY month ORDER BY month DESC LIMIT 12) sub),
  'co_occurring_keywords', (
    SELECT json_agg(json_build_object('keyword', co_kw, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT kw AS co_kw, COUNT(*) AS cnt FROM content_items ci, unnest(ci.ai_keywords) AS kw
      WHERE ci.ai_keywords @> ARRAY[lower(p_keyword)] AND kw != lower(p_keyword)
      GROUP BY kw ORDER BY cnt DESC LIMIT 15) sub),
  'recent_items', (
    SELECT json_agg(json_build_object('id', id, 'title', COALESCE(suggested_title, title),
      'content_type', content_type, 'author_name', author_name, 'captured_date', captured_date) ORDER BY captured_date DESC)
    FROM (SELECT id, suggested_title, title, content_type, author_name, captured_date FROM content_items
      WHERE ai_keywords @> ARRAY[lower(p_keyword)] ORDER BY captured_date DESC LIMIT 10) sub)
);
$$;


ALTER FUNCTION "public"."get_topic_deep_dive"("p_keyword" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_topic_layers"("p_topic_id" "text") RETURNS TABLE("id" "uuid", "title" "text", "content_type" "text", "primary_domain" "text", "metadata" "jsonb", "layer" "text")
    LANGUAGE "sql" STABLE
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


CREATE OR REPLACE FUNCTION "public"."get_trend_analysis"("p_days" integer DEFAULT 30, "p_min_count" integer DEFAULT 2) RETURNS TABLE("keyword" "text", "current_count" bigint, "previous_count" bigint, "growth_rate" numeric, "domains" "text"[])
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
SELECT kw AS keyword,
  COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL) AS current_count,
  COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL
    AND ci.captured_date < NOW() - (p_days || ' days')::INTERVAL) AS previous_count,
  CASE WHEN COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL
    AND ci.captured_date < NOW() - (p_days || ' days')::INTERVAL) = 0 THEN NULL
  ELSE ROUND(
    (COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL)::NUMERIC -
     COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL
       AND ci.captured_date < NOW() - (p_days || ' days')::INTERVAL)::NUMERIC) /
    COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL
      AND ci.captured_date < NOW() - (p_days || ' days')::INTERVAL)::NUMERIC * 100, 1)
  END AS growth_rate,
  array_agg(DISTINCT ci.primary_domain) FILTER (WHERE ci.primary_domain IS NOT NULL
    AND ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL) AS domains
FROM content_items ci, unnest(ci.ai_keywords) AS kw
WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL AND ci.ai_keywords IS NOT NULL
GROUP BY kw
HAVING COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL) >= p_min_count
ORDER BY current_count DESC, growth_rate DESC NULLS LAST;
$$;


ALTER FUNCTION "public"."get_trend_analysis"("p_days" integer, "p_min_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unique_authors"() RETURNS TABLE("author_name" "text", "count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
SELECT ci.author_name, COUNT(*) as count FROM content_items ci
WHERE ci.author_name IS NOT NULL AND ci.author_name != '' GROUP BY ci.author_name ORDER BY count DESC;
$$;


ALTER FUNCTION "public"."get_unique_authors"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_display_names"("user_ids" "uuid"[]) RETURNS TABLE("user_id" "uuid", "display_name" "text")
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  -- C-1 invariant (carried forward from S156 WP-2 + WP-G3.4 Batch 2):
  -- project `req.id` from `unnest(user_ids)`, NOT `up.id` from the LEFT
  -- JOIN. With LEFT JOIN, `up.id` is NULL when the requested UUID has
  -- no user_profiles row — without this discipline:
  --   1. Unknown UUIDs would return user_id = NULL and silently disappear
  --      at the TypeScript wrapper (`Map.set(row.user_id, ...)` would
  --      collide on key NULL).
  --   2. The pipeline service-account branch would fail to fire when the
  --      pipeline user is missing from user_profiles (partial backfill).
  --
  -- B-strict change (OPS-60): email column removed from RETURNS and from
  -- the SELECT projection; email-prefix fallback removed from COALESCE.
  -- New COALESCE chain: user_roles.display_name → user_profiles.full_name
  -- → 'A team member'. Pipeline-system special-case unchanged.
  RETURN QUERY
  SELECT
    req.id AS user_id,
    CASE
      WHEN req.id = 'a0000000-0000-4000-8000-000000000001'::uuid
        THEN 'Pipeline (system)'::text
      ELSE COALESCE(
        NULLIF(ur.display_name, ''),
        NULLIF(up.full_name, ''),
        'A team member'
      )
    END AS display_name
  FROM unnest(user_ids) AS req(id)
  LEFT JOIN public.user_profiles up ON up.id = req.id
  LEFT JOIN public.user_roles    ur ON ur.user_id = req.id;
END;
$$;


ALTER FUNCTION "public"."get_user_display_names"("user_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_display_names"("user_ids" "uuid"[]) IS 'Batch-resolve user UUIDs to display names. Returns one row per input UUID. Pipeline service account gets the hardcoded label ''Pipeline (system)''. Reads from public.user_profiles + public.user_roles. SECURITY INVOKER (kh-prod-readiness-S34 OPS-60 Option B-strict — email column dropped from return + body fallback; permissive RLS user_profiles_authenticated_lookup_select gates the SELECT). Used by /api/users/display-names, /api/content-owners/stats, /api/admin/provenance/export/verification-history, lib/reorient.ts:resolveDisplayNames, lib/provenance/item-provenance.ts. Originally S156 WP-2; rewritten WP-G3.4 Batch 2 to drop auth.users dep; flipped to INVOKER under OPS-60.';



CREATE OR REPLACE FUNCTION "public"."get_user_role"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


CREATE OR REPLACE FUNCTION "public"."get_user_tag_counts"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
SELECT COALESCE(jsonb_object_agg(tag, cnt), '{}'::jsonb)
FROM (SELECT tag, COUNT(*) as cnt FROM content_items ci, unnest(ci.user_tags) AS tag
  WHERE user_tags IS NOT NULL AND user_tags != '{}' GROUP BY tag ORDER BY cnt DESC) sub;
$$;


ALTER FUNCTION "public"."get_user_tag_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_verification_stats"() RETURNS json
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total', COUNT(*),
        'verified', COUNT(*) FILTER (WHERE verified_at IS NOT NULL),
        'unverified', COUNT(*) FILTER (WHERE verified_at IS NULL),
        'recent_7d', COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days'),
        'domains', (SELECT json_agg(json_build_object('domain', primary_domain, 'count', cnt))
            FROM (SELECT primary_domain, COUNT(*) as cnt FROM content_items
              WHERE primary_domain IS NOT NULL GROUP BY primary_domain ORDER BY cnt DESC) d)
    ) INTO result FROM content_items;
    RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_verification_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_workspace_counts"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
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
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT w.id AS workspace_id, COUNT(ciw.id) AS item_count,
    MAX(ciw.assigned_at) AS last_activity
  FROM workspaces w
  LEFT JOIN content_item_workspaces ciw ON ciw.workspace_id = w.id
  GROUP BY w.id;
$$;


ALTER FUNCTION "public"."get_workspace_item_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."grant_standard_public_table_access"("target_table" "regclass") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
BEGIN
  EXECUTE format('GRANT SELECT ON %s TO anon', target_table);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO authenticated', target_table);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO service_role', target_table);
  RAISE LOG 'grant_standard_public_table_access: granted on %', target_table;
END;
$$;


ALTER FUNCTION "public"."grant_standard_public_table_access"("target_table" "regclass") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."grant_standard_public_table_access"("target_table" "regclass") IS 'Applies standard 3-role grants (anon SELECT; authenticated + service_role full CRUD) on a new public.* table. Source: docs/plans/phase-0-investigation/supabase-db-action-items.md Item 1 (May 30 platform compliance — new public.* tables are NOT exposed to Data API without explicit grants). New table migrations should call SELECT grant_standard_public_table_access(''public.my_table''::regclass) after CREATE TABLE.';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  -- (1) Preserve S157 user_roles seed behaviour. Same body as the old
  --     handle_new_user_role (pre_squash_reconciliation.sql:2517-2520).
  INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'viewer')
    ON CONFLICT (user_id) DO NOTHING;

  -- (2) New: populate the user_profiles mirror.
  INSERT INTO public.user_profiles (id, email, full_name)
    VALUES (
      NEW.id,
      NEW.email,
      NEW.raw_user_meta_data ->> 'full_name'
    )
    ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."handle_new_user"() IS 'Consolidated AFTER INSERT trigger function on auth.users. Seeds public.user_roles (viewer default) AND public.user_profiles (mirror row). Replaces standalone handle_new_user_role per WP-G3.4 (kh-prod-readiness-S8). Spec: docs/audits/kh-production-readiness-phase-1/specs/wp-g3.4-user-profiles-spec-v1.md §4.3. RPC-exposure intentionally REVOKEd; triggers fire via owner privileges.';



CREATE OR REPLACE FUNCTION "public"."handle_user_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  UPDATE public.user_profiles
     SET email      = NEW.email,
         full_name  = NEW.raw_user_meta_data ->> 'full_name',
         updated_at = now()
   WHERE id = NEW.id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_user_update"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."handle_user_update"() IS 'AFTER UPDATE trigger function on auth.users. Mirrors email + full_name + updated_at into public.user_profiles. WP-G3.4 (kh-prod-readiness-S8). Spec §4.5. RPC-exposure intentionally REVOKEd; triggers fire via owner privileges.';



CREATE OR REPLACE FUNCTION "public"."hook_restrict_signup_to_allowed_domain"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  email text;
  domain text;
  allowed text;
BEGIN
  SELECT lower(nullif(trim(coalesce(allowed_domain, '')), ''))
    INTO allowed
    FROM public.signup_policy
    LIMIT 1;

  IF allowed IS NULL THEN
    -- Fail closed: wired restriction with no configured domain rejects rather
    -- than silently permitting any address.
    RETURN jsonb_build_object('error', jsonb_build_object(
      'message', 'Sign-up is currently unavailable: the allowed email domain is not configured.',
      'http_code', 403));
  END IF;

  email := coalesce(event->'user'->>'email', '');
  domain := lower(split_part(email, '@', 2));

  IF domain = allowed THEN
    RETURN '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object('error', jsonb_build_object(
    'message', format('Please sign up with your @%s email address.', allowed),
    'http_code', 403));
END;
$$;


ALTER FUNCTION "public"."hook_restrict_signup_to_allowed_domain"("event" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hybrid_search"("query_embedding" "extensions"."vector", "query_text" "text" DEFAULT ''::"text", "similarity_threshold" numeric DEFAULT 0.3, "limit_count" integer DEFAULT 10, "include_superseded" boolean DEFAULT false, "visibility_filter" character varying DEFAULT 'default'::character varying) RETURNS TABLE("id" "uuid", "title" "text", "suggested_title" "text", "summary" "text", "primary_domain" "text", "primary_subtopic" "text", "content_type" "text", "platform" "text", "author_name" "text", "source_domain" "text", "thumbnail_url" "text", "captured_date" timestamp with time zone, "ai_keywords" "text"[], "classification_confidence" numeric, "priority" "text", "metadata" "jsonb", "similarity" numeric, "snippet" "text", "created_by" "uuid", "verified_at" timestamp with time zone, "verified_by" "uuid")
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
$$;


ALTER FUNCTION "public"."hybrid_search"("query_embedding" "extensions"."vector", "query_text" "text", "similarity_threshold" numeric, "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."hybrid_search"("query_embedding" "extensions"."vector", "query_text" "text", "similarity_threshold" numeric, "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying) IS 'S216 W3 §5.2 Phase 3 + ID-197: hybrid full-text + vector search with visibility_filter. default=published-only, all=non-archived, admin=all states. Preserves include_superseded orthogonally. ID-197 fixes the win_stats JOIN column bq.project_id -> bq.workspace_id (T2/S246 rename, SQLSTATE 42703).';



CREATE OR REPLACE FUNCTION "public"."list_public_tables"() RETURNS SETOF "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT tablename::text
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT LIKE E'\\_%' ESCAPE E'\\'
  ORDER BY tablename;
$$;


ALTER FUNCTION "public"."list_public_tables"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_public_tables"() IS 'WP-G3.5 auto-inventory RPC consumed by scripts/db-row-count-diff.ts default invocation. Returns sorted public-schema table names excluding leading-underscore helpers (e.g. _backup_*, _test_*). SECURITY INVOKER; read-only on visible system catalogs.';



CREATE OR REPLACE FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
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



CREATE OR REPLACE FUNCTION "public"."merge_item_metadata"("p_item_id" "uuid", "p_new_data" "jsonb") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  UPDATE content_items
  SET metadata = COALESCE(metadata, '{}'::jsonb) || p_new_data,
      updated_at = now()
  WHERE id = p_item_id;
$$;


ALTER FUNCTION "public"."merge_item_metadata"("p_item_id" "uuid", "p_new_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."merge_tags"("p_source" "text", "p_target" "text", "p_type" "text") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
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


CREATE OR REPLACE FUNCTION "public"."q_a_extractions_promotion_candidates"() RETURNS SETOF "public"."q_a_extractions"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT e.*
  FROM public.q_a_extractions e
  LEFT JOIN public.q_a_pairs p ON p.id = e.promoted_to_pair_id
  WHERE e.invalidated_at IS NULL
    AND (
      e.promoted_to_pair_id IS NULL
      OR (p.id IS NOT NULL AND p.question_embedding IS NULL)
    )
  ORDER BY e.created_at;
$$;


ALTER FUNCTION "public"."q_a_extractions_promotion_candidates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."q_a_get_verbatim"("p_pair_id" "uuid") RETURNS TABLE("id" "uuid", "question_text" "text", "alternate_question_phrasings" "text"[], "answer_standard" "text", "answer_advanced" "text", "scope_tag" "text"[], "anti_scope_tag" "text"[], "source_workspace_id" "uuid", "origin_kind" "text", "publication_status" "text", "superseded_by" "uuid", "valid_from" timestamp with time zone, "valid_to" timestamp with time zone, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."q_a_get_verbatim"("p_pair_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."q_a_get_verbatim"("p_pair_id" "uuid") IS 'T6 WP2 — PLAN.md §4.6 sub-task 4. Two-step retrieval Step 2: full q_a_pair row for a specific pair_id. question_embedding deliberately excluded (payload-size discipline per S16 §6.1). No publication_status filter — caller may fetch any lifecycle state including superseded/archived (lineage resolution).';



CREATE OR REPLACE FUNCTION "public"."q_a_pairs_history_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_next_version integer;
BEGIN
  -- Only fire on UPDATE (guard belt-and-suspenders; trigger is AFTER UPDATE)
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Compute next sequential version for this q_a_pair_id
  SELECT COALESCE(MAX(version), 0) + 1
    INTO v_next_version
    FROM public.q_a_pair_history
   WHERE q_a_pair_id = OLD.id;

  -- Insert OLD row snapshot into history
  -- (incl. bl-74 superseded_by + source_workspace_id AND ID-59 edit_intent)
  INSERT INTO public.q_a_pair_history (
    q_a_pair_id,
    version,
    question_text,
    alternate_question_phrasings,
    answer_standard,
    answer_advanced,
    scope_tag,
    anti_scope_tag,
    origin_kind,
    publication_status,
    superseded_by,
    source_workspace_id,
    edit_intent,
    valid_from,
    valid_to,
    changed_at,
    changed_by
  ) VALUES (
    OLD.id,
    v_next_version,
    OLD.question_text,
    OLD.alternate_question_phrasings,
    OLD.answer_standard,
    OLD.answer_advanced,
    OLD.scope_tag,
    OLD.anti_scope_tag,
    OLD.origin_kind,
    OLD.publication_status,
    OLD.superseded_by,
    OLD.source_workspace_id,
    OLD.edit_intent,
    OLD.valid_from,
    OLD.valid_to,
    now(),
    auth.uid()
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."q_a_pairs_history_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."q_a_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer DEFAULT 20) RETURNS TABLE("pair_id" "uuid", "question_text_preview" "text", "answer_standard_preview" "text", "embedding_score" numeric, "fulltext_score" numeric, "scope_tag" "text"[], "publication_status" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."q_a_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."q_a_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer) IS 'T6 WP2 — PLAN.md §4.6 sub-task 4. Two-step retrieval Step 1: ranked preview list. Returns embedding_score + fulltext_score as SEPARATE columns per N9 RESOLVED-S236 (05-qa-flow.md §7.3). Scope filtering is caller-side (scope_tag pass-through). Internal ORDER BY uses weighted blend embedding*0.6 + fulltext*0.4 but that blend is NOT returned — callers see raw scores and apply own blend/display policy.';



CREATE OR REPLACE FUNCTION "public"."question_match_recompute"("p_form_question_id" "uuid", "p_query" "text", "p_query_embedding" "extensions"."vector", "p_question_kind" "text", "p_scope_tag" "text"[], "p_anti_scope_tag" "text"[], "p_limit" integer DEFAULT 20) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_count integer;
BEGIN
  WITH scored AS (
    -- The live scoring expression (mirrors q_a_search verbatim). This is the ONLY place
    -- re-scoring happens; the reader (question_match_search) consumes the stored result.
    SELECT
      qap.id AS q_a_pair_id,
      (1.0 - (qap.question_embedding <=> p_query_embedding))::numeric(5,4) AS embedding_score,
      ts_rank(
        to_tsvector('english',
          qap.question_text || ' ' || COALESCE(qap.answer_standard, '') || ' ' ||
          array_to_string(qap.alternate_question_phrasings, ' ')),
        plainto_tsquery('english', p_query),
        2  -- bl-76 calibration anchor (F1/D3); changing the flag never alters the table (F3)
      )::numeric(5,4) AS fulltext_score
    FROM public.q_a_pairs qap
    WHERE qap.question_embedding IS NOT NULL        -- B6 embedding-eligibility
      AND qap.publication_status = 'published'      -- B6 publication gate
      AND qap.scope_tag && p_scope_tag                       -- B5 scope overlap
      AND NOT (qap.anti_scope_tag && p_scope_tag)            -- B5 anti-scope exclusion
  ),
  ranked AS (
    SELECT s.q_a_pair_id, s.embedding_score, s.fulltext_score
    FROM scored s
    -- D4 default blend selects the top-N to materialise; C3 deterministic tie-break.
    ORDER BY (s.embedding_score * 0.6 + s.fulltext_score * 0.4) DESC, s.q_a_pair_id
    LIMIT p_limit
  ),
  upserted AS (
    INSERT INTO public.question_matches
      (form_question_id, q_a_pair_id, question_kind, embedding_score, fulltext_score, matched_at)
    SELECT p_form_question_id, r.q_a_pair_id, p_question_kind,
           r.embedding_score, r.fulltext_score, now()
    FROM ranked r
    ON CONFLICT (form_question_id, q_a_pair_id) DO UPDATE
      SET embedding_score = EXCLUDED.embedding_score,
          fulltext_score  = EXCLUDED.fulltext_score,
          matched_at      = now(),
          updated_at      = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upserted;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."question_match_recompute"("p_form_question_id" "uuid", "p_query" "text", "p_query_embedding" "extensions"."vector", "p_question_kind" "text", "p_scope_tag" "text"[], "p_anti_scope_tag" "text"[], "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."question_match_search"("p_form_question_id" "uuid", "p_question_kind" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 20) RETURNS TABLE("q_a_pair_id" "uuid", "question_text_preview" "text", "answer_standard_preview" "text", "embedding_score" numeric, "fulltext_score" numeric, "scope_tag" "text"[], "publication_status" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  -- Reads the MATERIALISED candidate edges for this form-question (05-qa-flow.md §7.2:
  -- question_matches RECORDS the ranked candidates). Returns the STORED per-method scores;
  -- no live re-scoring. The join to q_a_pairs supplies preview + pass-through columns only.
  SELECT
    qm.q_a_pair_id,
    LEFT(qap.question_text, 200)                 AS question_text_preview,
    LEFT(COALESCE(qap.answer_standard, ''), 200) AS answer_standard_preview,
    qm.embedding_score,                          -- STORED score (set by the writer, §E)
    qm.fulltext_score,                           -- STORED score (set by the writer, §E)
    qap.scope_tag,
    qap.publication_status
  FROM public.question_matches qm
  JOIN public.q_a_pairs qap ON qap.id = qm.q_a_pair_id
  WHERE qm.form_question_id = p_form_question_id                 -- C1: candidates FOR this fq
    AND (p_question_kind IS NULL OR qm.question_kind = p_question_kind)
    AND qap.publication_status = 'published'      -- B6 re-checked at read (no stale surfacing)
  -- D4 default ranking/blend over the STORED scores; C3 deterministic tie-break.
  ORDER BY (COALESCE(qm.embedding_score, 0) * 0.6 + COALESCE(qm.fulltext_score, 0) * 0.4) DESC,
           qm.q_a_pair_id
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."question_match_search"("p_form_question_id" "uuid", "p_question_kind" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reap_stuck_jobs"("p_timeout_seconds" integer) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  reaped_count integer;
BEGIN
  WITH reaped AS (
    UPDATE public.processing_queue
    SET status = 'pending',
        attempts = attempts + 1
    WHERE status = 'processing'
      AND started_at < NOW() - make_interval(secs => p_timeout_seconds)
    RETURNING id
  )
  SELECT count(*)::integer INTO reaped_count FROM reaped;
  RETURN reaped_count;
END;
$$;


ALTER FUNCTION "public"."reap_stuck_jobs"("p_timeout_seconds" integer) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."reference_get_verbatim"("p_reference_id" "uuid") RETURNS TABLE("id" "uuid", "title" "text", "body" "text", "summary" "text", "source_url" "text", "published_at" timestamp with time zone, "primary_domain" "text", "primary_subtopic" "text", "layer" "text", "source_document_id" "uuid", "ingestion_source" "text", "op_id" "uuid", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."reference_get_verbatim"("p_reference_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reference_get_verbatim"("p_reference_id" "uuid") IS 'ID-75 M2 — TECH.md §3 WP-B. Two-step retrieval Step 2: full reference_items row for a specific reference_id. embedding deliberately excluded (AI-consumer-first payload discipline, BI-16). MCP tool design over this RPC belongs to ID-71.';



CREATE OR REPLACE FUNCTION "public"."reference_ingest"("p_source_url" "text", "p_title" "text", "p_body" "text", "p_summary" "text", "p_primary_domain" "text", "p_primary_subtopic" "text", "p_embedding" "extensions"."vector", "p_published_at" timestamp with time zone, "p_filename" "text", "p_mime_type" "text", "p_file_size" integer, "p_content_hash" "text", "p_extraction_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_op_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("reference_id" "uuid", "source_document_id" "uuid", "title" "text", "summary" "text", "source_url" "text", "primary_domain" "text", "primary_subtopic" "text", "already_existed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  -- Server-side uuid5 PKs. Namespace pinned to the Python pipeline constant
  -- _KH_PIPELINE_DOC_NS (flow.py:1601) for cross-path identity parity (flow.py:2710-2712).
  v_sd_id    uuid := extensions.uuid_generate_v5(
    'fbfaf1ff-1ee4-583c-9757-1674465b2ec1'::uuid, 'sd:' || p_source_url);
  v_ri_id    uuid := extensions.uuid_generate_v5(
    'fbfaf1ff-1ee4-583c-9757-1674465b2ec1'::uuid, 'ri:' || p_source_url);
  v_existing uuid;
BEGIN
  -- Idempotency (PRODUCT §2.1/§2.2): if the reference already exists, return it with
  -- already_existed = true and write NOTHING. Deterministic PK + UNIQUE(source_url)
  -- make a repeat ingest of the same URL a no-op converge.
  SELECT ri.id INTO v_existing FROM public.reference_items ri WHERE ri.id = v_ri_id;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY
      SELECT ri.id, ri.source_document_id, ri.title, ri.summary, ri.source_url,
             ri.primary_domain, ri.primary_subtopic, true
      FROM public.reference_items ri
      WHERE ri.id = v_ri_id;
    RETURN;
  END IF;

  -- Atomicity (PRODUCT §4.6): the PL/pgSQL body runs in the caller's transaction; an
  -- exception on either INSERT rolls back both — no orphaned provenance row. sd FIRST
  -- (FK target: reference_items.source_document_id NOT NULL REFERENCES ... ON DELETE
  -- RESTRICT), then ri.
  INSERT INTO public.source_documents (
    id, filename, original_filename, mime_type, file_size, content_hash,
    storage_path, source_url, status, extraction_method, extraction_metadata, op_id)
  VALUES (
    v_sd_id, p_filename, p_filename, p_mime_type, p_file_size, p_content_hash,
    p_source_url,            -- storage_path = source_url for URL-sourced provenance (feed-path parity)
    p_source_url,
    'processed',             -- body extracted synchronously; no async processing follows (CHECK admits)
    NULL,                    -- extraction_method NULL (ID-42 CHECK rejects readability/unpdf — OQ-B)
    p_extraction_metadata,   -- true producer recorded here, not the CHECKed column
    p_op_id)
  ON CONFLICT (id) DO NOTHING;  -- belt-and-braces idempotency vs a concurrent identical-URL race

  INSERT INTO public.reference_items (
    id, title, body, summary, source_url, published_at, primary_domain,
    primary_subtopic, layer, embedding, source_document_id, ingestion_source, op_id)
  VALUES (
    v_ri_id, p_title, p_body, p_summary, p_source_url, p_published_at, p_primary_domain,
    p_primary_subtopic,
    'research',              -- v1 layer constant (validated by trg_validate_reference_items_layer)
    p_embedding, v_sd_id,
    'url_import',            -- CHECK already admits this value (ID-75 schema)
    p_op_id)
  ON CONFLICT (id) DO NOTHING;  -- belt-and-braces idempotency vs the same concurrent race

  RETURN QUERY
    SELECT ri.id, ri.source_document_id, ri.title, ri.summary, ri.source_url,
           ri.primary_domain, ri.primary_subtopic, false
    FROM public.reference_items ri
    WHERE ri.id = v_ri_id;
END;
$$;


ALTER FUNCTION "public"."reference_ingest"("p_source_url" "text", "p_title" "text", "p_body" "text", "p_summary" "text", "p_primary_domain" "text", "p_primary_subtopic" "text", "p_embedding" "extensions"."vector", "p_published_at" timestamp with time zone, "p_filename" "text", "p_mime_type" "text", "p_file_size" integer, "p_content_hash" "text", "p_extraction_metadata" "jsonb", "p_op_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reference_ingest"("p_source_url" "text", "p_title" "text", "p_body" "text", "p_summary" "text", "p_primary_domain" "text", "p_primary_subtopic" "text", "p_embedding" "extensions"."vector", "p_published_at" timestamp with time zone, "p_filename" "text", "p_mime_type" "text", "p_file_size" integer, "p_content_hash" "text", "p_extraction_metadata" "jsonb", "p_op_id" "uuid") IS 'ID-110 {110.5} — TECH.md §1. Owner-gated single write seam for the manual single-URL reference ingest. Atomically lands the source_documents + reference_items evidence pair for one normalised URL, minting both PKs server-side as uuid5 (namespace fbfaf1ff-1ee4-583c-9757-1674465b2ec1, parity with the Python feed path flow.py:1601). extraction_method written NULL (ID-42 CHECK rejects readability/unpdf); true producer in extraction_metadata. Idempotent: a repeat URL returns already_existed=true and writes nothing. Keeps reference_items write-policy-free (ID-75 BI-16).';



CREATE OR REPLACE FUNCTION "public"."reference_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer DEFAULT 20) RETURNS TABLE("reference_id" "uuid", "title" "text", "summary_preview" "text", "body_preview" "text", "embedding_score" numeric, "fulltext_score" numeric, "source_url" "text", "published_at" timestamp with time zone, "primary_domain" "text", "primary_subtopic" "text", "layer" "text", "ingestion_source" "text", "source_document_id" "uuid")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."reference_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reference_search"("p_query" "text", "p_query_embedding" "extensions"."vector", "p_limit" integer) IS 'ID-75 M2 — TECH.md §3 WP-B. Two-step retrieval Step 1: ranked preview list over reference_items. Returns embedding_score + fulltext_score as SEPARATE columns per N9 RESOLVED-S236 (q_a_search precedent). Internal ORDER BY uses weighted blend embedding*0.6 + fulltext*0.4 but that blend is NOT returned — callers see raw scores and apply own blend/display policy. Never blends reference rows into content_items/q_a_pairs results (BI-16 two-surface separation).';



CREATE OR REPLACE FUNCTION "public"."rename_tag"("p_old" "text", "p_new" "text", "p_type" "text") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
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


CREATE OR REPLACE FUNCTION "public"."resolve_near_dup_confirm_unique"("p_left_id" "uuid", "p_right_id" "uuid", "p_actor_user_id" "uuid", "p_pair_id" "text", "p_note" "text" DEFAULT NULL::"text", "p_similarity_at_resolution" numeric DEFAULT NULL::numeric, "p_threshold_at_resolution" numeric DEFAULT NULL::numeric) RETURNS TABLE("id" "uuid", "dedup_status" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_flipped uuid[];
BEGIN
  -- Idempotent: only flip rows not already in confirmed_unique
  WITH updated AS (
    UPDATE content_items
       SET dedup_status = 'confirmed_unique'
     WHERE content_items.id IN (p_left_id, p_right_id)
       AND content_items.dedup_status <> 'confirmed_unique'
    RETURNING content_items.id
  )
  SELECT array_agg(updated.id) INTO v_flipped FROM updated;

  -- Insert one history snapshot row per actually-flipped member.
  -- Matches v1 column list verbatim — `content_history` requires
  -- title/content/change_type/created_by NOT NULL plus change_reason
  -- (CLAUDE.md gotcha: content_history inserts must include change_reason).
  IF v_flipped IS NOT NULL THEN
    INSERT INTO content_history (
      content_item_id,
      version,
      title,
      content,
      brief,
      detail,
      reference,
      metadata,
      change_type,
      change_summary,
      change_reason,
      created_by
    )
    SELECT
      ci.id,
      COALESCE(
        (SELECT max(ch.version) FROM content_history ch WHERE ch.content_item_id = ci.id),
        0
      ) + 1,
      COALESCE(ci.title, ci.suggested_title, 'Untitled'),
      COALESCE(ci.content, ''),
      ci.brief,
      ci.detail,
      ci.reference,
      jsonb_build_object(
        'pairId', p_pair_id,
        'peerId', CASE WHEN ci.id = p_left_id THEN p_right_id ELSE p_left_id END,
        'note', p_note,
        'similarity_at_resolution', p_similarity_at_resolution,
        'threshold_at_resolution', p_threshold_at_resolution,
        'dedup_review_action', 'confirm_unique'
      ),
      'metadata_change',
      CASE
        WHEN p_note IS NOT NULL AND length(p_note) > 0
          THEN 'Confirmed unique via admin near-dup review: ' || p_note
        ELSE 'Confirmed unique via admin near-dup review'
      END,
      'dedup_admin_review_near_dup_confirmed_unique',
      p_actor_user_id
    FROM content_items ci
    WHERE ci.id = ANY(v_flipped);
  END IF;

  RETURN QUERY
    SELECT content_items.id, content_items.dedup_status::text
      FROM content_items
     WHERE content_items.id IN (p_left_id, p_right_id);
END;
$$;


ALTER FUNCTION "public"."resolve_near_dup_confirm_unique"("p_left_id" "uuid", "p_right_id" "uuid", "p_actor_user_id" "uuid", "p_pair_id" "text", "p_note" "text", "p_similarity_at_resolution" numeric, "p_threshold_at_resolution" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_near_dup_confirm_unique"("p_left_id" "uuid", "p_right_id" "uuid", "p_actor_user_id" "uuid", "p_pair_id" "text", "p_note" "text", "p_similarity_at_resolution" numeric, "p_threshold_at_resolution" numeric) IS '§1.9 near-dup confirm-unique transactional flip with OQ2 audit context. Sets dedup_status=confirmed_unique on each pair member that is not already confirmed_unique, plus matching content_history snapshot rows in the same transaction. Records similarity_at_resolution + threshold_at_resolution in metadata. Idempotent. Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §5.6, §11 OQ2.';



CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
       AND cmd.schema_name IN ('public')
       AND cmd.schema_name NOT IN ('pg_catalog', 'information_schema')
       AND cmd.schema_name NOT LIKE 'pg_toast%'
       AND cmd.schema_name NOT LIKE 'pg_temp%'
    THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    ELSE
      RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
                cmd.object_identity, cmd.schema_name;
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rls_auto_enable"() IS 'Auto-enables RLS on new public.* tables via DDL event trigger. Source: docs/plans/phase-0-investigation/supabase-db-action-items.md Item 2. Lockstep with grant_standard_public_table_access for May 30 platform compliance.';



CREATE OR REPLACE FUNCTION "public"."run_quality_scan"("p_batch_name" "text" DEFAULT ('quality-scan-'::"text" || "to_char"("now"(), 'YYYYMMDD-HH24MISS'::"text"))) RETURNS TABLE("issue_type" "text", "items_found" bigint, "flags_created" bigint)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
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


CREATE OR REPLACE FUNCTION "public"."search_content"("query_embedding" "extensions"."vector", "similarity_threshold" double precision DEFAULT 0.3, "limit_count" integer DEFAULT 50) RETURNS TABLE("id" "uuid", "title" "text", "suggested_title" "text", "summary" "text", "primary_domain" character varying, "primary_subtopic" character varying, "content_type" character varying, "platform" character varying, "author_name" character varying, "source_domain" character varying, "thumbnail_url" "text", "captured_date" timestamp with time zone, "ai_keywords" "text"[], "classification_confidence" numeric, "similarity" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT ci.id, ci.title, ci.suggested_title, ci.summary,
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


ALTER FUNCTION "public"."search_content"("query_embedding" "extensions"."vector", "similarity_threshold" double precision, "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_content"("query_embedding" "extensions"."vector", "similarity_threshold" numeric DEFAULT 0.35, "limit_count" integer DEFAULT 30) RETURNS TABLE("id" "uuid", "title" "text", "suggested_title" "text", "summary" "text", "primary_domain" character varying, "primary_subtopic" character varying, "content_type" character varying, "platform" character varying, "author_name" character varying, "source_domain" character varying, "thumbnail_url" "text", "captured_date" timestamp with time zone, "ai_keywords" "text"[], "classification_confidence" numeric, "similarity" numeric)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
SELECT ci.id, ci.title, ci.suggested_title, ci.summary,
  ci.primary_domain, ci.primary_subtopic, ci.content_type, ci.platform,
  ci.author_name, ci.source_domain, ci.thumbnail_url, ci.captured_date,
  ci.ai_keywords, ci.classification_confidence,
  (1 - (ci.embedding <=> query_embedding))::NUMERIC(4, 3) AS similarity
FROM content_items ci
WHERE ci.embedding IS NOT NULL
  AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
ORDER BY ci.embedding <=> query_embedding
LIMIT limit_count;
$$;


ALTER FUNCTION "public"."search_content"("query_embedding" "extensions"."vector", "similarity_threshold" numeric, "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_content_chunks"("query_embedding" "extensions"."vector", "similarity_threshold" numeric DEFAULT 0.3, "limit_count" integer DEFAULT 20, "filter_content_item_id" "uuid" DEFAULT NULL::"uuid", "filter_overdue_review" boolean DEFAULT NULL::boolean, "filter_review_due_within_days" integer DEFAULT NULL::integer, "visibility_filter" character varying DEFAULT 'default'::character varying) RETURNS TABLE("chunk_id" "uuid", "content_item_id" "uuid", "item_title" "text", "item_suggested_title" "text", "item_content_type" "text", "item_primary_domain" "text", "item_primary_subtopic" "text", "heading_text" "text", "heading_level" smallint, "heading_path" "text"[], "content" "text", "position" smallint, "char_count" integer, "word_count" integer, "similarity" numeric)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
$$;


ALTER FUNCTION "public"."search_content_chunks"("query_embedding" "extensions"."vector", "similarity_threshold" numeric, "limit_count" integer, "filter_content_item_id" "uuid", "filter_overdue_review" boolean, "filter_review_due_within_days" integer, "visibility_filter" character varying) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."search_content_chunks"("query_embedding" "extensions"."vector", "similarity_threshold" numeric, "limit_count" integer, "filter_content_item_id" "uuid", "filter_overdue_review" boolean, "filter_review_due_within_days" integer, "visibility_filter" character varying) IS 'S216 W3 §5.2 Phase 3: chunk search with visibility_filter (orthogonal to §5.5 review-cadence filters). default=published-only, all=non-archived, admin=all states.';



CREATE OR REPLACE FUNCTION "public"."search_for_form_response"("query_embedding" "extensions"."vector", "query_text" "text" DEFAULT ''::"text", "limit_count" integer DEFAULT 10, "include_superseded" boolean DEFAULT false, "visibility_filter" character varying DEFAULT 'default'::character varying) RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "brief" "text", "detail" "text", "primary_domain" character varying, "primary_subtopic" character varying, "content_type" character varying, "ai_keywords" "text"[], "similarity" numeric)
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
$$;


ALTER FUNCTION "public"."search_for_form_response"("query_embedding" "extensions"."vector", "query_text" "text", "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."search_for_form_response"("query_embedding" "extensions"."vector", "query_text" "text", "limit_count" integer, "include_superseded" boolean, "visibility_filter" character varying) IS 'ID-64.14 (renamed from search_for_bid_response): form-response search with visibility_filter. default=published-only, all=non-archived, admin=all states. Body references renamed tables form_responses/form_questions; cc.bid_response_id retained (content_citations excluded from rename per ID-58/T11).';



CREATE OR REPLACE FUNCTION "public"."set_classification_disputes_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_classification_disputes_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_config"("setting" "text", "value" "text", "is_local" boolean) RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT pg_catalog.set_config(setting, value, is_local);
$$;


ALTER FUNCTION "public"."set_config"("setting" "text", "value" "text", "is_local" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snapshot_form_response_history"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  IF OLD.response_text IS DISTINCT FROM NEW.response_text
     OR OLD.response_text_advanced IS DISTINCT FROM NEW.response_text_advanced
     OR OLD.metadata IS DISTINCT FROM NEW.metadata THEN

    INSERT INTO form_response_history (
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


ALTER FUNCTION "public"."snapshot_form_response_history"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."suggest_tags"("p_prefix" "text", "p_type" "text") RETURNS TABLE("tag" "text", "count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
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


CREATE OR REPLACE FUNCTION "public"."toggle_star"("item_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."toggle_star"("item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."toggle_star"("p_item_id" "uuid", "p_starred" boolean) RETURNS "void"
    LANGUAGE "sql"
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
$$;


ALTER FUNCTION "public"."update_citation_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_notification_prefs_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_user_notification_prefs_updated_at"() OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."ai_call_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "touchpoint_id" "text" NOT NULL,
    "model" "text" NOT NULL,
    "tier" "text" NOT NULL,
    "input_tokens" integer DEFAULT 0 NOT NULL,
    "output_tokens" integer DEFAULT 0 NOT NULL,
    "cache_read_tokens" integer DEFAULT 0 NOT NULL,
    "cache_write_tokens" integer DEFAULT 0 NOT NULL,
    "cost_usd" numeric(12,6) DEFAULT 0 NOT NULL,
    "outcome_signal" "public"."outcome_signal" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_call_events_cache_read_tokens_check" CHECK (("cache_read_tokens" >= 0)),
    CONSTRAINT "ai_call_events_cache_write_tokens_check" CHECK (("cache_write_tokens" >= 0)),
    CONSTRAINT "ai_call_events_cost_usd_check" CHECK (("cost_usd" >= (0)::numeric)),
    CONSTRAINT "ai_call_events_input_tokens_check" CHECK (("input_tokens" >= 0)),
    CONSTRAINT "ai_call_events_output_tokens_check" CHECK (("output_tokens" >= 0))
);


ALTER TABLE "public"."ai_call_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."ai_call_events" IS 'ID-104 T15 — persisted per-AI-call cost + outcome_signal substrate (recordAiCall, T14). outcome_signal = ratified enum win|fail|loop|refusal. Feeds the cost-tab rollup (T17). Tenant-safe + admin read; NEVER egresses off-platform (B-INV-15). FK → eval_touchpoints.';



CREATE OR REPLACE VIEW "api"."ai_call_events" WITH ("security_invoker"='true') AS
 SELECT "id",
    "touchpoint_id",
    "model",
    "tier",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "cost_usd",
    "outcome_signal",
    "created_at"
   FROM "public"."ai_call_events";


ALTER VIEW "api"."ai_call_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."application_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "provenance" "text" DEFAULT 'core'::"text" NOT NULL,
    "default_icon" "text",
    "default_colour" "text",
    "state_machine_config" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "label_plural" "text",
    "description" "text",
    CONSTRAINT "application_types_provenance_check" CHECK (("provenance" = ANY (ARRAY['core'::"text", 'client'::"text", 'recommended'::"text"])))
);


ALTER TABLE "public"."application_types" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."application_types" WITH ("security_invoker"='true') AS
 SELECT "id",
    "key",
    "label",
    "provenance",
    "default_icon",
    "default_colour",
    "state_machine_config",
    "created_at",
    "updated_at",
    "label_plural",
    "description"
   FROM "public"."application_types";


ALTER VIEW "api"."application_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."change_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "frequency" character varying DEFAULT 'weekly'::character varying NOT NULL,
    "period_start" timestamp with time zone NOT NULL,
    "period_end" timestamp with time zone NOT NULL,
    "item_count" integer DEFAULT 0 NOT NULL,
    "domain_summaries" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "narrative_summary" "text",
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "generated_by" character varying DEFAULT 'claude-sonnet'::character varying NOT NULL,
    "tokens_used" integer,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "item_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "created_by" "uuid"
);


ALTER TABLE "public"."change_reports" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."change_reports" WITH ("security_invoker"='true') AS
 SELECT "id",
    "frequency",
    "period_start",
    "period_end",
    "item_count",
    "domain_summaries",
    "narrative_summary",
    "generated_at",
    "generated_by",
    "tokens_used",
    "metadata",
    "created_at",
    "item_ids",
    "created_by"
   FROM "public"."change_reports";


ALTER VIEW "api"."change_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."citations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "citing_kind" "public"."citing_entity_kind" DEFAULT 'form_response'::"public"."citing_entity_kind" NOT NULL,
    "citing_form_response_id" "uuid",
    "cited_kind" "public"."cited_target_kind" NOT NULL,
    "cited_content_item_id" "uuid",
    "cited_q_a_pair_id" "uuid",
    "cited_version" integer,
    "cited_q_a_pair_version" integer,
    "citation_type" "text" DEFAULT 'reference'::"text" NOT NULL,
    "cited_text" "text",
    "cited_location_kind" "text",
    "cited_start" integer,
    "cited_end" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "citations_citation_type_chk" CHECK (("citation_type" = ANY (ARRAY['reference'::"text", 'copied'::"text", 'adapted'::"text", 'inspired'::"text"]))),
    CONSTRAINT "citations_cited_location_kind_chk" CHECK (("cited_location_kind" = ANY (ARRAY['block'::"text", 'char'::"text", 'page'::"text"]))),
    CONSTRAINT "citations_cited_one_of_chk" CHECK (((("cited_kind" = 'content_item'::"public"."cited_target_kind") AND ("cited_content_item_id" IS NOT NULL) AND ("cited_q_a_pair_id" IS NULL)) OR (("cited_kind" = 'q_a_pair'::"public"."cited_target_kind") AND ("cited_q_a_pair_id" IS NOT NULL) AND ("cited_content_item_id" IS NULL)))),
    CONSTRAINT "citations_citing_one_of_chk" CHECK ((("citing_kind" = 'form_response'::"public"."citing_entity_kind") AND ("citing_form_response_id" IS NOT NULL)))
);


ALTER TABLE "public"."citations" OWNER TO "postgres";


COMMENT ON TABLE "public"."citations" IS 'ID-58 polymorphic citations: replaces content_citations. cited side = content_item|q_a_pair (q_a_pair DORMANT v1, bl-74); citing side = form_response. Version-on-cite + span anchoring (D-S330-1).';



CREATE OR REPLACE VIEW "api"."citations" WITH ("security_invoker"='true') AS
 SELECT "id",
    "citing_kind",
    "citing_form_response_id",
    "cited_kind",
    "cited_content_item_id",
    "cited_q_a_pair_id",
    "cited_version",
    "cited_q_a_pair_version",
    "citation_type",
    "cited_text",
    "cited_location_kind",
    "cited_start",
    "cited_end",
    "created_at",
    "created_by"
   FROM "public"."citations";


ALTER VIEW "api"."citations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."classification_disputes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_item_id" "uuid" NOT NULL,
    "disputed_by" "uuid",
    "disputed_field" "text" NOT NULL,
    "current_value" "jsonb" DEFAULT 'null'::"jsonb" NOT NULL,
    "proposed_value" "jsonb",
    "rationale" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "resolution_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "classification_disputes_disputed_field_check" CHECK (("disputed_field" = ANY (ARRAY['primary_domain'::"text", 'primary_subtopic'::"text", 'secondary_domain'::"text", 'secondary_subtopic'::"text", 'primary_layer'::"text", 'content_type'::"text", 'entity_type'::"text"]))),
    CONSTRAINT "classification_disputes_rationale_check" CHECK (("length"(TRIM(BOTH FROM "rationale")) >= 10)),
    CONSTRAINT "classification_disputes_resolution_complete" CHECK (((("status" = 'open'::"text") AND ("resolved_by" IS NULL) AND ("resolved_at" IS NULL)) OR (("status" = ANY (ARRAY['resolved'::"text", 'rejected'::"text"])) AND ("resolved_by" IS NOT NULL) AND ("resolved_at" IS NOT NULL)))),
    CONSTRAINT "classification_disputes_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'resolved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."classification_disputes" OWNER TO "postgres";


COMMENT ON TABLE "public"."classification_disputes" IS 'User/admin disputes of classification decisions. Wave A stub tab; Wave C HITL workflow.';



COMMENT ON COLUMN "public"."classification_disputes"."disputed_by" IS 'Disputing user. Nullable so auth.users purges succeed; NULL indicates a purged user. INSERT RLS enforces non-null at write time.';



COMMENT ON COLUMN "public"."classification_disputes"."current_value" IS 'JSONB snapshot of the disputed classification at dispute-creation time; shape depends on disputed_field.';



COMMENT ON COLUMN "public"."classification_disputes"."proposed_value" IS 'Optional user-proposed correction; JSONB shape mirrors current_value.';



CREATE OR REPLACE VIEW "api"."classification_disputes" WITH ("security_invoker"='true') AS
 SELECT "id",
    "content_item_id",
    "disputed_by",
    "disputed_field",
    "current_value",
    "proposed_value",
    "rationale",
    "status",
    "resolved_by",
    "resolved_at",
    "resolution_notes",
    "created_at",
    "updated_at"
   FROM "public"."classification_disputes";


ALTER VIEW "api"."classification_disputes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" character varying NOT NULL,
    "description" "text",
    "website_url" "text",
    "sectors" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "services" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "certifications" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "geographic_scope" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "competitors" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "target_customers" "text",
    "value_proposition" "text",
    "key_topics" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "company_embedding" "text",
    "is_primary" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."company_profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."company_profiles"."company_embedding" IS 'JSON-serialised embedding vector for relevance pre-filter caching. Set to null when profile is updated to trigger re-generation.';



COMMENT ON COLUMN "public"."company_profiles"."is_primary" IS 'When true, this profile represents the organisation itself (app-wide grounding). At most one row may be primary and active (enforced by partial unique index). SI workspaces may reference any active profile via domain_metadata.company_profile_id.';



CREATE OR REPLACE VIEW "api"."company_profiles" WITH ("security_invoker"='true') AS
 SELECT "id",
    "name",
    "slug",
    "description",
    "website_url",
    "sectors",
    "services",
    "certifications",
    "geographic_scope",
    "competitors",
    "target_customers",
    "value_proposition",
    "key_topics",
    "is_active",
    "created_at",
    "updated_at",
    "created_by",
    "company_embedding",
    "is_primary"
   FROM "public"."company_profiles";


ALTER VIEW "api"."company_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_chunks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_item_id" "uuid" NOT NULL,
    "heading_text" "text",
    "heading_level" smallint,
    "heading_path" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "content" "text" NOT NULL,
    "position" smallint NOT NULL,
    "parent_chunk_id" "uuid",
    "embedding" "extensions"."vector"(1024),
    "char_count" integer DEFAULT 0 NOT NULL,
    "word_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "op_id" "uuid"
);


ALTER TABLE "public"."content_chunks" OWNER TO "postgres";


COMMENT ON COLUMN "public"."content_chunks"."op_id" IS 'Cocoindex per-flow op_id stamped by the chunking stage; ID-56.6 (extends docs/specs/cocoindex-flow-scaffolding/TECH.md §P-4 pattern to content_chunks per OQ-CMI-56-1 (c) S276).';



CREATE OR REPLACE VIEW "api"."content_chunks" WITH ("security_invoker"='true') AS
 SELECT "id",
    "content_item_id",
    "heading_text",
    "heading_level",
    "heading_path",
    "content",
    "position",
    "parent_chunk_id",
    "embedding",
    "char_count",
    "word_count",
    "created_at",
    "updated_at",
    "op_id"
   FROM "public"."content_chunks";


ALTER VIEW "api"."content_chunks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_item_id" "uuid",
    "version" integer NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "brief" "text",
    "detail" "text",
    "reference" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "change_summary" "text",
    "change_type" character varying NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "change_reason" "text",
    "edit_intent" "text",
    "arbitration_inputs" "jsonb",
    CONSTRAINT "content_history_change_type_check" CHECK ((("change_type")::"text" = ANY (ARRAY['create'::"text", 'edit'::"text", 'ai_update'::"text", 'import'::"text", 'merge'::"text", 'rollback'::"text", 'archive'::"text", 'delete'::"text", 'metadata_change'::"text", 'owner_change'::"text", 'publication_state'::"text"]))),
    CONSTRAINT "content_history_edit_intent_check" CHECK (("edit_intent" = ANY (ARRAY['cosmetic'::"text", 'data'::"text", 'structural'::"text"])))
);


ALTER TABLE "public"."content_history" OWNER TO "postgres";


COMMENT ON COLUMN "public"."content_history"."change_reason" IS 'Why this version was created (S152B WP3). Free-text convention; see docs/reference/data-entry-points.md for the canonical enum-like values (initial_ingest, reclassify, entity_enrichment, template_coverage_refresh, source_document_accepted, owner_change, rollback_to_v<N>). NULL is acceptable when the caller did not supply a reason (e.g. admin UI edit with empty reason field) — distinct from change_summary which captures WHAT changed, and from change_type which categorises the change.';



COMMENT ON COLUMN "public"."content_history"."edit_intent" IS 'Post-arbitration edit intent (S234 ONT.14 closed CV cosmetic|data|structural). Gates next-walk re-classification per 02-data-flow §8.2. App-written only; NEVER pipeline-written. Write-only-forward — pre-edit-feature history rows legitimately NULL (no backfill).';



COMMENT ON COLUMN "public"."content_history"."arbitration_inputs" IS 'Per-actor inputs when a CRDT merge arbitrated >1 intent: jsonb array of {actor: uuid, intent: text}. NULL for single-actor saves. Forensic reconstruction of the arbitration (INV-13).';



CREATE OR REPLACE VIEW "api"."content_history" WITH ("security_invoker"='true') AS
 SELECT "id",
    "content_item_id",
    "version",
    "title",
    "content",
    "brief",
    "detail",
    "reference",
    "metadata",
    "change_summary",
    "change_type",
    "created_by",
    "created_at",
    "change_reason",
    "edit_intent",
    "arbitration_inputs"
   FROM "public"."content_history";


ALTER VIEW "api"."content_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_item_workspaces" (
    "content_item_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"(),
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);


ALTER TABLE "public"."content_item_workspaces" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."content_item_workspaces" WITH ("security_invoker"='true') AS
 SELECT "content_item_id",
    "workspace_id",
    "assigned_at",
    "id"
   FROM "public"."content_item_workspaces";


ALTER VIEW "api"."content_item_workspaces" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."content_items" WITH ("security_invoker"='true') AS
 SELECT "id",
    "title",
    "content",
    "content_type",
    "platform",
    "source_url",
    "author_name",
    "metadata",
    "embedding",
    "starred",
    "quality_score",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "brief",
    "detail",
    "reference",
    "source_domain",
    "thumbnail_url",
    "file_path",
    "primary_domain",
    "primary_subtopic",
    "secondary_domain",
    "secondary_subtopic",
    "classification_confidence",
    "classified_at",
    "classification_reasoning",
    "suggested_title",
    "summary",
    "ai_keywords",
    "summary_data",
    "user_tags",
    "priority",
    "captured_date",
    "freshness",
    "freshness_checked_at",
    "lifecycle_type",
    "expiry_date",
    "previous_freshness",
    "verified_at",
    "verified_by",
    "governance_review_status",
    "governance_review_due",
    "governance_reviewer_id",
    "answer_standard",
    "answer_advanced",
    "archived_at",
    "archived_by",
    "archive_reason",
    "content_owner_id",
    "source_document_id",
    "quality_score_updated_at",
    "previous_quality_score",
    "citation_count",
    "source_file",
    "layer",
    "content_text_hash",
    "classification_model",
    "embedding_model",
    "dedup_status",
    "superseded_by",
    "next_review_date",
    "review_cadence_days",
    "publication_status",
    "ingestion_source",
    "op_id"
   FROM "public"."content_items";


ALTER VIEW "api"."content_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_propagation_version" (
    "payload_key" "text" NOT NULL,
    "version" bigint NOT NULL,
    "payload_checksum" "text" NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."content_propagation_version" OWNER TO "postgres";


COMMENT ON TABLE "public"."content_propagation_version" IS 'Per-client ledger of canonical-payload versions applied to THIS database by the one-way PI-18 propagation worker. One row per payload_key (the source table name). Service-role-only: the worker upserts by payload_key out-of-band; deny-all for anon/authenticated. No client literal.';



CREATE OR REPLACE VIEW "api"."content_propagation_version" WITH ("security_invoker"='true') AS
 SELECT "payload_key",
    "version",
    "payload_checksum",
    "applied_at"
   FROM "public"."content_propagation_version";


ALTER VIEW "api"."content_propagation_version" OWNER TO "postgres";


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



CREATE OR REPLACE VIEW "api"."coverage_targets" WITH ("security_invoker"='true') AS
 SELECT "id",
    "domain_id",
    "metric_name",
    "target_value",
    "created_by",
    "updated_by",
    "created_at",
    "updated_at"
   FROM "public"."coverage_targets";


ALTER VIEW "api"."coverage_targets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."entity_aliases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "alias" character varying NOT NULL,
    "canonical" character varying NOT NULL,
    "provenance" "text" DEFAULT 'core'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "entity_aliases_provenance_check" CHECK (("provenance" = ANY (ARRAY['core'::"text", 'client'::"text", 'recommended'::"text"])))
);


ALTER TABLE "public"."entity_aliases" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."entity_aliases" WITH ("security_invoker"='true') AS
 SELECT "id",
    "alias",
    "canonical",
    "provenance",
    "is_active",
    "created_at"
   FROM "public"."entity_aliases";


ALTER VIEW "api"."entity_aliases" OWNER TO "postgres";


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
    "op_id" "uuid",
    CONSTRAINT "entity_mentions_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))),
    CONSTRAINT "entity_mentions_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['organisation'::"text", 'certification'::"text", 'regulation'::"text", 'framework'::"text", 'capability'::"text", 'person'::"text", 'technology'::"text", 'project'::"text", 'sector'::"text", 'product'::"text", 'standard'::"text", 'methodology'::"text"])))
);


ALTER TABLE "public"."entity_mentions" OWNER TO "postgres";


COMMENT ON TABLE "public"."entity_mentions" IS 'Entities extracted from content items by AI classification';



COMMENT ON COLUMN "public"."entity_mentions"."entity_name" IS 'Original entity name as found in text';



COMMENT ON COLUMN "public"."entity_mentions"."canonical_name" IS 'Normalised form for deduplication (e.g. "ISO 27001" not "ISO27001")';



COMMENT ON COLUMN "public"."entity_mentions"."context_snippet" IS 'Short excerpt showing where the entity was found';



COMMENT ON COLUMN "public"."entity_mentions"."entity_type_override" IS 'Admin-set entity type that overrides AI-extracted type. NULL = use entity_type.';



COMMENT ON COLUMN "public"."entity_mentions"."normalisation_version" IS 'Version of canonicalise() rules applied. Allows selective re-normalisation.';



COMMENT ON COLUMN "public"."entity_mentions"."metadata" IS 'Structured metadata for entity-level properties. For certifications: version, issuing_body, expiry_date, scope, certificate_number, holder. For frameworks: round, status, expiry_date, lot, supplier_id.';



COMMENT ON COLUMN "public"."entity_mentions"."op_id" IS 'KH-generated per-run op_id, written as a declare_row field at UPSERT time per N7 hybrid (02-data-flow.md §5). Round-trip: pipeline_runs.op_id. Required for Stage-5 op_id-scoped UPDATEs per PRODUCT.md Inv-5. Mirrors T8 pattern at 20260521203414_t8_op_id_propagation.sql.';



CREATE OR REPLACE VIEW "api"."entity_mentions" WITH ("security_invoker"='true') AS
 SELECT "id",
    "content_item_id",
    "entity_type",
    "entity_name",
    "canonical_name",
    "confidence",
    "context_snippet",
    "created_at",
    "entity_type_override",
    "normalisation_version",
    "metadata",
    "op_id"
   FROM "public"."entity_mentions";


ALTER VIEW "api"."entity_mentions" OWNER TO "postgres";


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



CREATE OR REPLACE VIEW "api"."entity_relationships" WITH ("security_invoker"='true') AS
 SELECT "id",
    "source_entity",
    "relationship_type",
    "target_entity",
    "source_item_id",
    "confidence",
    "created_at"
   FROM "public"."entity_relationships";


ALTER VIEW "api"."entity_relationships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."eval_baseline_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "touchpoint_id" "text" NOT NULL,
    "action" "text" NOT NULL,
    "actor" "text" NOT NULL,
    "registry_version" integer NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."eval_baseline_audit" OWNER TO "postgres";


COMMENT ON TABLE "public"."eval_baseline_audit" IS 'ID-104 T12 — append-only baseline lifecycle audit (who/when/which registry_version). One row per promoteBaseline action (B-INV-12). FK → eval_touchpoints. Admin read; admin write.';



CREATE OR REPLACE VIEW "api"."eval_baseline_audit" WITH ("security_invoker"='true') AS
 SELECT "id",
    "touchpoint_id",
    "action",
    "actor",
    "registry_version",
    "at"
   FROM "public"."eval_baseline_audit";


ALTER VIEW "api"."eval_baseline_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."eval_baselines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "touchpoint_id" "text" NOT NULL,
    "metrics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "thresholds" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "registry_version" integer NOT NULL,
    "promoted_by" "text" NOT NULL,
    "promoted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."eval_baselines" OWNER TO "postgres";


COMMENT ON TABLE "public"."eval_baselines" IS 'ID-104 T11 — DB-backed per-touchpoint eval baseline (metrics + thresholds), replacing the legacy flat-JSON store (B-INV-11). Latest promoted_at row = active baseline; prior rows = baselineHistory. FK → eval_touchpoints. Admin read; promote = admin write.';



CREATE OR REPLACE VIEW "api"."eval_baselines" WITH ("security_invoker"='true') AS
 SELECT "id",
    "touchpoint_id",
    "metrics",
    "thresholds",
    "registry_version",
    "promoted_by",
    "promoted_at"
   FROM "public"."eval_baselines";


ALTER VIEW "api"."eval_baselines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."eval_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "touchpoint_id" "text" NOT NULL,
    "metrics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "passed" boolean NOT NULL,
    "severity_disposition" "text" NOT NULL,
    "exit_class" smallint NOT NULL,
    "run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" NOT NULL,
    CONSTRAINT "eval_runs_exit_class_check" CHECK (("exit_class" = ANY (ARRAY[0, 1, 2]))),
    CONSTRAINT "eval_runs_severity_disposition_check" CHECK (("severity_disposition" = ANY (ARRAY['block'::"text", 'warn'::"text", 'info'::"text", 'infra'::"text"]))),
    CONSTRAINT "eval_runs_source_check" CHECK (("source" = ANY (ARRAY['nightly'::"text", 'ci'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."eval_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."eval_runs" IS 'ID-104 T9 — uniform eval-runner result per touchpoint execution. exit_class is the runner 0/1/2 class (B-INV-9/10); source = nightly|ci|manual. FK → eval_touchpoints. Admin read; writer = service/runner role.';



CREATE OR REPLACE VIEW "api"."eval_runs" WITH ("security_invoker"='true') AS
 SELECT "id",
    "touchpoint_id",
    "metrics",
    "passed",
    "severity_disposition",
    "exit_class",
    "run_at",
    "source"
   FROM "public"."eval_runs";


ALTER VIEW "api"."eval_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."eval_touchpoints" (
    "touchpoint_id" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "owner" "text" NOT NULL,
    "suite_name" "text" NOT NULL,
    "grounding_shape" "text" NOT NULL,
    "severity_on_fail" "text" NOT NULL,
    "variance_band" numeric DEFAULT 0.02 NOT NULL,
    "graduation_metric" "text",
    "contract_version" integer DEFAULT 1 NOT NULL,
    "registry_version" integer DEFAULT 1 NOT NULL,
    "file_sha256" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "eval_touchpoints_grounding_shape_check" CHECK (("grounding_shape" = ANY (ARRAY['structured_output'::"text", 'forced_tool_strict'::"text", 'citations'::"text", 'n/a'::"text"]))),
    CONSTRAINT "eval_touchpoints_kind_check" CHECK (("kind" = ANY (ARRAY['tool'::"text", 'prompt'::"text", 'skill'::"text", 'inline'::"text", 'agent_recipe'::"text"]))),
    CONSTRAINT "eval_touchpoints_severity_on_fail_check" CHECK (("severity_on_fail" = ANY (ARRAY['block'::"text", 'warn'::"text", 'info'::"text", 'infra'::"text"]))),
    CONSTRAINT "eval_touchpoints_variance_band_check" CHECK ((("variance_band" >= (0)::numeric) AND ("variance_band" <= (1)::numeric)))
);


ALTER TABLE "public"."eval_touchpoints" OWNER TO "postgres";


COMMENT ON TABLE "public"."eval_touchpoints" IS 'ID-104 T3 — registry-of-record for every AI touchpoint. touchpoint_id PK enforces B-INV-3 (duplicate id rejected). Column unions mirror lib/eval/contract.ts (AgentEvalContract). file_sha256 nullable (TECH OQ-1) — git-backed touchpoints only. Admin read/write via get_user_role().';



CREATE OR REPLACE VIEW "api"."eval_touchpoints" WITH ("security_invoker"='true') AS
 SELECT "touchpoint_id",
    "kind",
    "owner",
    "suite_name",
    "grounding_shape",
    "severity_on_fail",
    "variance_band",
    "graduation_metric",
    "contract_version",
    "registry_version",
    "file_sha256",
    "created_at",
    "updated_at"
   FROM "public"."eval_touchpoints";


ALTER VIEW "api"."eval_touchpoints" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feed_articles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "feed_source_id" "uuid" NOT NULL,
    "external_url" "text" NOT NULL,
    "external_id" "text",
    "title" "text" NOT NULL,
    "raw_content" "text",
    "ai_summary" "text",
    "relevance_score" numeric(4,3),
    "relevance_category" character varying,
    "relevance_reasoning" "text",
    "matched_categories" "text"[],
    "passed" boolean DEFAULT false NOT NULL,
    "prompt_version_id" "uuid",
    "content_item_id" "uuid",
    "published_at" timestamp with time zone,
    "ingested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "extraction_method" character varying,
    "reference_item_id" "uuid",
    CONSTRAINT "feed_articles_extraction_method_check" CHECK ((("extraction_method" IS NULL) OR (("extraction_method")::"text" = ANY (ARRAY['rss_content'::"text", 'fetch'::"text", 'jina_reader'::"text", 'firecrawl'::"text", 'summary_fallback'::"text", 'pullmd_readability'::"text", 'pullmd_playwright'::"text", 'pullmd_cloudflare'::"text", 'pullmd_reddit'::"text", 'pullmd_trafilatura'::"text", 'docling'::"text"])))),
    CONSTRAINT "feed_articles_relevance_category_check" CHECK ((("relevance_category")::"text" = ANY (ARRAY[('high'::character varying)::"text", ('medium'::character varying)::"text", ('low'::character varying)::"text", ('irrelevant'::character varying)::"text"]))),
    CONSTRAINT "feed_articles_relevance_score_check" CHECK ((("relevance_score" >= (0)::numeric) AND ("relevance_score" <= (1)::numeric)))
);


ALTER TABLE "public"."feed_articles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."feed_articles" WITH ("security_invoker"='true') AS
 SELECT "id",
    "workspace_id",
    "feed_source_id",
    "external_url",
    "external_id",
    "title",
    "raw_content",
    "ai_summary",
    "relevance_score",
    "relevance_category",
    "relevance_reasoning",
    "matched_categories",
    "passed",
    "prompt_version_id",
    "content_item_id",
    "published_at",
    "ingested_at",
    "created_at",
    "updated_at",
    "extraction_method",
    "reference_item_id"
   FROM "public"."feed_articles";


ALTER VIEW "api"."feed_articles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feed_flags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "feed_article_id" "uuid" NOT NULL,
    "flag_type" character varying NOT NULL,
    "flagged_by" "uuid" NOT NULL,
    "notes" "text",
    "resolved" boolean DEFAULT false NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    "resolved_notes" "text",
    "resolution_type" character varying,
    "prompt_version_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "feed_flags_flag_type_check" CHECK ((("flag_type")::"text" = ANY (ARRAY[('false_positive'::character varying)::"text", ('false_negative'::character varying)::"text"]))),
    CONSTRAINT "feed_flags_resolution_type_check" CHECK ((("resolution_type")::"text" = ANY (ARRAY[('addressed'::character varying)::"text", ('dismissed'::character varying)::"text"])))
);


ALTER TABLE "public"."feed_flags" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."feed_flags" WITH ("security_invoker"='true') AS
 SELECT "id",
    "feed_article_id",
    "flag_type",
    "flagged_by",
    "notes",
    "resolved",
    "resolved_at",
    "resolved_by",
    "resolved_notes",
    "resolution_type",
    "prompt_version_id",
    "created_at"
   FROM "public"."feed_flags";


ALTER VIEW "api"."feed_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feed_prompts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "prompt_text" "text" NOT NULL,
    "version" integer NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "change_notes" "text",
    "performance_snapshot" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."feed_prompts" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."feed_prompts" WITH ("security_invoker"='true') AS
 SELECT "id",
    "workspace_id",
    "prompt_text",
    "version",
    "is_active",
    "change_notes",
    "performance_snapshot",
    "created_at",
    "created_by"
   FROM "public"."feed_prompts";


ALTER VIEW "api"."feed_prompts" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."feed_sources" WITH ("security_invoker"='true') AS
 SELECT "id",
    "workspace_id",
    "name",
    "url",
    "source_type",
    "polling_interval_minutes",
    "last_polled_at",
    "last_polled_status",
    "last_polled_error",
    "etag",
    "last_modified",
    "consecutive_failures",
    "article_count",
    "is_active",
    "created_at",
    "updated_at",
    "created_by"
   FROM "public"."feed_sources";


ALTER VIEW "api"."feed_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_questions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "section_name" "text",
    "section_sequence" integer NOT NULL,
    "question_sequence" integer NOT NULL,
    "question_text" "text" NOT NULL,
    "word_limit" integer,
    "evaluation_weight" real,
    "confidence_posture" "text",
    "matched_content_ids" "uuid"[],
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "has_variants" boolean DEFAULT false,
    "assigned_to" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "template_requirement_id" "uuid",
    CONSTRAINT "form_questions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'drafted'::"text", 'reviewed'::"text", 'final'::"text", 'skipped'::"text", 'complete'::"text"])))
);


ALTER TABLE "public"."form_questions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."form_questions" WITH ("security_invoker"='true') AS
 SELECT "id",
    "workspace_id",
    "section_name",
    "section_sequence",
    "question_sequence",
    "question_text",
    "word_limit",
    "evaluation_weight",
    "confidence_posture",
    "matched_content_ids",
    "status",
    "has_variants",
    "assigned_to",
    "created_by",
    "created_at",
    "updated_at",
    "template_requirement_id"
   FROM "public"."form_questions";


ALTER VIEW "api"."form_questions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_response_history" (
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


ALTER TABLE "public"."form_response_history" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."form_response_history" WITH ("security_invoker"='true') AS
 SELECT "id",
    "response_id",
    "version",
    "response_text",
    "response_text_advanced",
    "review_status",
    "metadata",
    "source_content_ids",
    "edited_by",
    "change_reason",
    "created_at"
   FROM "public"."form_response_history";


ALTER VIEW "api"."form_response_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_responses" (
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
    CONSTRAINT "chk_form_responses_overall_score_range" CHECK ((("overall_score" IS NULL) OR (("overall_score" >= (0)::numeric) AND ("overall_score" <= (100)::numeric))))
);


ALTER TABLE "public"."form_responses" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."form_responses" WITH ("security_invoker"='true') AS
 SELECT "id",
    "question_id",
    "version",
    "response_text",
    "response_text_advanced",
    "source_content_ids",
    "review_status",
    "drafted_by",
    "last_edited_by",
    "approved_by",
    "metadata",
    "created_at",
    "updated_at",
    "overall_score"
   FROM "public"."form_responses";


ALTER VIEW "api"."form_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_template_fields" (
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
    "is_mandatory" boolean,
    "reference_urls" "text"[],
    CONSTRAINT "form_template_fields_field_type_check" CHECK (("field_type" = ANY (ARRAY['empty_cell'::"text", 'placeholder'::"text", 'highlighted'::"text"]))),
    CONSTRAINT "form_template_fields_fill_status_check" CHECK (("fill_status" = ANY (ARRAY['pending'::"text", 'filled'::"text", 'skipped'::"text", 'failed'::"text"]))),
    CONSTRAINT "form_template_fields_mapping_status_check" CHECK (("mapping_status" = ANY (ARRAY['unreviewed'::"text", 'confirmed'::"text", 'rejected'::"text", 'manual'::"text", 'unmapped'::"text"])))
);


ALTER TABLE "public"."form_template_fields" OWNER TO "postgres";


COMMENT ON COLUMN "public"."form_template_fields"."is_mandatory" IS 'Explicit mandatory/optional flag from the source form (Inv-10). NULL = form expressed no such status (NOT defaulted to optional).';



COMMENT ON COLUMN "public"."form_template_fields"."reference_urls" IS 'External URLs preserved from the source form question / section (Inv-14). NULL or [] = no reference URLs on this field.';



CREATE OR REPLACE VIEW "api"."form_template_fields" WITH ("security_invoker"='true') AS
 SELECT "id",
    "template_id",
    "field_type",
    "table_index",
    "row_index",
    "col_index",
    "question_text",
    "section_name",
    "word_limit",
    "placeholder_text",
    "question_id",
    "mapping_status",
    "mapping_confidence",
    "fill_status",
    "fill_error",
    "sequence",
    "created_at",
    "updated_at",
    "is_mandatory",
    "reference_urls"
   FROM "public"."form_template_fields";


ALTER VIEW "api"."form_template_fields" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_template_requirements" (
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
    "requirement_embedding" "extensions"."vector"(1024),
    "is_mandatory" boolean DEFAULT true,
    "is_current" boolean DEFAULT true,
    "sector_applicability" "text"[],
    "word_limit_guidance" integer,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "form_template_requirements_requirement_type_check" CHECK (("requirement_type" = ANY (ARRAY['policy'::"text", 'statement'::"text", 'evidence'::"text", 'data'::"text", 'narrative'::"text", 'declaration'::"text", 'reference'::"text"])))
);


ALTER TABLE "public"."form_template_requirements" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."form_template_requirements" WITH ("security_invoker"='true') AS
 SELECT "id",
    "template_name",
    "template_version",
    "template_type",
    "section_ref",
    "section_name",
    "question_number",
    "requirement_text",
    "description",
    "requirement_type",
    "primary_domain",
    "primary_subtopic",
    "secondary_domain",
    "secondary_subtopic",
    "matching_keywords",
    "matching_guidance",
    "requirement_embedding",
    "is_mandatory",
    "is_current",
    "sector_applicability",
    "word_limit_guidance",
    "display_order",
    "created_at",
    "updated_at"
   FROM "public"."form_template_requirements";


ALTER VIEW "api"."form_template_requirements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
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
    "ingest_source" "text" DEFAULT 'pipeline'::"text" NOT NULL,
    "form_type" "text",
    "deadline" timestamp with time zone,
    "issuing_organisation" "text",
    "evaluation_methodology" "text",
    "status_reason" "text",
    CONSTRAINT "form_templates_ingest_source_check" CHECK (("ingest_source" = ANY (ARRAY['pipeline'::"text", 'app_upload'::"text"]))),
    CONSTRAINT "form_templates_mime_type_check" CHECK (("mime_type" = ANY (ARRAY['application/vnd.openxmlformats-officedocument.wordprocessingml.document'::"text", 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::"text", 'application/pdf'::"text"]))),
    CONSTRAINT "form_templates_status_check" CHECK (("status" = ANY (ARRAY['uploaded'::"text", 'analysing'::"text", 'analysed'::"text", 'analysis_failed'::"text", 'filling'::"text", 'completed'::"text", 'fill_failed'::"text"])))
);


ALTER TABLE "public"."form_templates" OWNER TO "postgres";


COMMENT ON COLUMN "public"."form_templates"."ingest_source" IS 'Provenance of this template row. v1 = pipeline (folder→workspace). app_upload reserved for the thin UI front-end per OQ-52-UI-UPLOAD-TENSION.';



COMMENT ON COLUMN "public"."form_templates"."form_type" IS 'FK to form_types.key — the form-type CV value (matches FormMetadata.form_type per CV-lockstep, TECH §2.6b). NULL permitted for app_upload rows pre-classification.';



COMMENT ON COLUMN "public"."form_templates"."deadline" IS 'Form submission deadline parsed from the source form (Inv-7 substrate). NULL = no deadline expressed.';



COMMENT ON COLUMN "public"."form_templates"."issuing_organisation" IS 'Issuing-organisation string parsed from the source form (Inv-7 substrate). NULL = no issuer expressed.';



COMMENT ON COLUMN "public"."form_templates"."evaluation_methodology" IS 'Evaluation-methodology string parsed from the source form (Inv-7 substrate). Replaces the v1-deferred description-packing scheme. NULL = no methodology expressed.';



CREATE OR REPLACE VIEW "api"."form_templates" WITH ("security_invoker"='true') AS
 SELECT "id",
    "workspace_id",
    "name",
    "description",
    "filename",
    "storage_path",
    "file_size",
    "mime_type",
    "status",
    "field_count",
    "mapped_count",
    "structure_path",
    "created_by",
    "created_at",
    "updated_at",
    "ingest_source",
    "form_type",
    "deadline",
    "issuing_organisation",
    "evaluation_methodology",
    "status_reason"
   FROM "public"."form_templates";


ALTER VIEW "api"."form_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_types" (
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "provenance" "text" DEFAULT 'core'::"text" NOT NULL,
    "applicable_application_types" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "form_types_provenance_check" CHECK (("provenance" = ANY (ARRAY['core'::"text", 'client'::"text", 'recommended'::"text"])))
);


ALTER TABLE "public"."form_types" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."form_types" WITH ("security_invoker"='true') AS
 SELECT "key",
    "label",
    "provenance",
    "applicable_application_types",
    "created_at"
   FROM "public"."form_types";


ALTER VIEW "api"."form_types" OWNER TO "postgres";


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
    "preset" "text",
    CONSTRAINT "governance_config_posture_check" CHECK (("posture" = ANY (ARRAY['open'::"text", 'review_on_change'::"text"]))),
    CONSTRAINT "governance_config_preset_check" CHECK (("preset" = ANY (ARRAY['light_touch'::"text", 'strict'::"text"])))
);


ALTER TABLE "public"."governance_config" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."governance_config" WITH ("security_invoker"='true') AS
 SELECT "id",
    "domain",
    "posture",
    "reviewer_id",
    "timeout_days",
    "created_by",
    "updated_by",
    "created_at",
    "updated_at",
    "quality_score_threshold",
    "auto_flag_on_quality_drop",
    "auto_flag_on_freshness_transition",
    "auto_flag_cooldown_days",
    "preset"
   FROM "public"."governance_config";


ALTER VIEW "api"."governance_config" OWNER TO "postgres";


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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "parent_section_id" "uuid"
);


ALTER TABLE "public"."guide_sections" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."guide_sections" WITH ("security_invoker"='true') AS
 SELECT "id",
    "guide_id",
    "section_name",
    "description",
    "expected_layer",
    "subtopic_filter",
    "content_type_filter",
    "display_order",
    "is_required",
    "created_at",
    "updated_at",
    "parent_section_id"
   FROM "public"."guide_sections";


ALTER VIEW "api"."guide_sections" OWNER TO "postgres";


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


CREATE OR REPLACE VIEW "api"."guides" WITH ("security_invoker"='true') AS
 SELECT "id",
    "slug",
    "name",
    "description",
    "guide_type",
    "domain_filter",
    "icon",
    "color",
    "display_order",
    "is_published",
    "created_by",
    "created_at",
    "updated_at"
   FROM "public"."guides";


ALTER VIEW "api"."guides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ingestion_quality_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_item_id" "uuid",
    "flag_type" "text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "severity" "text" DEFAULT 'warning'::"text" NOT NULL,
    "ingestion_batch" "text",
    "resolved_at" timestamp with time zone,
    "resolved_by" character varying,
    "source_url" "text",
    "resolution_notes" "text",
    "created_by" "uuid",
    CONSTRAINT "ingestion_quality_log_flag_type_check" CHECK (("flag_type" = ANY (ARRAY['duplicate'::"text", 'low_quality'::"text", 'missing_field'::"text", 'review_needed'::"text", 'stale'::"text", 'conflicting'::"text", 'ssrf_rejected'::"text"]))),
    CONSTRAINT "ingestion_quality_log_severity_check" CHECK (("severity" = ANY (ARRAY['error'::"text", 'warning'::"text", 'info'::"text"])))
);


ALTER TABLE "public"."ingestion_quality_log" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."ingestion_quality_log" WITH ("security_invoker"='true') AS
 SELECT "id",
    "content_item_id",
    "flag_type",
    "details",
    "resolved",
    "created_at",
    "severity",
    "ingestion_batch",
    "resolved_at",
    "resolved_by",
    "source_url",
    "resolution_notes",
    "created_by"
   FROM "public"."ingestion_quality_log";


ALTER VIEW "api"."ingestion_quality_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."intelligence_workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_profile_id" "uuid",
    "guide_id" "uuid",
    "relevance_threshold" real,
    CONSTRAINT "intelligence_workspaces_relevance_threshold_check" CHECK ((("relevance_threshold" IS NULL) OR (("relevance_threshold" >= (0.1)::double precision) AND ("relevance_threshold" <= (1.0)::double precision))))
);


ALTER TABLE "public"."intelligence_workspaces" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."intelligence_workspaces" WITH ("security_invoker"='true') AS
 SELECT "id",
    "workspace_id",
    "created_at",
    "updated_at",
    "company_profile_id",
    "guide_id",
    "relevance_threshold"
   FROM "public"."intelligence_workspaces";


ALTER VIEW "api"."intelligence_workspaces" OWNER TO "postgres";


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


CREATE OR REPLACE VIEW "api"."layer_vocabulary" WITH ("security_invoker"='true') AS
 SELECT "id",
    "key",
    "label",
    "description",
    "display_order",
    "is_active",
    "created_at",
    "updated_at"
   FROM "public"."layer_vocabulary";


ALTER VIEW "api"."layer_vocabulary" OWNER TO "postgres";


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
    CONSTRAINT "notifications_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['content_item'::"text", 'change_report'::"text", 'template_requirement'::"text", 'domain'::"text", 'source_document'::"text", 'entity_mention'::"text"]))),
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['governance_review_needed'::"text", 'governance_approve'::"text", 'governance_request_changes'::"text", 'governance_revert'::"text", 'quality_flag'::"text", 'change_report_ready'::"text", 'freshness_transition'::"text", 'coverage_alert'::"text", 'content_gap'::"text", 'owner_content_stale'::"text", 'owner_content_updated'::"text", 'owner_assignment'::"text", 'source_document_updated'::"text", 'date_expiry_approaching'::"text", 'review_overdue'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."notifications" WITH ("security_invoker"='true') AS
 SELECT "id",
    "user_id",
    "type",
    "entity_type",
    "entity_id",
    "title",
    "message",
    "read_at",
    "dismissed_at",
    "expires_at",
    "created_at"
   FROM "public"."notifications";


ALTER VIEW "api"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pipeline_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pipeline_name" "text" NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "items_processed" integer DEFAULT 0,
    "items_updated" integer DEFAULT 0,
    "items_skipped" integer DEFAULT 0,
    "error_message" "text" DEFAULT '[]'::"jsonb",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "created_by" "uuid",
    "cost" numeric,
    "result" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "progress" "jsonb" DEFAULT '{}'::"jsonb",
    "source_filename" "text",
    "workspace_id" "uuid",
    "items_created" "uuid"[],
    "op_id" "uuid",
    "ended_at" timestamp with time zone,
    CONSTRAINT "pipeline_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'in_progress'::"text", 'completed'::"text", 'completed_with_errors'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."pipeline_runs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pipeline_runs"."op_id" IS 'Cocoindex per-flow op_id; T8 (docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-4)';



COMMENT ON COLUMN "public"."pipeline_runs"."ended_at" IS 'ID-197: terminal-state timestamp for a pipeline run. Added to resolve SQLSTATE 42703 in the DLQ / op-id integration suite which selects this column. Nullable; populated by the pipeline on terminal status.';



CREATE OR REPLACE VIEW "api"."pipeline_runs" WITH ("security_invoker"='true') AS
 SELECT "id",
    "pipeline_name",
    "status",
    "items_processed",
    "items_updated",
    "items_skipped",
    "error_message",
    "started_at",
    "completed_at",
    "created_by",
    "cost",
    "result",
    "created_at",
    "progress",
    "source_filename",
    "workspace_id",
    "items_created",
    "op_id",
    "ended_at"
   FROM "public"."pipeline_runs";


ALTER VIEW "api"."pipeline_runs" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."processing_queue" WITH ("security_invoker"='true') AS
 SELECT "id",
    "job_type",
    "payload",
    "status",
    "priority",
    "attempts",
    "max_attempts",
    "error_message",
    "created_at",
    "started_at",
    "completed_at",
    "result",
    "created_by",
    "updated_at",
    "idempotency_key"
   FROM "public"."processing_queue";


ALTER VIEW "api"."processing_queue" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."q_a_extractions" WITH ("security_invoker"='true') AS
 SELECT "id",
    "source_content_item_id",
    "extractor_kind",
    "extracted_question_text",
    "extracted_answer_text",
    "extraction_metadata",
    "promoted_to_pair_id",
    "invalidated_at",
    "created_at",
    "updated_at",
    "op_id",
    "expected_response_kind",
    "evaluation_criteria",
    "evidence_requirements",
    "scope_tags",
    "alternate_question_phrasings"
   FROM "public"."q_a_extractions";


ALTER VIEW "api"."q_a_extractions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."q_a_pair_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "q_a_pair_id" "uuid" NOT NULL,
    "version" integer NOT NULL,
    "question_text" "text" NOT NULL,
    "alternate_question_phrasings" "text"[] NOT NULL,
    "answer_standard" "text" NOT NULL,
    "answer_advanced" "text",
    "scope_tag" "text"[] NOT NULL,
    "anti_scope_tag" "text"[] NOT NULL,
    "origin_kind" "text" NOT NULL,
    "publication_status" "text" NOT NULL,
    "valid_from" timestamp with time zone,
    "valid_to" timestamp with time zone,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "changed_by" "uuid",
    "superseded_by" "uuid",
    "source_workspace_id" "uuid",
    "edit_intent" "text",
    CONSTRAINT "q_a_pair_history_edit_intent_check" CHECK (("edit_intent" = ANY (ARRAY['cosmetic'::"text", 'data'::"text", 'structural'::"text"])))
);


ALTER TABLE "public"."q_a_pair_history" OWNER TO "postgres";


COMMENT ON COLUMN "public"."q_a_pair_history"."superseded_by" IS 'Snapshot of q_a_pairs.superseded_by at transition (plain uuid, no FK — append-only snapshot mirror, lineage preserved by value). ID-64.15.';



COMMENT ON COLUMN "public"."q_a_pair_history"."source_workspace_id" IS 'Snapshot of q_a_pairs.source_workspace_id at transition (plain uuid, no FK — append-only snapshot mirror, provenance preserved by value). ID-64.15.';



COMMENT ON COLUMN "public"."q_a_pair_history"."edit_intent" IS 'Snapshot of q_a_pairs.edit_intent at transition (closed CV cosmetic|data|structural). Written by q_a_pairs_history_trigger() copying OLD.edit_intent. NULL-allowed, write-only-forward. ID-59 PC-A4.';



CREATE OR REPLACE VIEW "api"."q_a_pair_history" WITH ("security_invoker"='true') AS
 SELECT "id",
    "q_a_pair_id",
    "version",
    "question_text",
    "alternate_question_phrasings",
    "answer_standard",
    "answer_advanced",
    "scope_tag",
    "anti_scope_tag",
    "origin_kind",
    "publication_status",
    "valid_from",
    "valid_to",
    "changed_at",
    "changed_by",
    "superseded_by",
    "source_workspace_id",
    "edit_intent"
   FROM "public"."q_a_pair_history";


ALTER VIEW "api"."q_a_pair_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."q_a_pairs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question_text" "text" NOT NULL,
    "answer_standard" "text" NOT NULL,
    "answer_advanced" "text",
    "scope_tag" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "anti_scope_tag" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "source_workspace_id" "uuid",
    "origin_kind" "text" DEFAULT 'curated_explicit'::"text" NOT NULL,
    "publication_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "superseded_by" "uuid",
    "valid_from" timestamp with time zone,
    "valid_to" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "alternate_question_phrasings" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "question_embedding" "extensions"."vector"(1024),
    "edit_intent" "text",
    "source_form_response_id" "uuid",
    "source_question_id" "uuid",
    CONSTRAINT "q_a_pairs_edit_intent_check" CHECK (("edit_intent" = ANY (ARRAY['cosmetic'::"text", 'data'::"text", 'structural'::"text"]))),
    CONSTRAINT "q_a_pairs_origin_kind_check" CHECK (("origin_kind" = ANY (ARRAY['extracted_from_corpus'::"text", 'curated_explicit'::"text", 'derived_from_form_response'::"text", 'imported_legacy'::"text"]))),
    CONSTRAINT "q_a_pairs_publication_status_check" CHECK (("publication_status" = ANY (ARRAY['draft'::"text", 'in_review'::"text", 'published'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."q_a_pairs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."q_a_pairs"."edit_intent" IS 'Post-arbitration edit intent on the UC6 user-direct Q&A revision path (closed CV cosmetic|data|structural). NULL-allowed, write-only-forward (no backfill). Snapshotted into q_a_pair_history at each UPDATE via q_a_pairs_history_trigger(). ID-59 PC-A4.';



COMMENT ON COLUMN "public"."q_a_pairs"."source_form_response_id" IS 'UC5 ({59.14}) promotion lineage: the form_responses(id) this Q&A draft was promoted from. NULL for non-promoted pairs. ON DELETE SET NULL.';



COMMENT ON COLUMN "public"."q_a_pairs"."source_question_id" IS 'UC5 ({59.14}) promotion lineage: the form_questions(id) the source response answered. NULL for non-promoted pairs. ON DELETE SET NULL.';



CREATE OR REPLACE VIEW "api"."q_a_pairs" WITH ("security_invoker"='true') AS
 SELECT "id",
    "question_text",
    "answer_standard",
    "answer_advanced",
    "scope_tag",
    "anti_scope_tag",
    "source_workspace_id",
    "origin_kind",
    "publication_status",
    "superseded_by",
    "valid_from",
    "valid_to",
    "created_at",
    "updated_at",
    "alternate_question_phrasings",
    "question_embedding",
    "edit_intent",
    "source_form_response_id",
    "source_question_id"
   FROM "public"."q_a_pairs";


ALTER VIEW "api"."q_a_pairs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."read_marks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_item_id" "uuid" NOT NULL,
    "read_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source" character varying DEFAULT 'manual'::character varying NOT NULL
);


ALTER TABLE "public"."read_marks" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."read_marks" WITH ("security_invoker"='true') AS
 SELECT "id",
    "content_item_id",
    "read_at",
    "user_id",
    "source"
   FROM "public"."read_marks";


ALTER VIEW "api"."read_marks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reference_items" (
    "id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "summary" "text",
    "source_url" "text" NOT NULL,
    "published_at" timestamp with time zone,
    "primary_domain" "text",
    "primary_subtopic" "text",
    "layer" "text",
    "embedding" "extensions"."vector"(1024),
    "source_document_id" "uuid" NOT NULL,
    "ingestion_source" "text" NOT NULL,
    "op_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reference_items_ingestion_source_check" CHECK (("ingestion_source" = ANY (ARRAY['rss_feed'::"text", 'url_import'::"text"])))
);


ALTER TABLE "public"."reference_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."reference_items" IS 'Global, workspace-less external reference/evidence layer (ID-75, O4/D4). One row per normalised URL. Never auto-promotes into content_items.';



CREATE OR REPLACE VIEW "api"."reference_items" WITH ("security_invoker"='true') AS
 SELECT "id",
    "title",
    "body",
    "summary",
    "source_url",
    "published_at",
    "primary_domain",
    "primary_subtopic",
    "layer",
    "embedding",
    "source_document_id",
    "ingestion_source",
    "op_id",
    "created_at",
    "updated_at"
   FROM "public"."reference_items";


ALTER VIEW "api"."reference_items" OWNER TO "postgres";


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


CREATE OR REPLACE VIEW "api"."review_assignments" WITH ("security_invoker"='true') AS
 SELECT "id",
    "reviewer_id",
    "assigned_by",
    "assignment_type",
    "filter_domains",
    "filter_content_types",
    "filter_freshness",
    "filter_date_from",
    "filter_date_to",
    "item_count",
    "status",
    "notes",
    "due_date",
    "completed_at",
    "created_at",
    "updated_at"
   FROM "public"."review_assignments";


ALTER VIEW "api"."review_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."si_processing_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "feed_source_id" "uuid" NOT NULL,
    "status" character varying DEFAULT 'pending'::character varying NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "error_message" "text",
    "articles_found" integer DEFAULT 0 NOT NULL,
    "articles_new" integer DEFAULT 0 NOT NULL,
    "articles_passed" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "si_processing_queue_status_check" CHECK ((("status")::"text" = ANY (ARRAY[('pending'::character varying)::"text", ('processing'::character varying)::"text", ('complete'::character varying)::"text", ('failed'::character varying)::"text"])))
);


ALTER TABLE "public"."si_processing_queue" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."si_processing_queue" WITH ("security_invoker"='true') AS
 SELECT "id",
    "workspace_id",
    "feed_source_id",
    "status",
    "started_at",
    "completed_at",
    "error_message",
    "articles_found",
    "articles_new",
    "articles_passed",
    "created_at"
   FROM "public"."si_processing_queue";


ALTER VIEW "api"."si_processing_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."signup_policy" (
    "id" boolean DEFAULT true NOT NULL,
    "allowed_domain" "text",
    CONSTRAINT "signup_policy_singleton" CHECK (("id" = true))
);


ALTER TABLE "public"."signup_policy" OWNER TO "postgres";


COMMENT ON TABLE "public"."signup_policy" IS 'Single-row per-instance sign-up domain policy. allowed_domain is set out-of-band per environment (SQL editor / post-deploy data step), NEVER in committed migrations, so the client domain never enters tracked source. Read by the before_user_created auth hook (hook_restrict_signup_to_allowed_domain).';



CREATE OR REPLACE VIEW "api"."signup_policy" WITH ("security_invoker"='true') AS
 SELECT "id",
    "allowed_domain"
   FROM "public"."signup_policy";


ALTER VIEW "api"."signup_policy" OWNER TO "postgres";


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
    "diff_mode" "text" DEFAULT 'qa'::"text" NOT NULL,
    "section_header" "text",
    CONSTRAINT "different_documents" CHECK (("old_document_id" <> "new_document_id")),
    CONSTRAINT "source_document_diffs_diff_mode_check" CHECK (("diff_mode" = ANY (ARRAY['qa'::"text", 'full_text'::"text"]))),
    CONSTRAINT "source_document_diffs_diff_type_check" CHECK (("diff_type" = ANY (ARRAY['added'::"text", 'removed'::"text", 'modified'::"text", 'unchanged'::"text"]))),
    CONSTRAINT "source_document_diffs_status_check" CHECK (("status" = ANY (ARRAY['pending_review'::"text", 'applied'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."source_document_diffs" OWNER TO "postgres";


COMMENT ON TABLE "public"."source_document_diffs" IS 'Stores Q&A pair-level diffs between source document versions. Each row represents one matched or unmatched pair.';



COMMENT ON COLUMN "public"."source_document_diffs"."reviewed_at" IS 'Timestamp when the entry status was last changed from pending_review';



COMMENT ON COLUMN "public"."source_document_diffs"."reviewed_by" IS 'User who last changed the entry status';



COMMENT ON COLUMN "public"."source_document_diffs"."created_by" IS 'User who triggered the diff computation';



COMMENT ON COLUMN "public"."source_document_diffs"."reviewer_note" IS 'Free-text reviewer annotation explaining the review decision for this diff entry';



COMMENT ON COLUMN "public"."source_document_diffs"."diff_mode" IS 'Diff algorithm used: qa for Q&A pair matching, full_text for line-level text diff';



COMMENT ON COLUMN "public"."source_document_diffs"."section_header" IS 'Section heading context for full-text diff entries';



CREATE OR REPLACE VIEW "api"."source_document_diffs" WITH ("security_invoker"='true') AS
 SELECT "id",
    "old_document_id",
    "new_document_id",
    "diff_type",
    "old_content",
    "new_content",
    "old_question",
    "new_question",
    "similarity_score",
    "affected_content_item_id",
    "status",
    "created_at",
    "updated_at",
    "reviewed_at",
    "reviewed_by",
    "created_by",
    "reviewer_note",
    "diff_mode",
    "section_header"
   FROM "public"."source_document_diffs";


ALTER VIEW "api"."source_document_diffs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."source_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "filename" "text" NOT NULL,
    "original_filename" "text",
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
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "op_id" "uuid",
    "pullmd_share_id" "text",
    "extraction_method" "text",
    "source_url" "text",
    CONSTRAINT "source_documents_extraction_method_check" CHECK ((("extraction_method" IS NULL) OR ("extraction_method" = ANY (ARRAY['rss_content'::"text", 'fetch'::"text", 'jina_reader'::"text", 'firecrawl'::"text", 'summary_fallback'::"text", 'pullmd_readability'::"text", 'pullmd_playwright'::"text", 'pullmd_cloudflare'::"text", 'pullmd_reddit'::"text", 'pullmd_trafilatura'::"text", 'docling'::"text"])))),
    CONSTRAINT "source_documents_status_check" CHECK ((("status")::"text" = ANY (ARRAY[('uploaded'::character varying)::"text", ('processing'::character varying)::"text", ('processed'::character varying)::"text", ('failed'::character varying)::"text"])))
);


ALTER TABLE "public"."source_documents" OWNER TO "postgres";


COMMENT ON TABLE "public"."source_documents" IS 'Tracks uploaded source documents with version history. Each row is a specific version of a document. The parent_id chain links versions together.';



COMMENT ON COLUMN "public"."source_documents"."op_id" IS 'Cocoindex per-flow op_id; T8 (docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-4)';



COMMENT ON COLUMN "public"."source_documents"."pullmd_share_id" IS 'pullmd X-Share-Id permalink (GET /s/:id round-trips); ID-42 (docs/specs/id-42-pullmd-deploy/TECH.md WP-D)';



COMMENT ON COLUMN "public"."source_documents"."extraction_method" IS 'Extractor that produced the markdown; pullmd_* mirrors X-Source, docling for binary; ID-42';



CREATE OR REPLACE VIEW "api"."source_documents" WITH ("security_invoker"='true') AS
 SELECT "id",
    "filename",
    "original_filename",
    "mime_type",
    "file_size",
    "content_hash",
    "version",
    "parent_id",
    "storage_path",
    "status",
    "extracted_text",
    "extraction_metadata",
    "workspace_id",
    "pipeline_run_id",
    "uploaded_by",
    "created_at",
    "archived_at",
    "archived_by",
    "op_id",
    "pullmd_share_id",
    "extraction_method",
    "source_url"
   FROM "public"."source_documents";


ALTER VIEW "api"."source_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tag_morphology_drift_flags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stored_tag" "text" NOT NULL,
    "proposed_canonical" "text" NOT NULL,
    "usage_count" integer NOT NULL,
    "affected_content_ids" "uuid"[] NOT NULL,
    "detected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "decision" "text" DEFAULT 'pending'::"text" NOT NULL,
    "decided_by" "uuid",
    "decided_at" timestamp with time zone,
    "decision_rationale" "text",
    CONSTRAINT "tag_morphology_drift_flags_decision_check" CHECK (("decision" = ANY (ARRAY['pending'::"text", 'accept'::"text", 'add_override'::"text", 'dismiss'::"text"])))
);


ALTER TABLE "public"."tag_morphology_drift_flags" OWNER TO "postgres";


COMMENT ON TABLE "public"."tag_morphology_drift_flags" IS 'Triage queue for tag morphology drift surfaced by the eval-tag-morphology-adoption script. Each row is one (stored_tag, proposed_canonical) disagreement awaiting human disposition. See docs/specs/p1-tag-morphology-library-adoption-spec.md §3.5.4.';



CREATE OR REPLACE VIEW "api"."tag_morphology_drift_flags" WITH ("security_invoker"='true') AS
 SELECT "id",
    "stored_tag",
    "proposed_canonical",
    "usage_count",
    "affected_content_ids",
    "detected_at",
    "decision",
    "decided_by",
    "decided_at",
    "decision_rationale"
   FROM "public"."tag_morphology_drift_flags";


ALTER VIEW "api"."tag_morphology_drift_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."taxonomy_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "display_order" integer DEFAULT 0 NOT NULL,
    "colour" "text",
    "is_active" boolean DEFAULT true,
    "provenance" "text" NOT NULL,
    "recommended_by" "text",
    "recommended_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_name" character varying(100),
    "key_signal" "text"
);


ALTER TABLE "public"."taxonomy_domains" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."taxonomy_domains" WITH ("security_invoker"='true') AS
 SELECT "id",
    "name",
    "description",
    "display_order",
    "colour",
    "is_active",
    "provenance",
    "recommended_by",
    "recommended_at",
    "accepted_at",
    "created_at",
    "display_name",
    "key_signal"
   FROM "public"."taxonomy_domains";


ALTER VIEW "api"."taxonomy_domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."taxonomy_subtopics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "display_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true,
    "provenance" "text" NOT NULL,
    "recommended_by" "text",
    "recommended_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_name" character varying(100)
);


ALTER TABLE "public"."taxonomy_subtopics" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."taxonomy_subtopics" WITH ("security_invoker"='true') AS
 SELECT "id",
    "domain_id",
    "name",
    "description",
    "display_order",
    "is_active",
    "provenance",
    "recommended_by",
    "recommended_at",
    "accepted_at",
    "created_at",
    "display_name"
   FROM "public"."taxonomy_subtopics";


ALTER VIEW "api"."taxonomy_subtopics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."taxonomy_sync_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "last_sync_hash" "text" DEFAULT ''::"text" NOT NULL,
    "last_sync_at" timestamp with time zone,
    "synced_by" "text" DEFAULT 'manual'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."taxonomy_sync_state" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."taxonomy_sync_state" WITH ("security_invoker"='true') AS
 SELECT "id",
    "last_sync_hash",
    "last_sync_at",
    "synced_by",
    "created_at",
    "updated_at"
   FROM "public"."taxonomy_sync_state";


ALTER VIEW "api"."taxonomy_sync_state" OWNER TO "postgres";


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


CREATE OR REPLACE VIEW "api"."template_completions" WITH ("security_invoker"='true') AS
 SELECT "id",
    "template_id",
    "job_id",
    "storage_path",
    "fields_filled",
    "fields_skipped",
    "fields_failed",
    "file_size",
    "created_by",
    "created_at"
   FROM "public"."template_completions";


ALTER VIEW "api"."template_completions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant_config" (
    "id" boolean DEFAULT true NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tenant_config_singleton" CHECK (("id" = true))
);


ALTER TABLE "public"."tenant_config" OWNER TO "postgres";


COMMENT ON TABLE "public"."tenant_config" IS 'Single-row per-instance client config document (branding + per-client config such as classificationDisambiguation). config jsonb is set out-of-band per environment via the re-seed manifest (scripts/reseed-tenant-instance.ts), NEVER in committed migrations, so no client value enters tracked source. Read ONLY by the build-time fetch (scripts/fetch-client-branding.ts) via the service-role key, which bypasses RLS. Deliberately closed to anon/authenticated (no permissive policy, no GRANT) — service-role access only (PI-10).';



CREATE OR REPLACE VIEW "api"."tenant_config" WITH ("security_invoker"='true') AS
 SELECT "id",
    "config",
    "created_at",
    "updated_at"
   FROM "public"."tenant_config";


ALTER VIEW "api"."tenant_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_notification_prefs" (
    "user_id" "uuid" NOT NULL,
    "email_weekly_change_report" boolean DEFAULT true NOT NULL,
    "email_review_assigned" boolean DEFAULT true NOT NULL,
    "email_owned_content_flagged" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "auto_generate_change_reports" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."user_notification_prefs" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_notification_prefs" IS 'Per-user email notification preferences. Rows created on first toggle; defaults = all ON.';



COMMENT ON COLUMN "public"."user_notification_prefs"."auto_generate_change_reports" IS 'When false, suppresses the auto-fire of weekly digest generation on first /digest page visit. User still has manual Generate button. See OPS-23.';



CREATE OR REPLACE VIEW "api"."user_notification_prefs" WITH ("security_invoker"='true') AS
 SELECT "user_id",
    "email_weekly_change_report",
    "email_review_assigned",
    "email_owned_content_flagged",
    "created_at",
    "updated_at",
    "auto_generate_change_reports"
   FROM "public"."user_notification_prefs";


ALTER VIEW "api"."user_notification_prefs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "full_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_profiles" IS 'Mirror of auth.users for app-side reads (no PostgREST exposure on auth schema). Populated by handle_new_user trigger AFTER INSERT on auth.users; updated by handle_user_update AFTER UPDATE. Backfill of pre-existing users at migration apply time. WP-G3.4 (kh-prod-readiness-S8). Spec: docs/audits/kh-production-readiness-phase-1/specs/wp-g3.4-user-profiles-spec-v1.md.';



COMMENT ON COLUMN "public"."user_profiles"."email" IS 'Mirror of auth.users.email. Nullable to support phone-only GoTrue signups; Knowledge Hub uses email-only auth via the allowed-domain signup hook today but schema must not bake that in.';



CREATE OR REPLACE VIEW "api"."user_profiles" WITH ("security_invoker"='true') AS
 SELECT "id",
    "email",
    "full_name",
    "created_at",
    "updated_at"
   FROM "public"."user_profiles";


ALTER VIEW "api"."user_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "granted_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "display_name" "text",
    CONSTRAINT "user_roles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'editor'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."user_roles" WITH ("security_invoker"='true') AS
 SELECT "id",
    "user_id",
    "role",
    "granted_by",
    "created_at",
    "updated_at",
    "display_name"
   FROM "public"."user_roles";


ALTER VIEW "api"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."verification_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_item_id" "uuid" NOT NULL,
    "action_type" character varying(20) NOT NULL,
    "note" "text",
    "performed_by" "uuid" NOT NULL,
    "performed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "verification_history_action_type_check" CHECK ((("action_type")::"text" = ANY (ARRAY[('verify'::character varying)::"text", ('unverify'::character varying)::"text", ('flag'::character varying)::"text"])))
);


ALTER TABLE "public"."verification_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."verification_history" IS 'Audit trail of verification actions on content items. Each verify, unverify, or flag action creates a row.';



COMMENT ON COLUMN "public"."verification_history"."content_item_id" IS 'The content item this verification action relates to';



COMMENT ON COLUMN "public"."verification_history"."action_type" IS 'Action taken: verify (mark as verified), unverify (remove verification), flag (raise quality concern)';



COMMENT ON COLUMN "public"."verification_history"."note" IS 'Optional reviewer note, max 500 characters enforced at application layer';



COMMENT ON COLUMN "public"."verification_history"."performed_by" IS 'UUID of the user who performed the action';



COMMENT ON COLUMN "public"."verification_history"."performed_at" IS 'Timestamp when the action was performed';



CREATE OR REPLACE VIEW "api"."verification_history" WITH ("security_invoker"='true') AS
 SELECT "id",
    "content_item_id",
    "action_type",
    "note",
    "performed_by",
    "performed_at"
   FROM "public"."verification_history";


ALTER VIEW "api"."verification_history" OWNER TO "postgres";


CREATE OR REPLACE VIEW "api"."workspaces" WITH ("security_invoker"='true') AS
 SELECT "id",
    "name",
    "description",
    "color",
    "created_at",
    "updated_at",
    "domain_metadata",
    "is_archived",
    "status",
    "created_by",
    "updated_by",
    "icon",
    "application_type_id"
   FROM "public"."workspaces";


ALTER VIEW "api"."workspaces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."competitor_research_workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."competitor_research_workspaces" OWNER TO "postgres";


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



CREATE TABLE IF NOT EXISTS "public"."entity_pair_resolutions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name_a" "text" NOT NULL,
    "name_b" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "decision" "text" NOT NULL,
    "resolved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "op_id" "uuid",
    CONSTRAINT "entity_pair_resolutions_decision_check" CHECK (("decision" = ANY (ARRAY['same'::"text", 'different'::"text"])))
);


ALTER TABLE "public"."entity_pair_resolutions" OWNER TO "postgres";


COMMENT ON TABLE "public"."entity_pair_resolutions" IS 'PairResolver determinism cache for Stage-5 cocoindex.resolve_entities. PRODUCT.md Inv-14 + §5 P-OQ3. Lexicographic ordering of (name_a, name_b) at insert time ensures cache-key stability; UNIQUE constraint backs the cache lookup. op_id records the originating run for audit-forensics.';



COMMENT ON COLUMN "public"."entity_pair_resolutions"."name_a" IS 'Lexicographically smaller of the (entity, candidate) pair at insert time.';



COMMENT ON COLUMN "public"."entity_pair_resolutions"."name_b" IS 'Lexicographically larger of the (entity, candidate) pair at insert time.';



COMMENT ON COLUMN "public"."entity_pair_resolutions"."decision" IS 'Resolver decision: same | different. Checked at LOAD time by KhPairResolver.';



COMMENT ON COLUMN "public"."entity_pair_resolutions"."op_id" IS 'op_id of the run that originated this decision (NULL if backfilled).';



CREATE TABLE IF NOT EXISTS "public"."procurement_vehicle_instances" (
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "vehicle_key" "text" NOT NULL,
    "provenance" "text" DEFAULT 'core'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "procurement_vehicle_instances_provenance_check" CHECK (("provenance" = ANY (ARRAY['core'::"text", 'client'::"text", 'recommended'::"text"])))
);


ALTER TABLE "public"."procurement_vehicle_instances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."procurement_vehicles" (
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "provenance" "text" DEFAULT 'core'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "procurement_vehicles_provenance_check" CHECK (("provenance" = ANY (ARRAY['core'::"text", 'client'::"text", 'recommended'::"text"])))
);


ALTER TABLE "public"."procurement_vehicles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."procurement_workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."procurement_workspaces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_guide_workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_guide_workspaces" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."quality_issues_pending" WITH ("security_invoker"='true') AS
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


CREATE TABLE IF NOT EXISTS "public"."question_matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "form_question_id" "uuid" NOT NULL,
    "q_a_pair_id" "uuid" NOT NULL,
    "question_kind" "text" NOT NULL,
    "embedding_score" numeric(5,4),
    "fulltext_score" numeric(5,4),
    "matched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "question_matches_embedding_score_range_chk" CHECK ((("embedding_score" IS NULL) OR (("embedding_score" >= (0)::numeric) AND ("embedding_score" <= (1)::numeric)))),
    CONSTRAINT "question_matches_fulltext_score_range_chk" CHECK ((("fulltext_score" IS NULL) OR (("fulltext_score" >= (0)::numeric) AND ("fulltext_score" <= (1)::numeric)))),
    CONSTRAINT "question_matches_score_present_chk" CHECK ((("embedding_score" IS NOT NULL) OR ("fulltext_score" IS NOT NULL)))
);


ALTER TABLE "public"."question_matches" OWNER TO "postgres";


COMMENT ON TABLE "public"."question_matches" IS 'ID-57 T10 — ranked candidate edge between a form-question instance and a corpus q_a_pair. Separate per-method scores (N9 RESOLVED-S236); never a blended match_score. Candidacy, not selection (05-qa-flow.md §7.2). Distinct from citations (ID-58 provenance).';



CREATE TABLE IF NOT EXISTS "public"."sales_proposal_workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sales_proposal_workspaces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_onboarding_workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."training_onboarding_workspaces" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_call_events"
    ADD CONSTRAINT "ai_call_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."application_types"
    ADD CONSTRAINT "application_types_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."application_types"
    ADD CONSTRAINT "application_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."change_reports"
    ADD CONSTRAINT "change_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."citations"
    ADD CONSTRAINT "citations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."classification_disputes"
    ADD CONSTRAINT "classification_disputes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_profiles"
    ADD CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_profiles"
    ADD CONSTRAINT "company_profiles_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."competitor_research_workspaces"
    ADD CONSTRAINT "competitor_research_workspaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."competitor_research_workspaces"
    ADD CONSTRAINT "competitor_research_workspaces_workspace_id_key" UNIQUE ("workspace_id");



ALTER TABLE ONLY "public"."content_chunks"
    ADD CONSTRAINT "content_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_history"
    ADD CONSTRAINT "content_history_content_item_id_version_key" UNIQUE ("content_item_id", "version");



ALTER TABLE ONLY "public"."content_history"
    ADD CONSTRAINT "content_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_item_workspaces"
    ADD CONSTRAINT "content_item_workspaces_pkey" PRIMARY KEY ("content_item_id", "workspace_id");



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_propagation_version"
    ADD CONSTRAINT "content_propagation_version_pkey" PRIMARY KEY ("payload_key");



ALTER TABLE ONLY "public"."content_templates"
    ADD CONSTRAINT "content_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_templates"
    ADD CONSTRAINT "content_templates_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."coverage_targets"
    ADD CONSTRAINT "coverage_targets_domain_metric_unique" UNIQUE ("domain_id", "metric_name");



ALTER TABLE ONLY "public"."coverage_targets"
    ADD CONSTRAINT "coverage_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entity_aliases"
    ADD CONSTRAINT "entity_aliases_alias_unique" UNIQUE ("alias");



ALTER TABLE ONLY "public"."entity_aliases"
    ADD CONSTRAINT "entity_aliases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entity_mentions"
    ADD CONSTRAINT "entity_mentions_canonical_name_entity_type_content_item_id_key" UNIQUE ("canonical_name", "entity_type", "content_item_id");



ALTER TABLE ONLY "public"."entity_mentions"
    ADD CONSTRAINT "entity_mentions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entity_pair_resolutions"
    ADD CONSTRAINT "entity_pair_resolutions_pair_unique" UNIQUE ("name_a", "name_b", "entity_type");



ALTER TABLE ONLY "public"."entity_pair_resolutions"
    ADD CONSTRAINT "entity_pair_resolutions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entity_relationships"
    ADD CONSTRAINT "entity_relationships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eval_baseline_audit"
    ADD CONSTRAINT "eval_baseline_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eval_baselines"
    ADD CONSTRAINT "eval_baselines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eval_runs"
    ADD CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eval_touchpoints"
    ADD CONSTRAINT "eval_touchpoints_pkey" PRIMARY KEY ("touchpoint_id");



ALTER TABLE ONLY "public"."feed_articles"
    ADD CONSTRAINT "feed_articles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feed_flags"
    ADD CONSTRAINT "feed_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feed_prompts"
    ADD CONSTRAINT "feed_prompts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feed_prompts"
    ADD CONSTRAINT "feed_prompts_workspace_id_version_key" UNIQUE ("workspace_id", "version");



ALTER TABLE ONLY "public"."feed_sources"
    ADD CONSTRAINT "feed_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_questions"
    ADD CONSTRAINT "form_questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_questions"
    ADD CONSTRAINT "form_questions_workspace_question_unique" UNIQUE ("workspace_id", "question_text");



ALTER TABLE ONLY "public"."form_response_history"
    ADD CONSTRAINT "form_response_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_response_history"
    ADD CONSTRAINT "form_response_history_response_id_version_key" UNIQUE ("response_id", "version");



ALTER TABLE ONLY "public"."form_responses"
    ADD CONSTRAINT "form_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_template_fields"
    ADD CONSTRAINT "form_template_fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_template_requirements"
    ADD CONSTRAINT "form_template_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_template_requirements"
    ADD CONSTRAINT "form_template_requirements_unique_section" UNIQUE ("template_name", "template_version", "section_ref", "question_number");



ALTER TABLE ONLY "public"."form_templates"
    ADD CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_types"
    ADD CONSTRAINT "form_types_pkey" PRIMARY KEY ("key");



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



ALTER TABLE ONLY "public"."intelligence_workspaces"
    ADD CONSTRAINT "intelligence_workspaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."intelligence_workspaces"
    ADD CONSTRAINT "intelligence_workspaces_workspace_id_key" UNIQUE ("workspace_id");



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



ALTER TABLE ONLY "public"."procurement_vehicle_instances"
    ADD CONSTRAINT "procurement_vehicle_instances_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."procurement_vehicles"
    ADD CONSTRAINT "procurement_vehicles_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."procurement_workspaces"
    ADD CONSTRAINT "procurement_workspaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."procurement_workspaces"
    ADD CONSTRAINT "procurement_workspaces_workspace_id_key" UNIQUE ("workspace_id");



ALTER TABLE ONLY "public"."product_guide_workspaces"
    ADD CONSTRAINT "product_guide_workspaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_guide_workspaces"
    ADD CONSTRAINT "product_guide_workspaces_workspace_id_key" UNIQUE ("workspace_id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."q_a_extractions"
    ADD CONSTRAINT "q_a_extractions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."q_a_pair_history"
    ADD CONSTRAINT "q_a_pair_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."q_a_pair_history"
    ADD CONSTRAINT "q_a_pair_history_q_a_pair_id_version_key" UNIQUE ("q_a_pair_id", "version");



ALTER TABLE ONLY "public"."q_a_pairs"
    ADD CONSTRAINT "q_a_pairs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."question_matches"
    ADD CONSTRAINT "question_matches_candidate_unique" UNIQUE ("form_question_id", "q_a_pair_id");



ALTER TABLE ONLY "public"."question_matches"
    ADD CONSTRAINT "question_matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."read_marks"
    ADD CONSTRAINT "read_marks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reference_items"
    ADD CONSTRAINT "reference_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reference_items"
    ADD CONSTRAINT "reference_items_source_url_key" UNIQUE ("source_url");



ALTER TABLE ONLY "public"."review_assignments"
    ADD CONSTRAINT "review_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_proposal_workspaces"
    ADD CONSTRAINT "sales_proposal_workspaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_proposal_workspaces"
    ADD CONSTRAINT "sales_proposal_workspaces_workspace_id_key" UNIQUE ("workspace_id");



ALTER TABLE ONLY "public"."si_processing_queue"
    ADD CONSTRAINT "si_processing_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signup_policy"
    ADD CONSTRAINT "signup_policy_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."source_document_diffs"
    ADD CONSTRAINT "source_document_diffs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."source_documents"
    ADD CONSTRAINT "source_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tag_morphology_drift_flags"
    ADD CONSTRAINT "tag_morphology_drift_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tag_morphology_drift_flags"
    ADD CONSTRAINT "tag_morphology_drift_flags_stored_tag_proposed_canonical_key" UNIQUE ("stored_tag", "proposed_canonical");



ALTER TABLE ONLY "public"."taxonomy_domains"
    ADD CONSTRAINT "taxonomy_domains_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."taxonomy_domains"
    ADD CONSTRAINT "taxonomy_domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."taxonomy_subtopics"
    ADD CONSTRAINT "taxonomy_subtopics_domain_id_name_key" UNIQUE ("domain_id", "name");



ALTER TABLE ONLY "public"."taxonomy_subtopics"
    ADD CONSTRAINT "taxonomy_subtopics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."taxonomy_sync_state"
    ADD CONSTRAINT "taxonomy_sync_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_completions"
    ADD CONSTRAINT "template_completions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_config"
    ADD CONSTRAINT "tenant_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_onboarding_workspaces"
    ADD CONSTRAINT "training_onboarding_workspaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_onboarding_workspaces"
    ADD CONSTRAINT "training_onboarding_workspaces_workspace_id_key" UNIQUE ("workspace_id");



ALTER TABLE ONLY "public"."user_notification_prefs"
    ADD CONSTRAINT "user_notification_prefs_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."verification_history"
    ADD CONSTRAINT "verification_history_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "citations_uniq_form_response_content_item" ON "public"."citations" USING "btree" ("citing_form_response_id", "cited_content_item_id") WHERE ("cited_kind" = 'content_item'::"public"."cited_target_kind");



CREATE UNIQUE INDEX "citations_uniq_form_response_q_a_pair" ON "public"."citations" USING "btree" ("citing_form_response_id", "cited_q_a_pair_id") WHERE ("cited_kind" = 'q_a_pair'::"public"."cited_target_kind");



CREATE INDEX "content_items_superseded_by_idx" ON "public"."content_items" USING "btree" ("superseded_by") WHERE ("superseded_by" IS NOT NULL);



CREATE UNIQUE INDEX "entity_relationships_unique_tuple" ON "public"."entity_relationships" USING "btree" ("source_entity", "relationship_type", "target_entity", "source_item_id") NULLS NOT DISTINCT;



COMMENT ON INDEX "public"."entity_relationships_unique_tuple" IS 'S183 WP1 G1 — prevents duplicate (source_entity, relationship_type, target_entity, source_item_id) rows from accumulating across re-ingestion and batch reclassify runs. NULLS NOT DISTINCT so NULL source_item_id seed tuples also collide.';



CREATE INDEX "idx_ai_call_events_touchpoint_created_at" ON "public"."ai_call_events" USING "btree" ("touchpoint_id", "created_at" DESC);



CREATE INDEX "idx_change_reports_created_by" ON "public"."change_reports" USING "btree" ("created_by");



CREATE INDEX "idx_citations_cited_content_item" ON "public"."citations" USING "btree" ("cited_content_item_id") WHERE ("cited_kind" = 'content_item'::"public"."cited_target_kind");



CREATE INDEX "idx_citations_cited_q_a_pair" ON "public"."citations" USING "btree" ("cited_q_a_pair_id") WHERE ("cited_kind" = 'q_a_pair'::"public"."cited_target_kind");



CREATE INDEX "idx_citations_citing_form_response" ON "public"."citations" USING "btree" ("citing_form_response_id");



CREATE INDEX "idx_citations_created_by" ON "public"."citations" USING "btree" ("created_by");



CREATE INDEX "idx_classification_disputes_disputed_by" ON "public"."classification_disputes" USING "btree" ("disputed_by");



CREATE INDEX "idx_classification_disputes_item" ON "public"."classification_disputes" USING "btree" ("content_item_id");



CREATE INDEX "idx_classification_disputes_resolved_by" ON "public"."classification_disputes" USING "btree" ("resolved_by") WHERE ("resolved_by" IS NOT NULL);



CREATE INDEX "idx_classification_disputes_status_created" ON "public"."classification_disputes" USING "btree" ("status", "created_at" DESC) WHERE ("status" = 'open'::"text");



CREATE INDEX "idx_company_profiles_created_by" ON "public"."company_profiles" USING "btree" ("created_by");



CREATE UNIQUE INDEX "idx_company_profiles_primary_singleton" ON "public"."company_profiles" USING "btree" ("is_primary") WHERE (("is_primary" = true) AND ("is_active" = true));



CREATE INDEX "idx_company_profiles_sectors" ON "public"."company_profiles" USING "gin" ("sectors");



CREATE INDEX "idx_content_chunks_embedding" ON "public"."content_chunks" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



CREATE INDEX "idx_content_chunks_heading" ON "public"."content_chunks" USING "btree" ("heading_text") WHERE ("heading_text" IS NOT NULL);



CREATE INDEX "idx_content_chunks_item" ON "public"."content_chunks" USING "btree" ("content_item_id");



CREATE INDEX "idx_content_chunks_op_id" ON "public"."content_chunks" USING "btree" ("op_id") WHERE ("op_id" IS NOT NULL);



CREATE INDEX "idx_content_chunks_parent" ON "public"."content_chunks" USING "btree" ("parent_chunk_id") WHERE ("parent_chunk_id" IS NOT NULL);



CREATE INDEX "idx_content_history_created_by" ON "public"."content_history" USING "btree" ("created_by");



CREATE INDEX "idx_content_history_item" ON "public"."content_history" USING "btree" ("content_item_id", "version" DESC);



CREATE INDEX "idx_content_item_workspaces_workspace_id" ON "public"."content_item_workspaces" USING "btree" ("workspace_id");



CREATE INDEX "idx_content_items_archived" ON "public"."content_items" USING "btree" ("publication_status", "archived_at" DESC) WHERE ("publication_status" = 'archived'::"text");



CREATE INDEX "idx_content_items_archived_at" ON "public"."content_items" USING "btree" ("archived_at");



CREATE INDEX "idx_content_items_archived_by" ON "public"."content_items" USING "btree" ("archived_by");



CREATE INDEX "idx_content_items_content_owner_id" ON "public"."content_items" USING "btree" ("content_owner_id") WHERE ("content_owner_id" IS NOT NULL);



CREATE INDEX "idx_content_items_content_text_hash" ON "public"."content_items" USING "btree" ("content_text_hash") WHERE ("content_text_hash" IS NOT NULL);



CREATE INDEX "idx_content_items_content_type" ON "public"."content_items" USING "btree" ("content_type");



CREATE INDEX "idx_content_items_created_at" ON "public"."content_items" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_content_items_created_by" ON "public"."content_items" USING "btree" ("created_by");



CREATE INDEX "idx_content_items_dedup_status" ON "public"."content_items" USING "btree" ("dedup_status") WHERE ("dedup_status" <> 'clean'::"text");



CREATE INDEX "idx_content_items_embedding" ON "public"."content_items" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



CREATE INDEX "idx_content_items_freshness" ON "public"."content_items" USING "btree" ("freshness");



CREATE INDEX "idx_content_items_governance_review_status" ON "public"."content_items" USING "btree" ("governance_review_status");



CREATE INDEX "idx_content_items_governance_reviewer_id" ON "public"."content_items" USING "btree" ("governance_reviewer_id");



CREATE INDEX "idx_content_items_is_starred" ON "public"."content_items" USING "btree" ("starred") WHERE ("starred" = true);



CREATE INDEX "idx_content_items_layer" ON "public"."content_items" USING "btree" ("layer") WHERE ("layer" IS NOT NULL);



CREATE INDEX "idx_content_items_lifecycle_type" ON "public"."content_items" USING "btree" ("lifecycle_type");



CREATE INDEX "idx_content_items_metadata" ON "public"."content_items" USING "gin" ("metadata");



CREATE INDEX "idx_content_items_metadata_gin" ON "public"."content_items" USING "gin" ("metadata" "jsonb_path_ops");



CREATE INDEX "idx_content_items_next_review_date" ON "public"."content_items" USING "btree" ("next_review_date") WHERE (("next_review_date" IS NOT NULL) AND ("superseded_by" IS NULL) AND ("archived_at" IS NULL));



CREATE INDEX "idx_content_items_op_id" ON "public"."content_items" USING "btree" ("op_id") WHERE ("op_id" IS NOT NULL);



CREATE INDEX "idx_content_items_owner_freshness" ON "public"."content_items" USING "btree" ("content_owner_id", "freshness") WHERE (("content_owner_id" IS NOT NULL) AND (("freshness")::"text" = ANY (ARRAY[('stale'::character varying)::"text", ('expired'::character varying)::"text"])));



CREATE INDEX "idx_content_items_primary_domain" ON "public"."content_items" USING "btree" ("primary_domain");



CREATE INDEX "idx_content_items_primary_subtopic" ON "public"."content_items" USING "btree" ("primary_subtopic");



CREATE INDEX "idx_content_items_publication_status_published" ON "public"."content_items" USING "btree" ("publication_status") WHERE ("publication_status" = 'published'::"text");



CREATE INDEX "idx_content_items_published_recent" ON "public"."content_items" USING "btree" ("publication_status", "created_at" DESC) WHERE ("publication_status" = 'published'::"text");



CREATE INDEX "idx_content_items_qa_type" ON "public"."content_items" USING "btree" ("content_type") WHERE (("content_type")::"text" = 'q_a_pair'::"text");



CREATE INDEX "idx_content_items_quality_score" ON "public"."content_items" USING "btree" ("quality_score") WHERE ("archived_at" IS NULL);



CREATE INDEX "idx_content_items_secondary_domain" ON "public"."content_items" USING "btree" ("secondary_domain") WHERE ("secondary_domain" IS NOT NULL);



CREATE INDEX "idx_content_items_source_document_id" ON "public"."content_items" USING "btree" ("source_document_id") WHERE ("source_document_id" IS NOT NULL);



CREATE INDEX "idx_content_items_source_file" ON "public"."content_items" USING "btree" ("source_file") WHERE ("source_file" IS NOT NULL);



CREATE INDEX "idx_content_items_starred" ON "public"."content_items" USING "btree" ("id") WHERE ("starred" = true);



CREATE INDEX "idx_content_items_topic_id" ON "public"."content_items" USING "btree" ((("metadata" ->> 'topic_id'::"text"))) WHERE (("metadata" ->> 'topic_id'::"text") IS NOT NULL);



CREATE INDEX "idx_content_items_unverified" ON "public"."content_items" USING "btree" ("created_at" DESC) WHERE ("verified_at" IS NULL);



CREATE INDEX "idx_content_items_updated_by" ON "public"."content_items" USING "btree" ("updated_by");



CREATE INDEX "idx_content_items_verified_at" ON "public"."content_items" USING "btree" ("verified_at");



CREATE INDEX "idx_content_items_verified_by" ON "public"."content_items" USING "btree" ("verified_by");



CREATE INDEX "idx_content_templates_created_by" ON "public"."content_templates" USING "btree" ("created_by");



CREATE INDEX "idx_coverage_targets_created_by" ON "public"."coverage_targets" USING "btree" ("created_by");



CREATE INDEX "idx_coverage_targets_updated_by" ON "public"."coverage_targets" USING "btree" ("updated_by");



CREATE INDEX "idx_entity_aliases_active" ON "public"."entity_aliases" USING "btree" ("alias") WHERE ("is_active" = true);



CREATE INDEX "idx_entity_mentions_canonical" ON "public"."entity_mentions" USING "btree" ("canonical_name", "entity_type");



CREATE INDEX "idx_entity_mentions_canonical_lower" ON "public"."entity_mentions" USING "btree" ("lower"("canonical_name"));



CREATE INDEX "idx_entity_mentions_canonical_trgm" ON "public"."entity_mentions" USING "gin" ("canonical_name" "extensions"."gin_trgm_ops");



CREATE INDEX "idx_entity_mentions_content" ON "public"."entity_mentions" USING "btree" ("content_item_id");



CREATE INDEX "idx_entity_mentions_metadata_expiry" ON "public"."entity_mentions" USING "btree" ((("metadata" ->> 'expiry_date'::"text"))) WHERE (("metadata" ->> 'expiry_date'::"text") IS NOT NULL);



CREATE INDEX "idx_entity_mentions_op_id" ON "public"."entity_mentions" USING "btree" ("op_id") WHERE ("op_id" IS NOT NULL);



CREATE INDEX "idx_entity_mentions_type" ON "public"."entity_mentions" USING "btree" ("entity_type");



CREATE INDEX "idx_entity_pair_resolutions_op_id" ON "public"."entity_pair_resolutions" USING "btree" ("op_id") WHERE ("op_id" IS NOT NULL);



CREATE INDEX "idx_entity_relationships_content" ON "public"."entity_relationships" USING "btree" ("source_item_id");



CREATE INDEX "idx_entity_relationships_source" ON "public"."entity_relationships" USING "btree" ("source_entity");



CREATE INDEX "idx_entity_relationships_target" ON "public"."entity_relationships" USING "btree" ("target_entity");



CREATE INDEX "idx_entity_relationships_type" ON "public"."entity_relationships" USING "btree" ("relationship_type");



CREATE INDEX "idx_eval_baseline_audit_touchpoint_at" ON "public"."eval_baseline_audit" USING "btree" ("touchpoint_id", "at" DESC);



CREATE INDEX "idx_eval_baselines_touchpoint_promoted_at" ON "public"."eval_baselines" USING "btree" ("touchpoint_id", "promoted_at" DESC);



CREATE INDEX "idx_eval_runs_touchpoint_run_at" ON "public"."eval_runs" USING "btree" ("touchpoint_id", "run_at" DESC);



CREATE INDEX "idx_feed_articles_content_item_id" ON "public"."feed_articles" USING "btree" ("content_item_id");



CREATE UNIQUE INDEX "idx_feed_articles_dedup" ON "public"."feed_articles" USING "btree" ("workspace_id", "external_url");



CREATE INDEX "idx_feed_articles_external_id" ON "public"."feed_articles" USING "btree" ("external_id") WHERE ("external_id" IS NOT NULL);



CREATE INDEX "idx_feed_articles_external_url" ON "public"."feed_articles" USING "btree" ("external_url");



CREATE INDEX "idx_feed_articles_passed" ON "public"."feed_articles" USING "btree" ("workspace_id") WHERE ("passed" = true);



CREATE INDEX "idx_feed_articles_prompt_version_id" ON "public"."feed_articles" USING "btree" ("prompt_version_id");



CREATE INDEX "idx_feed_articles_reference_item_id" ON "public"."feed_articles" USING "btree" ("reference_item_id") WHERE ("reference_item_id" IS NOT NULL);



CREATE INDEX "idx_feed_articles_source" ON "public"."feed_articles" USING "btree" ("feed_source_id");



CREATE INDEX "idx_feed_articles_workspace" ON "public"."feed_articles" USING "btree" ("workspace_id");



CREATE INDEX "idx_feed_articles_workspace_ingested" ON "public"."feed_articles" USING "btree" ("workspace_id", "ingested_at");



CREATE INDEX "idx_feed_flags_article" ON "public"."feed_flags" USING "btree" ("feed_article_id");



CREATE INDEX "idx_feed_flags_flagged_by" ON "public"."feed_flags" USING "btree" ("flagged_by");



CREATE INDEX "idx_feed_flags_prompt_version_id" ON "public"."feed_flags" USING "btree" ("prompt_version_id");



CREATE INDEX "idx_feed_flags_resolved_by" ON "public"."feed_flags" USING "btree" ("resolved_by");



CREATE INDEX "idx_feed_flags_unresolved" ON "public"."feed_flags" USING "btree" ("feed_article_id") WHERE ("resolved" = false);



CREATE INDEX "idx_feed_prompts_active" ON "public"."feed_prompts" USING "btree" ("workspace_id") WHERE ("is_active" = true);



CREATE INDEX "idx_feed_prompts_created_by" ON "public"."feed_prompts" USING "btree" ("created_by");



CREATE INDEX "idx_feed_prompts_workspace" ON "public"."feed_prompts" USING "btree" ("workspace_id");



CREATE INDEX "idx_feed_sources_active" ON "public"."feed_sources" USING "btree" ("workspace_id") WHERE ("is_active" = true);



CREATE INDEX "idx_feed_sources_created_by" ON "public"."feed_sources" USING "btree" ("created_by");



CREATE INDEX "idx_feed_sources_workspace" ON "public"."feed_sources" USING "btree" ("workspace_id");



CREATE INDEX "idx_form_questions_assigned_to" ON "public"."form_questions" USING "btree" ("assigned_to");



CREATE INDEX "idx_form_questions_created_by" ON "public"."form_questions" USING "btree" ("created_by");



CREATE INDEX "idx_form_questions_status" ON "public"."form_questions" USING "btree" ("status");



CREATE INDEX "idx_form_questions_template_requirement_id" ON "public"."form_questions" USING "btree" ("template_requirement_id");



CREATE INDEX "idx_form_questions_workspace" ON "public"."form_questions" USING "btree" ("workspace_id");



CREATE INDEX "idx_form_response_history_edited_by" ON "public"."form_response_history" USING "btree" ("edited_by");



CREATE INDEX "idx_form_response_history_response" ON "public"."form_response_history" USING "btree" ("response_id", "version" DESC);



CREATE INDEX "idx_form_responses_approved_by" ON "public"."form_responses" USING "btree" ("approved_by");



CREATE INDEX "idx_form_responses_drafted_by" ON "public"."form_responses" USING "btree" ("drafted_by");



CREATE INDEX "idx_form_responses_last_edited_by" ON "public"."form_responses" USING "btree" ("last_edited_by");



CREATE INDEX "idx_form_responses_overall_score" ON "public"."form_responses" USING "btree" ("overall_score" DESC NULLS LAST) WHERE ("overall_score" IS NOT NULL);



CREATE INDEX "idx_form_responses_question" ON "public"."form_responses" USING "btree" ("question_id", "version" DESC);



CREATE INDEX "idx_form_template_fields_mapping" ON "public"."form_template_fields" USING "btree" ("template_id", "mapping_status");



CREATE INDEX "idx_form_template_fields_question" ON "public"."form_template_fields" USING "btree" ("question_id");



CREATE INDEX "idx_form_template_fields_template" ON "public"."form_template_fields" USING "btree" ("template_id");



CREATE INDEX "idx_form_template_requirements_current" ON "public"."form_template_requirements" USING "btree" ("template_name", "is_current") WHERE ("is_current" = true);



CREATE INDEX "idx_form_template_requirements_display_order" ON "public"."form_template_requirements" USING "btree" ("display_order");



CREATE INDEX "idx_form_template_requirements_domain" ON "public"."form_template_requirements" USING "btree" ("primary_domain", "primary_subtopic");



CREATE INDEX "idx_form_template_requirements_sector" ON "public"."form_template_requirements" USING "gin" ("sector_applicability");



CREATE INDEX "idx_form_template_requirements_template" ON "public"."form_template_requirements" USING "btree" ("template_name", "template_version");



CREATE INDEX "idx_form_templates_created_by" ON "public"."form_templates" USING "btree" ("created_by");



CREATE INDEX "idx_form_templates_form_type" ON "public"."form_templates" USING "btree" ("form_type") WHERE ("form_type" IS NOT NULL);



CREATE INDEX "idx_form_templates_status" ON "public"."form_templates" USING "btree" ("status");



CREATE INDEX "idx_form_templates_workspace" ON "public"."form_templates" USING "btree" ("workspace_id");



CREATE INDEX "idx_governance_config_created_by" ON "public"."governance_config" USING "btree" ("created_by");



CREATE INDEX "idx_governance_config_reviewer_id" ON "public"."governance_config" USING "btree" ("reviewer_id");



CREATE INDEX "idx_governance_config_updated_by" ON "public"."governance_config" USING "btree" ("updated_by");



CREATE INDEX "idx_guide_sections_guide_id" ON "public"."guide_sections" USING "btree" ("guide_id");



CREATE INDEX "idx_guide_sections_order" ON "public"."guide_sections" USING "btree" ("guide_id", "display_order");



CREATE INDEX "idx_guide_sections_parent_section_id" ON "public"."guide_sections" USING "btree" ("parent_section_id") WHERE ("parent_section_id" IS NOT NULL);



CREATE INDEX "idx_guides_created_by" ON "public"."guides" USING "btree" ("created_by");



CREATE INDEX "idx_guides_slug" ON "public"."guides" USING "btree" ("slug");



CREATE INDEX "idx_guides_type" ON "public"."guides" USING "btree" ("guide_type");



CREATE INDEX "idx_iql_review_needed_unresolved" ON "public"."ingestion_quality_log" USING "btree" ("content_item_id") WHERE (("flag_type" = 'review_needed'::"text") AND ("resolved" = false));



CREATE INDEX "idx_layer_vocabulary_active_order" ON "public"."layer_vocabulary" USING "btree" ("display_order") WHERE ("is_active" = true);



CREATE INDEX "idx_notifications_created_at" ON "public"."notifications" USING "btree" ("created_at");



CREATE INDEX "idx_notifications_entity" ON "public"."notifications" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC) WHERE (("read_at" IS NULL) AND ("dismissed_at" IS NULL));



CREATE INDEX "idx_pipeline_runs_created_by_created_at" ON "public"."pipeline_runs" USING "btree" ("created_by", "created_at" DESC);



CREATE INDEX "idx_pipeline_runs_name_started_at" ON "public"."pipeline_runs" USING "btree" ("pipeline_name", "started_at" DESC);



CREATE INDEX "idx_pipeline_runs_op_id" ON "public"."pipeline_runs" USING "btree" ("op_id") WHERE ("op_id" IS NOT NULL);



CREATE INDEX "idx_pipeline_runs_started_at" ON "public"."pipeline_runs" USING "btree" ("started_at" DESC);



CREATE INDEX "idx_pipeline_runs_workspace_id" ON "public"."pipeline_runs" USING "btree" ("workspace_id") WHERE ("workspace_id" IS NOT NULL);



CREATE INDEX "idx_processing_queue_created_by" ON "public"."processing_queue" USING "btree" ("created_by");



CREATE INDEX "idx_processing_queue_job_type" ON "public"."processing_queue" USING "btree" ("job_type");



CREATE INDEX "idx_processing_queue_status" ON "public"."processing_queue" USING "btree" ("status", "priority" DESC, "created_at");



CREATE INDEX "idx_q_a_extractions_op_id" ON "public"."q_a_extractions" USING "btree" ("op_id") WHERE ("op_id" IS NOT NULL);



CREATE INDEX "idx_q_a_pairs_anti_scope_tag" ON "public"."q_a_pairs" USING "gin" ("anti_scope_tag");



CREATE INDEX "idx_q_a_pairs_scope_tag" ON "public"."q_a_pairs" USING "gin" ("scope_tag");



CREATE INDEX "idx_quality_log_content_item" ON "public"."ingestion_quality_log" USING "btree" ("content_item_id");



CREATE INDEX "idx_question_matches_form_question_ranked" ON "public"."question_matches" USING "btree" ("form_question_id", "embedding_score" DESC, "fulltext_score" DESC);



CREATE INDEX "idx_question_matches_q_a_pair" ON "public"."question_matches" USING "btree" ("q_a_pair_id");



CREATE INDEX "idx_read_marks_content_item_id" ON "public"."read_marks" USING "btree" ("content_item_id");



CREATE INDEX "idx_read_marks_user" ON "public"."read_marks" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_read_marks_user_item" ON "public"."read_marks" USING "btree" ("user_id", "content_item_id");



CREATE INDEX "idx_reference_items_embedding" ON "public"."reference_items" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



CREATE INDEX "idx_reference_items_published_at" ON "public"."reference_items" USING "btree" ("published_at" DESC);



CREATE INDEX "idx_reference_items_source_document_id" ON "public"."reference_items" USING "btree" ("source_document_id");



CREATE INDEX "idx_review_assignments_assigned_by" ON "public"."review_assignments" USING "btree" ("assigned_by");



CREATE INDEX "idx_review_assignments_reviewer" ON "public"."review_assignments" USING "btree" ("reviewer_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_review_assignments_status" ON "public"."review_assignments" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_si_processing_queue_source" ON "public"."si_processing_queue" USING "btree" ("feed_source_id");



CREATE INDEX "idx_si_processing_queue_status" ON "public"."si_processing_queue" USING "btree" ("status") WHERE (("status")::"text" = ANY (ARRAY[('pending'::character varying)::"text", ('processing'::character varying)::"text"]));



CREATE INDEX "idx_si_processing_queue_workspace" ON "public"."si_processing_queue" USING "btree" ("workspace_id");



CREATE INDEX "idx_source_document_diffs_affected_item" ON "public"."source_document_diffs" USING "btree" ("affected_content_item_id") WHERE ("affected_content_item_id" IS NOT NULL);



CREATE INDEX "idx_source_document_diffs_created_by" ON "public"."source_document_diffs" USING "btree" ("created_by");



CREATE INDEX "idx_source_document_diffs_new_doc" ON "public"."source_document_diffs" USING "btree" ("new_document_id");



CREATE INDEX "idx_source_document_diffs_old_doc" ON "public"."source_document_diffs" USING "btree" ("old_document_id");



CREATE INDEX "idx_source_document_diffs_reviewed_by" ON "public"."source_document_diffs" USING "btree" ("reviewed_by") WHERE ("reviewed_by" IS NOT NULL);



CREATE INDEX "idx_source_document_diffs_status" ON "public"."source_document_diffs" USING "btree" ("status") WHERE ("status" = 'pending_review'::"text");



CREATE INDEX "idx_source_documents_archived_by" ON "public"."source_documents" USING "btree" ("archived_by");



CREATE INDEX "idx_source_documents_content_hash" ON "public"."source_documents" USING "btree" ("content_hash");



CREATE INDEX "idx_source_documents_filename_uploaded_by" ON "public"."source_documents" USING "btree" ("filename", "uploaded_by");



CREATE INDEX "idx_source_documents_op_id" ON "public"."source_documents" USING "btree" ("op_id") WHERE ("op_id" IS NOT NULL);



CREATE INDEX "idx_source_documents_parent_id" ON "public"."source_documents" USING "btree" ("parent_id") WHERE ("parent_id" IS NOT NULL);



CREATE INDEX "idx_source_documents_pipeline_run_id" ON "public"."source_documents" USING "btree" ("pipeline_run_id");



CREATE INDEX "idx_source_documents_pullmd_share_id" ON "public"."source_documents" USING "btree" ("pullmd_share_id") WHERE ("pullmd_share_id" IS NOT NULL);



CREATE INDEX "idx_source_documents_source_url" ON "public"."source_documents" USING "btree" ("source_url") WHERE ("source_url" IS NOT NULL);



CREATE INDEX "idx_source_documents_uploaded_by" ON "public"."source_documents" USING "btree" ("uploaded_by");



CREATE INDEX "idx_source_documents_workspace_id" ON "public"."source_documents" USING "btree" ("workspace_id");



CREATE INDEX "idx_tag_morphology_drift_flags_decision" ON "public"."tag_morphology_drift_flags" USING "btree" ("decision") WHERE ("decision" = 'pending'::"text");



CREATE INDEX "idx_tag_morphology_drift_flags_detected_at" ON "public"."tag_morphology_drift_flags" USING "btree" ("detected_at" DESC);



CREATE INDEX "idx_taxonomy_subtopics_domain" ON "public"."taxonomy_subtopics" USING "btree" ("domain_id");



CREATE UNIQUE INDEX "idx_taxonomy_sync_state_singleton" ON "public"."taxonomy_sync_state" USING "btree" ((true));



CREATE INDEX "idx_template_completions_created_by" ON "public"."template_completions" USING "btree" ("created_by");



CREATE INDEX "idx_template_completions_job_id" ON "public"."template_completions" USING "btree" ("job_id");



CREATE INDEX "idx_template_completions_template" ON "public"."template_completions" USING "btree" ("template_id");



CREATE INDEX "idx_user_roles_granted_by" ON "public"."user_roles" USING "btree" ("granted_by");



CREATE INDEX "idx_verification_history_item" ON "public"."verification_history" USING "btree" ("content_item_id", "performed_at" DESC);



CREATE INDEX "idx_verification_history_user" ON "public"."verification_history" USING "btree" ("performed_by", "performed_at" DESC);



CREATE INDEX "idx_workspaces_application_type" ON "public"."workspaces" USING "btree" ("application_type_id");



CREATE INDEX "idx_workspaces_created_by" ON "public"."workspaces" USING "btree" ("created_by");



CREATE INDEX "idx_workspaces_updated_by" ON "public"."workspaces" USING "btree" ("updated_by");



CREATE UNIQUE INDEX "processing_queue_idempotency_key_uniq" ON "public"."processing_queue" USING "btree" ("idempotency_key") WHERE ("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text"]));



CREATE UNIQUE INDEX "uq_form_responses_question" ON "public"."form_responses" USING "btree" ("question_id");



CREATE UNIQUE INDEX "uq_q_a_extractions_promoted_to_pair_id" ON "public"."q_a_extractions" USING "btree" ("promoted_to_pair_id") WHERE ("promoted_to_pair_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "form_response_history_snapshot" BEFORE UPDATE ON "public"."form_responses" FOR EACH ROW EXECUTE FUNCTION "public"."snapshot_form_response_history"();



CREATE OR REPLACE TRIGGER "form_response_set_version" BEFORE INSERT OR UPDATE ON "public"."form_responses" FOR EACH ROW EXECUTE FUNCTION "public"."bid_response_auto_version"();



CREATE OR REPLACE TRIGGER "q_a_pairs_history_on_update" AFTER UPDATE ON "public"."q_a_pairs" FOR EACH ROW EXECUTE FUNCTION "public"."q_a_pairs_history_trigger"();



CREATE OR REPLACE TRIGGER "set_classification_disputes_updated_at_trigger" BEFORE UPDATE ON "public"."classification_disputes" FOR EACH ROW EXECUTE FUNCTION "public"."set_classification_disputes_updated_at"();



CREATE OR REPLACE TRIGGER "set_company_profiles_updated_at" BEFORE UPDATE ON "public"."company_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_content_history_version" BEFORE INSERT ON "public"."content_history" FOR EACH ROW EXECUTE FUNCTION "public"."auto_version_content_history"();



CREATE OR REPLACE TRIGGER "set_content_items_updated_at" BEFORE UPDATE ON "public"."content_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_eval_touchpoints_updated_at" BEFORE UPDATE ON "public"."eval_touchpoints" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_feed_articles_updated_at" BEFORE UPDATE ON "public"."feed_articles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_feed_sources_updated_at" BEFORE UPDATE ON "public"."feed_sources" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_form_questions_updated_at" BEFORE UPDATE ON "public"."form_questions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_form_responses_updated_at" BEFORE UPDATE ON "public"."form_responses" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_governance_config_updated_at" BEFORE UPDATE ON "public"."governance_config" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_projects_updated_at" BEFORE UPDATE ON "public"."workspaces" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_reference_items_updated_at" BEFORE UPDATE ON "public"."reference_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_review_assignments_updated_at" BEFORE UPDATE ON "public"."review_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_template_fields_updated_at" BEFORE UPDATE ON "public"."form_template_fields" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_template_requirements_updated_at" BEFORE UPDATE ON "public"."form_template_requirements" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_templates_updated_at" BEFORE UPDATE ON "public"."form_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_user_roles_updated_at" BEFORE UPDATE ON "public"."user_roles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_citation_count_delete" AFTER DELETE ON "public"."citations" FOR EACH ROW EXECUTE FUNCTION "public"."update_citation_count"();



CREATE OR REPLACE TRIGGER "trg_citation_count_insert" AFTER INSERT ON "public"."citations" FOR EACH ROW EXECUTE FUNCTION "public"."update_citation_count"();



CREATE OR REPLACE TRIGGER "trg_coerce_empty_classification_to_null" BEFORE INSERT OR UPDATE ON "public"."content_items" FOR EACH ROW EXECUTE FUNCTION "public"."coerce_empty_classification_to_null"();



CREATE CONSTRAINT TRIGGER "trg_content_items_ensure_v1_history" AFTER INSERT ON "public"."content_items" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."ensure_v1_history_at_commit"();



COMMENT ON TRIGGER "trg_content_items_ensure_v1_history" ON "public"."content_items" IS 'Structural backstop (S186 WP-E) - if an ingest path forgets to write v1 history, this trigger writes one at transaction commit with change_reason = auto_v1_on_insert. Observability: SELECT change_reason, COUNT(*) FROM content_history WHERE version=1 GROUP BY 1 flags paths that rely on the backstop.';



CREATE OR REPLACE TRIGGER "trg_enforce_archive_state_consistency" BEFORE UPDATE ON "public"."content_items" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_archive_state_consistency"();



CREATE OR REPLACE TRIGGER "trg_user_notification_prefs_updated_at" BEFORE UPDATE ON "public"."user_notification_prefs" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_notification_prefs_updated_at"();



CREATE OR REPLACE TRIGGER "trg_validate_layer_key" BEFORE INSERT OR UPDATE OF "layer" ON "public"."content_items" FOR EACH ROW EXECUTE FUNCTION "public"."validate_layer_key"();



CREATE OR REPLACE TRIGGER "trg_validate_reference_items_layer" BEFORE INSERT OR UPDATE OF "layer" ON "public"."reference_items" FOR EACH ROW EXECUTE FUNCTION "public"."validate_layer_key"();



ALTER TABLE ONLY "public"."ai_call_events"
    ADD CONSTRAINT "ai_call_events_touchpoint_id_fkey" FOREIGN KEY ("touchpoint_id") REFERENCES "public"."eval_touchpoints"("touchpoint_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."citations"
    ADD CONSTRAINT "citations_cited_content_item_id_fkey" FOREIGN KEY ("cited_content_item_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."citations"
    ADD CONSTRAINT "citations_cited_q_a_pair_id_fkey" FOREIGN KEY ("cited_q_a_pair_id") REFERENCES "public"."q_a_pairs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."citations"
    ADD CONSTRAINT "citations_citing_form_response_id_fkey" FOREIGN KEY ("citing_form_response_id") REFERENCES "public"."form_responses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."citations"
    ADD CONSTRAINT "citations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."classification_disputes"
    ADD CONSTRAINT "classification_disputes_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."classification_disputes"
    ADD CONSTRAINT "classification_disputes_disputed_by_fkey" FOREIGN KEY ("disputed_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."classification_disputes"
    ADD CONSTRAINT "classification_disputes_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."company_profiles"
    ADD CONSTRAINT "company_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."competitor_research_workspaces"
    ADD CONSTRAINT "competitor_research_workspaces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_chunks"
    ADD CONSTRAINT "content_chunks_parent_chunk_id_fkey" FOREIGN KEY ("parent_chunk_id") REFERENCES "public"."content_chunks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_history"
    ADD CONSTRAINT "content_history_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content_history"
    ADD CONSTRAINT "content_history_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."content_item_workspaces"
    ADD CONSTRAINT "content_item_workspaces_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_item_workspaces"
    ADD CONSTRAINT "content_item_workspaces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_content_owner_id_fkey" FOREIGN KEY ("content_owner_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_governance_reviewer_id_fkey" FOREIGN KEY ("governance_reviewer_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_superseded_by_fkey" FOREIGN KEY ("superseded_by") REFERENCES "public"."content_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content_templates"
    ADD CONSTRAINT "content_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."coverage_targets"
    ADD CONSTRAINT "coverage_targets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."coverage_targets"
    ADD CONSTRAINT "coverage_targets_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."taxonomy_domains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coverage_targets"
    ADD CONSTRAINT "coverage_targets_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."entity_relationships"
    ADD CONSTRAINT "entity_relationships_source_item_id_fkey" FOREIGN KEY ("source_item_id") REFERENCES "public"."content_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."eval_baseline_audit"
    ADD CONSTRAINT "eval_baseline_audit_touchpoint_id_fkey" FOREIGN KEY ("touchpoint_id") REFERENCES "public"."eval_touchpoints"("touchpoint_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eval_baselines"
    ADD CONSTRAINT "eval_baselines_touchpoint_id_fkey" FOREIGN KEY ("touchpoint_id") REFERENCES "public"."eval_touchpoints"("touchpoint_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eval_runs"
    ADD CONSTRAINT "eval_runs_touchpoint_id_fkey" FOREIGN KEY ("touchpoint_id") REFERENCES "public"."eval_touchpoints"("touchpoint_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feed_articles"
    ADD CONSTRAINT "feed_articles_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feed_articles"
    ADD CONSTRAINT "feed_articles_feed_source_id_fkey" FOREIGN KEY ("feed_source_id") REFERENCES "public"."feed_sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feed_articles"
    ADD CONSTRAINT "feed_articles_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."feed_prompts"("id");



ALTER TABLE ONLY "public"."feed_articles"
    ADD CONSTRAINT "feed_articles_reference_item_id_fkey" FOREIGN KEY ("reference_item_id") REFERENCES "public"."reference_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feed_articles"
    ADD CONSTRAINT "feed_articles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feed_flags"
    ADD CONSTRAINT "feed_flags_feed_article_id_fkey" FOREIGN KEY ("feed_article_id") REFERENCES "public"."feed_articles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feed_flags"
    ADD CONSTRAINT "feed_flags_flagged_by_fkey" FOREIGN KEY ("flagged_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."feed_flags"
    ADD CONSTRAINT "feed_flags_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."feed_prompts"("id");



ALTER TABLE ONLY "public"."feed_flags"
    ADD CONSTRAINT "feed_flags_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."feed_prompts"
    ADD CONSTRAINT "feed_prompts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."feed_prompts"
    ADD CONSTRAINT "feed_prompts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feed_sources"
    ADD CONSTRAINT "feed_sources_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."feed_sources"
    ADD CONSTRAINT "feed_sources_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_questions"
    ADD CONSTRAINT "form_questions_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."form_questions"
    ADD CONSTRAINT "form_questions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."form_questions"
    ADD CONSTRAINT "form_questions_template_requirement_id_fkey" FOREIGN KEY ("template_requirement_id") REFERENCES "public"."form_template_requirements"("id");



ALTER TABLE ONLY "public"."form_questions"
    ADD CONSTRAINT "form_questions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_response_history"
    ADD CONSTRAINT "form_response_history_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."form_response_history"
    ADD CONSTRAINT "form_response_history_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."form_responses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_responses"
    ADD CONSTRAINT "form_responses_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."form_responses"
    ADD CONSTRAINT "form_responses_drafted_by_fkey" FOREIGN KEY ("drafted_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."form_responses"
    ADD CONSTRAINT "form_responses_last_edited_by_fkey" FOREIGN KEY ("last_edited_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."form_responses"
    ADD CONSTRAINT "form_responses_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."form_questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_template_fields"
    ADD CONSTRAINT "form_template_fields_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."form_questions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."form_template_requirements"
    ADD CONSTRAINT "form_template_requirements_template_type_fkey" FOREIGN KEY ("template_type") REFERENCES "public"."form_types"("key") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."form_templates"
    ADD CONSTRAINT "form_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."form_templates"
    ADD CONSTRAINT "form_templates_form_type_fkey" FOREIGN KEY ("form_type") REFERENCES "public"."form_types"("key");



ALTER TABLE ONLY "public"."form_templates"
    ADD CONSTRAINT "form_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."governance_config"
    ADD CONSTRAINT "governance_config_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."governance_config"
    ADD CONSTRAINT "governance_config_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."governance_config"
    ADD CONSTRAINT "governance_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."guide_sections"
    ADD CONSTRAINT "guide_sections_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "public"."guides"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."guide_sections"
    ADD CONSTRAINT "guide_sections_parent_section_id_fkey" FOREIGN KEY ("parent_section_id") REFERENCES "public"."guide_sections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."guides"
    ADD CONSTRAINT "guides_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."ingestion_quality_log"
    ADD CONSTRAINT "ingestion_quality_log_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."intelligence_workspaces"
    ADD CONSTRAINT "intelligence_workspaces_company_profile_id_fkey" FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."intelligence_workspaces"
    ADD CONSTRAINT "intelligence_workspaces_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "public"."guides"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."intelligence_workspaces"
    ADD CONSTRAINT "intelligence_workspaces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."pipeline_runs"
    ADD CONSTRAINT "pipeline_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."pipeline_runs"
    ADD CONSTRAINT "pipeline_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."procurement_vehicle_instances"
    ADD CONSTRAINT "procurement_vehicle_instances_vehicle_key_fkey" FOREIGN KEY ("vehicle_key") REFERENCES "public"."procurement_vehicles"("key") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."procurement_workspaces"
    ADD CONSTRAINT "procurement_workspaces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_guide_workspaces"
    ADD CONSTRAINT "product_guide_workspaces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."q_a_extractions"
    ADD CONSTRAINT "q_a_extractions_promoted_to_pair_id_fkey" FOREIGN KEY ("promoted_to_pair_id") REFERENCES "public"."q_a_pairs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."q_a_pair_history"
    ADD CONSTRAINT "q_a_pair_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."q_a_pair_history"
    ADD CONSTRAINT "q_a_pair_history_q_a_pair_id_fkey" FOREIGN KEY ("q_a_pair_id") REFERENCES "public"."q_a_pairs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."q_a_pairs"
    ADD CONSTRAINT "q_a_pairs_source_form_response_id_fkey" FOREIGN KEY ("source_form_response_id") REFERENCES "public"."form_responses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."q_a_pairs"
    ADD CONSTRAINT "q_a_pairs_source_question_id_fkey" FOREIGN KEY ("source_question_id") REFERENCES "public"."form_questions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."q_a_pairs"
    ADD CONSTRAINT "q_a_pairs_source_workspace_id_fkey" FOREIGN KEY ("source_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."q_a_pairs"
    ADD CONSTRAINT "q_a_pairs_superseded_by_fkey" FOREIGN KEY ("superseded_by") REFERENCES "public"."q_a_pairs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."question_matches"
    ADD CONSTRAINT "question_matches_form_question_id_fkey" FOREIGN KEY ("form_question_id") REFERENCES "public"."form_questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."question_matches"
    ADD CONSTRAINT "question_matches_q_a_pair_id_fkey" FOREIGN KEY ("q_a_pair_id") REFERENCES "public"."q_a_pairs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."question_matches"
    ADD CONSTRAINT "question_matches_question_kind_fkey" FOREIGN KEY ("question_kind") REFERENCES "public"."form_types"("key") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."read_marks"
    ADD CONSTRAINT "read_marks_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."read_marks"
    ADD CONSTRAINT "read_marks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."reference_items"
    ADD CONSTRAINT "reference_items_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."review_assignments"
    ADD CONSTRAINT "review_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."review_assignments"
    ADD CONSTRAINT "review_assignments_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."sales_proposal_workspaces"
    ADD CONSTRAINT "sales_proposal_workspaces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."si_processing_queue"
    ADD CONSTRAINT "si_processing_queue_feed_source_id_fkey" FOREIGN KEY ("feed_source_id") REFERENCES "public"."feed_sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."si_processing_queue"
    ADD CONSTRAINT "si_processing_queue_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."source_document_diffs"
    ADD CONSTRAINT "source_document_diffs_affected_content_item_id_fkey" FOREIGN KEY ("affected_content_item_id") REFERENCES "public"."content_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_document_diffs"
    ADD CONSTRAINT "source_document_diffs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_document_diffs"
    ADD CONSTRAINT "source_document_diffs_new_document_id_fkey" FOREIGN KEY ("new_document_id") REFERENCES "public"."source_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."source_document_diffs"
    ADD CONSTRAINT "source_document_diffs_old_document_id_fkey" FOREIGN KEY ("old_document_id") REFERENCES "public"."source_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."source_document_diffs"
    ADD CONSTRAINT "source_document_diffs_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_documents"
    ADD CONSTRAINT "source_documents_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_documents"
    ADD CONSTRAINT "source_documents_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."source_documents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_documents"
    ADD CONSTRAINT "source_documents_pipeline_run_id_fkey" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_documents"
    ADD CONSTRAINT "source_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_documents"
    ADD CONSTRAINT "source_documents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tag_morphology_drift_flags"
    ADD CONSTRAINT "tag_morphology_drift_flags_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."taxonomy_subtopics"
    ADD CONSTRAINT "taxonomy_subtopics_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."taxonomy_domains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."template_completions"
    ADD CONSTRAINT "template_completions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."template_completions"
    ADD CONSTRAINT "template_completions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."processing_queue"("id");



ALTER TABLE ONLY "public"."template_completions"
    ADD CONSTRAINT "template_completions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_onboarding_workspaces"
    ADD CONSTRAINT "training_onboarding_workspaces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_notification_prefs"
    ADD CONSTRAINT "user_notification_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."verification_history"
    ADD CONSTRAINT "verification_history_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."verification_history"
    ADD CONSTRAINT "verification_history_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_application_type_id_fkey" FOREIGN KEY ("application_type_id") REFERENCES "public"."application_types"("id");



CREATE POLICY "Admin and editor can insert company_profiles" ON "public"."company_profiles" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Admin and editor can insert feed_articles" ON "public"."feed_articles" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Admin and editor can insert feed_flags" ON "public"."feed_flags" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Admin and editor can insert feed_sources" ON "public"."feed_sources" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Admin and editor can read company_profiles" ON "public"."company_profiles" FOR SELECT TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Admin and editor can update company_profiles" ON "public"."company_profiles" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"]))) WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Admin and editor can update feed_articles" ON "public"."feed_articles" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"]))) WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Admin and editor can update feed_flags" ON "public"."feed_flags" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"]))) WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Admin and editor can update feed_sources" ON "public"."feed_sources" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"]))) WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Admin can delete company_profiles" ON "public"."company_profiles" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin can delete feed_articles" ON "public"."feed_articles" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin can delete feed_flags" ON "public"."feed_flags" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin can delete feed_prompts" ON "public"."feed_prompts" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin can delete feed_sources" ON "public"."feed_sources" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin can manage feed_prompts" ON "public"."feed_prompts" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin can update feed_prompts" ON "public"."feed_prompts" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin read taxonomy_sync_state" ON "public"."taxonomy_sync_state" FOR SELECT USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin write taxonomy_sync_state" ON "public"."taxonomy_sync_state" FOR UPDATE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin: DELETE entity_aliases" ON "public"."entity_aliases" FOR DELETE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "Admin: DELETE layer_vocabulary" ON "public"."layer_vocabulary" FOR DELETE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "Admin: INSERT entity_aliases" ON "public"."entity_aliases" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "Admin: INSERT layer_vocabulary" ON "public"."layer_vocabulary" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "Admin: UPDATE entity_aliases" ON "public"."entity_aliases" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text")) WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "Admin: UPDATE layer_vocabulary" ON "public"."layer_vocabulary" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text")) WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "Admins can delete citations" ON "public"."citations" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admins can delete entity mentions" ON "public"."entity_mentions" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admins can delete entity relationships" ON "public"."entity_relationships" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admins can delete form response history" ON "public"."form_response_history" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admins can delete guides" ON "public"."guides" FOR DELETE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "Admins can delete source documents" ON "public"."source_documents" FOR DELETE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));



CREATE POLICY "All authenticated: SELECT entity_aliases" ON "public"."entity_aliases" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "All authenticated: SELECT layer_vocabulary" ON "public"."layer_vocabulary" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read feed_articles" ON "public"."feed_articles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read feed_flags" ON "public"."feed_flags" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read feed_prompts" ON "public"."feed_prompts" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read feed_sources" ON "public"."feed_sources" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read guide sections" ON "public"."guide_sections" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."guides" "g"
  WHERE (("g"."id" = "guide_sections"."guide_id") AND (("g"."is_published" = true) OR (( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"))))));



CREATE POLICY "Authenticated users can read guides" ON "public"."guides" FOR SELECT TO "authenticated" USING ((("is_published" = true) OR (( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text")));



CREATE POLICY "Authenticated users can read si_processing_queue" ON "public"."si_processing_queue" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view citations" ON "public"."citations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view diffs" ON "public"."source_document_diffs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view entity mentions" ON "public"."entity_mentions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view entity relationships" ON "public"."entity_relationships" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view form response history" ON "public"."form_response_history" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view source documents" ON "public"."source_documents" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Editors and admins can create source documents" ON "public"."source_documents" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['editor'::"text", 'admin'::"text"])));



CREATE POLICY "Editors and admins can delete guide sections" ON "public"."guide_sections" FOR DELETE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can insert entity mentions" ON "public"."entity_mentions" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can insert entity relationships" ON "public"."entity_relationships" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can insert form response history" ON "public"."form_response_history" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can insert guide sections" ON "public"."guide_sections" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can insert guides" ON "public"."guides" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can manage citations" ON "public"."citations" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "Editors and admins can update citations" ON "public"."citations" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



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



CREATE POLICY "Users can insert own notification prefs" ON "public"."user_notification_prefs" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own notification prefs" ON "public"."user_notification_prefs" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view own notification prefs" ON "public"."user_notification_prefs" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "admin_editor_delete_tag_morphology_drift_flags" ON "public"."tag_morphology_drift_flags" FOR DELETE USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "admin_editor_insert_tag_morphology_drift_flags" ON "public"."tag_morphology_drift_flags" FOR INSERT WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "admin_editor_read_tag_morphology_drift_flags" ON "public"."tag_morphology_drift_flags" FOR SELECT USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "admin_editor_update_tag_morphology_drift_flags" ON "public"."tag_morphology_drift_flags" FOR UPDATE USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"]))) WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."ai_call_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_call_events_select_admin" ON "public"."ai_call_events" FOR SELECT TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."application_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "application_types_select_all" ON "public"."application_types" FOR SELECT USING (true);



CREATE POLICY "auth_admin_reads_signup_policy" ON "public"."signup_policy" FOR SELECT TO "supabase_auth_admin" USING (true);



ALTER TABLE "public"."change_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "change_reports_delete" ON "public"."change_reports" FOR DELETE USING (("auth"."role"() = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));



CREATE POLICY "change_reports_insert" ON "public"."change_reports" FOR INSERT WITH CHECK (("auth"."role"() = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));



CREATE POLICY "change_reports_select" ON "public"."change_reports" FOR SELECT USING (true);



ALTER TABLE "public"."citations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ciw_delete" ON "public"."content_item_workspaces" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "ciw_insert" ON "public"."content_item_workspaces" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "ciw_select" ON "public"."content_item_workspaces" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "ciw_update" ON "public"."content_item_workspaces" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"]))) WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."classification_disputes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "classification_disputes_delete_admin_rejected_only" ON "public"."classification_disputes" FOR DELETE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") AND ("status" = 'rejected'::"text")));



CREATE POLICY "classification_disputes_insert" ON "public"."classification_disputes" FOR INSERT WITH CHECK ((("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])) AND ("disputed_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("status" = 'open'::"text") AND ("resolved_by" IS NULL) AND ("resolved_at" IS NULL) AND ("resolution_notes" IS NULL)));



CREATE POLICY "classification_disputes_select" ON "public"."classification_disputes" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR (("public"."get_user_role"() = 'editor'::"text") AND ("disputed_by" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "classification_disputes_update_admin" ON "public"."classification_disputes" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."company_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."competitor_research_workspaces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "competitor_research_workspaces_delete" ON "public"."competitor_research_workspaces" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "competitor_research_workspaces"."workspace_id"))));



CREATE POLICY "competitor_research_workspaces_insert" ON "public"."competitor_research_workspaces" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "competitor_research_workspaces"."workspace_id"))));



CREATE POLICY "competitor_research_workspaces_select" ON "public"."competitor_research_workspaces" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "competitor_research_workspaces"."workspace_id"))));



CREATE POLICY "competitor_research_workspaces_update" ON "public"."competitor_research_workspaces" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "competitor_research_workspaces"."workspace_id")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "competitor_research_workspaces"."workspace_id"))));



ALTER TABLE "public"."content_chunks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_chunks_delete" ON "public"."content_chunks" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "content_chunks_insert" ON "public"."content_chunks" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "content_chunks_select" ON "public"."content_chunks" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "content_chunks_update" ON "public"."content_chunks" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."content_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_history_insert" ON "public"."content_history" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "content_history_select" ON "public"."content_history" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."content_item_workspaces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_items_delete" ON "public"."content_items" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "content_items_insert" ON "public"."content_items" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "content_items_select" ON "public"."content_items" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "content_items_update" ON "public"."content_items" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."content_propagation_version" ENABLE ROW LEVEL SECURITY;


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



ALTER TABLE "public"."entity_aliases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."entity_mentions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."entity_pair_resolutions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."entity_relationships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."eval_baseline_audit" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "eval_baseline_audit_insert_admin" ON "public"."eval_baseline_audit" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "eval_baseline_audit_select_admin" ON "public"."eval_baseline_audit" FOR SELECT TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."eval_baselines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "eval_baselines_insert_admin" ON "public"."eval_baselines" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "eval_baselines_select_admin" ON "public"."eval_baselines" FOR SELECT TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."eval_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "eval_runs_select_admin" ON "public"."eval_runs" FOR SELECT TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."eval_touchpoints" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "eval_touchpoints_delete_admin" ON "public"."eval_touchpoints" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "eval_touchpoints_insert_admin" ON "public"."eval_touchpoints" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "eval_touchpoints_select_admin" ON "public"."eval_touchpoints" FOR SELECT TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "eval_touchpoints_update_admin" ON "public"."eval_touchpoints" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."feed_articles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feed_flags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feed_prompts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feed_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."form_questions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_questions_delete" ON "public"."form_questions" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "form_questions_insert" ON "public"."form_questions" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "form_questions_select" ON "public"."form_questions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "form_questions_update" ON "public"."form_questions" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."form_response_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."form_responses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_responses_delete" ON "public"."form_responses" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "form_responses_insert" ON "public"."form_responses" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "form_responses_select" ON "public"."form_responses" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "form_responses_update" ON "public"."form_responses" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."form_template_fields" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."form_template_requirements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."form_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_templates_select" ON "public"."form_templates" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "form_templates"."workspace_id"))));



ALTER TABLE "public"."form_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_types_select_all" ON "public"."form_types" FOR SELECT USING (true);



ALTER TABLE "public"."governance_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "governance_config_delete" ON "public"."governance_config" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "governance_config_insert" ON "public"."governance_config" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "governance_config_select" ON "public"."governance_config" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "governance_config_update" ON "public"."governance_config" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."guide_sections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."guides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ingestion_quality_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."intelligence_workspaces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "intelligence_workspaces_delete" ON "public"."intelligence_workspaces" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "intelligence_workspaces"."workspace_id"))));



CREATE POLICY "intelligence_workspaces_insert" ON "public"."intelligence_workspaces" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "intelligence_workspaces"."workspace_id"))));



CREATE POLICY "intelligence_workspaces_select" ON "public"."intelligence_workspaces" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "intelligence_workspaces"."workspace_id"))));



CREATE POLICY "intelligence_workspaces_update" ON "public"."intelligence_workspaces" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "intelligence_workspaces"."workspace_id")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "intelligence_workspaces"."workspace_id"))));



ALTER TABLE "public"."layer_vocabulary" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_delete" ON "public"."notifications" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "notifications_insert" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "notifications_select" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "notifications_update" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."pipeline_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pipeline_runs_delete" ON "public"."pipeline_runs" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "pipeline_runs_insert" ON "public"."pipeline_runs" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "pipeline_runs_select" ON "public"."pipeline_runs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "pipeline_runs_update" ON "public"."pipeline_runs" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."processing_queue" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "processing_queue_delete_admin" ON "public"."processing_queue" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "processing_queue_insert_editor_admin" ON "public"."processing_queue" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['editor'::"text", 'admin'::"text"])));



CREATE POLICY "processing_queue_select_admin" ON "public"."processing_queue" FOR SELECT TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "processing_queue_update_admin" ON "public"."processing_queue" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."procurement_vehicle_instances" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "procurement_vehicle_instances_select_all" ON "public"."procurement_vehicle_instances" FOR SELECT USING (true);



ALTER TABLE "public"."procurement_vehicles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "procurement_vehicles_select_all" ON "public"."procurement_vehicles" FOR SELECT USING (true);



ALTER TABLE "public"."procurement_workspaces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "procurement_workspaces_delete" ON "public"."procurement_workspaces" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "procurement_workspaces"."workspace_id"))));



CREATE POLICY "procurement_workspaces_insert" ON "public"."procurement_workspaces" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "procurement_workspaces"."workspace_id"))));



CREATE POLICY "procurement_workspaces_select" ON "public"."procurement_workspaces" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "procurement_workspaces"."workspace_id"))));



CREATE POLICY "procurement_workspaces_update" ON "public"."procurement_workspaces" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "procurement_workspaces"."workspace_id")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "procurement_workspaces"."workspace_id"))));



ALTER TABLE "public"."product_guide_workspaces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_guide_workspaces_delete" ON "public"."product_guide_workspaces" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "product_guide_workspaces"."workspace_id"))));



CREATE POLICY "product_guide_workspaces_insert" ON "public"."product_guide_workspaces" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "product_guide_workspaces"."workspace_id"))));



CREATE POLICY "product_guide_workspaces_select" ON "public"."product_guide_workspaces" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "product_guide_workspaces"."workspace_id"))));



CREATE POLICY "product_guide_workspaces_update" ON "public"."product_guide_workspaces" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "product_guide_workspaces"."workspace_id")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "product_guide_workspaces"."workspace_id"))));



ALTER TABLE "public"."q_a_extractions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "q_a_extractions_delete" ON "public"."q_a_extractions" FOR DELETE USING (("auth"."role"() = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));



CREATE POLICY "q_a_extractions_insert" ON "public"."q_a_extractions" FOR INSERT WITH CHECK (("auth"."role"() = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));



CREATE POLICY "q_a_extractions_select" ON "public"."q_a_extractions" FOR SELECT USING (true);



CREATE POLICY "q_a_extractions_update" ON "public"."q_a_extractions" FOR UPDATE USING (("auth"."role"() = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));



ALTER TABLE "public"."q_a_pair_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "q_a_pair_history_select" ON "public"."q_a_pair_history" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."q_a_pairs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "q_a_pairs_delete" ON "public"."q_a_pairs" FOR DELETE USING (("auth"."role"() = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));



CREATE POLICY "q_a_pairs_insert" ON "public"."q_a_pairs" FOR INSERT WITH CHECK (("auth"."role"() = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));



CREATE POLICY "q_a_pairs_select" ON "public"."q_a_pairs" FOR SELECT USING (true);



CREATE POLICY "q_a_pairs_update" ON "public"."q_a_pairs" FOR UPDATE USING (("auth"."role"() = ANY (ARRAY['authenticated'::"text", 'service_role'::"text"])));



CREATE POLICY "quality_log_insert" ON "public"."ingestion_quality_log" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "quality_log_select" ON "public"."ingestion_quality_log" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "quality_log_update" ON "public"."ingestion_quality_log" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."question_matches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "question_matches_delete_admin" ON "public"."question_matches" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "question_matches_insert_editor_admin" ON "public"."question_matches" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "question_matches_select_authenticated" ON "public"."question_matches" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "question_matches_update_editor_admin" ON "public"."question_matches" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."read_marks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read_marks_delete" ON "public"."read_marks" FOR DELETE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "read_marks_insert" ON "public"."read_marks" FOR INSERT WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "read_marks_select" ON "public"."read_marks" FOR SELECT USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."reference_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reference_items_select" ON "public"."reference_items" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."review_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "review_assignments_delete" ON "public"."review_assignments" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "review_assignments_insert" ON "public"."review_assignments" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "review_assignments_select" ON "public"."review_assignments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "review_assignments_update" ON "public"."review_assignments" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."sales_proposal_workspaces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_proposal_workspaces_delete" ON "public"."sales_proposal_workspaces" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "sales_proposal_workspaces"."workspace_id"))));



CREATE POLICY "sales_proposal_workspaces_insert" ON "public"."sales_proposal_workspaces" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "sales_proposal_workspaces"."workspace_id"))));



CREATE POLICY "sales_proposal_workspaces_select" ON "public"."sales_proposal_workspaces" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "sales_proposal_workspaces"."workspace_id"))));



CREATE POLICY "sales_proposal_workspaces_update" ON "public"."sales_proposal_workspaces" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "sales_proposal_workspaces"."workspace_id")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "sales_proposal_workspaces"."workspace_id"))));



ALTER TABLE "public"."si_processing_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."signup_policy" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."source_document_diffs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."source_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tag_morphology_drift_flags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."taxonomy_domains" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "taxonomy_domains_insert" ON "public"."taxonomy_domains" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "taxonomy_domains_select" ON "public"."taxonomy_domains" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "taxonomy_domains_update" ON "public"."taxonomy_domains" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."taxonomy_subtopics" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "taxonomy_subtopics_insert" ON "public"."taxonomy_subtopics" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "taxonomy_subtopics_select" ON "public"."taxonomy_subtopics" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "taxonomy_subtopics_update" ON "public"."taxonomy_subtopics" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."taxonomy_sync_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."template_completions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "template_completions_insert" ON "public"."template_completions" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "template_completions_select" ON "public"."template_completions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "template_fields_delete" ON "public"."form_template_fields" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "template_fields_insert" ON "public"."form_template_fields" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "template_fields_select" ON "public"."form_template_fields" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "template_fields_update" ON "public"."form_template_fields" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "template_requirements_delete" ON "public"."form_template_requirements" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "template_requirements_insert" ON "public"."form_template_requirements" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "template_requirements_select" ON "public"."form_template_requirements" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "template_requirements_update" ON "public"."form_template_requirements" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "templates_delete" ON "public"."form_templates" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "templates_insert" ON "public"."form_templates" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "templates_update" ON "public"."form_templates" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."tenant_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_onboarding_workspaces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "training_onboarding_workspaces_delete" ON "public"."training_onboarding_workspaces" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "training_onboarding_workspaces"."workspace_id"))));



CREATE POLICY "training_onboarding_workspaces_insert" ON "public"."training_onboarding_workspaces" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "training_onboarding_workspaces"."workspace_id"))));



CREATE POLICY "training_onboarding_workspaces_select" ON "public"."training_onboarding_workspaces" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "training_onboarding_workspaces"."workspace_id"))));



CREATE POLICY "training_onboarding_workspaces_update" ON "public"."training_onboarding_workspaces" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "training_onboarding_workspaces"."workspace_id")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE ("w"."id" = "training_onboarding_workspaces"."workspace_id"))));



ALTER TABLE "public"."user_notification_prefs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_profiles_admin_select" ON "public"."user_profiles" FOR SELECT TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"])));



CREATE POLICY "user_profiles_authenticated_lookup_select" ON "public"."user_profiles" FOR SELECT TO "authenticated" USING (true);



COMMENT ON POLICY "user_profiles_authenticated_lookup_select" ON "public"."user_profiles" IS 'OPS-60 (kh-prod-readiness-S34): permissive SELECT for any authenticated caller. Required so SECURITY INVOKER public.get_user_display_names(uuid[]) can resolve other users'' display names without admin/editor tier or self predicate. Direct-PostgREST exposure is constrained by the column GRANT to (id, full_name) — viewers cannot SELECT email, role, or other columns via PostgREST. ORs with user_profiles_admin_select + user_profiles_self_select.';



CREATE POLICY "user_profiles_self_select" ON "public"."user_profiles" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_roles_delete" ON "public"."user_roles" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "user_roles_insert" ON "public"."user_roles" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "user_roles_select_own" ON "public"."user_roles" FOR SELECT USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("public"."get_user_role"() = 'admin'::"text")));



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


GRANT USAGE ON SCHEMA "api" TO "anon";
GRANT USAGE ON SCHEMA "api" TO "authenticated";
GRANT USAGE ON SCHEMA "api" TO "service_role";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



























































































































REVOKE ALL ON FUNCTION "api"."_test_delete_broken_auth_user"("probe_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."_test_delete_broken_auth_user"("probe_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "api"."_test_insert_broken_auth_user"("probe_id" "uuid", "probe_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."_test_insert_broken_auth_user"("probe_id" "uuid", "probe_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "api"."bulk_delete_tags"("p_tags" "text"[], "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."bulk_delete_tags"("p_tags" "text"[], "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."bulk_delete_tags"("p_tags" "text"[], "p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "api"."bulk_merge_tags"("p_sources" "text"[], "p_target" "text", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."bulk_merge_tags"("p_sources" "text"[], "p_target" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."bulk_merge_tags"("p_sources" "text"[], "p_target" "text", "p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "api"."check_content_exists"("ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."check_content_exists"("ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "api"."check_content_exists"("ids" "uuid"[]) TO "service_role";



GRANT ALL ON TABLE "public"."processing_queue" TO "anon";
GRANT ALL ON TABLE "public"."processing_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."processing_queue" TO "service_role";



REVOKE ALL ON FUNCTION "api"."claim_next_job"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."claim_next_job"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."claim_next_job"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."cleanup_filtered_articles"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."cleanup_filtered_articles"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."cleanup_filtered_articles"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."count_auth_users"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."count_auth_users"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."delete_tag"("p_tag" "text", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."delete_tag"("p_tag" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."delete_tag"("p_tag" "text", "p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "api"."filter_by_keywords"("search_terms" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."filter_by_keywords"("search_terms" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "api"."filter_by_keywords"("search_terms" "text"[]) TO "service_role";



GRANT ALL ON TABLE "public"."content_items" TO "anon";
GRANT ALL ON TABLE "public"."content_items" TO "authenticated";
GRANT ALL ON TABLE "public"."content_items" TO "service_role";



REVOKE ALL ON FUNCTION "api"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text") TO "service_role";



REVOKE ALL ON FUNCTION "api"."find_duplicate_pairs"("similarity_threshold" numeric, "p_domain" "text", "limit_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."find_duplicate_pairs"("similarity_threshold" numeric, "p_domain" "text", "limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "api"."find_duplicate_pairs"("similarity_threshold" numeric, "p_domain" "text", "limit_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "api"."find_duplicate_tags"("p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."find_duplicate_tags"("p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."find_duplicate_tags"("p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "api"."find_exact_duplicates"("p_content_hash" "text", "p_exclude_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."find_exact_duplicates"("p_content_hash" "text", "p_exclude_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."find_exact_duplicates"("p_content_hash" "text", "p_exclude_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "api"."find_related_items"("p_item_id" "uuid", "p_similarity_threshold" double precision, "p_limit_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."find_related_items"("p_item_id" "uuid", "p_similarity_threshold" double precision, "p_limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "api"."find_related_items"("p_item_id" "uuid", "p_similarity_threshold" double precision, "p_limit_count" integer) TO "service_role";









REVOKE ALL ON FUNCTION "api"."get_aggregate_win_rate_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_aggregate_win_rate_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_aggregate_win_rate_stats"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_all_tag_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_all_tag_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_all_tag_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_author_analysis"("p_author_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_author_analysis"("p_author_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_author_analysis"("p_author_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_content_gaps"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_content_gaps"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_content_gaps"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_content_owner_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_content_owner_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_content_owner_stats"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_content_win_rate"("p_content_item_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_content_win_rate"("p_content_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_content_win_rate"("p_content_item_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_coverage_matrix"("p_layer" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_coverage_matrix"("p_layer" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_coverage_matrix"("p_layer" "text") TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_coverage_summary"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_coverage_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_coverage_summary"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") TO "service_role";



GRANT ALL ON TABLE "public"."feed_sources" TO "anon";
GRANT ALL ON TABLE "public"."feed_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."feed_sources" TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_due_feed_sources"("max_sources" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_due_feed_sources"("max_sources" integer) TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_due_feed_sources"("max_sources" integer) TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_entity_list_aggregated"("p_type" "text", "p_search" "text", "p_variants_only" boolean, "p_type_conflicts" boolean, "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_entity_list_aggregated"("p_type" "text", "p_search" "text", "p_variants_only" boolean, "p_type_conflicts" boolean, "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_entity_list_aggregated"("p_type" "text", "p_search" "text", "p_variants_only" boolean, "p_type_conflicts" boolean, "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_entity_summary"("p_entity_name" "text", "p_entity_type" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_entity_summary"("p_entity_name" "text", "p_entity_type" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_entity_summary"("p_entity_name" "text", "p_entity_type" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_filter_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_filter_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_filter_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_filter_ratio_trend"("p_workspace_id" "uuid", "p_granularity" "text", "p_period_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_filter_ratio_trend"("p_workspace_id" "uuid", "p_granularity" "text", "p_period_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_filter_ratio_trend"("p_workspace_id" "uuid", "p_granularity" "text", "p_period_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_form_question_stats"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_form_question_stats"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_form_question_stats"("p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_form_question_stats_batch"("p_project_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_form_question_stats_batch"("p_project_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_form_question_stats_batch"("p_project_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_freshness_breakdown"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_freshness_breakdown"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_freshness_breakdown"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_grouped_activity_feed"("p_limit" integer, "p_is_admin" boolean, "p_before" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_grouped_activity_feed"("p_limit" integer, "p_is_admin" boolean, "p_before" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_grouped_activity_feed"("p_limit" integer, "p_is_admin" boolean, "p_before" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_guide_content"("p_guide_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_guide_content"("p_guide_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_guide_content"("p_guide_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_guide_coverage"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_guide_coverage"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_guide_coverage"() TO "service_role";



GRANT ALL ON TABLE "public"."workspaces" TO "anon";
GRANT ALL ON TABLE "public"."workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."workspaces" TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_item_workspaces"("p_item_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_item_workspaces"("p_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_item_workspaces"("p_item_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_items_with_quality_flags"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_items_with_quality_flags"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_items_with_quality_flags"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_popular_keywords"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_popular_keywords"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_popular_keywords"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_quality_issue_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_quality_issue_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_quality_issue_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_reading_patterns"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_reading_patterns"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_reading_patterns"("p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_review_breakdown_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_review_breakdown_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_review_breakdown_stats"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_tag_counts_filtered"("p_type" "text", "p_min_count" integer, "p_search" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_tag_counts_filtered"("p_type" "text", "p_min_count" integer, "p_search" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_tag_counts_filtered"("p_type" "text", "p_min_count" integer, "p_search" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_tags_by_domain"("p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_tags_by_domain"("p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_tags_by_domain"("p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_topic_deep_dive"("p_keyword" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_topic_deep_dive"("p_keyword" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_topic_deep_dive"("p_keyword" "text") TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_topic_layers"("p_topic_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_topic_layers"("p_topic_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_topic_layers"("p_topic_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_trend_analysis"("p_days" integer, "p_min_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_trend_analysis"("p_days" integer, "p_min_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_trend_analysis"("p_days" integer, "p_min_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_unique_authors"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_unique_authors"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_unique_authors"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_user_display_names"("user_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_user_display_names"("user_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_user_display_names"("user_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "api"."get_user_tag_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."get_user_tag_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_user_tag_counts"() TO "service_role";






REVOKE ALL ON FUNCTION "api"."list_public_tables"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."list_public_tables"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."list_public_tables"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "api"."merge_item_metadata"("p_item_id" "uuid", "p_new_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."merge_item_metadata"("p_item_id" "uuid", "p_new_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "api"."merge_item_metadata"("p_item_id" "uuid", "p_new_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "api"."merge_tags"("p_source" "text", "p_target" "text", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."merge_tags"("p_source" "text", "p_target" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."merge_tags"("p_source" "text", "p_target" "text", "p_type" "text") TO "service_role";



GRANT ALL ON TABLE "public"."q_a_extractions" TO "anon";
GRANT ALL ON TABLE "public"."q_a_extractions" TO "authenticated";
GRANT ALL ON TABLE "public"."q_a_extractions" TO "service_role";



REVOKE ALL ON FUNCTION "api"."q_a_extractions_promotion_candidates"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."q_a_extractions_promotion_candidates"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."q_a_extractions_promotion_candidates"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."q_a_get_verbatim"("p_pair_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."q_a_get_verbatim"("p_pair_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."q_a_get_verbatim"("p_pair_id" "uuid") TO "service_role";









REVOKE ALL ON FUNCTION "api"."question_match_search"("p_form_question_id" "uuid", "p_question_kind" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."question_match_search"("p_form_question_id" "uuid", "p_question_kind" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "api"."question_match_search"("p_form_question_id" "uuid", "p_question_kind" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "api"."reap_stuck_jobs"("p_timeout_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."reap_stuck_jobs"("p_timeout_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "api"."reap_stuck_jobs"("p_timeout_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "api"."recalculate_all_freshness"() FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."recalculate_all_freshness"() TO "authenticated";
GRANT ALL ON FUNCTION "api"."recalculate_all_freshness"() TO "service_role";



REVOKE ALL ON FUNCTION "api"."reference_get_verbatim"("p_reference_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."reference_get_verbatim"("p_reference_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."reference_get_verbatim"("p_reference_id" "uuid") TO "service_role";









REVOKE ALL ON FUNCTION "api"."rename_tag"("p_old" "text", "p_new" "text", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."rename_tag"("p_old" "text", "p_new" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."rename_tag"("p_old" "text", "p_new" "text", "p_type" "text") TO "service_role";






REVOKE ALL ON FUNCTION "api"."set_config"("setting" "text", "value" "text", "is_local" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."set_config"("setting" "text", "value" "text", "is_local" boolean) TO "anon";
GRANT ALL ON FUNCTION "api"."set_config"("setting" "text", "value" "text", "is_local" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "api"."set_config"("setting" "text", "value" "text", "is_local" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "api"."suggest_tags"("p_prefix" "text", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."suggest_tags"("p_prefix" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."suggest_tags"("p_prefix" "text", "p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "api"."toggle_star"("item_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."toggle_star"("item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."toggle_star"("item_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "api"."toggle_star"("p_item_id" "uuid", "p_starred" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "api"."toggle_star"("p_item_id" "uuid", "p_starred" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "api"."toggle_star"("p_item_id" "uuid", "p_starred" boolean) TO "service_role";






























































































































































































































































































































































































































































































































REVOKE ALL ON FUNCTION "public"."_test_delete_broken_auth_user"("probe_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_test_delete_broken_auth_user"("probe_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_test_insert_broken_auth_user"("probe_id" "uuid", "probe_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_test_insert_broken_auth_user"("probe_id" "uuid", "probe_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."auto_version_content_history"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auto_version_content_history"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."bid_response_auto_version"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bid_response_auto_version"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."bulk_assign_content_owner"("p_item_ids" "uuid"[], "p_owner_id" "uuid", "p_assigned_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bulk_assign_content_owner"("p_item_ids" "uuid"[], "p_owner_id" "uuid", "p_assigned_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_assign_content_owner"("p_item_ids" "uuid"[], "p_owner_id" "uuid", "p_assigned_by" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bulk_delete_tags"("p_tags" "text"[], "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bulk_delete_tags"("p_tags" "text"[], "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_delete_tags"("p_tags" "text"[], "p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bulk_merge_tags"("p_sources" "text"[], "p_target" "text", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bulk_merge_tags"("p_sources" "text"[], "p_target" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_merge_tags"("p_sources" "text"[], "p_target" "text", "p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_content_exists"("ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_content_exists"("ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_content_exists"("ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_next_job"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_next_job"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_next_job"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_filtered_articles"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_filtered_articles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_filtered_articles"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."coerce_empty_classification_to_null"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."coerce_empty_classification_to_null"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."coerce_null_token_columns"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."coerce_null_token_columns"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."content_history_auto_version"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."content_history_auto_version"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_auth_users"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_auth_users"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_duplicate_entity_mentions"("p_canonical_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_duplicate_entity_mentions"("p_canonical_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_duplicate_entity_mentions"("p_canonical_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_tag"("p_tag" "text", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_tag"("p_tag" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_tag"("p_tag" "text", "p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."detect_reupload"("p_filename" "text", "p_uploaded_by" "uuid", "p_content_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."detect_reupload"("p_filename" "text", "p_uploaded_by" "uuid", "p_content_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."detect_reupload"("p_filename" "text", "p_uploaded_by" "uuid", "p_content_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_archive_state_consistency"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_archive_state_consistency"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_v1_history_at_commit"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_v1_history_at_commit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."filter_by_keywords"("search_terms" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."filter_by_keywords"("search_terms" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."filter_by_keywords"("search_terms" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."filter_by_keywords"("keyword_list" "text"[], "match_mode" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."find_duplicate_pairs"("similarity_threshold" numeric, "p_domain" "text", "limit_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_duplicate_pairs"("similarity_threshold" numeric, "p_domain" "text", "limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_duplicate_pairs"("similarity_threshold" numeric, "p_domain" "text", "limit_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."find_duplicate_tags"("p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_duplicate_tags"("p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_duplicate_tags"("p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."find_exact_duplicates"("p_content_hash" "text", "p_exclude_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_exact_duplicates"("p_content_hash" "text", "p_exclude_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_exact_duplicates"("p_content_hash" "text", "p_exclude_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."find_related_items"("p_item_id" "uuid", "p_similarity_threshold" double precision, "p_limit_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_related_items"("p_item_id" "uuid", "p_similarity_threshold" double precision, "p_limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_related_items"("p_item_id" "uuid", "p_similarity_threshold" double precision, "p_limit_count" integer) TO "service_role";









REVOKE ALL ON FUNCTION "public"."get_aggregate_win_rate_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_aggregate_win_rate_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_aggregate_win_rate_stats"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_all_tag_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_all_tag_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_tag_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_audit_content_items"("p_domain" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_audit_content_items"("p_domain" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_audit_content_items"("p_domain" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_author_analysis"("p_author_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_author_analysis"("p_author_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_author_analysis"("p_author_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_capture_activity"("days_back" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_capture_activity"("days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_capture_activity"("days_back" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_content_gaps"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_content_gaps"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_content_gaps"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_content_owner_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_content_owner_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_content_owner_stats"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_content_win_rate"("p_content_item_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_coverage_matrix"("p_layer" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_coverage_matrix"("p_layer" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_coverage_matrix"("p_layer" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_coverage_summary"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_coverage_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_coverage_summary"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_document_version_chain"("p_document_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_document_version_chain"("p_document_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_document_version_chain"("p_document_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_domain_subtopic_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_domain_subtopic_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_domain_subtopic_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_due_feed_sources"("max_sources" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_due_feed_sources"("max_sources" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_due_feed_sources"("max_sources" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_entity_co_occurrence"("p_limit" integer, "p_min_count" integer, "p_entity_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_entity_co_occurrence"("p_limit" integer, "p_min_count" integer, "p_entity_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_entity_co_occurrence"("p_limit" integer, "p_min_count" integer, "p_entity_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_entity_list_aggregated"("p_type" "text", "p_search" "text", "p_variants_only" boolean, "p_type_conflicts" boolean, "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_entity_list_aggregated"("p_type" "text", "p_search" "text", "p_variants_only" boolean, "p_type_conflicts" boolean, "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_entity_list_aggregated"("p_type" "text", "p_search" "text", "p_variants_only" boolean, "p_type_conflicts" boolean, "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_entity_name_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_entity_name_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_entity_name_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_entity_summary"("p_entity_name" "text", "p_entity_type" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_entity_summary"("p_entity_name" "text", "p_entity_type" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_entity_summary"("p_entity_name" "text", "p_entity_type" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_filter_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_filter_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_filter_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_filter_ratio_trend"("p_workspace_id" "uuid", "p_granularity" "text", "p_period_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_filter_ratio_trend"("p_workspace_id" "uuid", "p_granularity" "text", "p_period_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_filter_ratio_trend"("p_workspace_id" "uuid", "p_granularity" "text", "p_period_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_form_question_stats"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_form_question_stats"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_form_question_stats"("p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_form_question_stats_batch"("p_project_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_form_question_stats_batch"("p_project_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_form_question_stats_batch"("p_project_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_form_summary"("bid_workspace_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_form_summary"("bid_workspace_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_form_summary"("bid_workspace_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_freshness_breakdown"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_freshness_breakdown"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_freshness_breakdown"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_grouped_activity_feed"("p_limit" integer, "p_is_admin" boolean, "p_before" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_grouped_activity_feed"("p_limit" integer, "p_is_admin" boolean, "p_before" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_grouped_activity_feed"("p_limit" integer, "p_is_admin" boolean, "p_before" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_guide_content"("p_guide_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_guide_content"("p_guide_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_guide_content"("p_guide_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_guide_coverage"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_guide_coverage"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_guide_coverage"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_item_workspaces"("p_item_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_item_workspaces"("p_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_item_workspaces"("p_item_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_items_with_quality_flags"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_items_with_quality_flags"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_items_with_quality_flags"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_popular_keywords"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_popular_keywords"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_popular_keywords"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_quality_issue_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_quality_issue_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_quality_issue_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_reading_patterns"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_reading_patterns"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_reading_patterns"("p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_review_breakdown_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_review_breakdown_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_review_breakdown_stats"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_source_documents"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_source_documents"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_source_documents"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_tag_counts_filtered"("p_type" "text", "p_min_count" integer, "p_search" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_tag_counts_filtered"("p_type" "text", "p_min_count" integer, "p_search" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tag_counts_filtered"("p_type" "text", "p_min_count" integer, "p_search" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_tags_by_domain"("p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_tags_by_domain"("p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tags_by_domain"("p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_template_summary"("p_template_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_template_summary"("p_template_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_template_summary"("p_template_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_top_authors"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_top_authors"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_top_authors"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_topic_deep_dive"("p_keyword" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_topic_deep_dive"("p_keyword" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_topic_deep_dive"("p_keyword" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_topic_layers"("p_topic_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_topic_layers"("p_topic_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_topic_layers"("p_topic_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_trend_analysis"("p_days" integer, "p_min_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_trend_analysis"("p_days" integer, "p_min_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_trend_analysis"("p_days" integer, "p_min_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_unique_authors"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_unique_authors"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unique_authors"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_display_names"("user_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_display_names"("user_ids" "uuid"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_user_display_names"("user_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_tag_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_tag_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_tag_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_verification_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_verification_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_verification_stats"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_workspace_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_workspace_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_workspace_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_workspace_item_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_workspace_item_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_workspace_item_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."grant_standard_public_table_access"("target_table" "regclass") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."grant_standard_public_table_access"("target_table" "regclass") TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_user_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_user_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."hook_restrict_signup_to_allowed_domain"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hook_restrict_signup_to_allowed_domain"("event" "jsonb") TO "supabase_auth_admin";






REVOKE ALL ON FUNCTION "public"."list_public_tables"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_public_tables"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_public_tables"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_entities"("p_source_names" "text"[], "p_target_name" "text", "p_entity_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."merge_item_metadata"("p_item_id" "uuid", "p_new_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."merge_item_metadata"("p_item_id" "uuid", "p_new_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_item_metadata"("p_item_id" "uuid", "p_new_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."merge_tags"("p_source" "text", "p_target" "text", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."merge_tags"("p_source" "text", "p_target" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_tags"("p_source" "text", "p_target" "text", "p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."q_a_extractions_promotion_candidates"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."q_a_extractions_promotion_candidates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."q_a_extractions_promotion_candidates"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."q_a_get_verbatim"("p_pair_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."q_a_get_verbatim"("p_pair_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."q_a_get_verbatim"("p_pair_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."q_a_pairs_history_trigger"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."q_a_pairs_history_trigger"() TO "service_role";









REVOKE ALL ON FUNCTION "public"."question_match_search"("p_form_question_id" "uuid", "p_question_kind" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."question_match_search"("p_form_question_id" "uuid", "p_question_kind" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."question_match_search"("p_form_question_id" "uuid", "p_question_kind" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reap_stuck_jobs"("p_timeout_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reap_stuck_jobs"("p_timeout_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reap_stuck_jobs"("p_timeout_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."recalculate_all_freshness"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recalculate_all_freshness"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_all_freshness"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reference_get_verbatim"("p_reference_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reference_get_verbatim"("p_reference_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reference_get_verbatim"("p_reference_id" "uuid") TO "service_role";









REVOKE ALL ON FUNCTION "public"."rename_tag"("p_old" "text", "p_new" "text", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rename_tag"("p_old" "text", "p_new" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rename_tag"("p_old" "text", "p_new" "text", "p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_near_dup_confirm_unique"("p_left_id" "uuid", "p_right_id" "uuid", "p_actor_user_id" "uuid", "p_pair_id" "text", "p_note" "text", "p_similarity_at_resolution" numeric, "p_threshold_at_resolution" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_near_dup_confirm_unique"("p_left_id" "uuid", "p_right_id" "uuid", "p_actor_user_id" "uuid", "p_pair_id" "text", "p_note" "text", "p_similarity_at_resolution" numeric, "p_threshold_at_resolution" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_near_dup_confirm_unique"("p_left_id" "uuid", "p_right_id" "uuid", "p_actor_user_id" "uuid", "p_pair_id" "text", "p_note" "text", "p_similarity_at_resolution" numeric, "p_threshold_at_resolution" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."run_quality_scan"("p_batch_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."run_quality_scan"("p_batch_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_quality_scan"("p_batch_name" "text") TO "service_role";















REVOKE ALL ON FUNCTION "public"."set_classification_disputes_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_classification_disputes_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_config"("setting" "text", "value" "text", "is_local" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."set_config"("setting" "text", "value" "text", "is_local" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_config"("setting" "text", "value" "text", "is_local" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."snapshot_form_response_history"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snapshot_form_response_history"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."suggest_tags"("p_prefix" "text", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."suggest_tags"("p_prefix" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."suggest_tags"("p_prefix" "text", "p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."toggle_star"("item_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."toggle_star"("item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."toggle_star"("item_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."toggle_star"("p_item_id" "uuid", "p_starred" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."toggle_star"("p_item_id" "uuid", "p_starred" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."toggle_star"("p_item_id" "uuid", "p_starred" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_citation_count"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_citation_count"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_updated_at_column"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_user_notification_prefs_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_user_notification_prefs_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_layer_key"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_layer_key"() TO "service_role";
























GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."ai_call_events" TO "anon";
GRANT ALL ON TABLE "public"."ai_call_events" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_call_events" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."ai_call_events" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."ai_call_events" TO "service_role";



GRANT ALL ON TABLE "public"."application_types" TO "anon";
GRANT ALL ON TABLE "public"."application_types" TO "authenticated";
GRANT ALL ON TABLE "public"."application_types" TO "service_role";



GRANT SELECT ON TABLE "api"."application_types" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."application_types" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."application_types" TO "service_role";



GRANT ALL ON TABLE "public"."change_reports" TO "anon";
GRANT ALL ON TABLE "public"."change_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."change_reports" TO "service_role";



GRANT SELECT ON TABLE "api"."change_reports" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."change_reports" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."change_reports" TO "service_role";



GRANT ALL ON TABLE "public"."citations" TO "authenticated";
GRANT ALL ON TABLE "public"."citations" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."citations" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."citations" TO "service_role";



GRANT ALL ON TABLE "public"."classification_disputes" TO "anon";
GRANT ALL ON TABLE "public"."classification_disputes" TO "authenticated";
GRANT ALL ON TABLE "public"."classification_disputes" TO "service_role";



GRANT SELECT ON TABLE "api"."classification_disputes" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."classification_disputes" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."classification_disputes" TO "service_role";



GRANT ALL ON TABLE "public"."company_profiles" TO "anon";
GRANT ALL ON TABLE "public"."company_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."company_profiles" TO "service_role";



GRANT SELECT ON TABLE "api"."company_profiles" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."company_profiles" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."company_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."content_chunks" TO "anon";
GRANT ALL ON TABLE "public"."content_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."content_chunks" TO "service_role";



GRANT SELECT ON TABLE "api"."content_chunks" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."content_chunks" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."content_chunks" TO "service_role";



GRANT ALL ON TABLE "public"."content_history" TO "anon";
GRANT ALL ON TABLE "public"."content_history" TO "authenticated";
GRANT ALL ON TABLE "public"."content_history" TO "service_role";



GRANT SELECT ON TABLE "api"."content_history" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."content_history" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."content_history" TO "service_role";



GRANT ALL ON TABLE "public"."content_item_workspaces" TO "anon";
GRANT ALL ON TABLE "public"."content_item_workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."content_item_workspaces" TO "service_role";



GRANT SELECT ON TABLE "api"."content_item_workspaces" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."content_item_workspaces" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."content_item_workspaces" TO "service_role";



GRANT SELECT ON TABLE "api"."content_items" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."content_items" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."content_items" TO "service_role";



GRANT ALL ON TABLE "public"."content_propagation_version" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."content_propagation_version" TO "service_role";



GRANT ALL ON TABLE "public"."coverage_targets" TO "anon";
GRANT ALL ON TABLE "public"."coverage_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."coverage_targets" TO "service_role";



GRANT SELECT ON TABLE "api"."coverage_targets" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."coverage_targets" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."coverage_targets" TO "service_role";



GRANT ALL ON TABLE "public"."entity_aliases" TO "anon";
GRANT ALL ON TABLE "public"."entity_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."entity_aliases" TO "service_role";



GRANT SELECT ON TABLE "api"."entity_aliases" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."entity_aliases" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."entity_aliases" TO "service_role";



GRANT ALL ON TABLE "public"."entity_mentions" TO "anon";
GRANT ALL ON TABLE "public"."entity_mentions" TO "authenticated";
GRANT ALL ON TABLE "public"."entity_mentions" TO "service_role";



GRANT SELECT ON TABLE "api"."entity_mentions" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."entity_mentions" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."entity_mentions" TO "service_role";



GRANT ALL ON TABLE "public"."entity_relationships" TO "anon";
GRANT ALL ON TABLE "public"."entity_relationships" TO "authenticated";
GRANT ALL ON TABLE "public"."entity_relationships" TO "service_role";



GRANT SELECT ON TABLE "api"."entity_relationships" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."entity_relationships" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."entity_relationships" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."eval_baseline_audit" TO "anon";
GRANT ALL ON TABLE "public"."eval_baseline_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."eval_baseline_audit" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."eval_baseline_audit" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."eval_baseline_audit" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."eval_baselines" TO "anon";
GRANT ALL ON TABLE "public"."eval_baselines" TO "authenticated";
GRANT ALL ON TABLE "public"."eval_baselines" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."eval_baselines" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."eval_baselines" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."eval_runs" TO "anon";
GRANT ALL ON TABLE "public"."eval_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."eval_runs" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."eval_runs" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."eval_runs" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."eval_touchpoints" TO "anon";
GRANT ALL ON TABLE "public"."eval_touchpoints" TO "authenticated";
GRANT ALL ON TABLE "public"."eval_touchpoints" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."eval_touchpoints" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."eval_touchpoints" TO "service_role";



GRANT ALL ON TABLE "public"."feed_articles" TO "anon";
GRANT ALL ON TABLE "public"."feed_articles" TO "authenticated";
GRANT ALL ON TABLE "public"."feed_articles" TO "service_role";



GRANT SELECT ON TABLE "api"."feed_articles" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."feed_articles" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."feed_articles" TO "service_role";



GRANT ALL ON TABLE "public"."feed_flags" TO "anon";
GRANT ALL ON TABLE "public"."feed_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."feed_flags" TO "service_role";



GRANT SELECT ON TABLE "api"."feed_flags" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."feed_flags" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."feed_flags" TO "service_role";



GRANT ALL ON TABLE "public"."feed_prompts" TO "anon";
GRANT ALL ON TABLE "public"."feed_prompts" TO "authenticated";
GRANT ALL ON TABLE "public"."feed_prompts" TO "service_role";



GRANT SELECT ON TABLE "api"."feed_prompts" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."feed_prompts" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."feed_prompts" TO "service_role";



GRANT SELECT ON TABLE "api"."feed_sources" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."feed_sources" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."feed_sources" TO "service_role";



GRANT ALL ON TABLE "public"."form_questions" TO "anon";
GRANT ALL ON TABLE "public"."form_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."form_questions" TO "service_role";



GRANT SELECT ON TABLE "api"."form_questions" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."form_questions" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."form_questions" TO "service_role";



GRANT ALL ON TABLE "public"."form_response_history" TO "anon";
GRANT ALL ON TABLE "public"."form_response_history" TO "authenticated";
GRANT ALL ON TABLE "public"."form_response_history" TO "service_role";



GRANT SELECT ON TABLE "api"."form_response_history" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."form_response_history" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."form_response_history" TO "service_role";



GRANT ALL ON TABLE "public"."form_responses" TO "anon";
GRANT ALL ON TABLE "public"."form_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."form_responses" TO "service_role";



GRANT SELECT ON TABLE "api"."form_responses" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."form_responses" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."form_responses" TO "service_role";



GRANT ALL ON TABLE "public"."form_template_fields" TO "anon";
GRANT ALL ON TABLE "public"."form_template_fields" TO "authenticated";
GRANT ALL ON TABLE "public"."form_template_fields" TO "service_role";



GRANT SELECT ON TABLE "api"."form_template_fields" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."form_template_fields" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."form_template_fields" TO "service_role";



GRANT ALL ON TABLE "public"."form_template_requirements" TO "anon";
GRANT ALL ON TABLE "public"."form_template_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."form_template_requirements" TO "service_role";



GRANT SELECT ON TABLE "api"."form_template_requirements" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."form_template_requirements" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."form_template_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."form_templates" TO "anon";
GRANT ALL ON TABLE "public"."form_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."form_templates" TO "service_role";



GRANT SELECT ON TABLE "api"."form_templates" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."form_templates" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."form_templates" TO "service_role";



GRANT ALL ON TABLE "public"."form_types" TO "anon";
GRANT ALL ON TABLE "public"."form_types" TO "authenticated";
GRANT ALL ON TABLE "public"."form_types" TO "service_role";



GRANT SELECT ON TABLE "api"."form_types" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."form_types" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."form_types" TO "service_role";



GRANT ALL ON TABLE "public"."governance_config" TO "anon";
GRANT ALL ON TABLE "public"."governance_config" TO "authenticated";
GRANT ALL ON TABLE "public"."governance_config" TO "service_role";



GRANT SELECT ON TABLE "api"."governance_config" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."governance_config" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."governance_config" TO "service_role";



GRANT ALL ON TABLE "public"."guide_sections" TO "anon";
GRANT ALL ON TABLE "public"."guide_sections" TO "authenticated";
GRANT ALL ON TABLE "public"."guide_sections" TO "service_role";



GRANT SELECT ON TABLE "api"."guide_sections" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."guide_sections" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."guide_sections" TO "service_role";



GRANT ALL ON TABLE "public"."guides" TO "anon";
GRANT ALL ON TABLE "public"."guides" TO "authenticated";
GRANT ALL ON TABLE "public"."guides" TO "service_role";



GRANT SELECT ON TABLE "api"."guides" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."guides" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."guides" TO "service_role";



GRANT ALL ON TABLE "public"."ingestion_quality_log" TO "anon";
GRANT ALL ON TABLE "public"."ingestion_quality_log" TO "authenticated";
GRANT ALL ON TABLE "public"."ingestion_quality_log" TO "service_role";



GRANT SELECT ON TABLE "api"."ingestion_quality_log" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."ingestion_quality_log" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."ingestion_quality_log" TO "service_role";



GRANT ALL ON TABLE "public"."intelligence_workspaces" TO "anon";
GRANT ALL ON TABLE "public"."intelligence_workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."intelligence_workspaces" TO "service_role";



GRANT SELECT ON TABLE "api"."intelligence_workspaces" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."intelligence_workspaces" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."intelligence_workspaces" TO "service_role";



GRANT ALL ON TABLE "public"."layer_vocabulary" TO "anon";
GRANT ALL ON TABLE "public"."layer_vocabulary" TO "authenticated";
GRANT ALL ON TABLE "public"."layer_vocabulary" TO "service_role";



GRANT SELECT ON TABLE "api"."layer_vocabulary" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."layer_vocabulary" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."layer_vocabulary" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT SELECT ON TABLE "api"."notifications" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."notifications" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_runs" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_runs" TO "service_role";



GRANT SELECT ON TABLE "api"."pipeline_runs" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."pipeline_runs" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."pipeline_runs" TO "service_role";



GRANT SELECT ON TABLE "api"."processing_queue" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."processing_queue" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."processing_queue" TO "service_role";



GRANT SELECT ON TABLE "api"."q_a_extractions" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."q_a_extractions" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."q_a_extractions" TO "service_role";



GRANT ALL ON TABLE "public"."q_a_pair_history" TO "anon";
GRANT ALL ON TABLE "public"."q_a_pair_history" TO "authenticated";
GRANT ALL ON TABLE "public"."q_a_pair_history" TO "service_role";



GRANT SELECT ON TABLE "api"."q_a_pair_history" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."q_a_pair_history" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."q_a_pair_history" TO "service_role";



GRANT ALL ON TABLE "public"."q_a_pairs" TO "anon";
GRANT ALL ON TABLE "public"."q_a_pairs" TO "authenticated";
GRANT ALL ON TABLE "public"."q_a_pairs" TO "service_role";



GRANT SELECT ON TABLE "api"."q_a_pairs" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."q_a_pairs" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."q_a_pairs" TO "service_role";



GRANT ALL ON TABLE "public"."read_marks" TO "anon";
GRANT ALL ON TABLE "public"."read_marks" TO "authenticated";
GRANT ALL ON TABLE "public"."read_marks" TO "service_role";



GRANT SELECT ON TABLE "api"."read_marks" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."read_marks" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."read_marks" TO "service_role";



GRANT ALL ON TABLE "public"."reference_items" TO "anon";
GRANT ALL ON TABLE "public"."reference_items" TO "authenticated";
GRANT ALL ON TABLE "public"."reference_items" TO "service_role";



GRANT SELECT ON TABLE "api"."reference_items" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."reference_items" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."reference_items" TO "service_role";



GRANT ALL ON TABLE "public"."review_assignments" TO "anon";
GRANT ALL ON TABLE "public"."review_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."review_assignments" TO "service_role";



GRANT SELECT ON TABLE "api"."review_assignments" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."review_assignments" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."review_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."si_processing_queue" TO "anon";
GRANT ALL ON TABLE "public"."si_processing_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."si_processing_queue" TO "service_role";



GRANT SELECT ON TABLE "api"."si_processing_queue" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."si_processing_queue" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."si_processing_queue" TO "service_role";



GRANT ALL ON TABLE "public"."signup_policy" TO "service_role";
GRANT SELECT ON TABLE "public"."signup_policy" TO "supabase_auth_admin";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."signup_policy" TO "service_role";



GRANT ALL ON TABLE "public"."source_document_diffs" TO "anon";
GRANT ALL ON TABLE "public"."source_document_diffs" TO "authenticated";
GRANT ALL ON TABLE "public"."source_document_diffs" TO "service_role";



GRANT SELECT ON TABLE "api"."source_document_diffs" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."source_document_diffs" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."source_document_diffs" TO "service_role";



GRANT ALL ON TABLE "public"."source_documents" TO "anon";
GRANT ALL ON TABLE "public"."source_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."source_documents" TO "service_role";



GRANT SELECT ON TABLE "api"."source_documents" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."source_documents" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."source_documents" TO "service_role";



GRANT ALL ON TABLE "public"."tag_morphology_drift_flags" TO "anon";
GRANT ALL ON TABLE "public"."tag_morphology_drift_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."tag_morphology_drift_flags" TO "service_role";



GRANT SELECT ON TABLE "api"."tag_morphology_drift_flags" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."tag_morphology_drift_flags" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."tag_morphology_drift_flags" TO "service_role";



GRANT ALL ON TABLE "public"."taxonomy_domains" TO "anon";
GRANT ALL ON TABLE "public"."taxonomy_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."taxonomy_domains" TO "service_role";



GRANT SELECT ON TABLE "api"."taxonomy_domains" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."taxonomy_domains" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."taxonomy_domains" TO "service_role";



GRANT ALL ON TABLE "public"."taxonomy_subtopics" TO "anon";
GRANT ALL ON TABLE "public"."taxonomy_subtopics" TO "authenticated";
GRANT ALL ON TABLE "public"."taxonomy_subtopics" TO "service_role";



GRANT SELECT ON TABLE "api"."taxonomy_subtopics" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."taxonomy_subtopics" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."taxonomy_subtopics" TO "service_role";



GRANT ALL ON TABLE "public"."taxonomy_sync_state" TO "anon";
GRANT ALL ON TABLE "public"."taxonomy_sync_state" TO "authenticated";
GRANT ALL ON TABLE "public"."taxonomy_sync_state" TO "service_role";



GRANT SELECT ON TABLE "api"."taxonomy_sync_state" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."taxonomy_sync_state" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."taxonomy_sync_state" TO "service_role";



GRANT ALL ON TABLE "public"."template_completions" TO "anon";
GRANT ALL ON TABLE "public"."template_completions" TO "authenticated";
GRANT ALL ON TABLE "public"."template_completions" TO "service_role";



GRANT SELECT ON TABLE "api"."template_completions" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."template_completions" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."template_completions" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_config" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."tenant_config" TO "service_role";



GRANT ALL ON TABLE "public"."user_notification_prefs" TO "anon";
GRANT ALL ON TABLE "public"."user_notification_prefs" TO "authenticated";
GRANT ALL ON TABLE "public"."user_notification_prefs" TO "service_role";



GRANT SELECT ON TABLE "api"."user_notification_prefs" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."user_notification_prefs" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."user_notification_prefs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_profiles" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."user_profiles" TO "authenticated";



GRANT SELECT("full_name") ON TABLE "public"."user_profiles" TO "authenticated";



GRANT SELECT ON TABLE "api"."user_profiles" TO "anon";
GRANT SELECT ON TABLE "api"."user_profiles" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT SELECT ON TABLE "api"."user_roles" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."user_roles" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."verification_history" TO "anon";
GRANT ALL ON TABLE "public"."verification_history" TO "authenticated";
GRANT ALL ON TABLE "public"."verification_history" TO "service_role";



GRANT SELECT ON TABLE "api"."verification_history" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."verification_history" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."verification_history" TO "service_role";



GRANT SELECT ON TABLE "api"."workspaces" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."workspaces" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "api"."workspaces" TO "service_role";


















GRANT ALL ON TABLE "public"."competitor_research_workspaces" TO "anon";
GRANT ALL ON TABLE "public"."competitor_research_workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."competitor_research_workspaces" TO "service_role";



GRANT ALL ON TABLE "public"."content_templates" TO "anon";
GRANT ALL ON TABLE "public"."content_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."content_templates" TO "service_role";



GRANT ALL ON TABLE "public"."entity_pair_resolutions" TO "anon";
GRANT ALL ON TABLE "public"."entity_pair_resolutions" TO "authenticated";
GRANT ALL ON TABLE "public"."entity_pair_resolutions" TO "service_role";



GRANT ALL ON TABLE "public"."procurement_vehicle_instances" TO "anon";
GRANT ALL ON TABLE "public"."procurement_vehicle_instances" TO "authenticated";
GRANT ALL ON TABLE "public"."procurement_vehicle_instances" TO "service_role";



GRANT ALL ON TABLE "public"."procurement_vehicles" TO "anon";
GRANT ALL ON TABLE "public"."procurement_vehicles" TO "authenticated";
GRANT ALL ON TABLE "public"."procurement_vehicles" TO "service_role";



GRANT ALL ON TABLE "public"."procurement_workspaces" TO "anon";
GRANT ALL ON TABLE "public"."procurement_workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."procurement_workspaces" TO "service_role";



GRANT ALL ON TABLE "public"."product_guide_workspaces" TO "anon";
GRANT ALL ON TABLE "public"."product_guide_workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."product_guide_workspaces" TO "service_role";



GRANT ALL ON TABLE "public"."quality_issues_pending" TO "anon";
GRANT ALL ON TABLE "public"."quality_issues_pending" TO "authenticated";
GRANT ALL ON TABLE "public"."quality_issues_pending" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."question_matches" TO "anon";
GRANT ALL ON TABLE "public"."question_matches" TO "authenticated";
GRANT ALL ON TABLE "public"."question_matches" TO "service_role";



GRANT ALL ON TABLE "public"."sales_proposal_workspaces" TO "anon";
GRANT ALL ON TABLE "public"."sales_proposal_workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_proposal_workspaces" TO "service_role";



GRANT ALL ON TABLE "public"."training_onboarding_workspaces" TO "anon";
GRANT ALL ON TABLE "public"."training_onboarding_workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."training_onboarding_workspaces" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";










-- NOTE (id-115 {115.15}): the `ensure_rls` EVENT TRIGGER itself is owned by
-- supabase_admin (superuser) and is NOT created by this baseline — `supabase
-- migration squash`/pg_dump filtered the CREATE because the non-superuser dump
-- role cannot recreate event triggers, but leaked this COMMENT through. On the
-- hosted DBs the trigger already exists (it predates the squash), so this COMMENT
-- still applies there; on a fresh-from-zero apply (CI grant-guard, local
-- `db reset`) the trigger is absent, so the bare COMMENT aborted the whole apply
-- with `event trigger "ensure_rls" does not exist (SQLSTATE 42704)`. Guarding it
-- (rather than adding a CREATE EVENT TRIGGER, which needs SUPERUSER and breaks
-- every hosted `db push`/preview-branch apply) makes this a no-op where the
-- trigger is absent and faithful where it is present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    COMMENT ON EVENT TRIGGER "ensure_rls" IS 'Auto-enables row-level security on new public.* tables. Pairs with grant_standard_public_table_access for the standard onboarding flow.';
  END IF;
END $$;





























--
-- Dumped schema changes for auth and storage
--

CREATE OR REPLACE TRIGGER "coerce_null_token_columns_before_insupd" BEFORE INSERT OR UPDATE ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."coerce_null_token_columns"();



CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();



CREATE OR REPLACE TRIGGER "on_auth_user_updated" AFTER UPDATE ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_user_update"();



CREATE POLICY "Authenticated users can read documents" ON "storage"."objects" FOR SELECT TO "authenticated" USING (("bucket_id" = 'documents'::"text"));



CREATE POLICY "Authenticated users can read templates" ON "storage"."objects" FOR SELECT TO "authenticated" USING (("bucket_id" = 'templates'::"text"));



CREATE POLICY "Authenticated users can read tender documents" ON "storage"."objects" FOR SELECT TO "authenticated" USING (("bucket_id" = 'tender-documents'::"text"));



CREATE POLICY "Authenticated users can upload documents" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (("bucket_id" = 'documents'::"text"));



CREATE POLICY "Authenticated users can upload templates" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (("bucket_id" = 'templates'::"text"));



CREATE POLICY "Authenticated users can upload tender documents" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (("bucket_id" = 'tender-documents'::"text"));



CREATE POLICY "Editors and admins can delete documents" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'documents'::"text") AND (( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"]))));



CREATE POLICY "Editors and admins can delete templates" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'templates'::"text") AND (( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"]))));



CREATE POLICY "Editors and admins can delete tender documents" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'tender-documents'::"text") AND (( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"]))));



CREATE POLICY "Editors and admins can update templates" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'templates'::"text") AND (( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['admin'::"text", 'editor'::"text"]))));




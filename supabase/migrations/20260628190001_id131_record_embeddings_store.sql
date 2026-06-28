-- ID-131 {131.6} G-SCHEMA M1b — record_embeddings store
-- TECH.md §"Migration set" row M1b; §"Deferred decisions resolved" (b) contrast.
--
-- Net-new central embeddings store. Deliberately uses the OTHER polymorphic
-- idiom from record_lifecycle: (owner_kind, owner_id) + an owner_kind CHECK and
-- NO foreign keys — because the kind set includes 'concept', which has no DB row
-- (its identity is a bundle path), so a per-kind FK is structurally impossible.
-- record_embeddings includes reference_item + content_chunk as embedding owners
-- (a different axis from record_lifecycle — no conflict with BI-19).
--
-- Absorbs the scattered inline vector columns (the 5 inline vector cols are
-- DROPPED later in M5 once reads move here). Additive, zero-row, data-safe.
-- Refs: BI-17.

CREATE TABLE IF NOT EXISTS "public"."record_embeddings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_kind" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "model" "text" NOT NULL,
    "embedding" "extensions"."vector"(1024),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- No FKs (D7 contrast): 'concept' has no DB row, so per-kind FKs are impossible.
    CONSTRAINT "record_embeddings_owner_kind_chk" CHECK (("owner_kind" = ANY (ARRAY['source_document'::"text", 'content_chunk'::"text", 'q_a_pair'::"text", 'reference_item'::"text", 'concept'::"text"]))),
    CONSTRAINT "record_embeddings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "record_embeddings_owner_kind_owner_id_model_key" UNIQUE ("owner_kind", "owner_id", "model")
);


ALTER TABLE "public"."record_embeddings" OWNER TO "postgres";


COMMENT ON TABLE "public"."record_embeddings" IS 'ID-131 {131.6} M1b: central embeddings store. (owner_kind, owner_id) idiom + owner_kind CHECK, NO FKs (D7 contrast — ''concept'' has no DB row). Owners: source_document|content_chunk|q_a_pair|reference_item|concept. UNIQUE (owner_kind, owner_id, model); per-owner_kind partial HNSW indexes. Absorbs scattered inline vector cols (dropped in M5). BI-17.';


-- Per-owner_kind PARTIAL HNSW indexes (5) — vector_cosine_ops, m=16, ef_construction=64.
CREATE INDEX "idx_record_embeddings_source_document" ON "public"."record_embeddings" USING hnsw ("embedding" "extensions"."vector_cosine_ops") WITH ("m" = '16', "ef_construction" = '64') WHERE ("owner_kind" = 'source_document'::"text");

CREATE INDEX "idx_record_embeddings_content_chunk" ON "public"."record_embeddings" USING hnsw ("embedding" "extensions"."vector_cosine_ops") WITH ("m" = '16', "ef_construction" = '64') WHERE ("owner_kind" = 'content_chunk'::"text");

CREATE INDEX "idx_record_embeddings_q_a_pair" ON "public"."record_embeddings" USING hnsw ("embedding" "extensions"."vector_cosine_ops") WITH ("m" = '16', "ef_construction" = '64') WHERE ("owner_kind" = 'q_a_pair'::"text");

CREATE INDEX "idx_record_embeddings_reference_item" ON "public"."record_embeddings" USING hnsw ("embedding" "extensions"."vector_cosine_ops") WITH ("m" = '16', "ef_construction" = '64') WHERE ("owner_kind" = 'reference_item'::"text");

CREATE INDEX "idx_record_embeddings_concept" ON "public"."record_embeddings" USING hnsw ("embedding" "extensions"."vector_cosine_ops") WITH ("m" = '16', "ef_construction" = '64') WHERE ("owner_kind" = 'concept'::"text");


-- RLS mirrors the typed-record tables (source_documents): role-based via get_user_role().
ALTER TABLE "public"."record_embeddings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Authenticated users can view record embeddings" ON "public"."record_embeddings" FOR SELECT TO "authenticated" USING (true);


CREATE POLICY "Editors and admins can create record embeddings" ON "public"."record_embeddings" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['editor'::"text", 'admin'::"text"])));


CREATE POLICY "Editors and admins can update record embeddings" ON "public"."record_embeddings" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['editor'::"text", 'admin'::"text"])));


CREATE POLICY "Admins can delete record embeddings" ON "public"."record_embeddings" FOR DELETE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));


-- Base-table grants mirror source_documents exactly. Critical: the later G-API
-- (api.record_embeddings, {131.19}) view is fail-closed and mirrors only the BASE
-- table grants — RLS alone is insufficient for runtime reachability.
GRANT ALL ON TABLE "public"."record_embeddings" TO "anon";
GRANT ALL ON TABLE "public"."record_embeddings" TO "authenticated";
GRANT ALL ON TABLE "public"."record_embeddings" TO "service_role";

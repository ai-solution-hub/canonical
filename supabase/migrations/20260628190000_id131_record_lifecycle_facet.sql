-- ID-131 {131.6} G-SCHEMA M1a — record_lifecycle facet
-- TECH.md §"Migration set" row M1a; §"Deferred decisions resolved" (b).
--
-- Net-new polymorphic lifecycle/governance facet over the typed records
-- {source_document, q_a_pair}. Uses per-kind nullable FKs + an exactly-one-of
-- CHECK tying owner_kind to the matching non-null FK — the verified idiom
-- already live on citations (citations_cited_one_of_chk). A STORED generated
-- owner_id = COALESCE(source_document_id, q_a_pair_id) plus UNIQUE
-- (owner_kind, owner_id) give the (owner_kind, owner_id) query ergonomics.
--
-- PER-AXIS owner sets (D7):
--   * Review/Governance axis spans BOTH kinds {source_document, q_a_pair}.
--   * Freshness/expiry/review-cadence axis is source_document-ONLY — q_a_pairs
--     carry no freshness clock and are enforced NULL on those columns.
-- reference_item is EXCLUDED from this facet (BI-19): its freshness/validity
-- facet is deferred to the Intelligence-domain track.
--
-- The record_lifecycle.domain write-time sync trigger is NOT created here — it
-- dereferences source_documents.primary_domain, which does not exist until M3,
-- so it lands in M3-trig (id131_record_lifecycle_domain_sync).
--
-- Additive, zero-row, data-safe (no INSERT … SELECT; no DROP).
-- Refs: BI-17 contrast, BI-18, BI-19, BI-20, BI-21, BI-22.

CREATE TABLE IF NOT EXISTS "public"."record_lifecycle" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_kind" "text" NOT NULL,
    "source_document_id" "uuid",
    "q_a_pair_id" "uuid",
    -- STORED generated owner_id over the per-kind nullable FKs (BI-18 ergonomics).
    "owner_id" "uuid" GENERATED ALWAYS AS (COALESCE("source_document_id", "q_a_pair_id")) STORED,
    "domain" "text",
    -- Review/Governance axis — spans {source_document, q_a_pair} (BI-20).
    "governance_review_status" "text",
    "governance_review_due" timestamp with time zone,
    "governance_reviewer_id" "uuid",
    "verified_at" timestamp with time zone,
    "verified_by" "uuid",
    "content_owner_id" "uuid",
    -- Freshness/expiry/review-cadence axis — source_document-ONLY (D7, BI-22).
    "freshness" "text" DEFAULT 'fresh'::"text",
    "freshness_checked_at" timestamp with time zone,
    "previous_freshness" "text",
    "lifecycle_type" "text" DEFAULT 'evergreen'::"text",
    "expiry_date" timestamp with time zone,
    "next_review_date" timestamp with time zone,
    "review_cadence_days" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- reference_item is deliberately EXCLUDED from the owner_kind domain (BI-19).
    CONSTRAINT "record_lifecycle_owner_kind_chk" CHECK (("owner_kind" = ANY (ARRAY['source_document'::"text", 'q_a_pair'::"text"]))),
    -- Exactly-one-of: owner_kind ⟺ the matching non-null FK (mirrors citations_cited_one_of_chk).
    CONSTRAINT "record_lifecycle_owner_one_of_chk" CHECK (((("owner_kind" = 'source_document'::"text") AND ("source_document_id" IS NOT NULL) AND ("q_a_pair_id" IS NULL)) OR (("owner_kind" = 'q_a_pair'::"text") AND ("q_a_pair_id" IS NOT NULL) AND ("source_document_id" IS NULL)))),
    -- Per-axis (D7): q_a_pairs carry NO freshness/expiry/review-cadence values.
    -- NOTE: because freshness/lifecycle_type have non-null DEFAULTs, any q_a_pair
    -- insert MUST explicitly set those columns to NULL or this CHECK rejects it —
    -- intentional (q_a_pairs have no freshness clock, D7).
    CONSTRAINT "record_lifecycle_freshness_axis_chk" CHECK ((("owner_kind" = 'source_document'::"text") OR (("freshness" IS NULL) AND ("freshness_checked_at" IS NULL) AND ("previous_freshness" IS NULL) AND ("lifecycle_type" IS NULL) AND ("expiry_date" IS NULL) AND ("next_review_date" IS NULL) AND ("review_cadence_days" IS NULL)))),
    CONSTRAINT "record_lifecycle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "record_lifecycle_owner_kind_owner_id_key" UNIQUE ("owner_kind", "owner_id"),
    CONSTRAINT "record_lifecycle_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE CASCADE,
    CONSTRAINT "record_lifecycle_q_a_pair_id_fkey" FOREIGN KEY ("q_a_pair_id") REFERENCES "public"."q_a_pairs"("id") ON DELETE CASCADE
);


ALTER TABLE "public"."record_lifecycle" OWNER TO "postgres";


COMMENT ON TABLE "public"."record_lifecycle" IS 'ID-131 {131.6} M1a: polymorphic lifecycle/governance facet over typed records {source_document, q_a_pair}. Per-kind nullable FKs + exactly-one-of CHECK (mirrors citations_cited_one_of_chk). PER-AXIS owner sets (D7): review/governance axis spans both kinds; freshness/expiry/review-cadence axis is source_document-only (q_a_pairs carry no freshness clock). reference_item EXCLUDED (BI-19). domain sync trigger lands in M3-trig. BI-18/19/20/21/22.';


COMMENT ON CONSTRAINT "record_lifecycle_freshness_axis_chk" ON "public"."record_lifecycle" IS 'D7: q_a_pairs carry no freshness/expiry/review-cadence. Because freshness/lifecycle_type default non-null, q_a_pair inserts must set those columns NULL explicitly — intentional.';


-- RLS mirrors the typed-record tables (source_documents): role-based via get_user_role().
ALTER TABLE "public"."record_lifecycle" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Authenticated users can view record lifecycle" ON "public"."record_lifecycle" FOR SELECT TO "authenticated" USING (true);


CREATE POLICY "Editors and admins can create record lifecycle" ON "public"."record_lifecycle" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['editor'::"text", 'admin'::"text"])));


CREATE POLICY "Editors and admins can update record lifecycle" ON "public"."record_lifecycle" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = ANY (ARRAY['editor'::"text", 'admin'::"text"])));


CREATE POLICY "Admins can delete record lifecycle" ON "public"."record_lifecycle" FOR DELETE TO "authenticated" USING ((( SELECT "public"."get_user_role"() AS "get_user_role") = 'admin'::"text"));


-- Base-table grants mirror source_documents exactly. Critical: the later G-API
-- (api.record_lifecycle, {131.19}) view is fail-closed and mirrors only the BASE
-- table grants — RLS alone is insufficient for runtime reachability.
GRANT ALL ON TABLE "public"."record_lifecycle" TO "anon";
GRANT ALL ON TABLE "public"."record_lifecycle" TO "authenticated";
GRANT ALL ON TABLE "public"."record_lifecycle" TO "service_role";

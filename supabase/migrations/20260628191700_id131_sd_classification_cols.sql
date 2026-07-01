-- ID-131 {131.9} G-SD-COLS M3 — source_documents classification + inline-hot cols
-- TECH.md §"Migration set" row M3 (id131_sd_classification_cols); PRODUCT BI-11, BI-20.
--
-- Re-homes the classification family off the (soon-dropped) content_items table
-- onto the typed record source_documents. Column TYPES mirror content_items
-- exactly so the later consumer re-points (search_content_chunks et al., owned by
-- {131.11}/{131.19}) keep identical TS nullability after the cutover.
--
-- Net-new, additive, data-safe: source_documents is empty at reset (no seed row)
-- and is fully repopulated by the full-replace re-ingest (BI-1/BI-2).
--
-- Ratified corrections folded in:
--   * classification_model is NOT ported (DROPPED as dead — 0 stored consumers;
--     D1 / PRODUCT BI-11 / TECH M3; supersedes the ledger ADD-list mention).
--   * created_by is NOT added — it maps to existing source_documents.uploaded_by.
--   * IMS-vestige cols are NOT re-homed (they die with content_items at M6).
--
-- Also in this migration (TECH M3 explicitly):
--   * reference_items gains thumbnail_url (net-new nullable, ship empty — D4) and
--     superseded_by (net-new inline self-FK supersession — D7).
--   * q_a_pairs_origin_kind_check gains 'manually_authored' (D3; {131.21} depends
--     on this value being present here).
--   * coerce_empty_classification_to_null trigger RELOCATES content_items ->
--     source_documents (the classification cols now live here; TECH §Trigger
--     functions line 454-455).
--
-- UK English throughout (DD/MM/YYYY). Authored 28/06/2026.

-- ---------------------------------------------------------------------------
-- 1. source_documents — classification family + inline-hot cols (BI-11, BI-20)
--    Types mirror content_items 1:1 (see squash_baseline content_items DDL).
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."source_documents"
    ADD COLUMN "primary_domain" character varying(50) DEFAULT 'unclassified'::character varying NOT NULL,
    ADD COLUMN "primary_subtopic" character varying(50) DEFAULT 'unclassified'::character varying NOT NULL,
    ADD COLUMN "secondary_domain" character varying(50),
    ADD COLUMN "secondary_subtopic" character varying(50),
    ADD COLUMN "ai_keywords" "text"[],
    ADD COLUMN "summary" "text",
    ADD COLUMN "suggested_title" "text",
    ADD COLUMN "classified_at" timestamp with time zone,
    ADD COLUMN "classification_confidence" numeric,
    ADD COLUMN "classification_reasoning" "text",
    ADD COLUMN "content_type" character varying(50) NOT NULL,
    ADD COLUMN "captured_date" timestamp with time zone,
    ADD COLUMN "summary_data" "jsonb",
    ADD COLUMN "updated_by" "uuid",
    ADD COLUMN "updated_at" timestamp with time zone DEFAULT "now"(),
    ADD COLUMN "publication_status" "text" DEFAULT 'published'::"text" NOT NULL;

COMMENT ON COLUMN "public"."source_documents"."publication_status" IS 'ID-131 {131.9} M3, BI-20: inline-hot read-path lifecycle field (q_a_search filters publication_status on every query). Default published.';
COMMENT ON COLUMN "public"."source_documents"."updated_at" IS 'ID-131 {131.9} M3, Finding 3: SD carried no updated_at; net-new so the record_lifecycle freshness facet recalc has an updated_at to read.';

-- ---------------------------------------------------------------------------
-- 2. reference_items — net-new thumbnail_url (D4) + inline supersession (D7)
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."reference_items"
    ADD COLUMN "thumbnail_url" "text",
    ADD COLUMN "superseded_by" "uuid";

ALTER TABLE "public"."reference_items"
    ADD CONSTRAINT "reference_items_superseded_by_fkey"
    FOREIGN KEY ("superseded_by") REFERENCES "public"."reference_items"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "public"."reference_items"."thumbnail_url" IS 'ID-131 {131.9} M3, D4: net-new nullable; shipped empty, backfilled later (optional og:image re-wire).';
COMMENT ON COLUMN "public"."reference_items"."superseded_by" IS 'ID-131 {131.9} M3, D7: inline self-FK supersession for reference evidence (ON DELETE SET NULL).';

-- ---------------------------------------------------------------------------
-- 3. q_a_pairs_origin_kind_check — add 'manually_authored' (D3); preserve all
--    existing allowed values. {131.21} (manual Q&A authoring) depends on this.
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."q_a_pairs" DROP CONSTRAINT "q_a_pairs_origin_kind_check";
ALTER TABLE "public"."q_a_pairs" ADD CONSTRAINT "q_a_pairs_origin_kind_check"
    CHECK (("origin_kind" = ANY (ARRAY[
        'extracted_from_corpus'::"text",
        'curated_explicit'::"text",
        'derived_from_form_response'::"text",
        'imported_legacy'::"text",
        'manually_authored'::"text"
    ])));

-- ---------------------------------------------------------------------------
-- 4. RELOCATE coerce_empty_classification_to_null: content_items -> source_documents
--    The function body is column-name based (operates on the classification cols
--    now present on source_documents). Keep the function (re-affirm search_path),
--    drop the content_items trigger binding, bind it to source_documents.
--    content_items still exists until M6, but the classification family has been
--    re-homed so the trigger moves now (TECH §Trigger functions line 454-455).
-- ---------------------------------------------------------------------------
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

DROP TRIGGER IF EXISTS "trg_coerce_empty_classification_to_null" ON "public"."content_items";

CREATE TRIGGER "trg_coerce_empty_classification_to_null"
    BEFORE INSERT OR UPDATE ON "public"."source_documents"
    FOR EACH ROW EXECUTE FUNCTION "public"."coerce_empty_classification_to_null"();

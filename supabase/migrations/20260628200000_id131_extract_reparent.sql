-- ID-131 {131.8} G-PIPELINE — M2: id131_extract_reparent
-- TECH §Migration set M2 (row M2); PRODUCT BI-10 / BI-14 / BI-15.
--
-- Re-parent the five extraction-side tables off `content_items` onto
-- `source_documents`. content_items is the dying IMS staging table (dropped
-- wholesale in M6 / {131.19}); the extraction artefacts (chunks, mentions,
-- relationships, classification disputes, q&a extractions) belong to the
-- source_documents record from day one of the full-replace re-ingest (BI-14:
-- "no write-site may depend on a content_item_id parent").
--
-- DEPENDS on M0c debris-wipe ({131.7}, already in the track base): the 27
-- entity_mentions + 17 entity_relationships rows that dangled off content_items
-- (zero resolving to a source_documents id) were DELETEd on the live head, so
-- the ADD-FKs below are satisfiable. On a fresh `supabase db reset` the M0c
-- DELETEs are no-ops over empty tables and these ADD-FKs apply clean.
--
-- TECH Finding 4a: content_chunks.content_item_id / entity_mentions.content_item_id
-- ALREADY EXIST (bare `uuid NOT NULL`, no FK) — so this is a RENAME + ADD-FK,
-- NOT an ADD-column (PRODUCT BI-10 prose "CC has none today" is FALSE).
-- TECH Finding 4b: q_a_extractions.source_content_item_id had NO FK — so this is
-- a RENAME + ADD-FK, not a repoint.
--
-- api consequence: the projected column on the api.* views is repointed by the
-- companion migration 20260628200001_id131_extract_reparent_api_regen (scoped to
-- these 5 surface tables); the {131.19} full regen supersedes it later.

-- ── content_chunks: RENAME + ADD FK (was bare uuid NOT NULL — Finding 4a) ──────
ALTER TABLE "public"."content_chunks"
  RENAME COLUMN "content_item_id" TO "source_document_id";
ALTER TABLE "public"."content_chunks"
  ADD CONSTRAINT "content_chunks_source_document_id_fkey"
  FOREIGN KEY ("source_document_id")
  REFERENCES "public"."source_documents"("id") ON DELETE CASCADE;

-- ── entity_mentions: RENAME + ADD FK + RENAME the UNIQUE constraint ───────────
ALTER TABLE "public"."entity_mentions"
  RENAME COLUMN "content_item_id" TO "source_document_id";
ALTER TABLE "public"."entity_mentions"
  ADD CONSTRAINT "entity_mentions_source_document_id_fkey"
  FOREIGN KEY ("source_document_id")
  REFERENCES "public"."source_documents"("id") ON DELETE CASCADE;
ALTER TABLE "public"."entity_mentions"
  RENAME CONSTRAINT "entity_mentions_canonical_name_entity_type_content_item_id_key"
  TO "entity_mentions_canonical_name_entity_type_source_document_id_key";

-- ── entity_relationships: DROP old FK, RENAME, repoint FK (preserve SET NULL) ──
ALTER TABLE "public"."entity_relationships"
  DROP CONSTRAINT "entity_relationships_source_item_id_fkey";
ALTER TABLE "public"."entity_relationships"
  RENAME COLUMN "source_item_id" TO "source_document_id";
ALTER TABLE "public"."entity_relationships"
  ADD CONSTRAINT "entity_relationships_source_document_id_fkey"
  FOREIGN KEY ("source_document_id")
  REFERENCES "public"."source_documents"("id") ON DELETE SET NULL;

-- ── classification_disputes: DROP old FK, RENAME, repoint FK (preserve CASCADE) ─
ALTER TABLE "public"."classification_disputes"
  DROP CONSTRAINT "classification_disputes_content_item_id_fkey";
ALTER TABLE "public"."classification_disputes"
  RENAME COLUMN "content_item_id" TO "source_document_id";
ALTER TABLE "public"."classification_disputes"
  ADD CONSTRAINT "classification_disputes_source_document_id_fkey"
  FOREIGN KEY ("source_document_id")
  REFERENCES "public"."source_documents"("id") ON DELETE CASCADE;

-- ── q_a_extractions: RENAME + ADD FK (was bare uuid, no FK — Finding 4b) ───────
ALTER TABLE "public"."q_a_extractions"
  RENAME COLUMN "source_content_item_id" TO "source_document_id";
ALTER TABLE "public"."q_a_extractions"
  ADD CONSTRAINT "q_a_extractions_source_document_id_fkey"
  FOREIGN KEY ("source_document_id")
  REFERENCES "public"."source_documents"("id") ON DELETE CASCADE;

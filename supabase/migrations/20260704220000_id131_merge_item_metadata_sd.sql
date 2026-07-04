-- ID-131 {131.17} G-IMS-DELETE KEEP-list — merge_item_metadata REWRITE onto source_documents
-- TECH.md §"Function disposition" (merge_item_metadata row, ~line 412): "(p_item_id,
-- p_new_data) → SD metadata; surviving callers upload/route.ts:850, vision.ts:190,
-- extract-content.ts:143; IMS-route callers die with G-IMS-DELETE."
--
-- The classification family moved to source_documents in M3
-- (20260628191700_id131_sd_classification_cols.sql); this ad-hoc JSONB-merge helper
-- (used by vision.ts/extract-content.ts to persist vision_analysis / structured_extraction
-- blobs) re-points from content_items.metadata onto source_documents.extraction_metadata —
-- the nearest generic per-document JSONB column source_documents carries.
-- source_documents.summary_data is dedicated to summarise.ts's structured AI-summary shape
-- (executive/detailed/takeaways), so it is NOT a suitable merge target for free-form
-- extraction/analysis blobs; extraction_metadata (jsonb, default '{}') is the correct home.
--
-- Signature UNCHANGED (p_item_id uuid, p_new_data jsonb) so the api.merge_item_metadata SQL
-- wrapper (squash_baseline.sql:911, `SELECT public.merge_item_metadata(p_item_id => p_item_id,
-- p_new_data => p_new_data)`) keeps resolving without a regen — the {131.19} api-wrapper regen
-- owns re-pointing api.* bodies; this migration does NOT touch api.* (per this Subtask's
-- explicit "do NOT hand-edit api.*" instruction).
--
-- CREATE OR REPLACE on an unchanged signature preserves the existing GRANT/REVOKE shape on the
-- function object (no DROP), but the REVOKE ALL FROM PUBLIC + GRANT authenticated/service_role
-- lines below are re-affirmed defensively, mirroring squash_baseline.sql:12783-12785's existing
-- grant shape for public.merge_item_metadata.
--
-- AUTHORED, NOT APPLIED (never `supabase db push`; no type regen) per {131.17} dispatch —
-- the Executor never touches a DB for this Subtask.
--
-- UK English throughout. Authored 04/07/2026.

CREATE OR REPLACE FUNCTION "public"."merge_item_metadata"("p_item_id" "uuid", "p_new_data" "jsonb") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
  UPDATE source_documents
  SET extraction_metadata = COALESCE(extraction_metadata, '{}'::jsonb) || p_new_data,
      updated_at = now()
  WHERE id = p_item_id;
$$;

-- Defensive re-affirmation of the existing grant shape (CREATE OR REPLACE preserves grants
-- on the existing function object when the signature is unchanged — this is a no-op mirror
-- of squash_baseline.sql's REVOKE ALL FROM PUBLIC + GRANT authenticated/service_role for the
-- public fn, kept here for resilience if the object were ever dropped and recreated).
REVOKE ALL ON FUNCTION "public"."merge_item_metadata"("p_item_id" "uuid", "p_new_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."merge_item_metadata"("p_item_id" "uuid", "p_new_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_item_metadata"("p_item_id" "uuid", "p_new_data" "jsonb") TO "service_role";

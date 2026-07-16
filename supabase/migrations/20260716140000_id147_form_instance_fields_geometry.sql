-- ID-147 {147.10} — form_instance_fields.geometry: PDF spatial-overlay geometry
-- column (TECH.md §3; PRODUCT.md §C1/§C3/§C4; DR-064 Option A).
-- AUTHORED HERE, NOT PUSHED — Lane B never pushes migrations; the parent sequences
-- the push alongside the rest of this batch (20260716111053, 20260716113306,
-- 20260716123000).
--
-- NULLABLE is load-bearing (§C4): {147.9}'s ExtractedField.geometry is the
-- DISPLAYED (post-rotation) top-left page-fraction dict for PDF-sourced fields
-- only — it is None for every DOCX/XLSX field (no spatial geometry there) and for
-- any PDF field whose page rotation could not be normalised
-- (pdf.py::_normalise_geometry). A NOT NULL constraint here would force a
-- fabricated geometry onto those rows; NULL is the correct, honest representation
-- so the UI degrades to "list the slot without a spatial overlay", never draws a
-- misaligned box.
--
-- No column CHECK: this is a plain jsonb carrier column. Shape integrity
-- (required keys page/top/left/width/height, numeric ranges) is enforced on READ
-- by the geometrySchema zod validator (147-H, a later Subtask) — not by DB-level
-- constraints here, matching the existing form_instance_fields slot-model
-- convention (no CHECKs on question_text/section_name/etc. either).
--
-- UK English throughout (DD/MM/YYYY). Authored 16/07/2026.

ALTER TABLE "public"."form_instance_fields"
    ADD COLUMN "geometry" "jsonb";

COMMENT ON COLUMN "public"."form_instance_fields"."geometry" IS 'ID-147 {147.9}/{147.10} DR-064 Option A — DISPLAYED (post-rotation) top-left page-fraction geometry {page, top, left, width, height} for PDF-sourced fields, carried through from ExtractedField.geometry via bid_worker.py:_write_form_instance_fields. NULL for DOCX/XLSX fields and any PDF field whose rotation could not be normalised (§C4 degrade: list without spatial overlay, never a misaligned box). Shape enforced on READ by geometrySchema (zod), not by a column CHECK.';

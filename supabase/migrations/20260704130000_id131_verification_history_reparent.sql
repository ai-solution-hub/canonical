-- ID-131 {131.29} G-GOV-REPARENT — verification_history re-parent
-- TECH §"FK & trigger disposition" L475-482; PRODUCT BI-10 ("verification_history.content_item_id
-- moves with governance"), BI-20. Ratified disposition: RE-PARENT (rename + repoint FK onto
-- source_documents, KEEP NOT NULL — safe at 0 rows). verification_history stays a live,
-- load-bearing per-event audit table — the admin audit-PDF export needs per-event
-- action_type/note/performed_by/performed_at, and record_lifecycle.verified_at/verified_by is
-- lossy for that use case (a single latest-value column, not a per-event trail) — so it is NOT
-- dropped and REMAINS in scripts/generate-api-views.ts's SURFACE_TABLES (no −= edit here).
--
-- Companion api regen is in the SAME file (DR-030/DR-032 — base rename + companion view regen
-- must land atomically; precedent 20260628200001_id131_extract_reparent_api_regen.sql /
-- 20260703190000_id131_preapply_api_view_addcol_regen.sql). Without it api.verification_history
-- keeps projecting the dead content_item_id and every re-pointed TS caller ({131.29}'s own C1-C5
-- consumer sweep) breaks at the API layer post-apply (the {131.32}/{131.33} failure class).
--
-- 0 rows in production — data-safe: no backfill, no orphan-check needed.

-- ── verification_history: DROP old FK, RENAME column, ADD FK (preserve CASCADE + NOT NULL) ────
ALTER TABLE "public"."verification_history"
  DROP CONSTRAINT "verification_history_content_item_id_fkey";

ALTER TABLE "public"."verification_history"
  RENAME COLUMN "content_item_id" TO "source_document_id";

ALTER TABLE "public"."verification_history"
  ADD CONSTRAINT "verification_history_source_document_id_fkey"
  FOREIGN KEY ("source_document_id")
  REFERENCES "public"."source_documents"("id") ON DELETE CASCADE;

COMMENT ON COLUMN "public"."verification_history"."source_document_id" IS 'The source document this verification action relates to';

COMMENT ON TABLE "public"."verification_history" IS 'Audit trail of verification actions on source documents. Each verify, unverify, or flag action creates a row.';

-- Rebuild the composite index over the renamed column (was (content_item_id, performed_at DESC)).
-- A bare RENAME COLUMN already keeps the existing index consistent (Postgres tracks index
-- columns by attnum, not name), but the index is rebuilt explicitly here for auditability —
-- 0 rows makes this free.
DROP INDEX IF EXISTS "idx_verification_history_item";
CREATE INDEX "idx_verification_history_item" ON "public"."verification_history" USING "btree" ("source_document_id", "performed_at" DESC);

-- RLS policies (verification_history_insert / verification_history_select) reference only
-- get_user_role() and `true` — neither touches content_item_id/source_document_id — so they
-- are left untouched.

-- ── api regen (companion, same file — DR-030/DR-032) ───────────────────────────────────────────
DROP VIEW IF EXISTS api.verification_history;
CREATE VIEW api.verification_history WITH (security_invoker = true) AS
  SELECT
    id,
    source_document_id,
    action_type,
    note,
    performed_by,
    performed_at
  FROM public.verification_history;
GRANT SELECT ON api.verification_history TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.verification_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.verification_history TO service_role;

-- ID-138 {138.5} M1 — source-binding register + admission lifecycle schema
-- TECH.md §3.1 M1 (id138_sd_source_binding_cols); §2.1 R(a), §2.6 R(b)/R(ops);
-- PLAN.md §2 (mutable-path column shape — landed decision, NOT re-delegated
-- to this Subtask).
--
-- Adds the source-binding + admission-lifecycle columns to source_documents:
--   * origin_type/locator/retention_class/cadence/auth describe HOW a source
--     is bound (uploaded bytes vs. connected-external vs. live-synced),
--     assigned at the binding gate (DR-020 light tier).
--   * admission_status drives the admission + GDPR erasure lifecycle
--     (DR-023 — the bucket holds bytes; the COLUMN drives lifecycle).
--   * logical_path is the new MUTABLE client-facing display path (PLAN §2
--     landed decision). storage_path stays FROZEN as the object key + uuid5
--     SEED-CONTRACT source (DR-024 clause i) and is untouched by this
--     migration — a client rename updates logical_path only.
--
-- All additive/nullable-or-defaulted: source_documents is empty at reset
-- (id-131 precedent, 20260628191700_id131_sd_classification_cols.sql).
-- Runtime population (mint-time logical_path := storage_path, the admission
-- write path) is {138.10}/{138.13} — out of scope here; this migration only
-- adds the columns.
--
-- Authored, NOT applied: apply is an owner-gated coordinated GO (this is
-- migration #1 of the id138 serial — {138.5} -> {138.6} -> {138.7} -> {138.9}).
-- No db push, no types regen in this Subtask.
--
-- UK English throughout (DD/MM/YYYY). Authored 03/07/2026.

-- ---------------------------------------------------------------------------
-- source_documents — source-binding register + admission lifecycle (M1)
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."source_documents"
    ADD COLUMN "origin_type" "text",
    ADD COLUMN "locator" "text",
    ADD COLUMN "retention_class" "text",
    ADD COLUMN "cadence" "text",
    ADD COLUMN "auth" "jsonb",
    ADD COLUMN "admission_status" "text" DEFAULT 'admitted'::"text" NOT NULL,
    ADD COLUMN "logical_path" "text";

ALTER TABLE "public"."source_documents"
    ADD CONSTRAINT "source_documents_retention_class_check"
    CHECK (("retention_class" = ANY (ARRAY['keep_and_watch'::"text", 'ingest_once'::"text", 'live_connected'::"text", 'external_referenced'::"text"])));

ALTER TABLE "public"."source_documents"
    ADD CONSTRAINT "source_documents_admission_status_check"
    CHECK (("admission_status" = ANY (ARRAY['admitted'::"text", 'tombstoned'::"text"])));

COMMENT ON COLUMN "public"."source_documents"."origin_type" IS 'ID-138 {138.5} M1, TECH §2.6 R(b): origin classification driving the retention_class default at the binding gate (uploaded document / id-45 onboarding Q&A / connected external system, DR-020 light tier). Populated by {138.10}/{138.13}.';
COMMENT ON COLUMN "public"."source_documents"."locator" IS 'ID-138 {138.5} M1, TECH §2.6 R(b): locator for external_referenced bindings (e.g. a connected CRM) that are consumed in place and never ingested (DR-025). NULL for bucket-resident classes.';
COMMENT ON COLUMN "public"."source_documents"."retention_class" IS 'ID-138 {138.5} M1, TECH §2.6 R(b): keep_and_watch | ingest_once | live_connected | external_referenced, assigned at the binding gate (DR-020). Drives the register-tombstone reaper (R(ops)) and the pull-sync scope (R(c)).';
COMMENT ON COLUMN "public"."source_documents"."cadence" IS 'ID-138 {138.5} M1, TECH §2.6 R(b): refresh cadence for live_connected sources / pull-sync (keep_and_watch + synthetic Platform corpus, R(c)). NULL for classes with no re-sync.';
COMMENT ON COLUMN "public"."source_documents"."auth" IS 'ID-138 {138.5} M1, TECH §2.6 R(b): auth/connection binding for live_connected and external_referenced sources (DR-025) — the zero-byte classes store only locator + auth.';
COMMENT ON COLUMN "public"."source_documents"."admission_status" IS 'ID-138 {138.5} M1, TECH §2.6 R(b)/R(ops), DR-023: drives the admission + GDPR erasure lifecycle — the bucket holds bytes, this column drives lifecycle. tombstoned cascades to derived rows via the {138.7} erasure workflow; the register row itself survives (DR-025).';
COMMENT ON COLUMN "public"."source_documents"."logical_path" IS 'ID-138 {138.5} M1, TECH §2.2 R(id), PLAN §2 (landed decision): mutable client-facing display path. storage_path stays FROZEN as the object key + uuid5 seed source (DR-024 clause i); logical_path is the only column a client rename updates. On mint, logical_path := storage_path ({138.10}/{138.13} runtime behaviour, not this migration).';

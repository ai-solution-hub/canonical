-- ID-152 — verification_history polymorphic generalisation.
-- Owner ruling (OQ oq-dad46242b712f156): Option B — generalise
-- verification_history to the polymorphic {source_document, q_a_pair} owner
-- shape already established by record_lifecycle ({131.6} M1a,
-- 20260628190000_id131_record_lifecycle_facet.sql) and record_embeddings.
--
-- Fixes: POST /api/review/action hardcoded owner_kind=source_document +
-- a source_documents-only existence lookup in every branch, so /library
-- (q_a_pairs-only) Bulk Verify 404'd for every pair (contradicts id-139.9
-- "kept end-to-end"). This migration is the DB-side half of that fix — the
-- TS route wiring (owner-aware existence lookup + q_a_pair verify branch)
-- ships in the SAME ID-152 commit, gated on these columns existing once
-- applied.
--
-- Shape: relax source_document_id to nullable, add owner_kind (text) +
-- q_a_pair_id (uuid FK -> q_a_pairs), and an exactly-one-of CHECK tying
-- owner_kind to the matching non-null FK — mirrors
-- record_lifecycle_owner_one_of_chk / citations_cited_one_of_chk (the
-- verified idiom for this shape already live in this schema). owner_kind is
-- added `NOT NULL DEFAULT 'source_document'` — the DEFAULT backfills the
-- ~45 existing rows in the same metadata-only ADD COLUMN (every row written
-- before this migration is a source_document verification action — q_a_pair
-- verification had no write path until this ID-152 wiring); no separate
-- backfill UPDATE needed (owner amendment, S477: Platform DBs hold
-- wipe-able dogfooding data only, no live-data ceremony required).
--
-- reference_item is EXCLUDED from this owner_kind domain, same as
-- record_lifecycle (BI-19) — no reference_item verification-write path
-- exists or is proposed.
--
-- Companion api.verification_history view regen is in the SAME file
-- (DR-030/DR-032 precedent: base-shape change + companion view regen must
-- land atomically — see 20260704130000_id131_verification_history_reparent.sql
-- for the same discipline applied to this table's prior re-parent). Without
-- it, INSERT via the exposed api view (the runtime path — every supabase-js
-- client routes `.from('verification_history')` to `api.verification_history`
-- per lib/supabase/schema.ts DB_OPTION) would silently drop the new columns.
--
-- AUTHORED, NOT APPLIED — do NOT run `supabase db push` or apply this to
-- staging/prod from this worktree. The parent lane (S477 Lane A) sequences
-- all DB pushes this session. Types are hand-augmented (INTERIM) in
-- supabase/types/database.types.ts pending this migration's push + a real
-- `supabase gen types` regen — see the INTERIM comments there.
--
-- Additive, data-safe (no DROP of existing data; the DEFAULT-driven
-- backfill is a metadata-only ADD COLUMN, no table rewrite, no orphan-check
-- needed at ~45 rows).

-- ── verification_history: relax source_document_id, add owner_kind + q_a_pair_id ──
ALTER TABLE "public"."verification_history"
  ALTER COLUMN "source_document_id" DROP NOT NULL;

ALTER TABLE "public"."verification_history"
  ADD COLUMN "owner_kind" "text" DEFAULT 'source_document'::"text" NOT NULL,
  ADD COLUMN "q_a_pair_id" "uuid";

ALTER TABLE "public"."verification_history"
  ADD CONSTRAINT "verification_history_owner_kind_chk"
  CHECK (("owner_kind" = ANY (ARRAY['source_document'::"text", 'q_a_pair'::"text"])));

-- Exactly-one-of: owner_kind <-> the matching non-null FK (mirrors
-- record_lifecycle_owner_one_of_chk / citations_cited_one_of_chk).
ALTER TABLE "public"."verification_history"
  ADD CONSTRAINT "verification_history_owner_one_of_chk"
  CHECK (
    (
      ("owner_kind" = 'source_document'::"text")
      AND ("source_document_id" IS NOT NULL)
      AND ("q_a_pair_id" IS NULL)
    )
    OR
    (
      ("owner_kind" = 'q_a_pair'::"text")
      AND ("q_a_pair_id" IS NOT NULL)
      AND ("source_document_id" IS NULL)
    )
  );

ALTER TABLE "public"."verification_history"
  ADD CONSTRAINT "verification_history_q_a_pair_id_fkey"
  FOREIGN KEY ("q_a_pair_id") REFERENCES "public"."q_a_pairs"("id") ON DELETE CASCADE;

COMMENT ON COLUMN "public"."verification_history"."owner_kind" IS 'ID-152: polymorphic owner discriminator — source_document | q_a_pair. Mirrors record_lifecycle_owner_kind_chk domain (BI-19: reference_item excluded).';
COMMENT ON COLUMN "public"."verification_history"."q_a_pair_id" IS 'ID-152: the q_a_pair this verification action relates to (owner_kind=q_a_pair rows only).';
COMMENT ON COLUMN "public"."verification_history"."source_document_id" IS 'The source document this verification action relates to (owner_kind=source_document rows only; nullable post ID-152 polymorphism).';
COMMENT ON TABLE "public"."verification_history" IS 'Audit trail of verification actions on typed records {source_document, q_a_pair} (ID-152 polymorphism, owner ruling Option B). Each verify, unverify, or flag action creates a row.';

-- Partial index for the new q_a_pair lookup path — mirrors the existing
-- idx_verification_history_item (source_document_id, performed_at DESC),
-- left untouched, which continues to serve source_document lookups.
CREATE INDEX IF NOT EXISTS "idx_verification_history_qa_pair" ON "public"."verification_history" USING "btree" ("q_a_pair_id", "performed_at" DESC) WHERE ("q_a_pair_id" IS NOT NULL);

-- RLS policies (verification_history_insert / verification_history_select)
-- reference only get_user_role() / `true` — neither touches owner_kind or
-- either per-kind FK column — untouched.

-- ── api regen (companion, same file — DR-030/DR-032) ────────────────────────
DROP VIEW IF EXISTS api.verification_history;
CREATE VIEW api.verification_history WITH (security_invoker = true) AS
  SELECT
    id,
    source_document_id,
    owner_kind,
    q_a_pair_id,
    action_type,
    note,
    performed_by,
    performed_at
  FROM public.verification_history;
GRANT SELECT ON api.verification_history TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.verification_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.verification_history TO service_role;

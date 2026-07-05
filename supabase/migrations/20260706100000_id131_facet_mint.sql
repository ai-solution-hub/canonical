-- ID-131.38 (FACET-MINT) — backfill + forward-mint record_lifecycle rows.
--
-- WHY: record_lifecycle ({131.6} id131_record_lifecycle_facet.sql) is pure DDL —
-- nothing in the system has ever minted a row into it. The only existing trigger,
-- record_lifecycle_domain_sync ({131.9}), is a BEFORE INSERT OR UPDATE trigger ON
-- record_lifecycle ITSELF: it syncs the denormalised `domain` column on rows that
-- already exist, it does not create rows. Result: governance review/action
-- (app/api/review/action/route.ts verify|flag|unverify|publish) and send-to-review
-- (app/api/source-documents/[id]/send-to-review/route.ts) all treat a 0-row facet
-- match as "no governance record" and 409/report the gap — every source_document
-- and q_a_pair, pre-existing or newly created, has no facet row. This migration
-- closes the gap two ways:
--   (1) BACKFILL — one record_lifecycle row per existing source_documents /
--       q_a_pairs row, ON CONFLICT (owner_kind, owner_id) DO NOTHING (idempotent
--       re-run safe). reference_item is deliberately EXCLUDED (BI-19) — its
--       freshness/validity facet is a deferred Intelligence-domain track item, not
--       part of this (owner_kind IN {source_document, q_a_pair}) facet at all.
--   (2) FORWARD-MINT — AFTER INSERT triggers on source_documents and q_a_pairs that
--       insert the matching facet row so every NEW record gets one going forward,
--       same ON CONFLICT DO NOTHING guard (belt-and-braces against a racing
--       concurrent backfill/mint).
--
-- Backfilled/minted rows get the record_lifecycle column DEFAULTs (freshness=
-- 'fresh', lifecycle_type='evergreen' for source_document owners; governance_review_
-- status/governance_review_due/governance_reviewer_id/verified_at/verified_by/
-- content_owner_id all NULL — matching the pre-migration behaviour the callers
-- above already treat as "eligible"/not-yet-reviewed, per the send-to-review route's
-- own partition: NULL is eligible, same as 'approved'/'changes_requested'/
-- 'reverted'). content_owner_id has no backfill source: content_items — the only
-- table that ever carried it — was wiped in full by the predebris wipe
-- (20260628180855_id131_predebris_wipe.sql `DELETE FROM content_items`), and
-- source_documents/q_a_pairs carry no owner column of their own, so NULL is the
-- only honest value. `domain` is deliberately omitted from every INSERT column
-- list below: the existing BEFORE INSERT trg_record_lifecycle_domain_sync trigger
-- on record_lifecycle already fires on every row this migration/trigger inserts
-- and overwrites NEW.domain regardless of what (if anything) is supplied.
--
-- q_a_pair owners MUST explicitly NULL every column in the freshness/expiry/
-- review-cadence axis (record_lifecycle_freshness_axis_chk, D7): q_a_pairs carry
-- no freshness clock, and freshness/lifecycle_type default to non-null values, so
-- an insert that omits them would violate the CHECK. source_document owners take
-- the column DEFAULTs untouched (the axis CHECK only restricts non-source_document
-- owners).
--
-- Mint trigger functions are SECURITY DEFINER (OWNER TO postgres, matching the
-- public.handle_new_user precedent for a trigger that writes into a DIFFERENT
-- table than the one it fires on): q_a_pairs_insert's RLS policy admits ANY
-- authenticated role, not just editor/admin, but record_lifecycle's own INSERT
-- policy is editor/admin-only — a plain-privilege trigger would 403 a viewer's
-- q_a_pair insert transaction outright. SECURITY DEFINER + postgres ownership
-- (record_lifecycle has no FORCE ROW LEVEL SECURITY) makes the mint insert run as
-- the table owner, bypassing that policy gap regardless of the inserting role.
-- EXECUTE is revoked from PUBLIC — these are trigger-only, never directly callable
-- (mirrors handle_new_user: "triggers fire via owner privileges").
--
-- Idempotent + re-runnable: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS
-- before CREATE TRIGGER, ON CONFLICT DO NOTHING on every INSERT.
--
-- AUTHORED, NOT APPLIED — owner-gated apply in the {131.19} GO sequence (after
-- 20260704221000_id131_drop_ims_fns, before the M6 content_items DROP). No
-- `supabase db push`, no MCP apply, no types regen in this Subtask.

-- ============================================================================
-- STEP 1 — backfill: one record_lifecycle row per existing source_documents row.
-- source_document owners take the column DEFAULTs (freshness='fresh',
-- lifecycle_type='evergreen') — the axis CHECK does not restrict this owner_kind.
-- ============================================================================
INSERT INTO "public"."record_lifecycle" (
    "owner_kind",
    "source_document_id"
)
SELECT
    'source_document',
    "sd"."id"
FROM "public"."source_documents" "sd"
ON CONFLICT ("owner_kind", "owner_id") DO NOTHING;

-- ============================================================================
-- STEP 2 — backfill: one record_lifecycle row per existing q_a_pairs row.
-- reference_item is NOT touched anywhere in this migration (BI-19 exclusion).
-- Freshness/expiry/review-cadence axis explicitly NULLed per
-- record_lifecycle_freshness_axis_chk (D7: q_a_pairs carry no freshness clock).
-- ============================================================================
INSERT INTO "public"."record_lifecycle" (
    "owner_kind",
    "q_a_pair_id",
    "freshness",
    "freshness_checked_at",
    "previous_freshness",
    "lifecycle_type",
    "expiry_date",
    "next_review_date",
    "review_cadence_days"
)
SELECT
    'q_a_pair',
    "qap"."id",
    NULL, NULL, NULL, NULL, NULL, NULL, NULL
FROM "public"."q_a_pairs" "qap"
ON CONFLICT ("owner_kind", "owner_id") DO NOTHING;

-- ============================================================================
-- STEP 3 — forward-mint: AFTER INSERT ON source_documents.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."record_lifecycle_mint_source_document"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  INSERT INTO public.record_lifecycle ("owner_kind", "source_document_id")
    VALUES ('source_document', NEW.id)
    ON CONFLICT ("owner_kind", "owner_id") DO NOTHING;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."record_lifecycle_mint_source_document"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."record_lifecycle_mint_source_document"() IS 'ID-131.38 FACET-MINT: AFTER INSERT ON source_documents forward-mint of the matching record_lifecycle governance-facet row (owner_kind=''source_document''). ON CONFLICT (owner_kind, owner_id) DO NOTHING. SECURITY DEFINER (OWNER postgres) so the mint insert is unaffected by the inserting role''s own record_lifecycle grants. Not directly callable — EXECUTE revoked from PUBLIC, fires via owner privileges only.';

REVOKE ALL ON FUNCTION "public"."record_lifecycle_mint_source_document"() FROM PUBLIC;

DROP TRIGGER IF EXISTS "trg_record_lifecycle_mint_source_document" ON "public"."source_documents";

CREATE TRIGGER "trg_record_lifecycle_mint_source_document"
    AFTER INSERT ON "public"."source_documents"
    FOR EACH ROW EXECUTE FUNCTION "public"."record_lifecycle_mint_source_document"();

-- ============================================================================
-- STEP 4 — forward-mint: AFTER INSERT ON q_a_pairs.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."record_lifecycle_mint_q_a_pair"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  INSERT INTO public.record_lifecycle (
      "owner_kind",
      "q_a_pair_id",
      "freshness",
      "freshness_checked_at",
      "previous_freshness",
      "lifecycle_type",
      "expiry_date",
      "next_review_date",
      "review_cadence_days"
  )
    VALUES ('q_a_pair', NEW.id, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
    ON CONFLICT ("owner_kind", "owner_id") DO NOTHING;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."record_lifecycle_mint_q_a_pair"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."record_lifecycle_mint_q_a_pair"() IS 'ID-131.38 FACET-MINT: AFTER INSERT ON q_a_pairs forward-mint of the matching record_lifecycle governance-facet row (owner_kind=''q_a_pair''), freshness/expiry/review-cadence axis explicitly NULLed per record_lifecycle_freshness_axis_chk (D7). ON CONFLICT (owner_kind, owner_id) DO NOTHING. SECURITY DEFINER (OWNER postgres): q_a_pairs_insert RLS admits ANY authenticated role, but record_lifecycle INSERT is editor/admin-only — SECURITY DEFINER stops a viewer''s q_a_pair insert being blocked by the facet mint. Not directly callable — EXECUTE revoked from PUBLIC, fires via owner privileges only.';

REVOKE ALL ON FUNCTION "public"."record_lifecycle_mint_q_a_pair"() FROM PUBLIC;

DROP TRIGGER IF EXISTS "trg_record_lifecycle_mint_q_a_pair" ON "public"."q_a_pairs";

CREATE TRIGGER "trg_record_lifecycle_mint_q_a_pair"
    AFTER INSERT ON "public"."q_a_pairs"
    FOR EACH ROW EXECUTE FUNCTION "public"."record_lifecycle_mint_q_a_pair"();

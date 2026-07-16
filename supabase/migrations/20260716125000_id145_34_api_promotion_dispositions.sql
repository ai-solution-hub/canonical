-- ID-145 {145.34} coupling prep — api.promotion_dispositions companion view.
--
-- HAND-AUTHORED, NOT GENERATOR OUTPUT: `promotion_dispositions` was just added
-- to SURFACE_TABLES (scripts/generate-api-views.ts, commit
-- 9a8dcac8 "surface promotion_dispositions + engagement_group_content coupling
-- prep for push batch"), but the pinned generator OUTPUT_FILE
-- (20260706150000_id131_api_views_regen2.sql) was authored BEFORE this table's
-- own migration (20260716111053_id145_145_34_promotion_dispositions.sql) — so
-- `CREATE VIEW api.promotion_dispositions AS SELECT ... FROM
-- public.promotion_dispositions` cannot be added there: a fresh `supabase db
-- reset` would replay regen2.sql before the base table exists
-- (SQLSTATE 42P01, undefined_table). Without this view, once the push applies
-- 20260716111053, `client.from('promotion_dispositions')` 404s the LIVE
-- {145.30} accept/edit/reject feature (PostgREST only exposes the `api`
-- schema, ID-115) and `scripts/check-api-view-coverage.ts` fails "surface
-- table without an api view".
--
-- Precedent for exactly this shape: 20260712063000_id145_w1d_api_regen.sql
-- (its own header explains the same regen-vs-live-schema gap). Column list
-- and grants below are copied verbatim from the base table migration
-- (20260716111053_id145_145_34_promotion_dispositions.sql lines 46-54 for
-- columns in attnum/DDL order, lines 100-101 for grants — that table grants
-- authenticated only SELECT, INSERT [append-only: no UPDATE/DELETE policy
-- either, see that file's header] and service_role ALL; it grants anon
-- nothing at all), applying `emitView`'s own grant-derivation rule
-- (scripts/generate-api-views.ts lines 471-482): anon capped at SELECT and
-- only emitted if the base table grants anon SELECT (it does not here, so
-- anon gets NO grant on this view — a stricter posture than every other view
-- in the surface, correctly inherited rather than defaulted-open);
-- authenticated/service_role mirror the base table's {SELECT, INSERT, UPDATE,
-- DELETE} subset verbatim.
--
-- NOT GENERATOR PARITY, correctness-against-schema-as-authored: this migration
-- does not claim to be byte-identical to what `generate-api-views.ts` would
-- emit against a live catalog (it cannot introspect one here). The
-- Orchestrator should re-run `bun scripts/generate-api-views.ts --check`
-- post-push to confirm parity (INV-16 idempotency) and fold this view into
-- the next full regen at that point.
SET search_path = public, extensions;

-- promotion_dispositions ────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.promotion_dispositions;
CREATE VIEW api.promotion_dispositions WITH (security_invoker = true) AS
  SELECT
    id,
    extraction_id,
    action,
    actor,
    created_at,
    proposed_snapshot
  FROM public.promotion_dispositions;
GRANT SELECT, INSERT ON api.promotion_dispositions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.promotion_dispositions TO service_role;

-- ID-145 {145.35} fix-Executor (S481 post-push live smoke FAILURE) —
-- api.engagement_groups + api.engagement_group_content companion views.
--
-- HAND-AUTHORED, NOT GENERATOR OUTPUT: same shape as
-- 20260716125000_id145_34_api_promotion_dispositions.sql. Both base tables
-- (20260712062000_id145_w1c_rename_reshape.sql STEP 6 for engagement_groups;
-- 20260716130000_id145_35_engagement_group_content.sql for
-- engagement_group_content) were pushed live BEFORE this Subtask flips them
-- from INTERNAL_ONLY_TABLES to SURFACE_TABLES (scripts/generate-api-views.ts,
-- same commit as this migration), and the pinned generator OUTPUT_FILE
-- (20260706150000_id131_api_views_regen2.sql) predates both tables' own
-- migrations — a fresh `supabase db reset` would replay regen2.sql before
-- either base table exists (SQLSTATE 42P01). Precedent: the promotion_
-- dispositions migration above; original precedent:
-- 20260712063000_id145_w1d_api_regen.sql.
--
-- WHY THIS EXISTS (S481 live smoke FAILURE, not a design change): the
-- original {145.35} build (S479) reached both tables through a per-call
-- `.schema('public')` override on the standard client, citing
-- `lib/supabase/schema.ts`'s INV-12 escape hatch. That override cannot work:
-- post-ID-115, PostgREST is configured to expose ONLY the `api` schema —
-- `public` itself is UNEXPOSED at the Data API layer (not just untyped-for),
-- so `.schema('public')` 500s with PostgREST's "Invalid schema: public" for
-- EVERY caller, not only this app's client. INV-12's actual escape hatch
-- (`lib/supabase/schema.ts` module doc) is for direct-Postgres/service paths
-- outside the Data API entirely; it was never a route around schema
-- exposure. The correct fix is the platform-standard one: surface both
-- tables as `api` views (this migration) and read/write them through the
-- normal api-schema client, exactly like every other surfaced table — see
-- app/api/engagement-groups/route.ts and
-- app/api/engagement-groups/[id]/content/route.ts (same commit), which drop
-- the `.schema('public')` overrides entirely.
--
-- Column lists + grants copied verbatim from each base table migration:
--   - engagement_groups (20260712062000 STEP 6, lines ~167-197): columns
--     id, name, created_at, updated_at, created_by; RLS "no anon grants"
--     (stricter than the blanket surface pattern) — GRANT ALL ON TABLE to
--     authenticated + service_role only, nothing to anon.
--   - engagement_group_content (20260716130000, lines 51-92): columns id,
--     engagement_group_id, q_a_pair_id, created_at; same posture — GRANT ALL
--     ON TABLE to authenticated + service_role only, nothing to anon.
-- Applying `emitView`'s own grant-derivation rule
-- (scripts/generate-api-views.ts lines ~471-482): anon gets NO grant on
-- either view (neither base table grants anon SELECT); authenticated /
-- service_role mirror the base tables' {SELECT, INSERT, UPDATE, DELETE}
-- subset verbatim (both base tables' GRANT ALL includes all four). RLS
-- still applies via the caller's JWT (security_invoker = true) — this
-- migration only changes Data-API schema resolution, not the auth posture.
--
-- AUTHORED-ONLY — rides the next coordinated deploy, NOT applied here (same
-- Lane B2 convention as 20260716130000_id145_35_engagement_group_content.sql
-- and 20260716113306_id147_form_attachments.sql). `supabase db push` is
-- deliberately NOT run against this file — the parent/deploy lane sequences
-- it, then re-runs the {145.35} live smoke to confirm both endpoints 200.
--
-- NOT GENERATOR PARITY, correctness-against-schema-as-authored: this
-- migration does not claim to be byte-identical to what
-- `generate-api-views.ts` would emit against a live catalog. Post-push, the
-- Orchestrator should re-run `bun scripts/generate-api-views.ts --check` to
-- confirm parity (INV-16 idempotency) and fold both views into the next
-- full regen.
SET search_path = public, extensions;

-- engagement_groups ─────────────────────────────────────────────────────────
DROP VIEW IF EXISTS api.engagement_groups;
CREATE VIEW api.engagement_groups WITH (security_invoker = true) AS
  SELECT
    id,
    name,
    created_at,
    updated_at,
    created_by
  FROM public.engagement_groups;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.engagement_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.engagement_groups TO service_role;

-- engagement_group_content ──────────────────────────────────────────────────
DROP VIEW IF EXISTS api.engagement_group_content;
CREATE VIEW api.engagement_group_content WITH (security_invoker = true) AS
  SELECT
    id,
    engagement_group_id,
    q_a_pair_id,
    created_at
  FROM public.engagement_group_content;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.engagement_group_content TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.engagement_group_content TO service_role;

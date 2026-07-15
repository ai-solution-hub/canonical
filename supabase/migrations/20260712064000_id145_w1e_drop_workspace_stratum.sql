-- ID-145 {145.6} W1e — drop the procurement workspace stratum (TECH.md §2 M5;
-- R3/R10; ARCH-REVIEW C4/C9). MUST land AFTER W1c severs the workspace_id CASCADE
-- from form_instances/form_questions (else this DELETE would kill every
-- surviving form/question along with its workspace) and AFTER W1a's lineage
-- fix (else the 4 q_a_pairs rows lose their workspace provenance permanently).
-- `workspaces` ITSELF, `application_types`, and the intelligence lane are NOT
-- touched here (DR-056) — only rows/tables that are procurement-specific.

-- ============================================================================
-- STEP 1 — DELETE all procurement workspaces wholesale (R3/R10 — formless +
-- debris + wholesale, no salvage, no backfill; ~498 rows on staging).
-- procurement_workspaces.workspace_id is the 1:1 UNIQUE FK marker
-- (ON DELETE CASCADE) identifying which `workspaces` rows are procurement —
-- this DELETE removes exactly those rows (and, by that same CASCADE, empties
-- procurement_workspaces itself and any other workspace-scoped satellite row
-- for these specific ids) without touching non-procurement workspaces (sales
-- proposal, training/onboarding, product guide, intelligence, competitor
-- research — all separate applications on the SAME workspaces table).
-- ============================================================================
DELETE FROM "public"."workspaces"
WHERE "id" IN (SELECT "workspace_id" FROM "public"."procurement_workspaces");

-- ============================================================================
-- STEP 2 — drop the rollup machinery (C4): aggregates become direct
-- form_instances reads once there is no more procurement_workspaces row to
-- cache them on. Trigger + its function first (no more firings once the
-- trigger is gone), then the two get_procurement_rollup read wrappers
-- (api before public — the api wrapper's body references the public
-- function), then the recompute function itself, then the now-empty table.
-- ============================================================================
DROP TRIGGER IF EXISTS "form_templates_recompute_rollup" ON "public"."form_instances";
DROP FUNCTION IF EXISTS "public"."form_templates_recompute_rollup_trigger"();
DROP FUNCTION IF EXISTS "api"."get_procurement_rollup"("uuid");
DROP FUNCTION IF EXISTS "public"."get_procurement_rollup"("uuid");
DROP FUNCTION IF EXISTS "public"."recompute_procurement_rollup"("uuid");

DROP TABLE IF EXISTS "public"."procurement_workspaces";

-- ============================================================================
-- STEP 3 — drop procurement_vehicles + procurement_vehicle_instances (C9 —
-- zero code refs, zero inbound FKs from any surviving table). Child table
-- first: procurement_vehicle_instances_vehicle_key_fkey is ON DELETE RESTRICT
-- against procurement_vehicles, so the parent cannot drop first.
-- scripts/check-api-view-coverage.ts's two matching allow-list entries are
-- removed in the same {145.6} commit (companion TS change, tracked
-- separately — this migration only handles the DB objects).
-- ============================================================================
DROP TABLE IF EXISTS "public"."procurement_vehicle_instances";
DROP TABLE IF EXISTS "public"."procurement_vehicles";

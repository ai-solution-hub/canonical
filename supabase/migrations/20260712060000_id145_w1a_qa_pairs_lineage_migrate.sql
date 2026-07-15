-- ID-145 {145.6} W1a — q_a_pairs workspace→form lineage migrate.
-- TECH.md §2 M1; ARCH-REVIEW §2 C8. MUST land before {145.6} W1e (workspace drop) —
-- once workspaces rows are deleted, the "earliest form of that workspace" lookup
-- below has nothing left to resolve against. MUST land before W1c (rename/reshape)
-- too — the column names below are the pre-rename form_templates/source_workspace_id
-- shapes; W1c renames form_templates -> form_instances and
-- source_form_template_id -> source_form_instance_id AFTER this lineage fix has
-- already run. Idempotent (guarded by IS NULL / IS NOT NULL predicates) — safe to
-- re-run.
--
-- q_a_pairs: 4 live staging rows carry source_workspace_id with
-- source_form_template_id still NULL (all 4 verified migratable via their
-- workspace's earliest-created form, ARCH-REVIEW §2 C8). Resolve each to that
-- form — mirrors the {130.27} backfill migration's own DISTINCT ON resolution
-- precedent (20260708120000_id130_form_template_id_backfill_guard.sql STEP 1) so
-- the "earliest form per workspace" convention stays consistent app-wide.
UPDATE "public"."q_a_pairs" "qp"
SET "source_form_template_id" = "ft"."id"
FROM (
    SELECT DISTINCT ON ("workspace_id") "id", "workspace_id"
    FROM "public"."form_templates"
    ORDER BY "workspace_id", "created_at" ASC
) "ft"
WHERE "ft"."workspace_id" = "qp"."source_workspace_id"
  AND "qp"."source_form_template_id" IS NULL
  AND "qp"."source_workspace_id" IS NOT NULL;

-- q_a_pair_dedup_proposals.pair_a_source_workspace_id / pair_b_source_workspace_id:
-- deliberately NO migration DML here. These two columns are denormalised COPIES of
-- the workspace id captured at proposal-creation time — there is no pair_a/b-grain
-- "source_form_template_id" (or post-rename source_form_instance_id) column on
-- THIS table to migrate them onto; only q_a_pairs carries that column, fixed above.
-- Lineage for a dedup_proposals row stays fully recoverable after W1c drops these
-- two columns via the existing pair_a_id/pair_b_id FKs -> q_a_pairs.
-- source_form_instance_id (now populated by the UPDATE above wherever it was
-- resolvable) — dropping the two workspace columns loses no provenance that is not
-- already captured transitively through that FK. TECH.md §2 M1's "Same for
-- q_a_pair_dedup_proposals.pair_a/b_source_workspace_id" is read here as "apply the
-- same before-you-drop diligence", not a literal analogous UPDATE — there is no
-- structural target column for one on this table.

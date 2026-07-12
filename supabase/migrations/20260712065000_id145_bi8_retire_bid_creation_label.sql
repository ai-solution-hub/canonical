-- ID-145.27 — Retire the 'bid' form_type CV creation label (PRODUCT.md BI-8/
-- BI-12, rev. S467; TECH.md §1.B row 8, W2). DATA migration — no DDL.
--
-- CONTEXT: FormTypePicker (components/procurement/form-type-picker.tsx) is
-- DB-driven — it renders whatever rows api.form_types returns, filtered to
-- 'procurement' = ANY(applicable_application_types) (see
-- fetchProcurementFormTypes in that file). The 'bid' row (seeded by
-- 20260625150000_id130_data.sql STEP 0:
-- ('bid','Bid','core',ARRAY['procurement'])) is therefore a selectable
-- creation label purely by its presence in the table — BI-8 requires
-- "'Bid' is not offered as a first-class creation label", so retiring the
-- row IS the fix. FormTypePicker itself needs no code change (confirmed:
-- {145.8} out-of-scope observation 1, S467).
--
-- SEQUENCING: this file's timestamp (065000) sorts after the full {145.6}
-- W1 SQL batch (w1a 060000 .. w1e 064000) — required so form_instances /
-- form_requirement_templates / question_matches already carry their final
-- ID-145 names and columns before this migration touches them. It does NOT
-- need to sort after {145.6}'s M6 (scripts/seed-id145-w1f-exemplar.ts) — M6
-- is a TS script, not a SQL migration, and per its own header runs
-- POST-PUSH as an Orchestrator-gated manual step, i.e. strictly AFTER every
-- SQL migration (including this one) has already applied. This migration
-- therefore cannot rely on M6 JOB 1's `bid`->`itt` reclassification having
-- already run — it performs the equivalent reclassification itself
-- (STEP 1 below) so the STEP 2 DELETE never FK-orphans a live row. When M6
-- runs afterwards, its JOB 1 UPDATE naturally matches zero rows (already
-- idempotent by its own design) because STEP 1 here already did the work.
--
-- DESIGN DECISION (journalled per dispatch brief): form_types has no
-- active/selectable flag column — its DDL is key/label/provenance/
-- applicable_application_types/created_at only (verified against
-- 20260617130000_squash_baseline.sql:6674-6681, unchanged since). Adding
-- one would be additional DDL solely to retire a single CV label — not
-- justified when a guarded DELETE is safe and simpler. Chose
-- DELETE-with-guard over introducing a flag column.
--
-- FK surface referencing form_types.key (verified against
-- 20260617130000_squash_baseline.sql; unchanged by the {145.6} W1 batch —
-- grep confirms no RENAME CONSTRAINT touched any of the three below, only
-- the owning tables were renamed):
--   1. form_templates_form_type_fkey -> form_instances.form_type (table
--      renamed form_templates->form_instances by w1c; FK/constraint name
--      unchanged). No ON DELETE clause (defaults to NO ACTION — blocks the
--      DELETE while a referencing row exists).
--   2. form_template_requirements_template_type_fkey ->
--      form_requirement_templates.template_type (table renamed
--      form_template_requirements->form_requirement_templates by w1c; FK
--      name unchanged). ON DELETE RESTRICT.
--   3. question_matches_question_kind_fkey ->
--      question_matches.question_kind. ON DELETE RESTRICT. TECH.md §4 (R7
--      retrieval wiring) records question_match_recompute has ZERO callers
--      as of this Subtask, so this table is expected empty on every
--      environment — STEP 1c below is a defensive no-op, not a
--      known-needed reclassification.
--   (form_outcome_types.applicable_form_types also lists 'bid' — STEP 1 of
--   20260625120000_id130_spine.sql — but that is a plain text[], not an
--   FK-enforced column, so it cannot block this DELETE; left untouched and
--   flagged as a minor stale-data cleanup, out of this Subtask's scope.)
--
-- Grep-verified (no live-DB access this Subtask — AUTHOR ONLY, staging is
-- pre-{145.6}-push): no seed script assigns template_type='bid' or
-- question_kind='bid' (scripts/catalogue-standard-sq.ts's TEMPLATE_TYPE
-- constant is 'sq'; question_matches has no seed data at all as of this
-- Subtask). Only form_instances.form_type is a KNOWN reclassification
-- target (id-130 {130.8}'s `COALESCE(dm->>'form_type','bid')` mint
-- default, PRODUCT.md BI-45). STEPs 1b/1c exist purely as a defensive
-- mirror in case staging drift proves that grep wrong.
--
-- Idempotent / re-runnable: STEP 1's UPDATEs are plain WHERE-scoped (match
-- zero rows on a second pass). STEP 2's DELETE is naturally idempotent
-- (deleting an already-absent key matches zero rows) and additionally
-- guarded — it only fires if, after STEP 1, zero rows anywhere still
-- reference 'bid', so an unanticipated referencing row (a table this
-- migration did not foresee) SKIPS the delete with a RAISE NOTICE rather
-- than hard-failing the whole migration/transaction.
-- No explicit BEGIN/COMMIT — matches every {145.6} W1 sibling file (the
-- push harness already runs each migration in its own transaction).

-- ============================================================================
-- STEP 1 — defensively re-classify any 'bid'-typed rows before the CV row is
-- removed (mirrors {145.6} M6 JOB 1's bid->itt mapping; TECH.md §2 M6 /
-- PRODUCT.md BI-45). 'itt' is a valid final_award-stage form_type
-- (form_outcome_types.key IN ('won','lost') both already list 'itt' in
-- applicable_form_types alongside 'bid' — 20260625120000_id130_spine.sql
-- STEP 1), so an already-outcome-recorded form reclassified bid->itt does
-- not trip form_templates_outcome_form_type_check.
-- ============================================================================

-- STEP 1a — form_instances.form_type (the known, expected reclassification
-- target — id-130 {130.8}'s mint default).
UPDATE "public"."form_instances"
SET "form_type" = 'itt'
WHERE "form_type" = 'bid';

-- STEP 1b — form_requirement_templates.template_type (defensive; no seed
-- script assigns 'bid' here as of this Subtask).
UPDATE "public"."form_requirement_templates"
SET "template_type" = 'itt'
WHERE "template_type" = 'bid';

-- STEP 1c — question_matches.question_kind (defensive; TECH.md §4 records
-- zero callers for question_match_recompute as of this Subtask, so this
-- table is expected empty).
UPDATE "public"."question_matches"
SET "question_kind" = 'itt'
WHERE "question_kind" = 'bid';

-- ============================================================================
-- STEP 2 — guarded DELETE of the 'bid' CV row. Only deletes if, after
-- STEP 1, zero rows anywhere still reference 'bid' — an explicit
-- belt-and-braces check (not relying solely on the FK to fail the
-- statement) so an unanticipated referencing table skips the delete
-- cleanly (RAISE NOTICE) instead of aborting this migration's transaction.
-- ============================================================================
DO $$
DECLARE
    "v_remaining" integer;
BEGIN
    SELECT
        (SELECT count(*) FROM "public"."form_instances" WHERE "form_type" = 'bid')
      + (SELECT count(*) FROM "public"."form_requirement_templates" WHERE "template_type" = 'bid')
      + (SELECT count(*) FROM "public"."question_matches" WHERE "question_kind" = 'bid')
    INTO "v_remaining";

    IF "v_remaining" = 0 THEN
        DELETE FROM "public"."form_types" WHERE "key" = 'bid';
        RAISE NOTICE 'id145_bi8_retire_bid_creation_label: deleted form_types.key=bid (0 referencing rows after STEP 1).';
    ELSE
        RAISE NOTICE 'id145_bi8_retire_bid_creation_label: SKIPPED delete — % row(s) still reference form_type=bid after reclassification; form_types.key=bid left in place for manual follow-up.', "v_remaining";
    END IF;
END
$$;

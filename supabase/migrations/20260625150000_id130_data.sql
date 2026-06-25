-- ID-130.8 — Data migration (T-B22 mint + T-B4 re-key + initial rollup recompute).
-- TECH §Migration plan step 9. DATA ONLY — NO DDL (no CREATE/ALTER TABLE/TYPE/FUNCTION):
-- the schema was added by {130.5} spine (20260625120000), the rollup fn/trigger by {130.6}
-- (20260625130000), and the win-rate rewrite by {130.7} (20260625140000). This file is the
-- final ID-130 backfill: it mints one form per live procurement workspace, re-keys the
-- workspace-scoped questions onto that form, and materialises the procurement rollups.
--
-- DEPENDS ON (as-applied, verified against the migration files, not a live DB):
--   * {130.5} spine — form_templates engagement columns
--       (outcome, outcome_recorded_at, outcome_recorded_by, submission_date, workflow_state),
--       form_questions.form_template_id FK, form_outcome_types CV + cross-check trigger
--       (form_templates_outcome_form_type_check: a recorded outcome must be applicable to
--       the form_type — satisfied here because every minted {won,lost} form is form_type='bid',
--       and 'bid' ∈ form_outcome_types.applicable_form_types for both 'won' and 'lost').
--   * {130.6} recompute_procurement_rollup(uuid) — idempotent UPSERT (ON CONFLICT workspace_id);
--       also fired automatically by the AFTER-INSERT trigger on each mint below.
--   * squash baseline — form_templates NOT-NULL base columns (workspace_id, name, filename,
--       storage_path, file_size, mime_type[CHECK pdf/docx/xlsx], status[def 'uploaded'],
--       ingest_source[def 'pipeline']); procurement_workspaces_workspace_id_key UNIQUE (L8403);
--       form_templates_form_type_fkey → form_types.key ('bid' is a seeded CV key).
--
-- IDEMPOTENT / re-runnable on staging:
--   * mint guarded by NOT EXISTS (one form per workspace; a re-apply does not double-mint);
--   * re-key guarded by fq.form_template_id IS NULL (only keys unkeyed rows; same value on re-run);
--   * recompute is an UPSERT — naturally idempotent.
-- No explicit BEGIN/COMMIT: each migration already runs in the push harness's own transaction,
-- matching the {130.5}/{130.6}/{130.7} sibling files (a nested BEGIN/COMMIT would fight it).
--
-- domain_metadata is KEPT (NOT dropped) for reversibility — the per-engagement field drop is a
-- deferred Follow-up (gated on zero readers), not this Subtask.

-- ============================================================================
-- STEP 9a — T-B22: mint one form_templates row per live procurement workspace.
-- "Live procurement workspace" = workspaces joined to application_types.key='procurement'
-- (the verbatim {130.8} definition; no is_archived filter — every procurement engagement
-- becomes an umbrella, and every workspace-scoped question must re-key in 9b).
--
-- Transforms (verbatim {130.8}/T-B22), lifting workspaces.domain_metadata onto the form:
--   issuing_organisation  <- domain_metadata->>'buyer'         (buyer reuses issuing_organisation, AD-1)
--   deadline              <- domain_metadata->>'deadline'      (cast to timestamptz, null-safe)
--   submission_date       <- domain_metadata->>'submission_date' (cast, null-safe)
--   workflow_state        <- COALESCE(domain_metadata->>'status','draft')  (NOT NULL col; live status absent)
--   WITHDRAWN transform   :  domain_metadata->>'outcome'='withdrawn' => workflow_state='withdrawn' AND outcome=NULL
--                            (withdrawn is a workflow terminal, NOT an outcome — AD-4)
--   outcome               <- only {won,lost} lift; any other value (incl. withdrawn) => NULL
--   outcome_recorded_at/by<- lift ONLY alongside a lifted {won,lost} outcome (else NULL)
--   form_type             <- COALESCE(domain_metadata->>'form_type','bid'); live data carries no
--                            form_type signal so this resolves to the documented default 'bid'
--                            (a final-award form_type, so a minted won/lost form correctly enters
--                            the {130.7} win-rate denominator via form_outcome_types.counts_toward_win_rate).
--
-- NOT-NULL base columns with no domain_metadata source get sensible, clearly-marked synthetic
-- mint values (the engagement has no real uploaded file): name = the workspace name; mime_type =
-- 'application/pdf' (in the CHECK set); filename/storage_path = id130 mint markers; file_size = 0.
-- status (analysis-pipeline axis) is intentionally NOT set — it is orthogonal to the engagement
-- transform (AD-1 three-axis model) and relies on its column default 'uploaded'. outcome_notes is
-- intentionally NOT lifted (not in the verbatim transform; recoverable from the retained
-- domain_metadata).
-- ============================================================================
WITH "procurement_ws" AS (
    SELECT
        "w"."id"              AS "workspace_id",
        "w"."name"            AS "workspace_name",
        "w"."domain_metadata" AS "dm"
    FROM "public"."workspaces" "w"
    JOIN "public"."application_types" "app_type"
      ON "app_type"."id" = "w"."application_type_id"
    WHERE "app_type"."key" = 'procurement'
      AND NOT EXISTS (
          SELECT 1 FROM "public"."form_templates" "ft"
          WHERE "ft"."workspace_id" = "w"."id"
      )
)
INSERT INTO "public"."form_templates" (
    "workspace_id",
    "name",
    "filename",
    "storage_path",
    "file_size",
    "mime_type",
    "form_type",
    "issuing_organisation",
    "deadline",
    "submission_date",
    "workflow_state",
    "outcome",
    "outcome_recorded_at",
    "outcome_recorded_by"
)
SELECT
    "pw"."workspace_id",
    "pw"."workspace_name",
    'id130-minted-form.pdf',
    'id130-minted/' || "pw"."workspace_id"::"text",
    0,
    'application/pdf',
    COALESCE(NULLIF("pw"."dm"->>'form_type', ''), 'bid'),
    "pw"."dm"->>'buyer',
    NULLIF("pw"."dm"->>'deadline', '')::timestamp with time zone,
    NULLIF("pw"."dm"->>'submission_date', '')::timestamp with time zone,
    CASE
        WHEN "pw"."dm"->>'outcome' = 'withdrawn' THEN 'withdrawn'
        ELSE COALESCE("pw"."dm"->>'status', 'draft')
    END,
    CASE
        WHEN "pw"."dm"->>'outcome' IN ('won', 'lost') THEN "pw"."dm"->>'outcome'
        ELSE NULL
    END,
    CASE
        WHEN "pw"."dm"->>'outcome' IN ('won', 'lost')
            THEN NULLIF("pw"."dm"->>'outcome_recorded_at', '')::timestamp with time zone
        ELSE NULL
    END,
    CASE
        WHEN "pw"."dm"->>'outcome' IN ('won', 'lost')
            THEN NULLIF("pw"."dm"->>'outcome_recorded_by', '')::"uuid"
        ELSE NULL
    END
FROM "procurement_ws" "pw";

-- ============================================================================
-- STEP 9b — T-B4: re-key form_questions onto their workspace's minted form.
-- One minted form per workspace (guaranteed by the 9a NOT EXISTS guard + the empty starting
-- form_templates), so the workspace_id join is a deterministic 1:1. The fq.form_template_id IS
-- NULL guard makes this idempotent (re-keys only unkeyed rows; a re-run sets the same id).
-- The "ft" set contains only procurement-workspace mints, so non-procurement questions are
-- untouched. q_a_pairs stay corpus-level — this re-key is form_questions-only.
-- ============================================================================
UPDATE "public"."form_questions" "fq"
SET "form_template_id" = "ft"."id"
FROM "public"."form_templates" "ft"
WHERE "ft"."workspace_id" = "fq"."workspace_id"
  AND "fq"."form_template_id" IS NULL;

-- ============================================================================
-- STEP 9c — recompute the procurement rollups for every procurement workspace.
-- recompute_procurement_rollup ({130.6}) is an idempotent ON CONFLICT (workspace_id) UPSERT, so
-- ordering is safe and a re-run is harmless. The mint in 9a already fires the AFTER-INSERT rollup
-- trigger per form; this explicit pass additionally refreshes any workspace whose mint was skipped
-- on an idempotent re-run, and gives the final authoritative rollup state for all 12 engagements.
-- ============================================================================
SELECT "public"."recompute_procurement_rollup"("w"."id")
FROM "public"."workspaces" "w"
JOIN "public"."application_types" "app_type"
  ON "app_type"."id" = "w"."application_type_id"
WHERE "app_type"."key" = 'procurement';

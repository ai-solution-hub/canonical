-- ID-130 {130.27} — form_template_id write-side stamp: backfill + recurrence guard.
--
-- THE BUG: form_questions rows created via the live tender-upload extraction path
-- (app/api/procurement/[id]/questions/extract/route.ts) and the manual/batch
-- add-a-question paths (app/api/procurement/[id]/questions/route.ts) were written
-- with workspace_id ONLY -- form_template_id was populated ONCE by the {130.8}
-- backfill (20260625150000_id130_data.sql STEP 9b) and has drifted NULL on every
-- insert since. outcome/route.ts's KB-integration query and the win-rate RPCs
-- (get_content_win_rate / get_aggregate_win_rate_stats,
-- 20260625140000_id130_winrate.sql) INNER JOIN
-- form_questions.form_template_id -> form_templates.id, so a NULL-drifted row is
-- silently DROPPED from both, without erroring.
--
-- THE FIX ({130.27}, this Task wave):
--   1. (app code, same commit) every live form_questions insert/upsert site now
--      stamps form_template_id via lib/domains/procurement/resolve-form-template.ts,
--      which resolves the workspace's earliest-created form_templates row --
--      mirroring outcome/route.ts's existing "the workspace's single v1 form"
--      resolution -- and mints one on demand (ingest_source='app_upload') when
--      the workspace has none yet (the live tender-upload UI flow never creates
--      a form_templates row itself -- only the explicit "add a form" action or a
--      cocoindex-pipeline ingest does, so this is the COMMON case, not an edge
--      case).
--   2. STEP 1 below backfills every currently-NULL form_questions row the same
--      way, mirroring {130.8}'s STEP 9b re-key shape.
--   3. STEP 2 below adds a BEFORE INSERT recurrence-guard trigger: defense in
--      depth for any insert path this Subtask's app-code sweep missed (or a
--      future one that forgets to call resolveOrMintFormTemplateId()).
--   4. STEP 3 below (Checker Finding 1 remediation, same wave) adds the
--      `resolve_or_mint_form_template_id` RPC the app resolver now calls
--      instead of doing its own SELECT-then-INSERT, closing a concurrent-mint
--      race for a workspace's very first question-creation call. See STEP 3's
--      own header for the full rationale (including why this is a separate
--      function rather than a mint-capable STEP 2 trigger).
--
-- NOT NULL deliberately NOT added on form_questions.form_template_id:
-- scripts/seed-synthetic-corpus.ts inserts form_questions with form_template_id
-- intentionally NULL -- it exists to validate the {130.8} migration's OWN
-- mint-and-rekey steps (STEP 9a/9b) against workspaces that mimic the live
-- pre-backfill state, and a NOT NULL constraint would break that fixture outright.
-- (The trigger below is a no-op for that fixture at insert time anyway: its
-- synthetic workspaces carry zero form_templates rows at seed time, so there is
-- nothing to resolve against -- same observed NULL result as before this
-- migration.) Per the {130.27} brief: NOT NULL is only safe when EVERY insert
-- site stamps the column, and this one deliberately does not.
--
-- MULTI-FORM CAVEAT (v1 1:1 assumption): a workspace CAN carry more than one
-- form_templates row post-{130.8} (the explicit "add a form" action in
-- forms/route.ts, or an uploaded fill-in template via templates/route.ts). Both
-- STEP 1 and STEP 2 below resolve to the EARLIEST-created form_templates row per
-- workspace_id -- exactly matching the resolution outcome/route.ts already uses
-- for "the workspace's single v1 form" (order by created_at ascending, take the
-- first row). This is a consistency choice, not a new assumption: a future
-- multi-form-aware v2 would need to revisit both the app resolver AND this
-- backfill/trigger pair together.
--
-- Idempotent / re-runnable on staging or prod:
--   * STEP 1 is a plain UPDATE guarded by fq.form_template_id IS NULL -- a
--     re-apply re-selects the same earliest form per workspace and sets the
--     same value (no-op on a clean re-run).
--   * STEP 2 uses CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS / CREATE
--     TRIGGER -- safe to re-run.
--   * STEP 3 uses CREATE OR REPLACE FUNCTION for both the public function and
--     the api wrapper (signature-stable) + idempotent REVOKE/GRANT -- safe to
--     re-run.
-- No explicit BEGIN/COMMIT: each migration already runs in the push harness's
-- own transaction (matches the {130.5}/{130.6}/{130.7}/{130.8} sibling files).
--
-- Owner ruling (decision oq-961ad0eb240fb2a1 + owner steer): all Platform/client
-- DB data is TRANSIENT pre-launch (zero data-preservation effort required for
-- this backfill); migration + STAGING apply are GRANTED this wave.

-- ============================================================================
-- STEP 1 — backfill existing NULL-drifted form_questions rows.
-- Mirrors {130.8}'s STEP 9b shape (20260625150000_id130_data.sql), but resolves
-- the EARLIEST-created form per workspace_id via DISTINCT ON rather than a bare
-- join. {130.8} ran when the mint-guard (its STEP 9a NOT EXISTS) guaranteed
-- exactly one form per workspace, so a bare join was a safe 1:1. forms/route.ts's
-- "add a form" action (landed after {130.8}) means a workspace can now carry
-- more than one form_templates row, so a bare join here could non-deterministically
-- match a NON-canonical form for a multi-form workspace. DISTINCT ON
-- (workspace_id) ... ORDER BY created_at makes the "earliest form" resolution
-- explicit and deterministic, matching the app-level resolver.
-- ============================================================================
UPDATE "public"."form_questions" "fq"
SET "form_template_id" = "ft"."id"
FROM (
    SELECT DISTINCT ON ("workspace_id") "id", "workspace_id"
    FROM "public"."form_templates"
    ORDER BY "workspace_id", "created_at" ASC
) "ft"
WHERE "ft"."workspace_id" = "fq"."workspace_id"
  AND "fq"."form_template_id" IS NULL;

-- ============================================================================
-- STEP 2 — BEFORE INSERT recurrence-guard trigger (defense in depth).
-- Auto-resolves form_template_id from the workspace's earliest-created
-- form_templates row when a caller leaves it NULL. A no-op (leaves NULL) when
-- the workspace has no form_templates row yet -- only the app-level
-- resolveOrMintFormTemplateId() mint path can create the FIRST form for a
-- workspace (it needs a real filename/storage_path/mime_type to mint one; a
-- generic SQL trigger has no such context). This trigger is a backstop, not a
-- replacement for the app-level stamp.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."form_questions_resolve_form_template_id"()
RETURNS "trigger"
LANGUAGE "plpgsql"
SET "search_path" TO 'public', 'extensions'
AS $$
BEGIN
    IF NEW."form_template_id" IS NULL THEN
        SELECT "id" INTO NEW."form_template_id"
        FROM "public"."form_templates"
        WHERE "workspace_id" = NEW."workspace_id"
        ORDER BY "created_at" ASC
        LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."form_questions_resolve_form_template_id"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."form_questions_resolve_form_template_id"() IS 'ID-130 {130.27} — BEFORE INSERT recurrence guard: auto-resolves form_questions.form_template_id from the workspace''s earliest-created form_templates row when a caller leaves it NULL. No-op (leaves NULL) when the workspace has no form_templates row yet — only the app-level resolveOrMintFormTemplateId() (lib/domains/procurement/resolve-form-template.ts) can mint the first one. Defense in depth alongside the app-level write-time stamp, not a substitute for it.';

-- Mirrors the form_response_auto_version() trigger-function grant shape
-- (20260624130000_id61_unit_e_db_bid_to_procurement.sql): triggers fire via
-- the function OWNER's privileges regardless of the DML caller's role, so
-- revoking EXECUTE here hardens against DIRECT invocation only -- it does not
-- (and must not) stop the trigger firing for authenticated/service_role
-- inserts.
REVOKE ALL ON FUNCTION "public"."form_questions_resolve_form_template_id"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."form_questions_resolve_form_template_id"() FROM "anon";
GRANT ALL ON FUNCTION "public"."form_questions_resolve_form_template_id"() TO "service_role";

DROP TRIGGER IF EXISTS "form_questions_resolve_form_template_id_trigger" ON "public"."form_questions";
CREATE TRIGGER "form_questions_resolve_form_template_id_trigger"
    BEFORE INSERT ON "public"."form_questions"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."form_questions_resolve_form_template_id"();

-- ============================================================================
-- STEP 3 — atomic resolve-or-mint RPC (Checker Finding 1 remediation: closes
-- the concurrent-mint race in the app-level resolver).
--
-- THE RACE: `lib/domains/procurement/resolve-form-template.ts`'s
-- resolveOrMintFormTemplateId() used to do a plain SELECT-then-INSERT: two
-- concurrent question-creation calls against the SAME zero-form workspace
-- could both pass the "no existing form_templates row" check and both INSERT
-- one (there is no UNIQUE constraint on form_templates.workspace_id --
-- multi-form-per-workspace is a live feature via forms/route.ts's "add a
-- form" action, so adding one here would be a correctness regression, not a
-- fix). Result: the workspace fragments across >=2 forms on its very first
-- question-creation race, which can undercount win-rate/outcome (graceful,
-- not data loss, but undocumented + untested before this Subtask).
--
-- WHY THIS IS A NEW RPC, NOT AN ENHANCEMENT TO THE STEP 2 TRIGGER ABOVE:
-- the obvious "lowest surface" fix looked like teaching the BEFORE INSERT
-- trigger above to mint-if-none inside its own transaction (single serialized
-- authority for every insert path). That is unsound here for a reason
-- specific to THIS codebase: `scripts/seed-synthetic-corpus.ts` deliberately
-- inserts form_questions rows with form_template_id left NULL against
-- workspaces that carry ZERO form_templates rows -- its whole documented
-- purpose (see that file's SYNTHETIC_QUESTIONS doc comment) is to model the
-- live PRE-{130.8}-backfill state so a human/agent can validate {130.8}-style
-- earliest-form rekey logic against genuinely un-keyed data. A trigger that
-- unconditionally mints on every INSERT (any caller, not just the app
-- resolver) would silently and permanently retire that fixture's "zero-form
-- workspace" state -- the very first form_questions insert into ANY
-- zero-form workspace would auto-mint a form_templates row, so that state
-- could never be produced again via a normal INSERT, regardless of caller.
-- That is a correctness regression against an existing, documented test
-- fixture, not merely a style preference -- so the mint logic stays confined
-- to a SEPARATE function that only the app-level resolver explicitly calls;
-- the STEP 2 trigger above is UNCHANGED (still resolve-only, still a no-op
-- for a zero-form workspace) and keeps protecting every OTHER insert path
-- exactly as before.
--
-- RLS / privilege check (this Subtask's brief required verifying this
-- explicitly): SECURITY INVOKER (the default -- not stated below for
-- emphasis, matches the STEP 2 function above) so this function runs under
-- the CALLING role's own privileges/RLS, identical to what the app-level
-- SELECT-then-INSERT did before this fix. Both call sites
-- (app/api/procurement/[id]/questions/route.ts,
-- app/api/procurement/[id]/questions/extract/route.ts) gate on
-- getAuthorisedClient(['admin', 'editor']) before ever reaching this RPC --
-- the SAME role condition as both "form_questions_insert" and
-- "templates_insert" (20260617130000_squash_baseline.sql): `WITH CHECK
-- (get_user_role() = ANY (ARRAY['admin','editor']))`. A caller who already
-- passed the form_questions INSERT RLS check therefore always passes the
-- form_templates INSERT RLS check inside this function too -- no new
-- permission surface is introduced. scripts/seed-procurement-test-data.ts
-- calls this indirectly via the SAME resolver using a service_role client,
-- which bypasses RLS entirely (as it already did before this fix).
--
-- ADVISORY LOCK CHOICE -- pg_advisory_xact_lock is SAFE here, unlike the
-- REJECTED use in 20260704140000_id138_writer_fence_lease.sql: that
-- rejection was specifically because THAT design needed a lock to survive
-- ACROSS TWO SEPARATE RPC calls (acquire ... external work ... release),
-- and an xact-scoped lock releases the instant the RPC's own implicit
-- transaction commits -- before a later, separate RPC call's work even
-- starts. This function's entire critical section (the lock, the SELECT,
-- and the conditional INSERT) runs inside ONE function body / ONE implicit
-- transaction from a SINGLE `.rpc()` call, so the lock is held for exactly
-- the span it needs to guard and is released automatically at that SAME
-- call's commit -- the textbook xact-scoped-advisory-lock use case, not the
-- cross-call scenario that migration disqualified it for. A unique-
-- constraint + `INSERT ... ON CONFLICT` CAS (that migration's own chosen
-- mechanism) is not available here: there is deliberately no unique
-- constraint on form_templates.workspace_id (multi-form-per-workspace is a
-- live feature), so there is no natural conflict target to upsert against.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."resolve_or_mint_form_template_id"(
    "p_workspace_id" "uuid",
    "p_name" "text",
    "p_filename" "text",
    "p_storage_path" "text",
    "p_file_size" integer,
    "p_mime_type" "text",
    "p_created_by" "uuid"
)
RETURNS "uuid"
LANGUAGE "plpgsql"
SET "search_path" TO 'public', 'extensions'
AS $$
DECLARE
    v_id "uuid";
BEGIN
    -- Workspace-scoped advisory lock: serializes concurrent resolve-or-mint
    -- attempts for THE SAME workspace so two racing callers cannot both
    -- observe "no existing form" and both mint one. hashtext() collapses the
    -- uuid to an int4 lock key (implicitly widened to the bigint
    -- pg_advisory_xact_lock(bigint) overload) -- xact-scoped, so it releases
    -- automatically at this call's COMMIT/ROLLBACK with no explicit unlock.
    PERFORM "pg_advisory_xact_lock"("hashtext"(p_workspace_id::"text"));

    SELECT "id" INTO v_id
    FROM "public"."form_templates"
    WHERE "workspace_id" = p_workspace_id
    ORDER BY "created_at" ASC
    LIMIT 1;

    IF v_id IS NULL THEN
        INSERT INTO "public"."form_templates" (
            "workspace_id", "name", "filename", "storage_path", "file_size",
            "mime_type", "form_type", "ingest_source", "created_by"
        ) VALUES (
            p_workspace_id, p_name, p_filename, p_storage_path, p_file_size,
            p_mime_type, 'bid', 'app_upload', p_created_by
        )
        RETURNING "id" INTO v_id;
    END IF;

    RETURN v_id;
END;
$$;

ALTER FUNCTION "public"."resolve_or_mint_form_template_id"("uuid", "text", "text", "text", integer, "text", "uuid") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."resolve_or_mint_form_template_id"("uuid", "text", "text", "text", integer, "text", "uuid") IS 'ID-130 {130.27} Checker Finding 1 remediation — race-safe replacement for the app-level resolveOrMintFormTemplateId() SELECT-then-INSERT. Takes a workspace-scoped pg_advisory_xact_lock, resolves the earliest-created form_templates row, and mints one (same app_upload/bid convention as before) only if none exists — all inside one call/one transaction, so two concurrent callers against a zero-form workspace can no longer both mint. SECURITY INVOKER (default): runs under the calling role, same RLS exposure as the resolver it replaces. Deliberately NOT folded into the STEP 2 form_questions_resolve_form_template_id trigger above — see the STEP 3 header comment for why (scripts/seed-synthetic-corpus.ts fixture preservation).';

REVOKE ALL ON FUNCTION "public"."resolve_or_mint_form_template_id"("uuid", "text", "text", "text", integer, "text", "uuid") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."resolve_or_mint_form_template_id"("uuid", "text", "text", "text", integer, "text", "uuid") FROM "anon";
GRANT ALL ON FUNCTION "public"."resolve_or_mint_form_template_id"("uuid", "text", "text", "text", integer, "text", "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_or_mint_form_template_id"("uuid", "text", "text", "text", integer, "text", "uuid") TO "service_role";

-- api wrapper (DR-030/DR-032 companion in the SAME migration): thin
-- SECURITY INVOKER passthrough so PostgREST (schema-isolation cutover,
-- lib/supabase/schema.ts DB_OPTION routes every client's `.rpc()` call to
-- the `api` schema at runtime) can reach the function above. Mirrors
-- `api.get_aggregate_win_rate_stats` (20260625140000_id130_winrate.sql) --
-- LANGUAGE sql, SECURITY INVOKER, SET search_path = public, extensions,
-- REVOKE EXECUTE FROM PUBLIC/anon, GRANT to the same roles the public
-- function above grants (authenticated + service_role, no anon).
-- NOTE FOR THE ORCHESTRATOR: this is a NEW api-schema function --
-- `Database['api']['Functions']` (and `Database['public']['Functions']`)
-- change, so `supabase gen types` must be re-run once this migration is
-- applied (this Subtask's worktree has no DB access to do that itself).
CREATE OR REPLACE FUNCTION "api"."resolve_or_mint_form_template_id"(
    "p_workspace_id" "uuid",
    "p_name" "text",
    "p_filename" "text",
    "p_storage_path" "text",
    "p_file_size" integer,
    "p_mime_type" "text",
    "p_created_by" "uuid"
)
RETURNS "uuid"
LANGUAGE "sql"
SECURITY INVOKER
SET "search_path" TO 'public', 'extensions'
AS $api$
  SELECT "public"."resolve_or_mint_form_template_id"(p_workspace_id, p_name, p_filename, p_storage_path, p_file_size, p_mime_type, p_created_by);
$api$;

REVOKE EXECUTE ON FUNCTION "api"."resolve_or_mint_form_template_id"("uuid", "text", "text", "text", integer, "text", "uuid") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."resolve_or_mint_form_template_id"("uuid", "text", "text", "text", integer, "text", "uuid") TO authenticated, service_role;

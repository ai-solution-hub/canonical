## Outstanding items from current GH Action failures

### Supabase migration deployments (GH - Supabase integration)

- 'Main' has the following error which prevents deployment via the GH
  integration:

  ```
  Applying migration 20260503225703_migrate_auth_user_fks_to_user_profiles.sql...
  2026/05/03 23:32:10 ERROR: insert or update on table "feed_prompts" violates foreign key constraint "feed_prompts_created_by_fkey" (SQLSTATE 23503)
  Key (created_by)=(4f0ea46b-cd86-47c6-bb9f-ae9732d7c5cc) is not present in table "user_profiles".
  At statement: 37
  ALTER TABLE ONLY public.feed_prompts
    ADD CONSTRAINT feed_prompts_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.user_profiles(id)
  ```

- 'Staging' has the following items, which suggests we may not have the seeding
  set up correctly:

  ```
  2026/05/03 22:26:30 INFO Skipping configuration for protected branch...
  2026/05/03 22:26:30 INFO Skipping seed data for protected branch...
  ```

- Do we still need the seed-e2e-users script? I had thought the GoTrue
  'workaround' was resolved by migrating away from using auth.users directly to
  instead using user_profiles, as recommended by Supabase.
  - The following page provides valuable context -
    https://supabase.com/docs/guides/local-development/seeding-your-database
    - It also mentions 'snaplet' - should we consider using this for our setup?

- **Answer: Yes, `seed-e2e-users.ts` is still required.** The `user_profiles`
  migration moves FK _references_ away from `auth.users`, but `auth.users` is
  still the source of truth for authentication (passwords, tokens, identities).
  The GoTrue admin API (`supabase.auth.admin.createUser()`) is the only safe way
  to create `auth.users` rows with proper password hashing, token column
  initialisation, and `auth.identities` row creation. Direct SQL INSERT into
  `auth.users` breaks (S156 incident pattern). Snaplet could generate
  public-schema seed data programmatically but cannot create `auth.users` rows
  through GoTrue — the admin API is still needed for that.

- How do we confirm categorically that the staging DB is an exact replica of
  production, excluding the data? Something that's been an issue previously is
  that 'vector' should be part of the 'extensions' schema, but was appearing as
  part of 'public'. Is there a programmatic way that we can compare the
  production database with the staging persistent branch, and therefore identify
  anything which may have been missed when staging replays?
  - Could it be that the current failure on the main DB deployment (above),
    prevents staging from fully replicating main DB?

- **Answer: Yes, the prod FK migration failure prevents full parity.**
  Production has 63 applied migrations; staging has 64 (the FK migration
  succeeded there). The failed FK migration (`20260503225703`) has been made
  self-healing by re-running the `user_profiles` backfill before FK creation,
  and a follow-up corrective/sentinel migration (`20260504125137`) has been
  added. Once both land, prod and staging should align at 65 migrations.
- **Schema parity approach:** Run `pg_dump --schema-only` against both prod and
  staging connections, diff the output. This can be scripted as a CI job or a
  one-shot verification:
  ```
  pg_dump --schema-only -h <prod-host> -d postgres > /tmp/prod-schema.sql
  pg_dump --schema-only -h <staging-host> -d postgres > /tmp/staging-schema.sql
  diff /tmp/prod-schema.sql /tmp/staging-schema.sql
  ```
  The `vector` extension schema issue (public vs extensions) would appear in
  this diff. Alternatively, `supabase db diff` can compare against the migration
  set. Consider adding this as a nightly or post-deploy verification step.

### 'Migration replay smoke' job:

- Here is the current error, but can I also check the purpose of this job and
  whether it's still required based on recent updates to the CI setup? I've also
  switched on the 'Automatic branching' feature from Supabase, which creates a
  preview branch for PRs when there are Supabase file changes, in case this is
  relevant to this, or the wider pipeline setup.

  ```
  Run bun run scripts/migration-replay-check.ts
  WP-G4.5 migration replay check
    event=push pr=main run_id=25293989031
    project_ref=rovrymhhffssilaftdwd dry_run=false

  Cleanup: pre-flight orphan sweep matching ci-replay-main-* (excluding current run)...
    No matching branches found.
  Creating ephemeral branch 'ci-replay-main-25293989031' (git_branch=main, region=eu-west-2)...
  Error: Branch CREATE returned 409. Live branches at fail-time (2 total):
      main (status=CREATING_PROJECT, persistent=false)
      staging (status=FUNCTIONS_DEPLOYED, persistent=true)
  Run pre-flight orphan sweep manually if any 'ci-replay-*' entries are listed; otherwise this is a per-project quota hit (raise via Supabase dashboard) or a transient API flake (re-run).
  Error: Infrastructure failure during replay: Management API POST /projects/rovrymhhffssilaftdwd/branches failed: HTTP 409 — {"message":"Failed to insert preview branch"}
  Error: Process completed with exit code 2.
  ```

- **Investigation finding:** The migration replay and Supabase Automatic
  Branching serve **different purposes** and are NOT redundant:
  - **Migration replay** (`scripts/migration-replay-check.ts`): creates a fresh
    ephemeral branch and replays ALL migrations from scratch. Catches
    squash-divergence (S4/S8 class bug: out-of-band psql changes that work
    incrementally but break from-scratch replay).
  - **Automatic Branching**: applies migrations incrementally on a preview
    branch (tests "does this new migration work on top of current state?" but
    NOT "do all migrations replay from zero?").
  - The 409 error is a **branch quota collision**: Automatic Branching was
    creating a `main` branch (CREATING_PROJECT) at the same time as the replay
    script tried to create `ci-replay-main-*`, with only 2 slots total (one used
    by `staging`).
  - **Recommended fix options (pick one):**
    1. Raise the preview branch quota via Supabase dashboard (simplest — allows
       both to coexist)
    2. Skip migration replay on push-to-main events (Automatic Branching covers
       that path), keep it for PRs only
    3. Disable Automatic Branching and rely solely on the custom replay (loses
       preview environment benefit)

### 'Integration tests' job:

- Remove failing
  `__tests__/integration/publication-status-rpc-visibility.integration.test.ts`
  test

### MCP evals jobs:

- Check the purpose of the evals - should these be running on staging or prod?
  - Answer will determine whether test fixtures need to create Q&A content
    items, or if it's the prod setup being evaluated - there is also item 3.6.1
    from post-mvp-roadmap, which may contain helpful context, as it describes
    and references the original CI intention.

- **Investigation finding:** MCP evals should run against **staging**
  (confirmed):
  - The CI workflow (`.github/workflows/ci.yml` line 327) scopes `mcp-eval` to
    the `Staging` GH environment.
  - Roadmap §3.6.1 describes the intent as "Run MCP eval Layers L1-L4 on PR and
    on push to main" with the CI spec (`wp-g4.4-mcp-eval-ci-spec.md` §3.2)
    defining skip-flag policy for cost-zero PR runs.
  - The MCP eval spec (`docs/specs/mcp-evaluation-spec.md`) §7 (SUPERSEDED note)
    confirms Staging-scoped.
  - The `fixtures.ts` graceful-skip (`process.exit(0)` on empty DB) is an
    intentional soft-fail until staging has seeded Q&A content items with
    embeddings.
  - **No changes needed** — current configuration is correct. The graceful-skip
    will be removed once staging content fixtures are seeded (tracked by roadmap
    §9.16.10).

### 'E2E smoke' job:

- Should this job be running against production or staging? Currently, it runs
  against staging DB and setup.
- We need to understand the cause of each of the failures - full run log
  available here: 5_E2E smoke.txt - potentially use grep, file is 100kb.
  - If there are tests which are testing the implementation, rather than
    behaviour, then these should be removed, rather than debugged - we will soon
    be auditing all tests to identify any which fall into this category.

### Quality pre-check job:

- The `Build (Next.js)` job failed with the following error. NB. Other jobs in
  the CI workflow which have this step didn't fail (e.g., MCP eval (l1)):
  - Also, several jobs have `Build (Next.js)` - should we be configuring build
    caching across our GH Actions?

  ```
      FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
  ----- Native stack trace -----

   1: 0xe42d60 node::OOMErrorHandler(char const*, v8::OOMDetails const&) [/opt/hostedtoolcache/node/22.22.2/x64/bin/node]
   2: 0x121ded0 v8::Utils::ReportOOMFailure(v8::internal::Isolate*, char const*, v8::OOMDetails const&) [/opt/hostedtoolcache/node/22.22.2/x64/bin/node]
   3: 0x121e1a7 v8::internal::V8::FatalProcessOutOfMemory(v8::internal::Isolate*, char const*, v8::OOMDetails const&) [/opt/hostedtoolcache/node/22.22.2/x64/bin/node]
   4: 0x144d015  [/opt/hostedtoolcache/node/22.22.2/x64/bin/node]
   5: 0x144d043  [/opt/hostedtoolcache/node/22.22.2/x64/bin/node]
   6: 0x146611a  [/opt/hostedtoolcache/node/22.22.2/x64/bin/node]
   7: 0x14692e8  [/opt/hostedtoolcache/node/22.22.2/x64/bin/node]
   8: 0x1cd07a1  [/opt/hostedtoolcache/node/22.22.2/x64/bin/node]
  Next.js build worker exited with code: null and signal: SIGABRT
  error: script "build" exited with code 1
  Error: Process completed with exit code 1.
  ```

- **Investigation finding:** The CI workflow currently performs multiple Next.js
  builds:
  - `quality-precheck` builds once with the Production environment.
  - `mcp-eval` builds once per matrix layer (`l1`, `l3`, `l4`) with the Staging
    environment.
  - `e2e-smoke` does **not** build; Playwright starts `bun dev` via
    `playwright.config.ts`.
- **Recommendation:** Keep the Production and Staging builds separate because
  they compile with different environment scopes, but remove the three duplicate
  MCP builds. Two viable options:
  1. Simplest: collapse MCP eval layers into one job that builds once and runs
     L1/L3/L4 sequentially (loses separate check names).
  2. Better check granularity: add a Staging-scoped MCP build job that uploads
     `.next` as an artefact, then have the L1/L3/L4 jobs download it (keeps
     separate check names, more workflow complexity).
- **Immediate fix applied:** `NODE_OPTIONS: --max-old-space-size=4096` added to
  `quality-precheck` build, matching MCP eval's memory headroom.

## 'Supabase advisors' workflow

- Re-baseline the values and also disable `unused index` performance warnings
  (we don't have these switched on in the dashboard).

- **Action required (manual):** Run the following to re-baseline:
  ```
  SUPABASE_ACCESS_TOKEN=<pat> bun run scripts/run-supabase-advisors.ts --capture-baseline --env=prod
  ```
  This rewrites
  `docs/audits/kh-production-readiness-phase-1/supabase-advisor-baseline.json`
  (currently 1595 lines, 52 `unused_index` entries). To suppress `unused_index`
  findings from failing CI, either:
  1. Re-baseline (captures them as known) — simplest, recommended
  2. Add an `--ignore-names=unused_index` filter to the script if they should be
     permanently excluded

## Other items

- content_history table keeps growing in the staging environment -
  `[{"id":"08ae690b-e6d7-4f66-88db-4aae8c6364b9","content_item_id":null,"version":1,"title":"[CERT-BRIDGE-1777850337434] ISO 27001 Certification Status","content":"[CERT-BRIDGE-1777850337434] Test content for ISO 27001 Certification Status","brief":null,"detail":null,"reference":null,"metadata":"{\"via\": \"trigger\", \"auto\": true, \"trigger_name\": \"trg_content_items_ensure_v1_history\", \"ingest_source\": null}","change_summary":"v1 written by trg_content_items_ensure_v1_history","change_type":"create","created_by":"a0000000-0000-4000-8000-000000000001","created_at":"2026-05-03 23:18:57.589955+00","change_reason":"auto_v1_on_insert"}]`
  - These don't exist in production - what is the root cause of this occuring in
    the staging DB (my guess is missing related content items) and what options
    do we have available to prevent exponential growth of the table in staging.

- **Root cause analysis:** Integration and MCP eval tests create `content_items`
  via the service client, which fires `trg_content_items_ensure_v1_history`
  (creates a `content_history` row). When tests clean up the `content_items`,
  the FK `content_history.content_item_id` is set to NULL (ON DELETE SET NULL)
  but the history rows remain as orphans. Each CI run accumulates more orphaned
  rows.
- **Fix applied:** The `publication-status-rpc-visibility` test (now removed)
  already had the correct teardown pattern — deleting from
  `content_history WHERE content_item_id IN (seeded IDs)` BEFORE deleting from
  `content_items`. Other integration tests should follow this pattern.
- **Additional option:** Add a periodic staging cleanup query:
  `DELETE FROM content_history WHERE content_item_id IS NULL;`

- Is there a way to comprehensively audit our tests (particularly data
  integration and E2E) to identify which have assertions that rely on
  pre-existing data? Can this be done programmatically? Or has this already been
  done when we implemented `wp-ci-res7-staging-data-strategy-spec.md`

- Review outstanding items from
  `9.16 Staging environment — persistent Supabase branch` on the
  post-mvp-roadmap reference file.

- **Integration Phase 2 status:** Unblocked/active. `.github/workflows/ci.yml`
  already has the `integration` job running without `continue-on-error`, so the
  Phase 2 hard gate is effectively in place. The remaining actions are:
  1. Remove stale roadmap/spec references that say this is blocked on §9.16.10
     (future docs session).
  2. Add `Integration tests` as a required branch-protection check if not
     already enforced.
  3. Continue fixing real integration failures instead of soft-failing the job.
  4. Keep E2E and MCP soft-fail/graceful-skip decisions separate; those are not
     prerequisites for integration Phase 2 now that the staging data strategy
     changed.

- Once the above failures and findings are resolved, we'll be moving on to
  'OPS-55 WP-CI.RES.6 — integration + E2E coverage review (post-§9.16.10 close)'
  from the product backlog.
  - We will also need to ensure all relevant documentation is updated -
    /runbooks, /handover, roadmap, backlog, STATUS, /product-functionality etc.

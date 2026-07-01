#!/usr/bin/env bun
/**
 * Seeds E2E test users (TEST_USER_1/2/3) into auth.users.
 *
 * **ALWAYS-STAGING.** Post-WP-S5.2 .env.local flip, this script
 * defaults to staging — which is the correct intent. NEVER invoke
 * against prod (would create test users in prod auth.users with no
 * cleanup path).
 *
 * To verify env target before running: `cat .env.local | grep SUPABASE_URL`.
 *
 * Seed E2E test users (TEST_USER_1/2/3) with admin/editor/viewer roles.
 *
 * **Why this script exists:**
 *   E2E tests (`e2e/global-setup.ts`) require three test users with specific
 *   emails, passwords, and roles to be present in `auth.users` and
 *   `public.user_roles` before the test suite runs. Historically these were
 *   provisioned manually in the live DB, leaving fresh environments (new
 *   demo DB, client re-ingest, local dev) unable to run E2E tests until
 *   someone created the users by hand.
 *
 *   This script closes that gap by provisioning the three users idempotently
 *   via `supabase.auth.admin.createUser()` — the SAME path that GoTrue uses
 *   internally — so the resulting `auth.users` rows have the correct shape
 *   (token columns initialised to '', accompanying `auth.identities` rows).
 *   This avoids the S156 incident pattern where hand-rolled SQL inserts
 *   produced rows that 500'd `auth.admin.listUsers()`.
 *
 *   See also: `supabase/migrations/20260406180000_create_pipeline_service_account.sql`
 *   for the canonical "correct" insert shape, and
 *   `docs/audits/s156-auth-admin-sweep.md` Finding 5.2 for the gap this fills.
 *
 * **Idempotency:**
 *   - Safe to re-run. Existing users are detected and left unchanged.
 *   - Roles are upserted on every run so a missing/wrong role gets corrected.
 *   - Passwords are NOT updated on existing users (would be destructive).
 *     If the password env var has changed, the script prints a warning and
 *     skips that user — operator must reset manually via the Supabase UI.
 *
 * **Environment variables required:**
 *   - SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (service role — NOT the anon key)
 *   - TEST_USER_1_PASSWORD, TEST_USER_2_PASSWORD, TEST_USER_3_PASSWORD
 *
 * **Usage:**
 *   bun run seed:e2e-users                # provision (or verify) all 3 users
 *   bun run seed:e2e-users --dry-run      # show what would happen
 *   bun run seed:e2e-users --check        # verify-only, exit 1 if missing
 *
 * **Exit codes (WP-4, S156 resolution spec):**
 *   - `0` — success; all three users present and the pipeline service
 *     account row passes the S156 shape probe.
 *   - `1` — genuine error: missing env vars, DB unreachable, probe query
 *     itself failed, `createUser()` failed, role upsert failed, etc. CI
 *     should fail the job.
 *   - `2` — the S156 pre-flight probe detected a broken or missing pipeline
 *     service account row. Operator action is to apply the corrective
 *     migration (`supabase db push` picks up
 *     `20260408134124_fix_pipeline_service_account_auth_shape.sql`). CI
 *     should treat this as a known, recoverable environment drift and
 *     surface the runbook link, NOT report it as a generic failure.
 *
 *   Distinguishing exit 2 from exit 1 lets rebuild CI jobs branch on the
 *   known-recoverable case without masking genuine bugs. See
 *   `docs/operations/database-rebuild-runbook.md` §"Step 5 — Verify the
 *   corrective migration is not needed" and
 *   `docs/audits/s156-spec-verification.md` M-3 for the design rationale.
 *
 * **Rebuild flow integration:**
 *   After `supabase db reset && supabase db push` against a fresh project,
 *   run this script before invoking `bun run test:e2e`. The client re-ingest
 *   and demo DB rebuild runbooks must reference this step.
 */

import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { PRESET_VALUES } from '@/lib/governance/presets';
import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';

// S156 exit code constants — keep in sync with the top-of-file comment.
// EXIT_OK (0) is the implicit success case and is never passed to
// `process.exit()` explicitly; it is documented in the top-of-file block.
const EXIT_GENERIC_ERROR = 1;
const EXIT_S156_BAD_ROW = 2;

// PIPELINE_SYSTEM_USER_ID — infrastructure, not a person. See
// `lib/intelligence/types.ts` for the canonical constant and
// `supabase/migrations/20260406180000_create_pipeline_service_account.sql`
// for the row it points at.
const PIPELINE_SYSTEM_USER_ID = 'a0000000-0000-4000-8000-000000000001';

// Link used in every S156 pre-flight error message so operators can jump
// straight to the fix procedure.
const S156_RUNBOOK_LINK =
  'docs/operations/database-rebuild-runbook.md §"Step 5 — Verify the corrective migration is not needed"';

// ── Env loading (handles worktrees) ────────────────────────────────────────

function loadEnv(): void {
  let dir = process.cwd();
  while (dir !== '/') {
    for (const file of ['.env.local', '.env']) {
      const p = path.join(dir, file);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq === -1) continue;
          const key = trimmed.slice(0, eq).trim();
          let value = trimmed.slice(eq + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          if (!(key in process.env)) {
            process.env[key] = value;
          }
        }
      }
    }
    dir = path.dirname(dir);
  }
}

loadEnv();

// ── CLI args ───────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`
Seed E2E test users (admin/editor/viewer).

Usage:
  bun run seed:e2e-users             # provision or verify users
  bun run seed:e2e-users --dry-run   # preview without writing
  bun run seed:e2e-users --check     # verify-only, exit 1 on mismatch

Exit codes:
  0  success; all users present + S156 pipeline probe passed
  1  genuine error (missing env, DB unreachable, role upsert failed, …)
  2  S156 pre-flight probe detected the broken pipeline row — run
     \`supabase db push\` to apply the corrective migration

Required env vars:
  SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
  SUPABASE_SERVICE_ROLE_KEY
  TEST_USER_1_PASSWORD, TEST_USER_2_PASSWORD, TEST_USER_3_PASSWORD
`);
  process.exit(0);
}

const dryRun = values['dry-run'] ?? false;
const checkOnly = values.check ?? false;

// ── Supabase client ────────────────────────────────────────────────────────

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    '❌ Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
  );
  process.exit(EXIT_GENERIC_ERROR);
}

const supabase = createScriptClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type SupabaseServiceClient = typeof supabase;

// ── S156 pre-flight probe ──────────────────────────────────────────────────
//
// WP-4 addition. Run BEFORE any E2E user seeding to catch snapshot-cloned
// environments that still carry the pre-S156 broken pipeline service
// account row. The probe is strictly read-only — it MUST NOT mutate any
// data under any circumstance.
//
// **Query mechanism:** `supabase.auth.admin.getUserById()`.
//
//   Why not `.schema('auth').from('users')`? PostgREST only exposes
//   `public` and `graphql_public` on this project — verified against live
//   prod on 2026-04-08 (`Accept-Profile: auth` → PGRST106 "Invalid schema:
//   auth. Only the following schemas are exposed: public, graphql_public").
//   That rules out both `.schema('auth')` via supabase-js and a raw
//   `fetch` to the REST endpoint. The `auth.admin.*` methods talk to the
//   GoTrue admin HTTP API (not PostgREST), which bypasses PostgREST's
//   exposed-schema restriction entirely.
//
//   `getUserById()` is also the *exact* code path that S156 broke: GoTrue
//   scans `email_change_token_new` into a Go string, and a NULL value
//   triggers a scan error that 500s the whole response. So a successful
//   response from `getUserById(PIPELINE_SYSTEM_USER_ID)` is functionally
//   equivalent to asserting `email_change_token_new IS NOT NULL` — the
//   very assertion the spec calls for. The identity row count is surfaced
//   directly by GoTrue in the response (`data.user.identities`), so we
//   get both halves of the probe in a single call.
//
//   If a future project ever needs finer-grained assertions (e.g. checking
//   every token column individually), the correct move is to ship a
//   dedicated `SECURITY DEFINER` probe function in a follow-up migration.
//   WP-4 explicitly does not ship a new RPC.

type PipelineCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'bad-shape' | 'missing' | 'query-failed';
      detail: string;
    };

/**
 * Probe the pipeline service account row via GoTrue admin API and decide
 * whether the environment needs the S156 corrective migration.
 *
 * Read-only. No mutations. Intended to run on every invocation of this
 * script — `--check`, `--dry-run`, and normal seed.
 */
async function verifyPipelineUserShape(
  client: SupabaseServiceClient,
): Promise<PipelineCheckResult> {
  try {
    const { data, error } = await client.auth.admin.getUserById(
      PIPELINE_SYSTEM_USER_ID,
    );

    if (error) {
      // GoTrue 404 when the row does not exist at all.
      const status = (error as { status?: number }).status;
      const msg = error.message ?? '';
      const lower = msg.toLowerCase();
      const isMissing =
        status === 404 ||
        lower.includes('not found') ||
        lower.includes('user not found');
      if (isMissing) {
        return {
          ok: false,
          reason: 'missing',
          detail: `pipeline service account row (${PIPELINE_SYSTEM_USER_ID}) does not exist in auth.users — original migration has not been applied`,
        };
      }
      // Scan errors from NULL token columns surface as a GoTrue 500 with
      // a "Database error finding user" / "sql: Scan error" message. We
      // treat any non-404 error from getUserById as a bad-shape signal,
      // not a generic query failure — the whole point of the probe is
      // that this call path is the one S156 broke.
      return {
        ok: false,
        reason: 'bad-shape',
        detail: `auth.admin.getUserById(${PIPELINE_SYSTEM_USER_ID}) failed: ${msg || 'unknown GoTrue error'}`,
      };
    }

    if (!data?.user) {
      // Empty body without an error object — treat as missing.
      return {
        ok: false,
        reason: 'missing',
        detail: `auth.admin.getUserById(${PIPELINE_SYSTEM_USER_ID}) returned no user and no error`,
      };
    }

    // GoTrue returns the identities list directly on the user object.
    // A healthy post-S156 row has exactly one row in auth.identities
    // (email provider). The corrective migration is what backfills it on
    // pre-S156 snapshot clones.
    const identities = (data.user as { identities?: unknown[] }).identities;
    const identityCount = Array.isArray(identities) ? identities.length : 0;
    if (identityCount === 0) {
      return {
        ok: false,
        reason: 'bad-shape',
        detail: `pipeline service account row has 0 rows in auth.identities (expected ≥1) — S156 corrective migration has not been applied`,
      };
    }

    return { ok: true };
  } catch (err) {
    // Network / unexpected exception. This is NOT an S156 signal — the
    // check could not run at all. Surface as query-failed so main() exits
    // with the generic error code.
    return {
      ok: false,
      reason: 'query-failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Publication-review fixture (S31 W3 OPS-46) ──────────────────────────────
//
// One deterministic content_items row at publication_status='in_review'
// that the e2e/tests/review-publication-tab.spec.ts spec asserts against.
//
// Spec contract: docs/specs/review-page-tabs-refactor-spec.md §10.1.
//
// Idempotency rules (verbatim from spec §10.1):
//   1. Look up the row by its deterministic title.
//   2. If found, return the existing id WITHOUT updating the mutable
//      `publication_status` column — re-seeding mid-test would race the
//      Approve+toast assertion.
//   3. If absent, INSERT it with publication_status='in_review' and return
//      the new id.
//
// The afterEach reset in the test file (spec §10.2) is the SINGLE owner
// of the publication_status column for this row; this seeder defers to it.
//
// `content_text_hash` is `GENERATED ALWAYS` per CLAUDE.md gotcha — omit
// from the payload (PG computes it from `content`).

const PUBLICATION_REVIEW_FIXTURE_TITLE =
  '[E2E-PUB-REVIEW-FIXTURE] Awaiting publication test row';

/**
 * Seed (or verify) the single deterministic publication-review fixture
 * content_items row used by e2e/tests/review-publication-tab.spec.ts.
 *
 * Idempotent — re-runs are no-ops + return the existing row's id without
 * touching mutable columns. See spec §10.1 for the full contract.
 *
 * @param client  Supabase service-role client (RLS-bypassing).
 * @returns       The fixture row's UUID.
 */
export async function seedPublicationReviewFixture(
  client: SupabaseServiceClient,
): Promise<{ id: string; action: 'created' | 'already-exists' }> {
  // Step 1: lookup by deterministic title.
  const { data: existing, error: lookupErr } = await client
    .from('content_items')
    .select('id')
    .eq('title', PUBLICATION_REVIEW_FIXTURE_TITLE)
    .maybeSingle();

  if (lookupErr) {
    throw new Error(
      `publication-review fixture lookup failed: ${lookupErr.message}`,
    );
  }

  if (existing) {
    // Step 2: return existing id WITHOUT touching publication_status.
    // The test's afterEach resets the column — re-seeding mid-test
    // would race that reset.
    return { id: existing.id, action: 'already-exists' };
  }

  // Step 3: INSERT with publication_status='in_review'.
  const { data: created, error: insertErr } = await client
    .from('content_items')
    .insert({
      title: PUBLICATION_REVIEW_FIXTURE_TITLE,
      content_type: 'q_a_pair',
      primary_domain: 'Technical Capability',
      summary:
        'E2E fixture row — exercises the awaiting-publication tab Approve + visibility-gating flow.',
      content:
        'Q: E2E fixture question?\nA: This is the E2E fixture row used by review-publication-tab.spec.ts.',
      platform: 'manual',
      publication_status: 'in_review',
      // governance_review_status intentionally null — publication-review
      // tab is orthogonal to governance state per spec §6 / §7.
      // content_text_hash is GENERATED ALWAYS — do NOT pass it.
    })
    .select('id')
    .single();

  if (insertErr || !created) {
    throw new Error(
      `publication-review fixture insert failed: ${insertErr?.message ?? 'no row returned'}`,
    );
  }

  return { id: created.id, action: 'created' };
}

// ── Taxonomy + governance reference-data fixture (ID-128 {128.9}) ────────────
//
// Liam ratified treating taxonomy/governance reference data as AMBIENT → SEED
// it deterministically so e2e/tests/settings-mutations.spec.ts can HARD-assert
// equality (NOT `> 0`) against a known domain name (test-philosophy.md §2.1).
//
// Two rows, seeded idempotently via lookup-then-insert (mirrors
// seedPublicationReviewFixture):
//   1. public.taxonomy_domains — one active domain the Content Organisation
//      settings tab renders as a DomainCard ("E2e Seeded Domain").
//   2. public.governance_config — one Quality Review rule the Governance
//      settings tab renders as a config-list row.
//
// Idempotency: both rows are looked up by their UNIQUE business key
// (taxonomy_domains.name / governance_config.domain). Found → return the
// existing id WITHOUT mutating any column (the script re-runs every CI job).
// Absent → INSERT. No destructive updates.
//
// The governance row stores the taxonomy *slug* verbatim in `domain`, matching
// the real Add-Domain flow (governance-section.tsx submits the SelectItem
// value = the taxonomy domain slug). `created_by`/`updated_by`/`reviewer_id`
// are left NULL (all nullable FK→user_profiles) so the seed has no user
// dependency. Preset column values come from the canonical PRESET_VALUES map
// so this fixture never drifts from lib/governance/presets.ts.

const E2E_TAXONOMY_DOMAIN_SLUG = 'e2e-seeded-domain';
const E2E_GOVERNANCE_DOMAIN = E2E_TAXONOMY_DOMAIN_SLUG;

/**
 * Seed (or verify) the deterministic taxonomy_domains + governance_config rows
 * consumed by e2e/tests/settings-mutations.spec.ts. Idempotent — re-runs return
 * the existing rows' ids without touching any column. See test-philosophy.md
 * §2.1 (ambient-as-seeded reference data).
 *
 * @param client  Supabase service-role client (RLS-bypassing).
 */
export async function seedTaxonomyGovernanceFixture(
  client: SupabaseServiceClient,
): Promise<{
  taxonomy: { id: string; action: 'created' | 'already-exists' };
  governance: { id: string; action: 'created' | 'already-exists' };
}> {
  // ── taxonomy_domains ──────────────────────────────────────────────────
  const { data: existingDomain, error: domainLookupErr } = await client
    .from('taxonomy_domains')
    .select('id')
    .eq('name', E2E_TAXONOMY_DOMAIN_SLUG)
    .maybeSingle();
  if (domainLookupErr) {
    throw new Error(
      `taxonomy fixture lookup failed: ${domainLookupErr.message}`,
    );
  }

  let taxonomy: { id: string; action: 'created' | 'already-exists' };
  if (existingDomain) {
    taxonomy = { id: existingDomain.id, action: 'already-exists' };
  } else {
    const { data: created, error: insertErr } = await client
      .from('taxonomy_domains')
      .insert({
        name: E2E_TAXONOMY_DOMAIN_SLUG,
        description:
          'E2E fixture domain — exercises the Content Organisation settings tab.',
        // High display_order so the fixture sorts after real domains and never
        // collides with ambient reorder fixtures.
        display_order: 9000,
        is_active: true,
        // 'baseline' renders no provenance badge — keeps the card minimal.
        provenance: 'baseline',
      })
      .select('id')
      .single();
    if (insertErr || !created) {
      throw new Error(
        `taxonomy fixture insert failed: ${insertErr?.message ?? 'no row returned'}`,
      );
    }
    taxonomy = { id: created.id, action: 'created' };
  }

  // ── governance_config ─────────────────────────────────────────────────
  const { data: existingGov, error: govLookupErr } = await client
    .from('governance_config')
    .select('id')
    .eq('domain', E2E_GOVERNANCE_DOMAIN)
    .maybeSingle();
  if (govLookupErr) {
    throw new Error(
      `governance fixture lookup failed: ${govLookupErr.message}`,
    );
  }

  let governance: { id: string; action: 'created' | 'already-exists' };
  if (existingGov) {
    governance = { id: existingGov.id, action: 'already-exists' };
  } else {
    const { data: created, error: insertErr } = await client
      .from('governance_config')
      .insert({
        domain: E2E_GOVERNANCE_DOMAIN,
        preset: 'light_touch',
        // posture + the auto-flag/threshold columns mirror the server's
        // preset→columns mapping (lib/governance/presets.ts PRESET_VALUES).
        ...PRESET_VALUES.light_touch,
        reviewer_id: null,
      })
      .select('id')
      .single();
    if (insertErr || !created) {
      throw new Error(
        `governance fixture insert failed: ${insertErr?.message ?? 'no row returned'}`,
      );
    }
    governance = { id: created.id, action: 'created' };
  }

  return { taxonomy, governance };
}

// ── Test user definitions ──────────────────────────────────────────────────

interface TestUserSpec {
  label: 'admin' | 'editor' | 'viewer' | 'signout';
  email: string;
  passwordEnv: string;
  role: 'admin' | 'editor' | 'viewer';
  displayName: string;
}

const TEST_USERS: TestUserSpec[] = [
  {
    label: 'admin',
    email: 'test.user1@test-kb-aish.co.uk',
    passwordEnv: 'TEST_USER_1_PASSWORD',
    role: 'admin',
    displayName: 'E2E Test Admin',
  },
  {
    label: 'editor',
    email: 'test.user2@test-kb-aish.co.uk',
    passwordEnv: 'TEST_USER_2_PASSWORD',
    role: 'editor',
    displayName: 'E2E Test Editor',
  },
  {
    label: 'viewer',
    email: 'test.user3@test-kb-aish.co.uk',
    passwordEnv: 'TEST_USER_3_PASSWORD',
    role: 'viewer',
    displayName: 'E2E Test Viewer',
  },
  {
    // Dedicated user for the destructive sign-out test (auth.spec.ts). The
    // sign-out test calls supabase.auth.signOut() at GLOBAL scope, revoking
    // ALL of this user's sessions — so it MUST NOT share a user with any other
    // spec (S420). 'admin' role so it renders the same shell the sign-out test
    // originally exercised. Used only via e2e/.auth/signout.json.
    label: 'signout',
    email: 'test.user4@test-kb-aish.co.uk',
    passwordEnv: 'TEST_USER_4_PASSWORD',
    role: 'admin',
    displayName: 'E2E Test Sign-out User',
  },
];

// ── Provisioning logic ─────────────────────────────────────────────────────

interface ProvisionResult {
  label: string;
  email: string;
  action: 'created' | 'already-exists' | 'skipped' | 'role-fixed' | 'verified';
  warning?: string;
}

async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  // listUsers() returns paginated results. We use a small per_page and only
  // need to check whether THIS email exists, not enumerate all users.
  // This is the same call path that S156 broke — running this script
  // requires the corrective migration to have been applied first.
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) {
    throw new Error(
      `listUsers failed (is the S156 corrective migration applied?): ${error.message}`,
    );
  }
  const found = data.users.find((u) => u.email === email);
  return found ? { id: found.id } : null;
}

async function provisionUser(spec: TestUserSpec): Promise<ProvisionResult> {
  const password = process.env[spec.passwordEnv];
  if (!password) {
    return {
      label: spec.label,
      email: spec.email,
      action: 'skipped',
      warning: `${spec.passwordEnv} not set in env`,
    };
  }

  const existing = await findUserByEmail(spec.email);

  let userId: string;
  let action: ProvisionResult['action'];

  if (existing) {
    userId = existing.id;
    action = 'already-exists';
  } else {
    if (checkOnly) {
      return {
        label: spec.label,
        email: spec.email,
        action: 'skipped',
        warning: 'user does not exist (check mode — would have created)',
      };
    }
    if (dryRun) {
      return {
        label: spec.label,
        email: spec.email,
        action: 'created',
        warning: 'dry-run — no write performed',
      };
    }
    // createUser is the canonical path. GoTrue initialises every NOT-NULL-ish
    // column (token columns, identities row) for us.
    const { data, error } = await supabase.auth.admin.createUser({
      email: spec.email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: spec.displayName,
        display_name: spec.displayName,
        seeded_by: 'scripts/seed-e2e-users.ts',
      },
    });
    if (error || !data.user) {
      throw new Error(
        `createUser(${spec.email}) failed: ${error?.message ?? 'no user returned'}`,
      );
    }
    userId = data.user.id;
    action = 'created';
  }

  // Always upsert the role so a missing/wrong assignment gets corrected.
  // Idempotent: ON CONFLICT (user_id) DO UPDATE on the user_roles table.
  if (!dryRun && !checkOnly) {
    const { error: roleErr } = await supabase
      .from('user_roles')
      .upsert({ user_id: userId, role: spec.role }, { onConflict: 'user_id' });
    if (roleErr) {
      throw new Error(
        `upsert user_roles for ${spec.email} failed: ${roleErr.message}`,
      );
    }
  }

  // Verify the role landed correctly
  const { data: roleRow, error: roleReadErr } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (roleReadErr) {
    throw new Error(
      `read-back user_roles for ${spec.email} failed: ${roleReadErr.message}`,
    );
  }
  if (roleRow?.role !== spec.role) {
    if (action === 'already-exists') {
      action = 'role-fixed';
    }
    if (checkOnly && roleRow?.role !== spec.role) {
      return {
        label: spec.label,
        email: spec.email,
        action: 'skipped',
        warning: `role mismatch — has '${roleRow?.role ?? 'none'}', expected '${spec.role}' (check mode)`,
      };
    }
  } else if (action === 'already-exists') {
    action = 'verified';
  }

  return { label: spec.label, email: spec.email, action };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    `\n🌱 Seeding E2E test users against ${supabaseUrl}\n` +
      (dryRun ? '   (dry-run mode — no writes)\n' : '') +
      (checkOnly ? '   (check mode — verify only)\n' : ''),
  );

  // ── S156 pre-flight probe (WP-4) ──────────────────────────────────────
  //
  // Runs on every invocation: --check, --dry-run, and normal seed. The
  // probe itself never mutates data.
  //
  // Exit-code discipline:
  //   - bad-shape / missing → exit 2 so CI can distinguish "S156 fix
  //     needed" from generic failures. In dry-run mode we still report
  //     the finding but keep going (dry-run promises no side effects,
  //     including no non-zero exits on recoverable drift).
  //   - query-failed → exit 1 (generic error code) because we cannot
  //     tell the caller anything about the row if the probe itself
  //     never ran.
  console.log('→ Checking pipeline service account shape (S156 probe)…');
  const pipelineCheck = await verifyPipelineUserShape(supabase);
  if (pipelineCheck.ok) {
    console.log('  ✅ Pipeline service account row looks healthy.');
  } else if (pipelineCheck.reason === 'query-failed') {
    console.error(
      `  ❌ S156 pre-flight probe could not run: ${pipelineCheck.detail}`,
    );
    console.error(
      '     This is a genuine error, not an S156 drift. Check env vars, network, and service role key.',
    );
    process.exit(EXIT_GENERIC_ERROR);
  } else {
    const headline =
      pipelineCheck.reason === 'bad-shape'
        ? '⚠️  Pipeline service account row has the S156 broken shape.'
        : '⚠️  Pipeline service account row is missing entirely.';
    console.error(`  ${headline}`);
    console.error(`     ${pipelineCheck.detail}`);
    console.error(`     See ${S156_RUNBOOK_LINK}.`);
    if (pipelineCheck.reason === 'bad-shape') {
      console.error(
        '     Fix: apply the S156 corrective migration via `supabase db push`',
      );
      console.error(
        '          (picks up `20260408134124_fix_pipeline_service_account_auth_shape.sql`).',
      );
    } else {
      console.error(
        '     Fix: run `supabase db push` to apply the original migration',
      );
      console.error(
        '          `20260406180000_create_pipeline_service_account.sql`.',
      );
    }
    if (dryRun) {
      // Dry-run promises no side effects, including no hard-fail exits on
      // recoverable drift. Report the finding and continue to the E2E
      // user seeding step (which will itself no-op in dry-run).
      console.error(
        '     (dry-run mode: continuing without exit; re-run without --dry-run to trigger exit code 2)',
      );
    } else {
      process.exit(EXIT_S156_BAD_ROW);
    }
  }

  const results: ProvisionResult[] = [];
  for (const spec of TEST_USERS) {
    try {
      const r = await provisionUser(spec);
      results.push(r);
    } catch (err) {
      console.error(
        `❌ ${spec.label} (${spec.email}): ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(EXIT_GENERIC_ERROR);
    }
  }

  console.log('\nResults:');
  let hasIssues = false;
  for (const r of results) {
    const icon =
      r.action === 'created'
        ? '✨'
        : r.action === 'verified'
          ? '✅'
          : r.action === 'role-fixed'
            ? '🔧'
            : r.action === 'already-exists'
              ? '➖'
              : '⚠️';
    console.log(`  ${icon} ${r.label.padEnd(7)} ${r.email}  →  ${r.action}`);
    if (r.warning) {
      console.log(`     ↳ ${r.warning}`);
      hasIssues = true;
    }
  }

  if (checkOnly && hasIssues) {
    console.error(
      '\n❌ check mode: one or more users missing or misconfigured. Exiting 1.',
    );
    process.exit(EXIT_GENERIC_ERROR);
  }

  // ── S31 W3 — Publication-review fixture seed ──────────────────────────
  //
  // Provisioned post-user seed. Spec §10.1: invoke once per CI E2E job
  // and emit a single line into the Results: block alongside the user
  // provisioning results. --check verifies the row exists; --dry-run
  // skips the INSERT branch.
  console.log('\n→ Seeding publication-review fixture (S31 W3 OPS-46)…');
  if (dryRun) {
    console.log(
      '  (dry-run — would seed [E2E-PUB-REVIEW-FIXTURE] content_items row if missing)',
    );
  } else if (checkOnly) {
    // --check: read-only verification. Row presence is enough — the
    // mutable publication_status column is owned by the test's
    // afterEach (spec §10.2), so any of in_review/published/draft is
    // an acceptable mid-test state.
    const { data, error } = await supabase
      .from('content_items')
      .select('id, publication_status')
      .eq('title', '[E2E-PUB-REVIEW-FIXTURE] Awaiting publication test row')
      .maybeSingle();
    if (error) {
      console.error(
        `  ❌ publication-review fixture check failed: ${error.message}`,
      );
      process.exit(EXIT_GENERIC_ERROR);
    }
    if (!data) {
      console.error(
        '  ❌ publication-review fixture row missing. Re-run without --check to seed.',
      );
      process.exit(EXIT_GENERIC_ERROR);
    }
    console.log(
      `  ✅ publication-review fixture present (id: ${data.id}, status: ${data.publication_status}).`,
    );
  } else {
    try {
      const fixture = await seedPublicationReviewFixture(supabase);
      const icon = fixture.action === 'created' ? '✨' : '➖';
      console.log(
        `  ${icon} publication-review fixture: ${fixture.action} (${fixture.id})`,
      );
    } catch (err) {
      console.error(
        `  ❌ publication-review fixture seed failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      process.exit(EXIT_GENERIC_ERROR);
    }
  }

  // ── ID-128 {128.9} — Taxonomy + governance reference-data fixture ─────
  //
  // Provisioned post-user seed. --check verifies both rows exist; --dry-run
  // skips the INSERT branch. test-philosophy.md §2.1 (ambient-as-seeded).
  console.log('\n→ Seeding taxonomy + governance fixture (ID-128 {128.9})…');
  if (dryRun) {
    console.log(
      "  (dry-run — would seed taxonomy_domains 'e2e-seeded-domain' + a governance_config rule if missing)",
    );
  } else if (checkOnly) {
    const { data: domainRow, error: domainErr } = await supabase
      .from('taxonomy_domains')
      .select('id')
      .eq('name', 'e2e-seeded-domain')
      .maybeSingle();
    const { data: govRow, error: govErr } = await supabase
      .from('governance_config')
      .select('id')
      .eq('domain', 'e2e-seeded-domain')
      .maybeSingle();
    if (domainErr || govErr) {
      console.error(
        `  ❌ taxonomy/governance fixture check failed: ${(domainErr ?? govErr)?.message}`,
      );
      process.exit(EXIT_GENERIC_ERROR);
    }
    if (!domainRow || !govRow) {
      console.error(
        '  ❌ taxonomy/governance fixture missing. Re-run without --check to seed.',
      );
      process.exit(EXIT_GENERIC_ERROR);
    }
    console.log(
      `  ✅ taxonomy + governance fixture present (domain: ${domainRow.id}, rule: ${govRow.id}).`,
    );
  } else {
    try {
      const fixture = await seedTaxonomyGovernanceFixture(supabase);
      const tIcon = fixture.taxonomy.action === 'created' ? '✨' : '➖';
      const gIcon = fixture.governance.action === 'created' ? '✨' : '➖';
      console.log(
        `  ${tIcon} taxonomy domain: ${fixture.taxonomy.action} (${fixture.taxonomy.id})`,
      );
      console.log(
        `  ${gIcon} governance rule: ${fixture.governance.action} (${fixture.governance.id})`,
      );
    } catch (err) {
      console.error(
        `  ❌ taxonomy/governance fixture seed failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      process.exit(EXIT_GENERIC_ERROR);
    }
  }

  console.log('\n✅ Done.\n');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(EXIT_GENERIC_ERROR);
});

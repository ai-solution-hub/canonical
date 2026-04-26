#!/usr/bin/env bun
/**
 * Seed E2E test users (TEST_USER_1/2/3) with admin/editor/viewer roles.
 *
 * **Why this script exists:**
 *   E2E tests (`e2e/global-setup.ts`) require three test users with specific
 *   emails, passwords, and roles to be present in `auth.users` and
 *   `public.user_roles` before the test suite runs. Historically these were
 *   provisioned manually in the live DB, leaving fresh environments (new
 *   demo DB, example-client re-ingest, local dev) unable to run E2E tests until
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
 *   run this script before invoking `bun run test:e2e`. The example-client re-ingest
 *   and demo DB rebuild runbooks must reference this step.
 */

import { createClient } from '@supabase/supabase-js';
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

const supabase = createClient(supabaseUrl, supabaseKey, {
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

// ── Test user definitions ──────────────────────────────────────────────────

interface TestUserSpec {
  label: 'admin' | 'editor' | 'viewer';
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

  console.log('\n✅ Done.\n');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(EXIT_GENERIC_ERROR);
});

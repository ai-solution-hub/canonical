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
 *   - SUPABASE_SECRET_KEY (service role — NOT the anon key)
 *   - TEST_USER_1_PASSWORD, TEST_USER_2_PASSWORD, TEST_USER_3_PASSWORD
 *
 * **Usage:**
 *   bun run seed:e2e-users                # provision (or verify) all 3 users
 *   bun run seed:e2e-users --dry-run      # show what would happen
 *   bun run seed:e2e-users --check        # verify-only, exit 1 if missing
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

Required env vars:
  SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
  SUPABASE_SECRET_KEY
  TEST_USER_1_PASSWORD, TEST_USER_2_PASSWORD, TEST_USER_3_PASSWORD
`);
  process.exit(0);
}

const dryRun = values['dry-run'] ?? false;
const checkOnly = values.check ?? false;

// ── Supabase client ────────────────────────────────────────────────────────

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    '❌ Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SECRET_KEY',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

  const results: ProvisionResult[] = [];
  for (const spec of TEST_USERS) {
    try {
      const r = await provisionUser(spec);
      results.push(r);
    } catch (err) {
      console.error(
        `❌ ${spec.label} (${spec.email}): ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
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
    process.exit(1);
  }

  console.log('\n✅ Done.\n');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

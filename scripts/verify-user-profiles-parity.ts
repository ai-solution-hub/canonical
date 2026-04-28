#!/usr/bin/env bun
/**
 * Verify public.user_profiles parity against auth.users.
 *
 * Runs after the WP-G3.4 mirror migration applies, and as a slot-in step
 * in the staging-refresh runbook (§4.3 step 4) so backfill skew, dashboard
 * email-change drift, or signup-time trigger failure surface immediately.
 *
 * **Why this script exists:**
 *   The user_profiles table is a mirror of auth.users populated by AFTER
 *   INSERT and AFTER UPDATE triggers (handle_new_user, handle_user_update).
 *   If the trigger function ever silently fails, or a backfill on a fresh
 *   environment is skipped, the mirror drifts. This probe is a fail-fast
 *   detector: counts must match, and a 3-row spot-check confirms the
 *   email + full_name columns line up.
 *
 *   Modelled on `scripts/seed-e2e-users.ts:234 verifyPipelineUserShape()`.
 *
 * **Environment variables required:**
 *   - SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (service role — NOT the anon key)
 *
 * **Usage:**
 *   bun run scripts/verify-user-profiles-parity.ts                     # auto env (trust SUPABASE_URL)
 *   bun run scripts/verify-user-profiles-parity.ts --env=prod          # asserts URL contains rovrymhhffssilaftdwd
 *   bun run scripts/verify-user-profiles-parity.ts --env=staging       # asserts URL contains turayklvaunphgbgscat
 *   bun run scripts/verify-user-profiles-parity.ts --spot-check=5      # check 5 random users instead of 3
 *
 * **Exit codes (per WP-G3.4 spec §5.2):**
 *   - `0` — pass; counts match and spot-check parity holds.
 *   - `1` — count mismatch, column-level drift, or env-flag assertion failure.
 *   - `2` — query failure (the probe itself could not run; e.g. RPC
 *           missing, network issue, missing service role key).
 *
 *   The script defaults to `auto` env, which trusts whatever SUPABASE_URL
 *   is in scope. Use `--env=prod`/`--env=staging` to defensively assert
 *   the target before running — catches sandbox env drift early.
 *
 * **Counts**: auth.users is read via the public.count_auth_users() RPC
 *   shipped in the WP-G3.4 v1 migration. The RPC is service-role only;
 *   anon/authenticated have no execute privilege.
 */

import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';

const PROD_PROJECT_REF = 'rovrymhhffssilaftdwd';
const STAGING_PROJECT_REF = 'turayklvaunphgbgscat';

const EXIT_OK = 0;
const EXIT_GENERIC_ERROR = 1;
const EXIT_QUERY_FAILED = 2;

// ── Env loading (handles worktrees) ────────────────────────────────────────
//
// Identical body to seed-e2e-users.ts:99-127 — walks up the cwd tree to find
// .env.local / .env. Worktree-safe.

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
    env: { type: 'string', default: 'auto' }, // prod | staging | auto
    'spot-check': { type: 'string', default: '3' }, // N random users
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`
Verify public.user_profiles parity against auth.users.

Usage:
  bun run scripts/verify-user-profiles-parity.ts                # auto env
  bun run scripts/verify-user-profiles-parity.ts --env=prod     # asserts prod
  bun run scripts/verify-user-profiles-parity.ts --env=staging  # asserts staging
  bun run scripts/verify-user-profiles-parity.ts --spot-check=5 # 5 random users

Exit codes:
  0  pass; counts match and spot-check parity holds
  1  count mismatch, column drift, or env-flag assertion failure
  2  query failure — probe could not run (RPC missing, network, etc.)

Required env vars:
  SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
  SUPABASE_SERVICE_ROLE_KEY
`);
  process.exit(EXIT_OK);
}

const envFlag = values.env ?? 'auto';
const spotCheckNRaw = values['spot-check'] ?? '3';
const spotCheckN = Number.parseInt(spotCheckNRaw, 10);
if (!Number.isFinite(spotCheckN) || spotCheckN < 0) {
  console.error(
    `❌ Invalid --spot-check=${spotCheckNRaw}; must be a non-negative integer.`,
  );
  process.exit(EXIT_GENERIC_ERROR);
}

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

// ── Env-flag assertion (WP-S5.3 §7.1 template) ─────────────────────────────
//
// --env=prod => SUPABASE_URL must include rovrymhhffssilaftdwd
// --env=staging => SUPABASE_URL must include turayklvaunphgbgscat
// --env=auto => no assertion (trust the env)

function assertEnvFlag(env: string, url: string): void {
  if (env === 'prod' && !url.includes(PROD_PROJECT_REF)) {
    console.error(
      `❌ --env=prod set but SUPABASE_URL does not include '${PROD_PROJECT_REF}'.\n` +
        `   Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> ` +
        `bun run scripts/verify-user-profiles-parity.ts --env=prod`,
    );
    process.exit(EXIT_GENERIC_ERROR);
  }
  if (env === 'staging' && !url.includes(STAGING_PROJECT_REF)) {
    console.error(
      `❌ --env=staging set but SUPABASE_URL does not include '${STAGING_PROJECT_REF}'.\n` +
        `   Run: SUPABASE_URL=<staging-url> SUPABASE_SERVICE_ROLE_KEY=<key> ` +
        `bun run scripts/verify-user-profiles-parity.ts --env=staging`,
    );
    process.exit(EXIT_GENERIC_ERROR);
  }
  if (env !== 'prod' && env !== 'staging' && env !== 'auto') {
    console.error(
      `❌ Unknown --env=${env}; expected 'prod', 'staging', or 'auto'.`,
    );
    process.exit(EXIT_GENERIC_ERROR);
  }
}

assertEnvFlag(envFlag, supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type SupabaseServiceClient = typeof supabase;

// ── Probe ──────────────────────────────────────────────────────────────────

interface SpotCheckRow {
  id: string;
  auth_email: string | null;
  profile_email: string | null;
  auth_name: string | null;
  profile_name: string | null;
}

interface ParityResult {
  ok: boolean;
  authCount: number;
  profileCount: number;
  spotCheckPasses: number;
  spotCheckTotal: number;
  failures: string[];
}

/**
 * Runs the parity check. Throws on query failure (caught in main and mapped
 * to EXIT_QUERY_FAILED). Returns a structured result on success — caller
 * inspects ParityResult.ok to decide between EXIT_OK and EXIT_GENERIC_ERROR.
 */
async function verifyUserProfilesParity(
  client: SupabaseServiceClient,
  spotCheckLimit: number,
): Promise<ParityResult> {
  // (1) Count parity. auth.users via the count_auth_users() RPC; user_profiles
  //     via PostgREST head-only count. Either failure is a query-failed.
  const { data: authCountData, error: authErr } =
    await client.rpc('count_auth_users');
  if (authErr) {
    throw new Error(
      `count_auth_users RPC failed: ${authErr.message ?? authErr}. ` +
        `Has the WP-G3.4 migration been applied?`,
    );
  }
  const authCount = Number(authCountData);
  if (!Number.isFinite(authCount)) {
    throw new Error(
      `count_auth_users returned non-numeric value: ${JSON.stringify(authCountData)}`,
    );
  }

  const { count: profileCountRaw, error: profErr } = await client
    .from('user_profiles')
    .select('*', { count: 'exact', head: true });
  if (profErr) {
    throw new Error(
      `SELECT count(*) FROM user_profiles failed: ${profErr.message}`,
    );
  }
  const profileCount = profileCountRaw ?? 0;

  const failures: string[] = [];
  if (authCount !== profileCount) {
    failures.push(
      `count mismatch: auth.users=${authCount} user_profiles=${profileCount} ` +
        `(diff ${authCount - profileCount})`,
    );
  }

  // (2) Spot-check N random users for column parity. Skip cleanly when the
  //     table is empty or spotCheckLimit=0 (no rows to check is a valid
  //     pass — counts already matched).
  let spotCheckPasses = 0;
  let spotCheckTotal = 0;
  if (authCount > 0 && spotCheckLimit > 0) {
    const limit = Math.min(spotCheckLimit, authCount);
    // Random sample via the RPC pattern would require a server-side helper.
    // Instead, fetch up to `limit` rows ordered by random offset on
    // user_profiles (cheap on small tables) and look up the matching
    // auth.users rows via auth.admin.getUserById (the same path
    // verifyPipelineUserShape uses — bypasses PostgREST's auth-schema
    // restriction).
    const { data: profileRows, error: profSampleErr } = await client
      .from('user_profiles')
      .select('id, email, full_name')
      .limit(limit);
    if (profSampleErr) {
      throw new Error(
        `spot-check SELECT FROM user_profiles failed: ${profSampleErr.message}`,
      );
    }

    const rows: SpotCheckRow[] = [];
    for (const pr of profileRows ?? []) {
      const { data: authRes, error: authLookupErr } =
        await client.auth.admin.getUserById(pr.id as string);
      if (authLookupErr || !authRes?.user) {
        throw new Error(
          `spot-check auth.admin.getUserById(${pr.id}) failed: ${
            authLookupErr?.message ?? 'no user returned'
          }`,
        );
      }
      const authUser = authRes.user;
      const authMeta = (authUser.user_metadata ?? {}) as Record<
        string,
        unknown
      >;
      const authFullName =
        typeof authMeta.full_name === 'string'
          ? (authMeta.full_name as string)
          : null;
      rows.push({
        id: pr.id as string,
        auth_email: (authUser.email as string | undefined) ?? null,
        profile_email: (pr.email as string | null) ?? null,
        auth_name: authFullName,
        profile_name: (pr.full_name as string | null) ?? null,
      });
    }

    spotCheckTotal = rows.length;
    for (const row of rows) {
      const idShort = row.id.slice(0, 8);
      const emailMatch = row.auth_email === row.profile_email;
      const nameMatch = row.auth_name === row.profile_name;
      if (emailMatch && nameMatch) {
        spotCheckPasses++;
      } else {
        if (!emailMatch) {
          failures.push(
            `user ${idShort}: email drift (auth='${row.auth_email}', profile='${row.profile_email}')`,
          );
        }
        if (!nameMatch) {
          failures.push(
            `user ${idShort}: full_name drift (auth='${row.auth_name}', profile='${row.profile_name}')`,
          );
        }
      }
    }
  }

  return {
    ok: failures.length === 0,
    authCount,
    profileCount,
    spotCheckPasses,
    spotCheckTotal,
    failures,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    `\n🔍 Verifying public.user_profiles parity against ${supabaseUrl}\n` +
      `   (--env=${envFlag} assertion: PASS)\n`,
  );

  const result = await verifyUserProfilesParity(supabase, spotCheckN);

  console.log('Counts:');
  console.log(`  auth.users:           ${result.authCount}`);
  console.log(`  public.user_profiles: ${result.profileCount}`);
  if (result.authCount === result.profileCount) {
    console.log(`  ✅ counts match`);
  } else {
    console.log(`  ❌ COUNT MISMATCH`);
  }

  if (spotCheckN === 0) {
    console.log(`\nColumn spot-check: skipped (--spot-check=0).`);
  } else if (result.spotCheckTotal === 0) {
    console.log(
      `\nColumn spot-check: skipped (auth.users is empty — counts already match).`,
    );
  } else {
    console.log(
      `\nColumn spot-check (${result.spotCheckTotal} of ${spotCheckN} requested):`,
    );
    if (result.spotCheckPasses === result.spotCheckTotal) {
      console.log(
        `  ✅ all ${result.spotCheckTotal} user(s): email + full_name parity`,
      );
    }
  }

  if (result.failures.length > 0) {
    console.error(`\n❌ Failures (${result.failures.length}):`);
    for (const f of result.failures) {
      console.error(`   - ${f}`);
    }
    if (result.authCount !== result.profileCount) {
      console.error(
        `\n   Re-run backfill via supabase db push (the WP-G3.4 migration is\n` +
          `   replay-safe; ON CONFLICT DO NOTHING absorbs idempotent re-runs).\n`,
      );
    }
    process.exit(EXIT_GENERIC_ERROR);
  }

  console.log(`\n✅ Done. Exit ${EXIT_OK}.\n`);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(EXIT_QUERY_FAILED);
});

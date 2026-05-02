#!/usr/bin/env bun
/**
 * Migration replay smoke check (WP-G4.5).
 *
 * Creates a fresh ephemeral Supabase preview branch of the prod project,
 * applies every file under `supabase/migrations/**` via `supabase db push
 * --linked`, then deletes the branch. Catches squash-divergence at PR
 * time (the failure mode that hit S4 + S8 — see
 * `feedback_out_of_band_psql_must_become_migration`).
 *
 * **Why this script exists:**
 *   `supabase db push --linked` only applies migrations not already on
 *   the linked branch. It does NOT verify a from-scratch replay would
 *   succeed. A migration depending on out-of-band schema state succeeds
 *   against the patched live branch and silently breaks on every fresh
 *   branch ever after. This script forces the from-scratch path to be
 *   exercised on every PR that touches `supabase/migrations/**`.
 *
 *   Spec: docs/audits/kh-production-readiness-phase-1/specs/wp-g4.5-migration-replay-spec.md
 *
 * **Mechanism:** Supabase Management API (REST, direct fetch — NO
 * supabase-js writes per CLAUDE.md Bun-204-hang gotcha) + subprocess
 * invocation of `supabase db push --linked` for the actual migration
 * apply. The Management API direct-migration endpoint
 * (POST /v1/projects/{ref}/database/migrations) is restricted-access; CLI
 * `db push` is the supported path.
 *
 * **Required env vars (all set by the workflow):**
 *   - SUPABASE_ACCESS_TOKEN — Personal Access Token for Management API
 *   - POSTGRES_PASSWORD — DB password (CLI `db push` opens direct conn)
 *   - PROJECT_REF — prod project ref (constant, set by workflow env:)
 *   - PR_NUMBER — branch name component (PR number or 'main' / branch name)
 *   - RUN_ID — branch name component + cleanup matcher
 *   - EVENT_NAME — distinguishes pull_request vs push (informational)
 *   - HEAD_REF — git_branch field in branch creation (PR head)
 *   - REF_NAME — fallback when HEAD_REF is empty (push events)
 *
 * **Usage:**
 *   bun run scripts/migration-replay-check.ts                 # full replay
 *   bun run scripts/migration-replay-check.ts --cleanup-only  # delete leaked branches
 *   bun run scripts/migration-replay-check.ts --dry-run       # log only
 *   bun run scripts/migration-replay-check.ts --help          # this text
 *
 * **Exit codes (per spec §5):**
 *   - 0 — replay succeeded; cleanup ran
 *   - 1 — a migration failed to apply (real PR-blocking bug)
 *   - 2 — infrastructure failure (branch create/poll/API; transient)
 *
 * **Design constraints:**
 *   - No supabase-js (Bun 204 hang in sandbox; CLAUDE.md Supabase Gotchas)
 *   - No new npm dependencies (zero install footprint)
 *   - UK English in all messages
 *   - All `${{ github.* }}` workflow values arrive via env vars (workflow
 *     injection mitigation; spec §4.5)
 */

import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

// ── Constants ──────────────────────────────────────────────────────────────

const MANAGEMENT_API_BASE = 'https://api.supabase.com/v1';
const BRANCH_REGION = 'eu-west-2';
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 60; // 5-minute cap
const DELETE_TIMEOUT_MS = 30_000;
const FAILING_MIGRATION_PATTERN =
  /Applying migration (\d{14}_[A-Za-z0-9_]+\.sql)/;

const EXIT_OK = 0;
const EXIT_MIGRATION_FAILED = 1;
const EXIT_INFRA_ERROR = 2;

// ── Config loading ─────────────────────────────────────────────────────────

interface ReplayConfig {
  accessToken: string;
  postgresPassword: string;
  projectRef: string;
  prNumber: string;
  runId: string;
  eventName: string;
  headRef: string;
  refName: string;
  dryRun: boolean;
  cleanupOnly: boolean;
}

interface CliFlags {
  dryRun: boolean;
  cleanupOnly: boolean;
}

function parseCli(): CliFlags {
  const { values } = parseArgs({
    options: {
      'cleanup-only': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
Migration replay smoke check (WP-G4.5).

Usage:
  bun run scripts/migration-replay-check.ts                 # full replay
  bun run scripts/migration-replay-check.ts --cleanup-only  # delete branches matching $RUN_ID
  bun run scripts/migration-replay-check.ts --dry-run       # log API calls, do not execute
  bun run scripts/migration-replay-check.ts --help          # this text

Required env vars:
  SUPABASE_ACCESS_TOKEN, POSTGRES_PASSWORD, PROJECT_REF,
  PR_NUMBER, RUN_ID, EVENT_NAME, HEAD_REF, REF_NAME

Exit codes:
  0  replay succeeded
  1  migration failed (PR-blocking)
  2  infrastructure failure (transient; re-run)

Spec: docs/audits/kh-production-readiness-phase-1/specs/wp-g4.5-migration-replay-spec.md
`);
    process.exit(EXIT_OK);
  }

  return {
    dryRun: values['dry-run'] ?? false,
    cleanupOnly: values['cleanup-only'] ?? false,
  };
}

function loadConfig(flags: CliFlags): ReplayConfig {
  const required = {
    SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
    PROJECT_REF: process.env.PROJECT_REF,
    PR_NUMBER: process.env.PR_NUMBER,
    RUN_ID: process.env.RUN_ID,
  };

  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    console.error(
      `Missing required env vars: ${missing.join(', ')}. ` +
        `See script header or --help for the full list.`,
    );
    process.exit(EXIT_INFRA_ERROR);
  }

  return {
    accessToken: required.SUPABASE_ACCESS_TOKEN as string,
    postgresPassword: required.POSTGRES_PASSWORD as string,
    projectRef: required.PROJECT_REF as string,
    prNumber: required.PR_NUMBER as string,
    runId: required.RUN_ID as string,
    eventName: process.env.EVENT_NAME ?? 'unknown',
    headRef: process.env.HEAD_REF ?? '',
    refName: process.env.REF_NAME ?? '',
    dryRun: flags.dryRun,
    cleanupOnly: flags.cleanupOnly,
  };
}

// ── Branch lifecycle ───────────────────────────────────────────────────────

interface BranchSummary {
  id: string;
  project_ref: string;
  name: string;
  status: string;
  git_branch?: string;
  persistent?: boolean;
}

/**
 * Branch lifecycle statuses that indicate the branch is fully provisioned
 * and accepting connections — terminal "ready" states.
 */
export const READY_BRANCH_STATUSES = [
  'ACTIVE_HEALTHY',
  'FUNCTIONS_DEPLOYED',
] as const;

/**
 * Branch lifecycle statuses that are transient during creation/migration —
 * the polling loop should keep waiting rather than failing.
 *
 * `CREATING_PROJECT` was added kh-prod-readiness-S22 (02/05/2026) after
 * two consecutive migration-replay smoke runs (25260265369 + 25260575282)
 * failed on attempt 1 with the API returning `CREATING_PROJECT` — a state
 * not previously in the accepted-intermediate set. `MIGRATIONS_FAILED` is
 * intentionally separated out (handled as an immediate-throw inside the
 * polling loop) because it indicates the branch's clone of parent
 * migrations failed and additional waiting will not recover.
 */
export const INTERMEDIATE_BRANCH_STATUSES = [
  'CREATING_PROJECT',
  'CREATING',
  'COMING_UP',
  'MIGRATIONS_PASSED',
  'MIGRATIONS_FAILED',
] as const;

export function isReadyBranchStatus(status: string): boolean {
  return (READY_BRANCH_STATUSES as readonly string[]).includes(status);
}

export function isIntermediateBranchStatus(status: string): boolean {
  return (INTERMEDIATE_BRANCH_STATUSES as readonly string[]).includes(status);
}

interface BranchDetails extends BranchSummary {
  db_pass?: string;
  db_host?: string;
  db_port?: number;
  db_user?: string;
}

function buildBranchName(config: ReplayConfig): string {
  // Pattern: ci-replay-<pr-or-branch>-<run-id>
  // PR_NUMBER is the PR number for pull_request events, falls back to
  // the branch name for push events (set in workflow env: block).
  const prefix = `ci-replay-${config.prNumber}`;
  return `${prefix}-${config.runId}`;
}

function buildGitBranch(config: ReplayConfig): string {
  // HEAD_REF is set on pull_request events; REF_NAME on push events.
  // Either way, the branch must exist or Supabase rejects creation.
  return config.headRef || config.refName || 'main';
}

async function managementApi<T>(
  config: ReplayConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${MANAGEMENT_API_BASE}${path}`;
  if (config.dryRun) {
    console.log(`[dry-run] ${init.method ?? 'GET'} ${url}`);
    if (init.body) console.log(`[dry-run] body: ${init.body as string}`);
    return {} as T;
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.accessToken}`,
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Management API ${init.method ?? 'GET'} ${path} failed: ` +
        `HTTP ${res.status} — ${errText.slice(0, 500)}`,
    );
  }
  // 204 No Content is valid (e.g. DELETE)
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

async function createBranch(config: ReplayConfig): Promise<BranchSummary> {
  const branchName = buildBranchName(config);
  const gitBranch = buildGitBranch(config);
  console.log(
    `Creating ephemeral branch '${branchName}' (git_branch=${gitBranch}, region=${BRANCH_REGION})...`,
  );
  try {
    const branch = await managementApi<BranchSummary>(
      config,
      `/projects/${config.projectRef}/branches`,
      {
        method: 'POST',
        body: JSON.stringify({
          branch_name: branchName,
          git_branch: gitBranch,
          persistent: false,
          region: BRANCH_REGION,
        }),
      },
    );
    if (!config.dryRun) {
      console.log(
        `  Created branch id=${branch.id} project_ref=${branch.project_ref} status=${branch.status}`,
      );
    }
    return branch;
  } catch (err) {
    // 409 on POST /branches typically means name collision OR per-project
    // branch quota hit. Pre-flight orphan sweep should have absorbed
    // collisions; if we still see 409, dump the live branch list to make
    // debugging one-step (S19 WP1.4).
    const msg = (err as Error).message ?? String(err);
    if (msg.includes('HTTP 409')) {
      try {
        const live = await listBranches(config);
        const summary = live
          .map(
            (b) =>
              `    ${b.name} (status=${b.status}, persistent=${b.persistent ?? '?'})`,
          )
          .join('\n');
        console.error(
          `::error::Branch CREATE returned 409. Live branches at fail-time ` +
            `(${live.length} total):\n${summary || '    (none)'}\n` +
            `Run pre-flight orphan sweep manually if any 'ci-replay-*' ` +
            `entries are listed; otherwise this is a per-project quota hit ` +
            `(raise via Supabase dashboard) or a transient API flake (re-run).`,
        );
      } catch (listErr) {
        console.error(
          `::error::Branch CREATE returned 409 and follow-up list_branches ` +
            `failed: ${(listErr as Error).message}`,
        );
      }
    }
    throw err;
  }
}

async function listBranches(config: ReplayConfig): Promise<BranchSummary[]> {
  if (config.dryRun) return [];
  return await managementApi<BranchSummary[]>(
    config,
    `/projects/${config.projectRef}/branches`,
  );
}

async function waitForBranchReady(
  config: ReplayConfig,
  branchRef: string,
): Promise<BranchSummary> {
  if (config.dryRun) {
    console.log(`[dry-run] would poll branch ${branchRef} until ready`);
    return {
      id: 'dry-run',
      project_ref: branchRef,
      name: 'dry-run',
      status: 'ACTIVE_HEALTHY',
    };
  }
  console.log(
    `Polling branch ${branchRef} until ACTIVE_HEALTHY (max ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s)...`,
  );
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    const branches = await listBranches(config);
    const target = branches.find((b) => b.project_ref === branchRef);
    if (!target) {
      // Branch not yet visible in list — wait + retry
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (isReadyBranchStatus(target.status)) {
      console.log(
        `  Branch ready after ${attempt} attempt(s) (status=${target.status})`,
      );
      return target;
    }
    if (isIntermediateBranchStatus(target.status)) {
      if (target.status === 'MIGRATIONS_FAILED') {
        throw new Error(
          `Branch ${branchRef} reported MIGRATIONS_FAILED during creation. ` +
            `Inherits parent migration history, so this indicates a parent-DB ` +
            `migration ledger drift. Check Supabase dashboard branch logs.`,
        );
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    throw new Error(
      `Branch ${branchRef} reported unexpected status='${target.status}' on attempt ${attempt}`,
    );
  }
  throw new Error(
    `Branch ${branchRef} did not reach ACTIVE_HEALTHY within ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`,
  );
}

async function getBranchDetails(
  config: ReplayConfig,
  branchId: string,
): Promise<BranchDetails> {
  if (config.dryRun) {
    return {
      id: branchId,
      project_ref: 'dry-run',
      name: 'dry-run',
      status: 'ACTIVE_HEALTHY',
      db_pass: 'dry-run-password',
    };
  }
  return await managementApi<BranchDetails>(config, `/branches/${branchId}`);
}

async function deleteBranch(
  config: ReplayConfig,
  branchId: string,
): Promise<void> {
  if (config.dryRun) {
    console.log(`[dry-run] would DELETE branch ${branchId}`);
    return;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
    try {
      await managementApi(config, `/branches/${branchId}`, {
        method: 'DELETE',
        signal: controller.signal,
      });
      console.log(`  Deleted branch ${branchId}`);
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    // Cleanup failure is a warning (per spec §5.3) — branch will idle
    // and Supabase auto-cleans eventually.
    console.warn(
      `::warning::Branch ${branchId} deletion failed (${msg}); ` +
        `will idle and auto-clean. Manually delete via Supabase dashboard if needed.`,
    );
  }
}

// ── Migration apply ────────────────────────────────────────────────────────

interface ApplyResult {
  ok: boolean;
  failingMigration?: string;
  stderr: string;
}

function applyMigrations(
  config: ReplayConfig,
  branchProjectRef: string,
  branchDbPassword: string,
): ApplyResult {
  if (config.dryRun) {
    console.log(
      `[dry-run] would supabase link --project-ref ${branchProjectRef}`,
    );
    console.log(`[dry-run] would supabase db push --linked --yes`);
    return { ok: true, stderr: '' };
  }
  console.log(`Linking Supabase CLI to branch ${branchProjectRef}...`);
  const link = spawnSync(
    'supabase',
    ['link', '--project-ref', branchProjectRef],
    {
      env: {
        ...process.env,
        SUPABASE_ACCESS_TOKEN: config.accessToken,
        SUPABASE_DB_PASSWORD: branchDbPassword,
      },
      encoding: 'utf-8',
    },
  );
  if (link.status !== 0) {
    return {
      ok: false,
      stderr: `supabase link failed: ${link.stderr ?? '(no stderr)'}`,
    };
  }

  console.log(
    `Running supabase db push --linked --yes (45+ migration files)...`,
  );
  const push = spawnSync('supabase', ['db', 'push', '--linked', '--yes'], {
    env: {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: config.accessToken,
      SUPABASE_DB_PASSWORD: branchDbPassword,
      PGPASSWORD: branchDbPassword,
    },
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });

  const stderr = push.stderr ?? '';
  const stdout = push.stdout ?? '';
  const combined = `${stdout}\n${stderr}`;

  if (push.status === 0) {
    console.log('  All migrations applied cleanly.');
    return { ok: true, stderr: '' };
  }

  const failingMigration = extractFailingMigration(combined);
  return {
    ok: false,
    failingMigration,
    stderr: combined.slice(0, 2048),
  };
}

export function extractFailingMigration(output: string): string | undefined {
  // Supabase CLI emits "Applying migration <filename>..." lines. The last
  // such line before the error is our failing file. Use a stateful global
  // regex + while-loop (rather than matchAll spread) to avoid downlevel-
  // iteration constraints on older tsc targets — works on ES2017+.
  const re = new RegExp(FAILING_MIGRATION_PATTERN, 'g');
  let last: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    last = m[1];
  }
  return last;
}

// ── Cleanup-only mode ──────────────────────────────────────────────────────

/**
 * Match scope:
 *   - 'exact' — current-run branch only (post-job cleanup belt+braces)
 *   - 'prefix' — all `ci-replay-<prNumber>-*` branches (pre-flight orphan
 *      sweep; absorbs leaks from previous crashed/cancelled runs that never
 *      reached their `finally` cleanup, which is the leading 409
 *      `Failed to insert preview branch` cause when a prior run's branch
 *      lingered in a stuck state — see S19 WP1.4 / run 25162738483)
 */
type CleanupScope = 'exact' | 'prefix';

export function shouldDeleteBranch(
  branchName: string,
  prNumber: string,
  runId: string,
  scope: CleanupScope,
): boolean {
  const exactName = `ci-replay-${prNumber}-${runId}`;
  if (scope === 'exact') return branchName === exactName;
  // Prefix scope: delete all `ci-replay-<prNumber>-*` EXCEPT the current run
  // (the current run owns its own branch; same-run cleanup happens in the
  // `finally` arm, not here).
  const prefix = `ci-replay-${prNumber}-`;
  return branchName.startsWith(prefix) && branchName !== exactName;
}

async function cleanupLeakedBranches(
  config: ReplayConfig,
  scope: CleanupScope = 'exact',
): Promise<void> {
  const label =
    scope === 'prefix'
      ? `pre-flight orphan sweep matching ci-replay-${config.prNumber}-* (excluding current run)`
      : `current-run branch ci-replay-${config.prNumber}-${config.runId}`;
  console.log(`Cleanup: ${label}...`);
  const branches = await listBranches(config);
  const matches = branches.filter((b) =>
    shouldDeleteBranch(b.name, config.prNumber, config.runId, scope),
  );
  if (matches.length === 0) {
    console.log('  No matching branches found.');
    return;
  }
  console.log(`  Found ${matches.length} branch(es); deleting...`);
  for (const b of matches) {
    await deleteBranch(config, b.id);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Orchestration ──────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const flags = parseCli();
  const config = loadConfig(flags);

  console.log(
    `WP-G4.5 migration replay check\n` +
      `  event=${config.eventName} pr=${config.prNumber} run_id=${config.runId}\n` +
      `  project_ref=${config.projectRef} dry_run=${config.dryRun}\n`,
  );

  if (config.cleanupOnly) {
    try {
      await cleanupLeakedBranches(config);
      return EXIT_OK;
    } catch (err) {
      console.error(`Cleanup-only run failed: ${(err as Error).message}`);
      return EXIT_INFRA_ERROR;
    }
  }

  let branchId: string | undefined;
  let branchProjectRef: string | undefined;

  try {
    // Pre-flight orphan sweep — delete any leaked `ci-replay-<prNumber>-*`
    // branches from previous runs that crashed/were-cancelled before
    // hitting their `finally` arm. Cleanup failure is non-fatal; if a
    // genuine resource is blocking createBranch, the next CREATE call
    // surfaces 409 with the branch list logged.
    try {
      await cleanupLeakedBranches(config, 'prefix');
    } catch (err) {
      console.warn(
        `::warning::Pre-flight orphan sweep failed (${(err as Error).message}); ` +
          `continuing with create attempt.`,
      );
    }

    const created = await createBranch(config);
    branchId = created.id;
    const ready = await waitForBranchReady(config, created.project_ref);
    branchProjectRef = ready.project_ref;

    const details = await getBranchDetails(config, created.id);
    const dbPassword = details.db_pass;
    if (!dbPassword) {
      throw new Error(
        `Branch ${created.id} did not return db_pass in /branches/{id} response`,
      );
    }

    const result = applyMigrations(config, ready.project_ref, dbPassword);
    if (!result.ok) {
      const failingFile = result.failingMigration ?? '(unknown)';
      console.error(
        `::error file=supabase/migrations/${failingFile},line=1::Migration replay failed: ${result.stderr.split('\n')[0]?.slice(0, 200) ?? 'see stderr'}`,
      );
      console.error(`\nFull stderr (first 2KB):\n${result.stderr}`);
      return EXIT_MIGRATION_FAILED;
    }
    return EXIT_OK;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`::error::Infrastructure failure during replay: ${msg}`);
    return EXIT_INFRA_ERROR;
  } finally {
    // Always attempt cleanup (spec §3.4). Failure is a warning, not an
    // error — leaked ephemeral branches auto-clean.
    if (branchId) {
      console.log(`\nCleanup: deleting branch ${branchId}...`);
      await deleteBranch(config, branchId);
    } else if (branchProjectRef) {
      console.log(
        `\nCleanup: branch id unavailable but project_ref=${branchProjectRef} created; ` +
          `manual cleanup may be needed.`,
      );
    }
  }
}

// Guard top-level execution so the file is safely importable for unit
// testing of pure helpers like extractFailingMigration. Bun's
// `import.meta.main` is the canonical signal but tsc rejects it under
// some module targets (`module=esnext` is required); fall back to
// process.argv[1] basename matching, which is portable.
const isMain =
  process.argv[1]?.endsWith('migration-replay-check.ts') ||
  process.argv[1]?.endsWith('migration-replay-check');
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`Unhandled exception: ${(err as Error).message}`);
      process.exit(EXIT_INFRA_ERROR);
    });
}

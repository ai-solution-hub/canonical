#!/usr/bin/env bun
/**
 * Staging live-mirror orchestrator (WP-CI.RES.2 / OPS-52).
 *
 * Pipes prod data into the persistent staging Supabase branch, then
 * scrubs PII per `scripts/scrub-staging-pii.sql` and verifies the scrub
 * via `scripts/verify-scrub.ts`. Pure `spawnSync` shell-outs — no
 * supabase-js or MCP imports inside the orchestrator (per spec §4.2 +
 * `feedback_chokepoint_cross_runtime`); a service-role Supabase client
 * is constructed only for the `recordPipelineRun()` audit-trail call.
 *
 * Spec: docs/audits/kh-production-readiness-phase-1/specs/wp-ci-res2-staging-live-mirror-spec.md
 */

import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { recordPipelineRun } from '@/lib/pipeline/record-run';
import type { Database, Json } from '@/supabase/types/database.types';

// ── Constants ──────────────────────────────────────────────────────────────

const PIPELINE_NAME = 'staging_live_mirror';
const STAGING_BRANCH_ID = 'turayklvaunphgbgscat';

/** Exit codes per spec §2.9. */
const EXIT_OK = 0;
const EXIT_SCRUB_PROBE_FAILED = 1;
const EXIT_INFRA_FAILURE = 2;
const EXIT_PREFLIGHT_FAILURE = 3;

/** Manual protection-toggle poll cadence (per spec §2.7 step 7.2 / 7.7). */
const PROTECTION_POLL_INTERVAL_MS = 30_000;
const PROTECTION_POLL_MAX_MS = 30 * 60 * 1_000; // 30-min timeout

/** Pre-flight in-flight guard window per spec §2.7 step 7.1(c). */
const INFLIGHT_GUARD_INTERVAL = "30 minutes";

// pg_dump exclusion args verbatim per spec §2.7 step 7.3 (auth tables that
// must never replay into staging — sessions/tokens/MFA state).
const PG_DUMP_EXCLUSIONS = [
  'auth.audit_log_entries',
  'auth.refresh_tokens',
  'auth.sessions',
  'auth.flow_state',
  'auth.mfa_factors',
  'auth.mfa_challenges',
];

// ── Types ──────────────────────────────────────────────────────────────────

type ProtectionMode = 'cli' | 'manual';

interface CliFlags {
  protectionMode: ProtectionMode;
  skipSeed: boolean;
  dryRun: boolean;
}

interface OrchestratorConfig {
  stagingDbUrl: string;
  prodDbUrl: string;
  stagingBcrypt: string;
  stagingSupabaseUrl: string;
  stagingServiceRoleKey: string;
  /** Required only when protectionMode === 'cli'. */
  supabaseAccessToken: string | null;
  flags: CliFlags;
}

interface StepTiming {
  step: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
}

interface OrchestratorResult {
  exitCode: number;
  steps: StepTiming[];
  /** Raw post-scrub row counts captured from staging for parity-probe baseline. */
  tableCounts?: Record<string, number>;
  errorMessage?: string;
}

// ── CLI parsing ────────────────────────────────────────────────────────────

function parseCli(): CliFlags {
  const { values } = parseArgs({
    options: {
      'protection-mode': { type: 'string', default: 'cli' },
      'skip-seed': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(EXIT_OK);
  }

  const modeRaw = values['protection-mode'] ?? 'cli';
  if (modeRaw !== 'cli' && modeRaw !== 'manual') {
    console.error(
      `Invalid --protection-mode='${modeRaw}'. Allowed: cli|manual.`,
    );
    process.exit(EXIT_PREFLIGHT_FAILURE);
  }

  return {
    protectionMode: modeRaw,
    skipSeed: values['skip-seed'] ?? false,
    dryRun: values['dry-run'] ?? false,
  };
}

function printUsage(): void {
  console.log(`
Staging live-mirror orchestrator (WP-CI.RES.2 / OPS-52).

Pipes prod data into the persistent staging Supabase branch, then
scrubs PII via scripts/scrub-staging-pii.sql and verifies via
scripts/verify-scrub.ts. Re-enables staging branch protection in
finally{} so staging is never left unprotected on any exit path.

Usage:
  bun run scripts/staging-mirror-and-scrub.ts                                # default cli-protection refresh
  bun run scripts/staging-mirror-and-scrub.ts --protection-mode=manual       # Liam dashboard toggle
  bun run scripts/staging-mirror-and-scrub.ts --skip-seed                    # debug — skip seedTestUsers
  bun run scripts/staging-mirror-and-scrub.ts --dry-run                      # log intended ops
  bun run scripts/staging-mirror-and-scrub.ts --help

Required env vars:
  STAGING_SUPABASE_DB_URL              psql/pg_dump connection URI for staging
  PROD_SUPABASE_DB_URL                 pg_dump source URI for prod
  STAGING_SHARED_PASSWORD_BCRYPT       bcrypt hash for scrubbed staging users
  STAGING_SUPABASE_URL                 staging REST URL (recordPipelineRun client)
  STAGING_SUPABASE_SERVICE_ROLE_KEY    service-role key for staging
  SUPABASE_ACCESS_TOKEN                PAT for branches CLI (only when --protection-mode=cli)

Exit codes:
  0  refresh succeeded; verification probes pass
  1  scrub probe failed (PII residue detected)
  2  infrastructure failure (pg_dump, psql, protection-toggle re-enable)
  3  pre-flight failure (env / schema-parity / in-flight / protection-toggle disable)

Spec: docs/audits/kh-production-readiness-phase-1/specs/wp-ci-res2-staging-live-mirror-spec.md
`);
}

// ── Config loading ─────────────────────────────────────────────────────────

function loadConfig(flags: CliFlags): OrchestratorConfig {
  const env = process.env;

  // PROTECTION_MODE / SKIP_SEED env vars (per spec §2.4) override CLI
  // defaults so the GHA `env:` block can drive behaviour without re-shaping
  // the bun-run argv. CLI flags still win when explicitly supplied.
  const envProtectionMode = env.PROTECTION_MODE;
  if (envProtectionMode === 'cli' || envProtectionMode === 'manual') {
    flags.protectionMode = envProtectionMode;
  }
  if (env.SKIP_SEED === 'true') {
    flags.skipSeed = true;
  }

  const required: Record<string, string | undefined> = {
    STAGING_SUPABASE_DB_URL: env.STAGING_SUPABASE_DB_URL,
    PROD_SUPABASE_DB_URL: env.PROD_SUPABASE_DB_URL,
    STAGING_SHARED_PASSWORD_BCRYPT: env.STAGING_SHARED_PASSWORD_BCRYPT,
    STAGING_SUPABASE_URL: env.STAGING_SUPABASE_URL,
    STAGING_SUPABASE_SERVICE_ROLE_KEY: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
  };

  if (flags.protectionMode === 'cli') {
    required.SUPABASE_ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
  }

  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    if (flags.dryRun) {
      // Dry-run is intentionally non-destructive and used for smoke tests
      // that lack real workflow secrets; substitute redacted placeholders
      // so log output stays meaningful without leaking shape ambiguity.
      for (const k of missing) {
        required[k] = `<dry-run-placeholder:${k}>`;
      }
      console.log(
        `[dry-run] config: synthesised placeholders for missing env vars ` +
          `(${missing.join(', ')}); no real connections will be opened.`,
      );
    } else {
      throw new PreflightError(
        `Missing required env vars: ${missing.join(', ')}. ` +
          `See --help for the full list.`,
      );
    }
  }

  return {
    stagingDbUrl: required.STAGING_SUPABASE_DB_URL as string,
    prodDbUrl: required.PROD_SUPABASE_DB_URL as string,
    stagingBcrypt: required.STAGING_SHARED_PASSWORD_BCRYPT as string,
    stagingSupabaseUrl: required.STAGING_SUPABASE_URL as string,
    stagingServiceRoleKey: required.STAGING_SUPABASE_SERVICE_ROLE_KEY as string,
    supabaseAccessToken:
      flags.protectionMode === 'cli'
        ? (required.SUPABASE_ACCESS_TOKEN as string)
        : null,
    flags,
  };
}

// ── Error class for clean exit-code routing ────────────────────────────────

class PreflightError extends Error {}
class InfraError extends Error {}
class ScrubProbeError extends Error {}

// ── Step utility ───────────────────────────────────────────────────────────

async function timed<T>(
  step: string,
  steps: StepTiming[],
  fn: () => Promise<T> | T,
): Promise<T> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const out = await fn();
    steps.push({ step, startedAt, durationMs: Date.now() - t0, ok: true });
    return out;
  } catch (err) {
    steps.push({ step, startedAt, durationMs: Date.now() - t0, ok: false });
    throw err;
  }
}

// ── Pre-flight ─────────────────────────────────────────────────────────────

async function preflight(config: OrchestratorConfig): Promise<void> {
  if (config.flags.dryRun) {
    console.log(
      '[dry-run] skipping pg_dump version + reachability + parity + in-flight probes',
    );
    return;
  }

  // 7.1(a) pg_dump --version asserts PG 17.x (per CLAUDE.md gotcha:
  // pg_dump major must match server PG major; Supabase runs PG 17.6).
  const ver = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' });
  if (ver.status !== 0) {
    throw new PreflightError(
      `pg_dump --version failed (exit ${ver.status}): ${ver.stderr ?? ''}`,
    );
  }
  const verOut = (ver.stdout ?? '').trim();
  if (!/\b17\.\d+/.test(verOut)) {
    throw new PreflightError(
      `pg_dump must report PG 17.x, got: '${verOut}'. ` +
        `Install postgresql@17 client per CLAUDE.md gotcha.`,
    );
  }
  console.log(`pre-flight: pg_dump version OK (${verOut})`);

  // 7.1(b) staging reachability via psql.
  const reach = spawnSync(
    'psql',
    [config.stagingDbUrl, '-c', 'SELECT current_database()'],
    { encoding: 'utf8' },
  );
  if (reach.status !== 0) {
    throw new PreflightError(
      `psql -c against staging failed (exit ${reach.status}): ${reach.stderr ?? ''}`,
    );
  }
  console.log('pre-flight: staging psql reachable');

  // 7.1(b) schema-parity via migration count parity prod-vs-staging.
  const stagingCount = countMigrations(config.stagingDbUrl);
  const prodCount = countMigrations(config.prodDbUrl);
  if (stagingCount !== prodCount) {
    throw new PreflightError(
      `Migration-count parity failed: staging has ${stagingCount} ` +
        `applied migrations, prod has ${prodCount}. Schema drift — ` +
        `re-link staging via supabase link + db push before retrying.`,
    );
  }
  console.log(
    `pre-flight: migration-count parity OK (${stagingCount} migrations both sides)`,
  );

  // 7.1(c) in-flight guard. A running refresh started within the
  // last INFLIGHT_GUARD_INTERVAL would race this dispatch.
  const inflightSql = `SELECT count(*) FROM pipeline_runs WHERE pipeline_name = '${PIPELINE_NAME}' AND status = 'in_progress' AND created_at > NOW() - INTERVAL '${INFLIGHT_GUARD_INTERVAL}'`;
  const inflight = spawnSync(
    'psql',
    [config.stagingDbUrl, '-tAc', inflightSql],
    { encoding: 'utf8' },
  );
  if (inflight.status !== 0) {
    throw new PreflightError(
      `In-flight guard query failed (exit ${inflight.status}): ${inflight.stderr ?? ''}`,
    );
  }
  const inflightCount = Number.parseInt((inflight.stdout ?? '0').trim(), 10);
  if (inflightCount > 0) {
    throw new PreflightError(
      `In-flight refresh detected: ${inflightCount} '${PIPELINE_NAME}' ` +
        `runs in_progress within last ${INFLIGHT_GUARD_INTERVAL}. ` +
        `Wait for completion or clear the stale row before retrying.`,
    );
  }
  console.log('pre-flight: no in-flight refresh detected');
}

function countMigrations(dbUrl: string): number {
  const sql =
    'SELECT count(*) FROM supabase_migrations.schema_migrations';
  const out = spawnSync('psql', [dbUrl, '-tAc', sql], { encoding: 'utf8' });
  if (out.status !== 0) {
    throw new PreflightError(
      `Migration count query failed for DB URL: ${out.stderr ?? ''}`,
    );
  }
  return Number.parseInt((out.stdout ?? '0').trim(), 10);
}

// ── Protection toggle ──────────────────────────────────────────────────────

async function disableProtection(config: OrchestratorConfig): Promise<void> {
  await toggleProtection(config, false, 'disable');
}

async function enableProtection(config: OrchestratorConfig): Promise<void> {
  // Failure to re-enable surfaces as exit-2 + GHA error annotation per spec
  // §4.2 — operator must dashboard-toggle ASAP if this throws.
  await toggleProtection(config, true, 'enable');
}

async function toggleProtection(
  config: OrchestratorConfig,
  desiredProtected: boolean,
  label: 'enable' | 'disable',
): Promise<void> {
  if (config.flags.dryRun) {
    console.log(
      `[dry-run] would ${label} protection on ${STAGING_BRANCH_ID} via ${config.flags.protectionMode} mode`,
    );
    return;
  }

  if (config.flags.protectionMode === 'cli') {
    const result = spawnSync(
      'supabase',
      [
        'branches',
        'update',
        STAGING_BRANCH_ID,
        '--is-protected',
        String(desiredProtected),
      ],
      { encoding: 'utf8', env: process.env },
    );
    if (result.status !== 0) {
      throw new InfraError(
        `supabase branches update --is-protected ${desiredProtected} failed ` +
          `(exit ${result.status}): ${result.stderr ?? ''}`,
      );
    }
    console.log(
      `protection: ${label}d via CLI (is_protected=${desiredProtected})`,
    );
    return;
  }

  // manual mode — emit a GHA notice and poll until the dashboard toggle lands.
  console.log(
    `::notice::Awaiting Liam dashboard toggle: set staging branch ` +
      `${STAGING_BRANCH_ID} is_protected=${desiredProtected}. Polling every ` +
      `${PROTECTION_POLL_INTERVAL_MS / 1000}s for up to ` +
      `${PROTECTION_POLL_MAX_MS / 60_000} min.`,
  );
  const deadline = Date.now() + PROTECTION_POLL_MAX_MS;
  while (Date.now() < deadline) {
    const observed = readProtectedFlag();
    if (observed === desiredProtected) {
      console.log(
        `protection: ${label}d via manual toggle (is_protected=${desiredProtected})`,
      );
      return;
    }
    await sleep(PROTECTION_POLL_INTERVAL_MS);
  }
  throw new InfraError(
    `Manual protection ${label} timed out after ` +
      `${PROTECTION_POLL_MAX_MS / 60_000} min waiting for ` +
      `is_protected=${desiredProtected} on ${STAGING_BRANCH_ID}.`,
  );
}

function readProtectedFlag(): boolean | null {
  const result = spawnSync(
    'supabase',
    ['branches', 'list', '--output', 'json'],
    { encoding: 'utf8', env: process.env },
  );
  if (result.status !== 0) {
    console.warn(
      `::warning::supabase branches list --output json failed during ` +
        `manual-mode poll (exit ${result.status}); will retry.`,
    );
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout ?? '[]') as Array<{
      id?: string;
      is_protected?: boolean;
    }>;
    const target = parsed.find((b) => b.id === STAGING_BRANCH_ID);
    return typeof target?.is_protected === 'boolean'
      ? target.is_protected
      : null;
  } catch (err) {
    console.warn(
      `::warning::Failed to parse 'supabase branches list' JSON: ` +
        `${(err as Error).message}`,
    );
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Stream restore (pg_dump | psql) ────────────────────────────────────────

async function streamRestore(config: OrchestratorConfig): Promise<void> {
  // Single shell pipe per spec §4.2 (no /tmp intermediate file). Args
  // verbatim from spec §2.7 step 7.3. Both pipe ends MUST exit 0; we
  // enforce via `set -o pipefail`.
  const dumpArgs = [
    '"$PROD_DB_URL"',
    '--data-only',
    '--no-owner',
    '--no-privileges',
    '--schema=public',
    '--schema=auth',
    ...PG_DUMP_EXCLUSIONS.map((t) => `--exclude-table-data=${t}`),
  ].join(' ');
  const cmd = `set -o pipefail; pg_dump ${dumpArgs} | psql "$STAGING_DB_URL" --single-transaction`;

  if (config.flags.dryRun) {
    console.log(`[dry-run] would run: ${cmd}`);
    return;
  }

  const result = spawnSync('bash', ['-c', cmd], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PROD_DB_URL: config.prodDbUrl,
      STAGING_DB_URL: config.stagingDbUrl,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new InfraError(
      `pg_dump | psql stream-restore failed (exit ${result.status}). ` +
        `Re-run after addressing transient infra issue.`,
    );
  }
  console.log('stream-restore: pg_dump | psql completed (both ends OK)');
}

// ── Scrub ──────────────────────────────────────────────────────────────────

async function runScrub(config: OrchestratorConfig): Promise<void> {
  // psql --set=staging_bcrypt="..." per spec §4.3 Pass 1 + F-v2-1.
  // Reference inside SQL as :'staging_bcrypt' for proper string-literal
  // escaping of bcrypt $-literals.
  if (config.flags.dryRun) {
    console.log(
      '[dry-run] would run: psql --single-transaction --set=staging_bcrypt=<redacted> --file scripts/scrub-staging-pii.sql',
    );
    return;
  }

  const result = spawnSync(
    'psql',
    [
      config.stagingDbUrl,
      '--single-transaction',
      `--set=staging_bcrypt=${config.stagingBcrypt}`,
      '--file',
      'scripts/scrub-staging-pii.sql',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (result.status !== 0) {
    // Scrub-file execution failure is treated as a probe failure (exit-1):
    // staging is in mid-state and PII may remain. Operator must re-run the
    // full refresh per spec §2.9.1.
    throw new ScrubProbeError(
      `psql --file scripts/scrub-staging-pii.sql failed (exit ${result.status}). ` +
        `Staging is in mid-state — re-run refresh from scratch.`,
    );
  }
  console.log('scrub: scripts/scrub-staging-pii.sql applied');
}

async function verifyScrub(config: OrchestratorConfig): Promise<void> {
  if (config.flags.dryRun) {
    console.log(
      '[dry-run] would run: bun run scripts/verify-scrub.ts --env=staging',
    );
    return;
  }

  const result = spawnSync(
    'bun',
    ['run', 'scripts/verify-scrub.ts', '--env=staging'],
    { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'], env: process.env },
  );
  if (result.status !== 0) {
    throw new ScrubProbeError(
      `verify-scrub.ts probes failed (exit ${result.status}). ` +
        `PII residue detected — staging is in mid-state. Per spec §2.9.1.`,
    );
  }
  console.log('verify-scrub: all probes passed');
}

// ── Seed ───────────────────────────────────────────────────────────────────

async function seedTestUsers(config: OrchestratorConfig): Promise<void> {
  if (config.flags.skipSeed) {
    console.log('seed: skipped (--skip-seed / SKIP_SEED=true)');
    return;
  }
  if (config.flags.dryRun) {
    console.log('[dry-run] would run: bun run scripts/seed-e2e-users.ts');
    return;
  }

  // seed-e2e-users.ts always targets staging post-WP-S5.2 (.env.local
  // points at staging). No --env flag is exposed; the script reads the
  // workspace .env.local SUPABASE_URL.
  const result = spawnSync(
    'bun',
    ['run', 'scripts/seed-e2e-users.ts'],
    { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'], env: process.env },
  );
  if (result.status !== 0) {
    throw new InfraError(
      `seed-e2e-users.ts failed (exit ${result.status}). ` +
        `Staging is scrubbed but TEST_USER seeding incomplete — re-run ` +
        `the seed script manually before relying on E2E.`,
    );
  }
  console.log('seed: TEST_USER_1/2/3 provisioned');
}

// ── Post-scrub table-count snapshot for parity baseline ────────────────────

async function captureTableCounts(
  config: OrchestratorConfig,
): Promise<Record<string, number>> {
  // Eight canonical tables per AC-9 (highest-volume content-bearing).
  // The result feeds `pipeline_runs.result` so cycle-2+ refreshes can diff
  // against the previous baseline (aids parity-probe debugging).
  const tables = [
    'auth.users',
    'public.user_profiles',
    'public.user_roles',
    'public.content_items',
    'public.content_chunks',
    'public.bid_questions',
    'public.bid_responses',
    'public.feed_articles',
  ];

  if (config.flags.dryRun) {
    console.log('[dry-run] skipping table-count snapshot');
    return {};
  }

  const counts: Record<string, number> = {};
  for (const table of tables) {
    const sql = `SELECT count(*) FROM ${table}`;
    const out = spawnSync(
      'psql',
      [config.stagingDbUrl, '-tAc', sql],
      { encoding: 'utf8' },
    );
    if (out.status !== 0) {
      console.warn(
        `::warning::Table-count snapshot failed for ${table}: ${out.stderr ?? ''}`,
      );
      counts[table] = -1;
      continue;
    }
    counts[table] = Number.parseInt((out.stdout ?? '0').trim(), 10);
  }
  return counts;
}

// ── Audit-trail recordPipelineRun() ────────────────────────────────────────

async function recordRun(
  config: OrchestratorConfig,
  outcome: OrchestratorResult,
): Promise<void> {
  if (config.flags.dryRun) {
    console.log('[dry-run] skipping recordPipelineRun()');
    return;
  }

  // Service-role client constructed locally (the orchestrator otherwise
  // avoids supabase-js) because recordPipelineRun() requires a
  // SupabaseClient parameter per its signature.
  const client: SupabaseClient<Database> = createClient<Database>(
    config.stagingSupabaseUrl,
    config.stagingServiceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const status =
    outcome.exitCode === EXIT_OK
      ? 'completed'
      : outcome.exitCode === EXIT_SCRUB_PROBE_FAILED
        ? 'completed_with_errors'
        : 'failed';

  const result: Json = {
    exitCode: outcome.exitCode,
    protectionMode: config.flags.protectionMode,
    skipSeed: config.flags.skipSeed,
    dryRun: config.flags.dryRun,
    steps: outcome.steps as unknown as Json,
    tableCounts: (outcome.tableCounts ?? {}) as unknown as Json,
  };

  await recordPipelineRun({
    supabase: client,
    pipelineName: PIPELINE_NAME,
    status,
    itemsCreated: [],
    result,
    errorMessage: outcome.errorMessage ?? null,
  });
}

// ── main() ─────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const flags = parseCli();
  const steps: StepTiming[] = [];

  let config: OrchestratorConfig;
  try {
    config = loadConfig(flags);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`::error::Pre-flight (env): ${msg}`);
    // Pre-flight failure -> exit-3 with no protection toggle attempted +
    // best-effort recordRun via env vars that ARE present (skipped if
    // staging credentials are themselves missing).
    return EXIT_PREFLIGHT_FAILURE;
  }

  let exitCode = EXIT_OK;
  let errorMessage: string | undefined;
  let toggleAttempted = false;
  let tableCounts: Record<string, number> | undefined;

  try {
    await timed('preflight', steps, () => preflight(config));

    await timed('disableProtection', steps, () => disableProtection(config));
    toggleAttempted = true;

    await timed('streamRestore', steps, () => streamRestore(config));
    await timed('runScrub', steps, () => runScrub(config));
    await timed('verifyScrub', steps, () => verifyScrub(config));
    await timed('seedTestUsers', steps, () => seedTestUsers(config));

    tableCounts = await timed('tableCountSnapshot', steps, () =>
      captureTableCounts(config),
    );
  } catch (err) {
    errorMessage = (err as Error).message;
    if (err instanceof PreflightError) {
      exitCode = EXIT_PREFLIGHT_FAILURE;
      console.error(`::error::Pre-flight: ${errorMessage}`);
    } else if (err instanceof ScrubProbeError) {
      exitCode = EXIT_SCRUB_PROBE_FAILED;
      console.error(
        `::error file=scripts/scrub-staging-pii.sql,line=1::Scrub probe ` +
          `failed: ${errorMessage}`,
      );
    } else if (err instanceof InfraError) {
      exitCode = EXIT_INFRA_FAILURE;
      console.error(`::error::Infrastructure: ${errorMessage}`);
    } else {
      exitCode = EXIT_INFRA_FAILURE;
      console.error(`::error::Unhandled: ${errorMessage}`);
    }
  } finally {
    // Re-enable protection unconditionally if we ever disabled it, to
    // avoid leaving staging unprotected on workflow exit (spec §2.7
    // step 7.7 + §2.9.2). Re-enable failure escalates exit code to
    // INFRA_FAILURE per spec §4.2.
    if (toggleAttempted) {
      try {
        await timed('enableProtection', steps, () => enableProtection(config));
      } catch (err) {
        const msg = (err as Error).message;
        console.error(
          `::error::Failed to re-enable staging branch protection: ${msg}. ` +
            `OPERATOR ACTION REQUIRED: toggle is_protected=true in the ` +
            `Supabase dashboard for branch ${STAGING_BRANCH_ID} ASAP.`,
        );
        if (exitCode === EXIT_OK) {
          exitCode = EXIT_INFRA_FAILURE;
          errorMessage = msg;
        }
      }
    }

    // Always emit recordPipelineRun() — never throws (per its contract).
    try {
      await recordRun(config, {
        exitCode,
        steps,
        tableCounts,
        errorMessage,
      });
    } catch (err) {
      // recordPipelineRun is documented never-throws but guard anyway.
      console.warn(
        `::warning::recordPipelineRun() raised unexpectedly: ` +
          `${(err as Error).message}`,
      );
    }
  }

  return exitCode;
}

// Guard top-level execution so the file is safely importable for unit
// testing (mirrors migration-replay-check.ts isMain pattern).
const isMain =
  process.argv[1]?.endsWith('staging-mirror-and-scrub.ts') ||
  process.argv[1]?.endsWith('staging-mirror-and-scrub');
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`Unhandled exception: ${(err as Error).message}`);
      process.exit(EXIT_INFRA_FAILURE);
    });
}

export {
  parseCli,
  loadConfig,
  PIPELINE_NAME,
  STAGING_BRANCH_ID,
  EXIT_OK,
  EXIT_SCRUB_PROBE_FAILED,
  EXIT_INFRA_FAILURE,
  EXIT_PREFLIGHT_FAILURE,
  PreflightError,
  InfraError,
  ScrubProbeError,
};

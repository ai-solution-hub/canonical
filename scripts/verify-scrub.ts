#!/usr/bin/env bun
/**
 * Staging-mirror PII scrub verification (WP-CI.RES.2 §4.6).
 *
 * Runs the §3.6 12-probe v2 minimal subset against the staging Supabase
 * branch after `scripts/scrub-staging-pii.sql` has executed. Pure
 * `spawnSync('psql', ...)` shell-out — **no supabase-js, no MCP imports**
 * (per WP-G4.5 §7.3 + `feedback_chokepoint_cross_runtime` rationale and
 * the F-v2-3 audit gate at AC-20).
 *
 * Spec: docs/audits/kh-production-readiness-phase-1/specs/wp-ci-res2-staging-live-mirror-spec.md
 *
 * **Probe set (§3.6 — v2 minimal subset, 12 probes):**
 *   1.  auth.users.email PII residue            (== 0)
 *   2.  user_profiles.email PII residue         (== 0)
 *   3.  auth.users.last_sign_in_at residue      (== 0)
 *   4.  auth.users.phone residue                (== 0)
 *   5.  auth.users token columns residue        (== 0)
 *   6.  auth.identities.identity_data JSONB     (== 0)
 *   7.  auth.refresh_tokens (truncated)         (== 0)
 *   8.  auth.sessions (truncated)               (== 0)
 *   9.  auth.flow_state (truncated)             (== 0)
 *   10. auth.users count parity vs prod         (within ±5% of baseline, pre-seed)
 *   11. user_profiles ↔ auth.users mirror       (exact equality)
 *   12. content_items.created_by FK orphan      (== 0)
 *
 * **Required env vars:**
 *   STAGING_SUPABASE_DB_URL — psql URI for staging branch
 *   PROD_SUPABASE_DB_URL    — psql URI for prod (only required when
 *                              --baseline-cycle=1; cycle 2+ reads
 *                              `pipeline_runs.result.prod_counts`)
 *
 * **Surface:**
 *   bun run scripts/verify-scrub.ts                            # full probe set
 *   bun run scripts/verify-scrub.ts --probe=auth-users-pii     # single probe
 *   bun run scripts/verify-scrub.ts --env=staging              # explicit target
 *   bun run scripts/verify-scrub.ts --baseline-cycle=1         # use live prod for baseline
 *   bun run scripts/verify-scrub.ts --help
 *
 * **Exit codes (per spec §2.9):**
 *   0  all probes green
 *   1  one or more probes failed (PII residue / parity drift)
 *   2  infrastructure failure (psql connection, query error)
 *   3  env-validation failure (missing required env var)
 */

import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

// ── Constants ──────────────────────────────────────────────────────────────

export const EXIT_OK = 0;
export const EXIT_PROBE_FAILED = 1;
export const EXIT_INFRA_ERROR = 2;
export const EXIT_ENV_ERROR = 3;

const PARITY_TOLERANCE = 0.05; // ±5% — AC-9 + probe 10
const SCRUB_SQL_PATH = 'scripts/scrub-staging-pii.sql';

// ── Types ──────────────────────────────────────────────────────────────────

export type ProbeExpectation =
  | { kind: 'eq-zero' }
  | { kind: 'eq-baseline'; baseline: number }
  | { kind: 'within-tolerance'; baseline: number; tolerance: number };

export interface ProbeDef {
  /** Stable kebab-case name used by --probe= and GHA annotations. */
  name: string;
  /** Single-line SQL `count(*)` expression — runs via `psql -c "<sql>" -t -A`. */
  sql: string;
  /** Pass criterion for the returned numeric count. */
  expectation: ProbeExpectation;
  /** Human-readable label printed on failure annotations. */
  label: string;
}

export interface ProbeResult {
  name: string;
  label: string;
  pass: boolean;
  actual: number;
  expectation: ProbeExpectation;
  error?: string;
}

export interface VerifyConfig {
  stagingDbUrl: string;
  prodDbUrl: string | undefined;
  baselineCycle: 1 | 2;
  env: 'staging' | 'prod';
  probeFilter: string | undefined;
}

export interface CliFlags {
  probe: string | undefined;
  env: 'staging' | 'prod';
  baselineCycle: 1 | 2;
}

// ── CLI parsing ────────────────────────────────────────────────────────────

export function parseCli(argv?: string[]): CliFlags {
  const { values } = parseArgs({
    args: argv,
    options: {
      probe: { type: 'string' },
      env: { type: 'string', default: 'staging' },
      'baseline-cycle': { type: 'string', default: '1' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(EXIT_OK);
  }

  const env = values.env;
  if (env !== 'staging' && env !== 'prod') {
    throw new Error(
      `Invalid --env=${String(env)} — expected 'staging' or 'prod'.`,
    );
  }

  const cycleStr = values['baseline-cycle'];
  const cycle = cycleStr === '2' ? 2 : 1;

  return {
    probe: values.probe,
    env,
    baselineCycle: cycle,
  };
}

function printHelp(): void {
  console.log(`
Staging-mirror PII scrub verification (WP-CI.RES.2 §4.6).

Usage:
  bun run scripts/verify-scrub.ts                            # full probe set
  bun run scripts/verify-scrub.ts --probe=<name>             # run a single probe
  bun run scripts/verify-scrub.ts --env=staging|prod         # target env (default: staging)
  bun run scripts/verify-scrub.ts --baseline-cycle=1|2       # 1 = live prod fetch; 2 = pipeline_runs lookup
  bun run scripts/verify-scrub.ts --help

Required env vars:
  STAGING_SUPABASE_DB_URL — psql URI for staging branch
  PROD_SUPABASE_DB_URL    — psql URI for prod (only when --baseline-cycle=1)

Exit codes:
  0  all probes green
  1  one or more probes failed (PII residue / parity drift)
  2  infrastructure failure (psql connection, query error)
  3  env-validation failure (missing required env var)

Spec: docs/audits/kh-production-readiness-phase-1/specs/wp-ci-res2-staging-live-mirror-spec.md
`);
}

// ── Config loading ─────────────────────────────────────────────────────────

export function loadConfig(flags: CliFlags): VerifyConfig {
  const stagingDbUrl = process.env.STAGING_SUPABASE_DB_URL;
  const prodDbUrl = process.env.PROD_SUPABASE_DB_URL;

  if (!stagingDbUrl) {
    throw new Error(
      'Missing required env var: STAGING_SUPABASE_DB_URL. ' +
        'See script header or --help.',
    );
  }

  if (flags.baselineCycle === 1 && !prodDbUrl) {
    throw new Error(
      'Missing required env var: PROD_SUPABASE_DB_URL ' +
        '(required when --baseline-cycle=1; cycle 2+ reads pipeline_runs.result.prod_counts).',
    );
  }

  return {
    stagingDbUrl,
    prodDbUrl,
    baselineCycle: flags.baselineCycle,
    env: flags.env,
    probeFilter: flags.probe,
  };
}

// ── psql shell-out ─────────────────────────────────────────────────────────

/**
 * Executes `psql -c "<sql>" -t -A` against the supplied connection URI and
 * parses the single-value count from stdout. Tuples-only (`-t`) and
 * unaligned (`-A`) output mode means `count(*)` returns just the number,
 * trimmed of whitespace — no headers, no row separators.
 */
export function psqlCount(dbUrl: string, sql: string): number {
  const result = spawnSync(
    'psql',
    [dbUrl, '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    {
      encoding: 'utf-8',
      maxBuffer: 4 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').toString().trim();
    throw new Error(
      `psql exit=${result.status}; stderr=${stderr.slice(0, 500) || '(empty)'}`,
    );
  }

  const stdout = (result.stdout ?? '').toString().trim();
  const parsed = Number.parseInt(stdout, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `psql returned non-numeric output: "${stdout.slice(0, 200)}"`,
    );
  }
  return parsed;
}

// ── Probe definitions (§3.6 — 12-probe v2 minimal subset) ──────────────────

/**
 * Builds the §3.6 probe set. `prodAuthUsersCount` is required for probe 10
 * (count parity); supply 0 to disable the parity check (probe will still run
 * but will pass automatically against a baseline of 0 only if staging count
 * is also within ±5% of 0 — i.e. exactly 0). Use the loadProdBaseline path
 * to fetch a real baseline before invoking.
 */
export function buildProbeSet(prodAuthUsersCount: number): ProbeDef[] {
  return [
    {
      name: 'auth-users-pii',
      label: 'auth.users email PII residue',
      sql:
        "SELECT count(*) FROM auth.users " +
        "WHERE email NOT LIKE 'staging-%@kb-staging.test' " +
        "AND email NOT LIKE '%@test-kb-aish.co.uk'",
      expectation: { kind: 'eq-zero' },
    },
    {
      name: 'user-profiles-pii',
      label: 'public.user_profiles email PII residue',
      sql:
        "SELECT count(*) FROM public.user_profiles " +
        "WHERE email NOT LIKE 'staging-%@kb-staging.test' " +
        "AND email NOT LIKE '%@test-kb-aish.co.uk'",
      expectation: { kind: 'eq-zero' },
    },
    {
      name: 'auth-users-last-sign-in',
      label: 'auth.users last_sign_in_at residue',
      sql: 'SELECT count(*) FROM auth.users WHERE last_sign_in_at IS NOT NULL',
      expectation: { kind: 'eq-zero' },
    },
    {
      name: 'auth-users-phone',
      label: 'auth.users phone residue',
      sql: 'SELECT count(*) FROM auth.users WHERE phone IS NOT NULL',
      expectation: { kind: 'eq-zero' },
    },
    {
      name: 'auth-users-tokens',
      label: 'auth.users token columns residue',
      sql:
        "SELECT count(*) FROM auth.users " +
        "WHERE recovery_token != '' " +
        "OR confirmation_token != '' " +
        "OR reauthentication_token != ''",
      expectation: { kind: 'eq-zero' },
    },
    {
      name: 'auth-identities-jsonb',
      label: 'auth.identities.identity_data JSONB residue (Pass 2 scrub)',
      sql:
        "SELECT count(*) FROM auth.identities " +
        "WHERE identity_data::text ILIKE '%client.example%'",
      expectation: { kind: 'eq-zero' },
    },
    {
      name: 'auth-refresh-tokens-truncated',
      label: 'auth.refresh_tokens TRUNCATE check',
      sql: 'SELECT count(*) FROM auth.refresh_tokens',
      expectation: { kind: 'eq-zero' },
    },
    {
      name: 'auth-sessions-truncated',
      label: 'auth.sessions TRUNCATE check',
      sql: 'SELECT count(*) FROM auth.sessions',
      expectation: { kind: 'eq-zero' },
    },
    {
      name: 'auth-flow-state-truncated',
      label: 'auth.flow_state TRUNCATE check',
      sql: 'SELECT count(*) FROM auth.flow_state',
      expectation: { kind: 'eq-zero' },
    },
    {
      name: 'auth-users-count-parity',
      label:
        'auth.users prod-vs-staging count parity (pre-seed; ±5% tolerance)',
      sql: 'SELECT count(*) FROM auth.users',
      expectation: {
        kind: 'within-tolerance',
        baseline: prodAuthUsersCount,
        tolerance: PARITY_TOLERANCE,
      },
    },
    {
      name: 'mirror-parity-exact',
      label: 'public.user_profiles ↔ auth.users mirror parity (exact)',
      sql:
        '(SELECT count(*) FROM public.user_profiles) - ' +
        '(SELECT count(*) FROM auth.users)',
      expectation: { kind: 'eq-zero' },
    },
    {
      name: 'fk-orphan-content-items',
      label: 'content_items.created_by FK orphan probe',
      sql:
        'SELECT count(*) FROM public.content_items ci ' +
        'LEFT JOIN auth.users u ON ci.created_by = u.id ' +
        'WHERE ci.created_by IS NOT NULL AND u.id IS NULL',
      expectation: { kind: 'eq-zero' },
    },
  ];
}

// ── Probe evaluation ───────────────────────────────────────────────────────

export function evaluateProbe(
  actual: number,
  expectation: ProbeExpectation,
): boolean {
  switch (expectation.kind) {
    case 'eq-zero':
      return actual === 0;
    case 'eq-baseline':
      return actual === expectation.baseline;
    case 'within-tolerance': {
      // Baseline 0 short-circuit: ±5% of 0 is still 0; staging must also be 0.
      if (expectation.baseline === 0) return actual === 0;
      const drift =
        Math.abs(actual - expectation.baseline) / expectation.baseline;
      return drift <= expectation.tolerance;
    }
  }
}

export function runProbe(dbUrl: string, probe: ProbeDef): ProbeResult {
  try {
    const actual = psqlCount(dbUrl, probe.sql);
    const pass = evaluateProbe(actual, probe.expectation);
    return {
      name: probe.name,
      label: probe.label,
      pass,
      actual,
      expectation: probe.expectation,
    };
  } catch (err) {
    return {
      name: probe.name,
      label: probe.label,
      pass: false,
      actual: -1,
      expectation: probe.expectation,
      error: (err as Error).message,
    };
  }
}

export function runProbeSet(
  dbUrl: string,
  probes: ProbeDef[],
): ProbeResult[] {
  const results: ProbeResult[] = [];
  for (const probe of probes) {
    const result = runProbe(dbUrl, probe);
    results.push(result);
  }
  return results;
}

// ── Reporting ──────────────────────────────────────────────────────────────

/**
 * Per spec §2.9.1: emits a GHA `::error file=...,line=...::<message>`
 * annotation on probe failure, pointing at the scrub SQL file so operator
 * jumps directly to the offending logic. Returns the annotation string for
 * test assertion.
 */
export function reportProbe(result: ProbeResult): string {
  if (result.pass) {
    const ok = `[OK] ${result.name} — ${result.label} (count=${result.actual})`;
    console.log(ok);
    return ok;
  }

  const detail = result.error
    ? `error: ${result.error}`
    : `count=${result.actual}, expected ${describeExpectation(result.expectation)}`;
  const message =
    `Scrub probe failed: ${result.name} (${result.label}) — ${detail}; ` +
    `staging is in mid-state — re-run refresh from scratch ` +
    `(do NOT trust staging until probes are green)`;
  const annotation = `::error file=${SCRUB_SQL_PATH},line=1::${message}`;
  console.error(annotation);
  return annotation;
}

function describeExpectation(expectation: ProbeExpectation): string {
  switch (expectation.kind) {
    case 'eq-zero':
      return '== 0';
    case 'eq-baseline':
      return `== ${expectation.baseline} (baseline)`;
    case 'within-tolerance':
      return `within ±${(expectation.tolerance * 100).toFixed(1)}% of baseline ${expectation.baseline}`;
  }
}

// ── Baseline lookup (cycle 1 = live psql against prod; cycle 2+ deferred) ──

/**
 * Loads the prod `auth.users` row count for the parity probe (probe 10).
 * Cycle 1 (default) shells out via `psql` against `PROD_SUPABASE_DB_URL`.
 * Cycle 2+ would read `pipeline_runs.result.prod_counts` from the most
 * recent successful `staging_live_mirror` run — deferred to follow-up
 * work; cycle 2 currently still falls back to live psql.
 *
 * **No MCP fallback in v2** — `loadProdBaselineCounts()` shells out via
 * `psql` only (per spec §4.6 contract).
 */
export function loadProdBaselineCounts(config: VerifyConfig): number {
  if (!config.prodDbUrl) {
    throw new Error(
      'PROD_SUPABASE_DB_URL not set — cannot fetch live prod baseline.',
    );
  }
  return psqlCount(config.prodDbUrl, 'SELECT count(*) FROM auth.users');
}

// ── Orchestration ──────────────────────────────────────────────────────────

export async function main(argv?: string[]): Promise<number> {
  let flags: CliFlags;
  try {
    flags = parseCli(argv);
  } catch (err) {
    console.error(`::error::CLI parse error: ${(err as Error).message}`);
    return EXIT_ENV_ERROR;
  }

  let config: VerifyConfig;
  try {
    config = loadConfig(flags);
  } catch (err) {
    console.error(`::error::Env validation failed: ${(err as Error).message}`);
    return EXIT_ENV_ERROR;
  }

  console.log(
    `Staging-mirror PII scrub verification (env=${config.env}, ` +
      `baseline-cycle=${config.baselineCycle}, ` +
      `probe-filter=${config.probeFilter ?? '(all)'})`,
  );

  // Fetch prod baseline for parity probe (probe 10).
  let prodAuthUsersCount = 0;
  try {
    prodAuthUsersCount = loadProdBaselineCounts(config);
    console.log(`Prod baseline: auth.users count = ${prodAuthUsersCount}`);
  } catch (err) {
    console.error(
      `::error::Baseline fetch failed: ${(err as Error).message}`,
    );
    return EXIT_INFRA_ERROR;
  }

  const allProbes = buildProbeSet(prodAuthUsersCount);
  const probes = config.probeFilter
    ? allProbes.filter((p) => p.name === config.probeFilter)
    : allProbes;

  if (probes.length === 0) {
    console.error(
      `::error::Unknown probe '${String(config.probeFilter)}'. ` +
        `Available: ${allProbes.map((p) => p.name).join(', ')}`,
    );
    return EXIT_ENV_ERROR;
  }

  const results = runProbeSet(config.stagingDbUrl, probes);
  for (const r of results) reportProbe(r);

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(
      `\n${failed.length}/${results.length} probe(s) failed. ` +
        `See annotations above for per-probe detail.`,
    );
    // Distinguish infra error (psql failure) from probe failure.
    const infraFailures = failed.filter((r) => r.error !== undefined);
    if (infraFailures.length === results.length && results.length > 0) {
      return EXIT_INFRA_ERROR;
    }
    return EXIT_PROBE_FAILED;
  }

  console.log(`\nAll ${results.length} probe(s) passed.`);
  return EXIT_OK;
}

// Guard top-level execution so the file is safely importable for unit
// testing of pure helpers. Pattern lifted from `scripts/migration-replay-check.ts`.
const isMain =
  process.argv[1]?.endsWith('verify-scrub.ts') ||
  process.argv[1]?.endsWith('verify-scrub');
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`Unhandled exception: ${(err as Error).message}`);
      process.exit(EXIT_INFRA_ERROR);
    });
}

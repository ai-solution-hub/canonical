#!/usr/bin/env bun
/**
 * Cutover row-count diff utility (WP-G3.5).
 *
 * Compares row counts of every public-schema table between a source and a
 * target Supabase project (defaults: source=prod, target=staging) and reports
 * any drift. Used at every prod release as a fail-fast detector for:
 *   - missed/orphaned data migrations
 *   - silent backfill failures
 *   - persistent-branch data-empty regressions (per
 *     feedback_supabase_branch_data_empty.md — staging branches start empty
 *     and must be populated separately from schema migrations)
 *
 * Modelled on `scripts/verify-user-profiles-parity.ts` (env-flag pattern,
 * service-role client init, exit-code conventions).
 *
 * **Environment variables required:**
 *   For each side (source, target) the script picks up the URL + service-role
 *   key from one of:
 *     - SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SERVICE_ROLE_KEY
 *     - TARGET_SUPABASE_URL / TARGET_SUPABASE_SERVICE_ROLE_KEY
 *   When the side flag is `prod` or `staging`, you may instead set:
 *     - PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY
 *     - STAGING_SUPABASE_URL / STAGING_SUPABASE_SERVICE_ROLE_KEY
 *   When ONE side resolves to the URL in NEXT_PUBLIC_SUPABASE_URL /
 *   SUPABASE_URL with SUPABASE_SERVICE_ROLE_KEY, those defaults are used as
 *   the last-resort fallback.
 *
 * **Usage:**
 *   bun run scripts/db-row-count-diff.ts                          # default prod→staging
 *   bun run scripts/db-row-count-diff.ts --source=prod --target=staging
 *   bun run scripts/db-row-count-diff.ts --source=staging --target=prod  # reverse
 *   bun run scripts/db-row-count-diff.ts --tables=content_items,user_roles
 *   bun run scripts/db-row-count-diff.ts --output-dir=/tmp/diff
 *
 * **Auto-inventory dependency:**
 *   When `--tables=...` is omitted, the script invokes RPC
 *   `public.list_public_tables()` (returns `setof text` of public-schema
 *   tablenames excluding partitions and views). If that RPC is missing, the
 *   script exits with EXIT_QUERY_FAILED and a hint to apply the migration
 *   that ships it. Operators can pass `--tables=<csv>` as a workaround until
 *   the RPC is live.
 *
 * **Allowlist:**
 *   `scripts/db-row-count-diff-allowlist.json` keyed by table name. Two value
 *   types are accepted per AC:
 *     "users": "expected-empty"   // staging may legitimately have 0 here
 *     "content_chunks": 5         // ±5 rows is acceptable drift
 *   A missing entry means "zero drift required".
 *
 * **Exit codes:**
 *   0  no drift OR all drift covered by allowlist
 *   1  out-of-allowlist drift (operator action required)
 *   2  query failure — probe could not run (RPC missing, network, etc.)
 *
 * **Outputs:**
 *   - stdout markdown table summarising per-table delta
 *   - JSON sidecar `db-row-count-diff-output-<ISO-timestamp>.json` written
 *     to `--output-dir` (default: cwd) for CI consumption
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Mirror of WP-G3.4 verify-user-profiles-parity.ts:49-50. */
const PROD_PROJECT_REF = 'rovrymhhffssilaftdwd';
const STAGING_PROJECT_REF = 'turayklvaunphgbgscat';

/** Exit codes per AC. */
export const EXIT_OK = 0;
export const EXIT_DRIFT = 1;
export const EXIT_QUERY_FAILED = 2;

/** Cap on parallel `count(*)` queries — Supabase rate-limit guard. */
const MAX_PARALLEL_COUNT_QUERIES = 10;

/** Default allowlist path (relative to scripts/). */
const DEFAULT_ALLOWLIST_PATH = path.join(
  __dirname,
  'db-row-count-diff-allowlist.json',
);

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

export type Side = 'prod' | 'staging';

export interface CliArgs {
  /** Source DB role — defaults to 'prod'. */
  source: Side;
  /** Target DB role — defaults to 'staging'. */
  target: Side;
  /** Optional explicit table list (csv). When null, auto-discover via RPC. */
  tables: string[] | null;
  /** Allowlist JSON path. */
  allowlistPath: string;
  /** Output dir for the JSON sidecar. */
  outputDir: string;
  /** Help requested. */
  help: boolean;
  /** Parse error, if any. */
  error: string | null;
}

const SIDE_VALUES = new Set<Side>(['prod', 'staging']);

function emptyArgs(): CliArgs {
  return {
    source: 'prod',
    target: 'staging',
    tables: null,
    allowlistPath: DEFAULT_ALLOWLIST_PATH,
    outputDir: process.cwd(),
    help: false,
    error: null,
  };
}

/** Parse argv; pure, exported for unit tests. */
export function parseCliArgs(argv: string[]): CliArgs {
  const out = emptyArgs();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else if (arg === '--source' && argv[i + 1] !== undefined) {
      const v = argv[i + 1];
      if (!SIDE_VALUES.has(v as Side)) {
        return {
          ...out,
          error: `--source must be 'prod' or 'staging', got '${v}'`,
        };
      }
      out.source = v as Side;
      i++;
    } else if (arg.startsWith('--source=')) {
      const v = arg.slice('--source='.length);
      if (!SIDE_VALUES.has(v as Side)) {
        return {
          ...out,
          error: `--source must be 'prod' or 'staging', got '${v}'`,
        };
      }
      out.source = v as Side;
    } else if (arg === '--target' && argv[i + 1] !== undefined) {
      const v = argv[i + 1];
      if (!SIDE_VALUES.has(v as Side)) {
        return {
          ...out,
          error: `--target must be 'prod' or 'staging', got '${v}'`,
        };
      }
      out.target = v as Side;
      i++;
    } else if (arg.startsWith('--target=')) {
      const v = arg.slice('--target='.length);
      if (!SIDE_VALUES.has(v as Side)) {
        return {
          ...out,
          error: `--target must be 'prod' or 'staging', got '${v}'`,
        };
      }
      out.target = v as Side;
    } else if (arg === '--tables' && argv[i + 1] !== undefined) {
      out.tables = parseTablesCsv(argv[i + 1]);
      i++;
    } else if (arg.startsWith('--tables=')) {
      out.tables = parseTablesCsv(arg.slice('--tables='.length));
    } else if (arg === '--allowlist' && argv[i + 1] !== undefined) {
      out.allowlistPath = argv[i + 1];
      i++;
    } else if (arg.startsWith('--allowlist=')) {
      out.allowlistPath = arg.slice('--allowlist='.length);
    } else if (arg === '--output-dir' && argv[i + 1] !== undefined) {
      out.outputDir = argv[i + 1];
      i++;
    } else if (arg.startsWith('--output-dir=')) {
      out.outputDir = arg.slice('--output-dir='.length);
    } else if (arg.startsWith('--')) {
      return {
        ...out,
        error: `unknown flag: ${arg}`,
      };
    }
  }

  if (out.help) {
    return out;
  }

  if (out.source === out.target) {
    return {
      ...out,
      error: `--source and --target must differ; both set to '${out.source}'`,
    };
  }

  if (out.tables && out.tables.length === 0) {
    return {
      ...out,
      error:
        '--tables provided but parsed to an empty list (check for stray commas)',
    };
  }

  return out;
}

function parseTablesCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

export type AllowlistValue = 'expected-empty' | number;

/** Parsed shape of `db-row-count-diff-allowlist.json`. */
export type Allowlist = Record<string, AllowlistValue>;

/**
 * Parses the allowlist JSON. Pure; exported for unit tests.
 *
 * Validates that every value is either the literal string 'expected-empty'
 * or a non-negative integer.
 */
export function parseAllowlist(raw: string): {
  allowlist: Allowlist;
  error: string | null;
} {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return {
      allowlist: {},
      error: `allowlist JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return {
      allowlist: {},
      error: 'allowlist must be a JSON object (got array or non-object)',
    };
  }
  const out: Allowlist = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v === 'expected-empty') {
      out[k] = 'expected-empty';
    } else if (typeof v === 'number' && Number.isInteger(v) && v >= 0) {
      out[k] = v;
    } else {
      return {
        allowlist: {},
        error: `allowlist['${k}'] must be 'expected-empty' or a non-negative integer, got ${JSON.stringify(v)}`,
      };
    }
  }
  return { allowlist: out, error: null };
}

/** Read+parse the allowlist file from disk. Returns empty allowlist if file missing. */
export function loadAllowlist(filePath: string): {
  allowlist: Allowlist;
  error: string | null;
} {
  if (!fs.existsSync(filePath)) {
    return { allowlist: {}, error: null };
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (raw.trim().length === 0) {
    return { allowlist: {}, error: null };
  }
  return parseAllowlist(raw);
}

// ---------------------------------------------------------------------------
// Diff logic
// ---------------------------------------------------------------------------

export type DiffStatus =
  | 'match'
  | 'within-allowlist'
  | 'expected-empty'
  | 'drift';

export interface RowCount {
  table: string;
  /** Source row count, or null if the table is missing on that side. */
  sourceCount: number | null;
  targetCount: number | null;
}

export interface DiffRow extends RowCount {
  /** target - source. */
  delta: number;
  /** Absolute delta (used for allowlist comparison). */
  absDelta: number;
  /** Resolution status. */
  status: DiffStatus;
  /** Allowlist value applied (or null if no entry / not applied). */
  allowlistApplied: AllowlistValue | null;
}

/**
 * Compute per-table diff results. Pure; exported for unit tests.
 *
 * Status mapping:
 *   - sourceCount === targetCount → 'match'
 *   - allowlist[table] === 'expected-empty' AND targetCount === 0 → 'expected-empty'
 *   - allowlist[table] is integer N AND |delta| ≤ N → 'within-allowlist'
 *   - otherwise → 'drift'
 *
 * Tables that are missing on one side (count === null) always report as
 * 'drift' — even within the allowlist — because a missing table is a
 * structural rather than data-volume issue.
 */
export function computeDiff(
  counts: RowCount[],
  allowlist: Allowlist,
): DiffRow[] {
  return counts.map((c) => {
    const allowlistApplied = allowlist[c.table] ?? null;

    // Missing on either side: always drift, even with allowlist entry.
    if (c.sourceCount === null || c.targetCount === null) {
      const delta = (c.targetCount ?? 0) - (c.sourceCount ?? 0);
      return {
        ...c,
        delta,
        absDelta: Math.abs(delta),
        status: 'drift' as DiffStatus,
        allowlistApplied,
      };
    }

    const delta = c.targetCount - c.sourceCount;
    const absDelta = Math.abs(delta);

    if (delta === 0) {
      return {
        ...c,
        delta,
        absDelta,
        status: 'match' as DiffStatus,
        allowlistApplied,
      };
    }

    if (allowlistApplied === 'expected-empty' && c.targetCount === 0) {
      return {
        ...c,
        delta,
        absDelta,
        status: 'expected-empty' as DiffStatus,
        allowlistApplied,
      };
    }

    if (typeof allowlistApplied === 'number' && absDelta <= allowlistApplied) {
      return {
        ...c,
        delta,
        absDelta,
        status: 'within-allowlist' as DiffStatus,
        allowlistApplied,
      };
    }

    return {
      ...c,
      delta,
      absDelta,
      status: 'drift' as DiffStatus,
      allowlistApplied,
    };
  });
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

export interface DiffSummary {
  matched: number;
  expectedEmpty: number;
  withinAllowlist: number;
  drifted: number;
  totalTables: number;
}

export function summariseDiff(rows: DiffRow[]): DiffSummary {
  const summary: DiffSummary = {
    matched: 0,
    expectedEmpty: 0,
    withinAllowlist: 0,
    drifted: 0,
    totalTables: rows.length,
  };
  for (const r of rows) {
    if (r.status === 'match') summary.matched++;
    else if (r.status === 'expected-empty') summary.expectedEmpty++;
    else if (r.status === 'within-allowlist') summary.withinAllowlist++;
    else summary.drifted++;
  }
  return summary;
}

const STATUS_GLYPH: Record<DiffStatus, string> = {
  match: 'OK',
  'expected-empty': 'EXPECTED-EMPTY',
  'within-allowlist': 'ALLOWLIST',
  drift: 'DRIFT',
};

/** Render a markdown table for stdout. Pure; exported for unit tests. */
export function renderMarkdown(
  rows: DiffRow[],
  source: Side,
  target: Side,
): string {
  const summary = summariseDiff(rows);
  const header = [
    `# DB row-count diff: ${source} → ${target}`,
    '',
    `Total tables: ${summary.totalTables}  ` +
      `Matched: ${summary.matched}  ` +
      `Expected-empty: ${summary.expectedEmpty}  ` +
      `Within allowlist: ${summary.withinAllowlist}  ` +
      `**Drifted: ${summary.drifted}**`,
    '',
    `| Table | ${source} count | ${target} count | Delta | Status | Allowlist |`,
    '| --- | ---: | ---: | ---: | --- | --- |',
  ];

  // Sort: drifted first (by absDelta desc), then within-allowlist, then expected-empty, then matched.
  const statusOrder: Record<DiffStatus, number> = {
    drift: 0,
    'within-allowlist': 1,
    'expected-empty': 2,
    match: 3,
  };
  const sorted = [...rows].sort((a, b) => {
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    if (a.absDelta !== b.absDelta) return b.absDelta - a.absDelta;
    return a.table.localeCompare(b.table);
  });

  const body = sorted.map((r) => {
    const sCount = r.sourceCount === null ? 'MISSING' : String(r.sourceCount);
    const tCount = r.targetCount === null ? 'MISSING' : String(r.targetCount);
    const deltaStr =
      r.sourceCount === null || r.targetCount === null
        ? '—'
        : (r.delta > 0 ? '+' : '') + r.delta.toString();
    const allowlistStr =
      r.allowlistApplied === null
        ? '—'
        : r.allowlistApplied === 'expected-empty'
          ? 'expected-empty'
          : `±${r.allowlistApplied}`;
    return `| \`${r.table}\` | ${sCount} | ${tCount} | ${deltaStr} | ${STATUS_GLYPH[r.status]} | ${allowlistStr} |`;
  });

  return [...header, ...body, ''].join('\n');
}

export interface JsonSidecar {
  generatedAt: string;
  source: Side;
  target: Side;
  sourceUrl: string;
  targetUrl: string;
  summary: DiffSummary;
  rows: DiffRow[];
}

/** Build the JSON sidecar payload. Pure; exported for unit tests. */
export function buildJsonSidecar(args: {
  rows: DiffRow[];
  source: Side;
  target: Side;
  sourceUrl: string;
  targetUrl: string;
  generatedAt?: string;
}): JsonSidecar {
  return {
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    source: args.source,
    target: args.target,
    sourceUrl: args.sourceUrl,
    targetUrl: args.targetUrl,
    summary: summariseDiff(args.rows),
    rows: args.rows,
  };
}

/** Compose the sidecar filename. Pure; exported for unit tests. */
export function sidecarFilename(generatedAt: string): string {
  // Replace ':' (illegal on Windows) and '.' with '-' to keep cross-platform safety.
  const safe = generatedAt.replace(/[:.]/g, '-');
  return `db-row-count-diff-output-${safe}.json`;
}

// ---------------------------------------------------------------------------
// Env loading (mirrors verify-user-profiles-parity.ts:61-89)
// ---------------------------------------------------------------------------

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

/**
 * Resolve the (URL, service-role key) pair for a given side.
 *
 * Lookup order, by side:
 *   1. SOURCE_*  / TARGET_*  (side-specific)
 *   2. PROD_*    / STAGING_* (role-specific)
 *   3. NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *      — used as last-resort default when its project ref matches the side.
 */
export function resolveCredentials(
  side: Side,
  whichSlot: 'source' | 'target',
  env: Record<string, string | undefined> = process.env,
): { url: string | null; key: string | null } {
  const slotPrefix = whichSlot.toUpperCase(); // SOURCE | TARGET
  const slotUrl = env[`${slotPrefix}_SUPABASE_URL`];
  const slotKey = env[`${slotPrefix}_SUPABASE_SERVICE_ROLE_KEY`];
  if (slotUrl && slotKey) return { url: slotUrl, key: slotKey };

  const rolePrefix = side.toUpperCase(); // PROD | STAGING
  const roleUrl = env[`${rolePrefix}_SUPABASE_URL`];
  const roleKey = env[`${rolePrefix}_SUPABASE_SERVICE_ROLE_KEY`];
  if (roleUrl && roleKey) return { url: roleUrl, key: roleKey };

  const fallbackUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? null;
  const fallbackKey = env.SUPABASE_SERVICE_ROLE_KEY ?? null;
  if (fallbackUrl && fallbackKey) {
    const expectedRef =
      side === 'prod' ? PROD_PROJECT_REF : STAGING_PROJECT_REF;
    if (fallbackUrl.includes(expectedRef)) {
      return { url: fallbackUrl, key: fallbackKey };
    }
  }

  return { url: null, key: null };
}

// ---------------------------------------------------------------------------
// Live DB calls (thin wrappers, mocked at test time)
// ---------------------------------------------------------------------------

/**
 * Subset of the Supabase client shape we use. We type as `SupabaseClient`
 * directly here; tests cast their mocks via `as unknown as SupabaseClient`
 * (matching the `scripts/export-user-data.ts` precedent).
 */
type SimpleSupabaseClient = SupabaseClient;

/**
 * Auto-discover the public-table inventory by calling RPC
 * `list_public_tables()`. Returns the table names sorted alphabetically.
 *
 * This RPC must be present in the project schema. If missing, throws — the
 * caller maps the throw to EXIT_QUERY_FAILED with a hint to apply the
 * migration shipping the RPC.
 */
export async function fetchTableInventory(
  client: SimpleSupabaseClient,
): Promise<string[]> {
  const { data, error } = await client.rpc('list_public_tables');
  if (error) {
    throw new Error(
      `RPC list_public_tables() failed: ${error.message ?? String(error)}. ` +
        `Either apply the migration that ships the RPC or pass --tables=<csv>.`,
    );
  }
  if (!Array.isArray(data)) {
    throw new Error(
      `RPC list_public_tables() returned non-array: ${JSON.stringify(data)}`,
    );
  }
  // Coerce; accept rows of {tablename: string} or plain strings.
  const names = data
    .map((row: unknown) => {
      if (typeof row === 'string') return row;
      if (
        row !== null &&
        typeof row === 'object' &&
        'tablename' in row &&
        typeof (row as { tablename: unknown }).tablename === 'string'
      ) {
        return (row as { tablename: string }).tablename;
      }
      return null;
    })
    .filter((s): s is string => s !== null && s.length > 0);
  return [...new Set(names)].sort();
}

/** Count rows in a single table. Used by countAllTables (which throttles). */
export async function countOneTable(
  client: SimpleSupabaseClient,
  table: string,
): Promise<number | null> {
  const { count, error } = await client
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) {
    // Postgres relation-not-found
    if ((error as { code?: string }).code === '42P01') {
      return null;
    }
    throw new Error(
      `count(*) FROM ${table} failed: ${error.message ?? String(error)}`,
    );
  }
  return count ?? 0;
}

/**
 * Count rows in every named table on the given client, capped at
 * MAX_PARALLEL_COUNT_QUERIES concurrent queries to stay friendly with
 * Supabase's REST rate limit. Returns one entry per input table; entries
 * for missing tables have count === null.
 *
 * Exported for unit tests that mock SimpleSupabaseClient.
 */
export async function countAllTables(
  client: SimpleSupabaseClient,
  tables: string[],
  maxParallel = MAX_PARALLEL_COUNT_QUERIES,
): Promise<Array<{ table: string; count: number | null }>> {
  const results: Array<{ table: string; count: number | null }> = [];
  for (let i = 0; i < tables.length; i += maxParallel) {
    const batch = tables.slice(i, i + maxParallel);
    const batchResults = await Promise.all(
      batch.map(async (t) => ({
        table: t,
        count: await countOneTable(client, t),
      })),
    );
    results.push(...batchResults);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const HELP_TEXT = `
DB row-count diff utility (WP-G3.5)

Usage:
  bun run scripts/db-row-count-diff.ts [options]

Options:
  --source=prod|staging      Source DB (default: prod)
  --target=prod|staging      Target DB (default: staging)
  --tables=A,B,C             Explicit table list (CSV); skips RPC inventory
  --allowlist=<path>         Allowlist JSON path (default: scripts/db-row-count-diff-allowlist.json)
  --output-dir=<dir>         Output dir for JSON sidecar (default: cwd)
  -h, --help                 Show this help

Exit codes:
  0  no drift OR all drift covered by allowlist
  1  out-of-allowlist drift
  2  query failure (missing RPC, network error, missing env vars)

Environment variables (each side):
  SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SERVICE_ROLE_KEY
  TARGET_SUPABASE_URL / TARGET_SUPABASE_SERVICE_ROLE_KEY
  …or PROD_*/STAGING_* equivalents,
  …or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (fallback,
     ref-matched against the requested side).
`.trim();

async function main(args: CliArgs): Promise<number> {
  if (args.help) {
    console.log(HELP_TEXT);
    return EXIT_OK;
  }
  if (args.error) {
    console.error(`db-row-count-diff: ${args.error}`);
    return EXIT_QUERY_FAILED;
  }

  // Resolve creds for both sides.
  const sourceCreds = resolveCredentials(args.source, 'source');
  const targetCreds = resolveCredentials(args.target, 'target');
  if (!sourceCreds.url || !sourceCreds.key) {
    console.error(
      `db-row-count-diff: missing source (${args.source}) Supabase URL/service-role key.\n` +
        `Set SOURCE_SUPABASE_URL/SOURCE_SUPABASE_SERVICE_ROLE_KEY or ${args.source.toUpperCase()}_SUPABASE_URL/_SERVICE_ROLE_KEY.`,
    );
    return EXIT_QUERY_FAILED;
  }
  if (!targetCreds.url || !targetCreds.key) {
    console.error(
      `db-row-count-diff: missing target (${args.target}) Supabase URL/service-role key.\n` +
        `Set TARGET_SUPABASE_URL/TARGET_SUPABASE_SERVICE_ROLE_KEY or ${args.target.toUpperCase()}_SUPABASE_URL/_SERVICE_ROLE_KEY.`,
    );
    return EXIT_QUERY_FAILED;
  }

  // Defensive ref assertion.
  if (args.source === 'prod' && !sourceCreds.url.includes(PROD_PROJECT_REF)) {
    console.error(
      `db-row-count-diff: --source=prod but URL does not include '${PROD_PROJECT_REF}'.`,
    );
    return EXIT_QUERY_FAILED;
  }
  if (
    args.source === 'staging' &&
    !sourceCreds.url.includes(STAGING_PROJECT_REF)
  ) {
    console.error(
      `db-row-count-diff: --source=staging but URL does not include '${STAGING_PROJECT_REF}'.`,
    );
    return EXIT_QUERY_FAILED;
  }
  if (args.target === 'prod' && !targetCreds.url.includes(PROD_PROJECT_REF)) {
    console.error(
      `db-row-count-diff: --target=prod but URL does not include '${PROD_PROJECT_REF}'.`,
    );
    return EXIT_QUERY_FAILED;
  }
  if (
    args.target === 'staging' &&
    !targetCreds.url.includes(STAGING_PROJECT_REF)
  ) {
    console.error(
      `db-row-count-diff: --target=staging but URL does not include '${STAGING_PROJECT_REF}'.`,
    );
    return EXIT_QUERY_FAILED;
  }

  const sourceClient = createScriptClient(sourceCreds.url, sourceCreds.key, {
    db: { schema: 'public' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const targetClient = createScriptClient(targetCreds.url, targetCreds.key, {
    db: { schema: 'public' },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve allowlist.
  const { allowlist, error: allowlistErr } = loadAllowlist(args.allowlistPath);
  if (allowlistErr) {
    console.error(`db-row-count-diff: ${allowlistErr}`);
    return EXIT_QUERY_FAILED;
  }

  // Resolve table inventory.
  let tables = args.tables;
  if (!tables) {
    try {
      tables = await fetchTableInventory(sourceClient);
    } catch (err) {
      console.error(
        `db-row-count-diff: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EXIT_QUERY_FAILED;
    }
  }

  if (tables.length === 0) {
    console.error('db-row-count-diff: no tables resolved (empty inventory).');
    return EXIT_QUERY_FAILED;
  }

  // Count both sides in parallel-batched mode.
  console.error(
    `db-row-count-diff: counting ${tables.length} table(s) on ${args.source} and ${args.target}…`,
  );
  let sourceCounts: Array<{ table: string; count: number | null }>;
  let targetCounts: Array<{ table: string; count: number | null }>;
  try {
    [sourceCounts, targetCounts] = await Promise.all([
      countAllTables(sourceClient, tables),
      countAllTables(targetClient, tables),
    ]);
  } catch (err) {
    console.error(
      `db-row-count-diff: count failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    return EXIT_QUERY_FAILED;
  }

  // Stitch into RowCount[].
  const targetByTable = new Map(targetCounts.map((c) => [c.table, c.count]));
  const counts: RowCount[] = sourceCounts.map((c) => ({
    table: c.table,
    sourceCount: c.count,
    targetCount: targetByTable.get(c.table) ?? null,
  }));

  // Diff + report.
  const rows = computeDiff(counts, allowlist);
  const markdown = renderMarkdown(rows, args.source, args.target);
  console.log(markdown);

  const generatedAt = new Date().toISOString();
  const sidecar = buildJsonSidecar({
    rows,
    source: args.source,
    target: args.target,
    sourceUrl: sourceCreds.url,
    targetUrl: targetCreds.url,
    generatedAt,
  });
  const sidecarPath = path.join(args.outputDir, sidecarFilename(generatedAt));
  try {
    fs.mkdirSync(args.outputDir, { recursive: true });
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), 'utf-8');
    console.error(`db-row-count-diff: wrote sidecar → ${sidecarPath}`);
  } catch (err) {
    console.error(
      `db-row-count-diff: failed to write JSON sidecar to ${sidecarPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EXIT_QUERY_FAILED;
  }

  const summary = sidecar.summary;
  return summary.drifted === 0 ? EXIT_OK : EXIT_DRIFT;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

if (import.meta.main) {
  loadEnv();
  const args = parseCliArgs(process.argv.slice(2));
  main(args)
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(
        'db-row-count-diff: fatal:',
        err instanceof Error ? err.message : String(err),
      );
      process.exit(EXIT_QUERY_FAILED);
    });
}

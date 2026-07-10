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
 * **Mechanism (ID-143.1 — S459 owner-ratified):** the Supabase Management
 * API's read-only query endpoint —
 * `POST /v1/projects/{ref}/database/query/read-only` — executed as the
 * least-privilege `supabase_read_only_user` via a `SUPABASE_ACCESS_TOKEN`
 * PAT. This replaced a PostgREST-based approach (`supabase-js` `.from()` /
 * `.rpc()`) that broke after ID-115 unexposed the `public` schema from the
 * Data API: the script must count EVERY public base table, including the
 * ~10 INTERNAL_ONLY_TABLES with no `api.*` view, so re-pointing at `api`
 * views could never cover it — the counting leg needs a mechanism that sees
 * `public` directly. Pattern lifted from `scripts/run-supabase-advisors.ts`
 * / the retired `scripts/check-revoke-guard.ts` (direct `fetch()` + Bearer
 * PAT, no `supabase-js`; Bun 204-hang gotcha).
 *
 * Beta-endpoint caveats encoded here:
 *   - 429 responses are retried with linear backoff (`runManagementQuery`).
 *   - every entity reference in a query sent to the endpoint is
 *     schema-qualified (`pg_catalog.pg_tables`, `public."<table>"`) — the
 *     endpoint has no PostgREST-style schema-exposure notion, so an
 *     unqualified name would resolve against an unspecified search_path.
 *   - table names are validated against a plain-identifier allowlist
 *     (`assertSafeTableIdentifier`) before being interpolated into SQL,
 *     since they are schema-qualified by string concatenation, not a
 *     parameterised query (the Management API query endpoint has no bind
 *     parameters).
 *
 * **Environment variables required:**
 *   - `SUPABASE_ACCESS_TOKEN` — Management API PAT (shared by both sides).
 *   - Project refs per side, resolved via `scripts/lib/project-refs.ts`
 *     (`--env`-flag conventions): `source`/`target` of `prod` maps to
 *     `PROD_PROJECT_REF`, `staging` maps to `STAGING_PROJECT_REF`. Refs are
 *     runtime-only — never hardcoded in committed source.
 *
 * **Usage:**
 *   bun run scripts/db-row-count-diff.ts                          # default prod→staging
 *   bun run scripts/db-row-count-diff.ts --source=prod --target=staging
 *   bun run scripts/db-row-count-diff.ts --source=staging --target=prod  # reverse
 *   bun run scripts/db-row-count-diff.ts --tables=content_items,user_roles
 *   bun run scripts/db-row-count-diff.ts --output-dir=/tmp/diff
 *
 * **Auto-inventory dependency:**
 *   When `--tables=...` is omitted, the script queries
 *   `pg_catalog.pg_tables` on the source side for every `public` base table
 *   whose name does not start with `_` (mirrors the retired
 *   `public.list_public_tables()` RPC's filter — kept for continuity, not
 *   because the RPC is still reachable: `supabase_read_only_user` has no
 *   EXECUTE grant on it, confirmed empirically against the endpoint).
 *   Operators can pass `--tables=<csv>` as a workaround if the inventory
 *   query fails.
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
 *   2  query failure — probe could not run (missing token/ref, network, etc.)
 *
 * **Outputs:**
 *   - stdout markdown table summarising per-table delta
 *   - JSON sidecar `db-row-count-diff-output-<ISO-timestamp>.json` written
 *     to `--output-dir` (default: cwd) for CI consumption
 */

import { prodProjectRef, stagingProjectRef } from '@/scripts/lib/project-refs';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Exit codes per AC. */
export const EXIT_OK = 0;
export const EXIT_DRIFT = 1;
export const EXIT_QUERY_FAILED = 2;

/**
 * Cap on parallel Management API count queries per side — Beta-endpoint
 * rate-limit guard. Lower than the old PostgREST count-query cap since the
 * Management API's rate limit is materially tighter (journal 143.1 caveat);
 * combined with `runManagementQuery`'s own 429 retry/backoff.
 */
const MAX_PARALLEL_MANAGEMENT_QUERIES = 5;

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
  /** Optional explicit table list (csv). When null, auto-discover via query. */
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
  sourceRef: string;
  targetRef: string;
  summary: DiffSummary;
  rows: DiffRow[];
}

/** Build the JSON sidecar payload. Pure; exported for unit tests. */
export function buildJsonSidecar(args: {
  rows: DiffRow[];
  source: Side;
  target: Side;
  sourceRef: string;
  targetRef: string;
  generatedAt?: string;
}): JsonSidecar {
  return {
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    source: args.source,
    target: args.target,
    sourceRef: args.sourceRef,
    targetRef: args.targetRef,
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
 * Resolve the Supabase project ref for a given side, per
 * `scripts/lib/project-refs.ts` conventions: `prod` → `PROD_PROJECT_REF`,
 * `staging` → `STAGING_PROJECT_REF`. Refs are runtime-only (never hardcoded
 * in committed source) — the underlying getters throw a fail-loud error if
 * the env var is unset.
 */
export function resolveProjectRef(side: Side): string {
  return side === 'prod' ? prodProjectRef() : stagingProjectRef();
}

// ---------------------------------------------------------------------------
// Supabase Management API (read-only query endpoint)
// ---------------------------------------------------------------------------

const MANAGEMENT_API_BASE = 'https://api.supabase.com/v1';

export class ManagementApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagementApiError';
  }
}

/** Bounded-retry tuning for Management API 429s (Beta-endpoint rate limit). */
export interface ManagementApiRetryOptions {
  /** Total attempts including the first (default 5). */
  attempts: number;
  /** Base backoff in ms; wait = backoffMs * attempt (linear). Default 1000. */
  backoffMs: number;
  /** Sleep seam — overridden in tests to avoid real waits. */
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_MANAGEMENT_API_RETRY: ManagementApiRetryOptions = {
  attempts: 5,
  backoffMs: 1000,
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface ManagementQueryOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to DEFAULT_MANAGEMENT_API_RETRY. */
  retry?: Partial<ManagementApiRetryOptions>;
}

/**
 * Run one read-only SQL statement against a project via the Supabase
 * Management API's read-only query endpoint (executes as
 * `supabase_read_only_user` — least-privilege; no service-role key or
 * DB-password secret required beyond the PAT). Beta endpoint: 429
 * responses are retried with linear backoff before throwing.
 *
 * Callers MUST schema-qualify every entity reference in `sql` — unlike
 * PostgREST, this endpoint has no schema-exposure allowlist, but an
 * unqualified name still resolves against an unspecified connection
 * search_path, so qualification is the only way to pin the target schema.
 */
export async function runManagementQuery(
  ref: string,
  token: string,
  sql: string,
  options: ManagementQueryOptions = {},
): Promise<unknown[]> {
  const f = options.fetchImpl ?? fetch;
  const retry: ManagementApiRetryOptions = {
    ...DEFAULT_MANAGEMENT_API_RETRY,
    ...options.retry,
  };
  const attempts = Math.max(1, retry.attempts);
  const url = `${MANAGEMENT_API_BASE}/projects/${ref}/database/query/read-only`;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await f(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    });

    if (res.status === 429) {
      const body = await res.text();
      if (attempt < attempts) {
        await retry.sleep(retry.backoffMs * attempt);
        continue;
      }
      throw new ManagementApiError(
        `Management API POST /database/query/read-only rate-limited (429) ` +
          `for ${ref} after ${attempts} attempt(s): ${body.slice(0, 300)}`,
      );
    }

    if (!res.ok) {
      const body = await res.text();
      throw new ManagementApiError(
        `Management API POST /database/query/read-only failed for ${ref}: ` +
          `HTTP ${res.status} — ${body.slice(0, 500)}`,
      );
    }

    const json = await res.json();
    if (!Array.isArray(json)) {
      throw new ManagementApiError(
        `Management API POST /database/query/read-only returned a ` +
          `non-array payload for ${ref}: ${JSON.stringify(json).slice(0, 200)}`,
      );
    }
    return json;
  }
  // Unreachable — the loop above always returns or throws.
  throw new ManagementApiError(
    `Management API query exhausted retries for ${ref} with no result.`,
  );
}

const SAFE_TABLE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Guard against building unsafe SQL from a table name. Every count(*) query
 * interpolates `table` directly into a schema-qualified `public."<table>"`
 * reference (the Management API query endpoint has no bind parameters), so
 * a name must be a plain SQL identifier — no quotes, whitespace, or
 * statement-terminating characters.
 */
export function assertSafeTableIdentifier(table: string): void {
  if (!SAFE_TABLE_IDENTIFIER_RE.test(table)) {
    throw new Error(
      `db-row-count-diff: unsafe table identifier '${table}' — expected to ` +
        `match ${SAFE_TABLE_IDENTIFIER_RE}.`,
    );
  }
}

/**
 * Auto-discover the public-table inventory via the Management API read-only
 * query endpoint, querying `pg_catalog.pg_tables` directly. Mirrors the
 * retired `public.list_public_tables()` RPC's filter (every `public` base
 * table excluding leading-underscore helpers, e.g. `_backup_*`, `_test_*`)
 * for continuity — NOT by calling that RPC, which `supabase_read_only_user`
 * cannot execute (confirmed empirically: permission denied). Reading the
 * catalog directly also means this surfaces the ~10 INTERNAL_ONLY_TABLES
 * that have no `api.*` view (ID-115 posture), which a PostgREST-routed call
 * could never see.
 */
export async function fetchTableInventory(
  ref: string,
  token: string,
  options: ManagementQueryOptions = {},
): Promise<string[]> {
  const sql =
    'SELECT tablename::text AS tablename FROM pg_catalog.pg_tables ' +
    "WHERE schemaname = 'public' " +
    "AND tablename NOT LIKE E'\\\\_%' ESCAPE E'\\\\' " +
    'ORDER BY tablename;';

  let rows: unknown[];
  try {
    rows = await runManagementQuery(ref, token, sql, options);
  } catch (err) {
    throw new Error(
      `public-table inventory query failed: ` +
        `${err instanceof Error ? err.message : String(err)}. ` +
        `Pass --tables=<csv> as a workaround.`,
    );
  }

  const names = rows
    .map((row: unknown) => {
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
  ref: string,
  token: string,
  table: string,
  options: ManagementQueryOptions = {},
): Promise<number | null> {
  assertSafeTableIdentifier(table);
  const sql = `SELECT count(*) AS count FROM public."${table}";`;
  try {
    const rows = await runManagementQuery(ref, token, sql, options);
    const row = rows[0] as Record<string, unknown> | undefined;
    const raw = row?.count;
    const n =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number(raw)
          : NaN;
    if (!Number.isFinite(n)) {
      throw new Error(
        `count(*) FROM public.${table} returned an unexpected shape: ${JSON.stringify(row)}`,
      );
    }
    return n;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Postgres relation-not-found (42P01), surfaced via the Management
    // API's error body text (empirically confirmed shape: `"...ERROR:
    // 42P01: relation \"public.x\" does not exist..."`).
    if (/42P01/.test(message) || /does not exist/i.test(message)) {
      return null;
    }
    throw new Error(`count(*) FROM public.${table} failed: ${message}`);
  }
}

export interface CountAllTablesOptions extends ManagementQueryOptions {
  /** Cap on parallel in-flight count queries (default: MAX_PARALLEL_MANAGEMENT_QUERIES). */
  maxParallel?: number;
}

/**
 * Count rows in every named table on the given project ref, capped at
 * `maxParallel` concurrent Management API queries to stay within the Beta
 * endpoint's rate limit. Returns one entry per input table; entries for
 * missing tables have count === null.
 *
 * Exported for unit tests that mock the `fetchImpl` seam.
 */
export async function countAllTables(
  ref: string,
  token: string,
  tables: string[],
  options: CountAllTablesOptions = {},
): Promise<Array<{ table: string; count: number | null }>> {
  const maxParallel = options.maxParallel ?? MAX_PARALLEL_MANAGEMENT_QUERIES;
  const results: Array<{ table: string; count: number | null }> = [];
  for (let i = 0; i < tables.length; i += maxParallel) {
    const batch = tables.slice(i, i + maxParallel);
    const batchResults = await Promise.all(
      batch.map(async (t) => ({
        table: t,
        count: await countOneTable(ref, token, t, options),
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
  --tables=A,B,C             Explicit table list (CSV); skips inventory query
  --allowlist=<path>         Allowlist JSON path (default: scripts/db-row-count-diff-allowlist.json)
  --output-dir=<dir>         Output dir for JSON sidecar (default: cwd)
  -h, --help                 Show this help

Exit codes:
  0  no drift OR all drift covered by allowlist
  1  out-of-allowlist drift
  2  query failure (missing token/ref, network error, missing env vars)

Environment variables:
  SUPABASE_ACCESS_TOKEN   Supabase Management API PAT (shared by both sides)
  PROD_PROJECT_REF        Project ref used when a side resolves to 'prod'
  STAGING_PROJECT_REF     Project ref used when a side resolves to 'staging'
  (see scripts/lib/project-refs.ts for the full resolution contract)
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

  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    console.error(
      'db-row-count-diff: missing SUPABASE_ACCESS_TOKEN (Supabase Management ' +
        'API PAT). Set it in .env.local or export it before running.',
    );
    return EXIT_QUERY_FAILED;
  }

  let sourceRef: string;
  let targetRef: string;
  try {
    sourceRef = resolveProjectRef(args.source);
    targetRef = resolveProjectRef(args.target);
  } catch (err) {
    console.error(
      `db-row-count-diff: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EXIT_QUERY_FAILED;
  }

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
      tables = await fetchTableInventory(sourceRef, accessToken);
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
    `db-row-count-diff: counting ${tables.length} table(s) on ` +
      `${args.source} (${sourceRef}) and ${args.target} (${targetRef})…`,
  );
  let sourceCounts: Array<{ table: string; count: number | null }>;
  let targetCounts: Array<{ table: string; count: number | null }>;
  try {
    [sourceCounts, targetCounts] = await Promise.all([
      countAllTables(sourceRef, accessToken, tables),
      countAllTables(targetRef, accessToken, tables),
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
    sourceRef,
    targetRef,
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

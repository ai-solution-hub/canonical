/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — Standalone Bun script, not part of Next.js build
/**
 * WP-B Phase 0a — Provenance triage CSV emitter
 *
 * Reads `content_items` rows where `metadata.ingestion_source` is NULL and
 * writes a CSV (one row per content_item) for Liam/client to review row-by-row.
 * The reviewed CSV is the input to Phase 0c (`scripts/wp-b-apply-triage.ts`,
 * future session) which writes the reviewed `metadata.ingestion_source` back
 * to the DB via targeted SQL UPDATE.
 *
 * Read-only — never writes to `content_items`. Re-runnable any number of times;
 * the candidate list shrinks as Phase 0c attributions land. Once Phase 0c has
 * processed the full triage, the candidate list should be empty (or near-empty
 * if some rows are intentionally flagged "no provenance recorded").
 *
 * Source-of-truth: column order locked per
 * `docs/specs/ai-telemetry-instrumentation-spec.md` §6.7.
 *
 * Usage:
 *   bun run scripts/wp-b-triage-report.ts
 *   bun run scripts/wp-b-triage-report.ts --limit 50
 *   bun run scripts/wp-b-triage-report.ts --output /tmp/triage.csv
 *   SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> \
 *     bun run scripts/wp-b-triage-report.ts --env=prod
 *
 * Default target is staging per CLAUDE.md staging-default convention. Pass
 * `--env=prod` AND set `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` to the
 * prod project explicitly to target prod r.
 *
 * Phase 1 of the standard backfill (§6.1 + §6.4) is BLOCKED until Liam/client
 * fills in the reviewed CSV and Phase 0c lands. Do not bypass.
 *
 * Exit codes:
 *   0 — Ran to completion (CSV written, even if 0 rows)
 *   1 — Fatal error (missing env, --env=prod mismatch, DB unreachable, etc.)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Project ref for prod r — matches `backfill-classify-content-items.ts`. */
export const PROD_PROJECT_REF = 'rovrymhhffssilaftdwd';

/** Project ref for the persistent staging branch. */
export const STAGING_PROJECT_REF = 'turayklvaunphgbgscat';

/**
 * CSV column order — locked per spec §6.7. Phase 0c parses this exact order
 * and the CSV header MUST match (case-sensitive). Do not reorder, rename,
 * or add columns without spec amendment.
 */
export const CSV_COLUMNS = [
  'id',
  'title',
  'source_url',
  'source_file',
  'created_by',
  'created_at',
  'current_classification_model',
  'current_embedding_model',
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

export interface CliArgs {
  /** Output path — defaults to scripts/output/wp-b-provenance-triage-{date}.csv. */
  output: string;
  /** Row cap. `null` means unlimited (per spec §6.7 — full prod set ~583 rows). */
  limit: number | null;
  /** Env target — `staging` (default) or `prod`. */
  env: 'staging' | 'prod';
  /** If set, parseArgs collected an error message instead of valid args. */
  error: string | null;
}

/** ISO date string (YYYY-MM-DD) for default output path naming. */
export function todayIsoDate(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Default output path for a given run date. */
export function defaultOutputPath(now: Date = new Date()): string {
  return `scripts/output/wp-b-provenance-triage-${todayIsoDate(now)}.csv`;
}

export function parseArgs(argv: string[], now: Date = new Date()): CliArgs {
  let output: string | null = null;
  let limit: number | null = null;
  let env: 'staging' | 'prod' = 'staging';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output' && argv[i + 1]) {
      output = argv[i + 1];
      i++;
    } else if (arg.startsWith('--output=')) {
      output = arg.slice('--output='.length);
    } else if (arg === '--limit' && argv[i + 1]) {
      const parsed = parseInt(argv[i + 1], 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        return {
          output: output ?? defaultOutputPath(now),
          limit,
          env,
          error: `--limit must be a positive integer, got "${argv[i + 1]}"`,
        };
      }
      limit = parsed;
      i++;
    } else if (arg.startsWith('--limit=')) {
      const raw = arg.slice('--limit='.length);
      const parsed = parseInt(raw, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        return {
          output: output ?? defaultOutputPath(now),
          limit,
          env,
          error: `--limit must be a positive integer, got "${raw}"`,
        };
      }
      limit = parsed;
    } else if (arg === '--env' && argv[i + 1]) {
      const raw = argv[i + 1];
      if (raw !== 'staging' && raw !== 'prod') {
        return {
          output: output ?? defaultOutputPath(now),
          limit,
          env,
          error: `--env must be 'staging' or 'prod', got "${raw}"`,
        };
      }
      env = raw;
      i++;
    } else if (arg.startsWith('--env=')) {
      const raw = arg.slice('--env='.length);
      if (raw !== 'staging' && raw !== 'prod') {
        return {
          output: output ?? defaultOutputPath(now),
          limit,
          env,
          error: `--env must be 'staging' or 'prod', got "${raw}"`,
        };
      }
      env = raw;
    }
  }

  return {
    output: output ?? defaultOutputPath(now),
    limit,
    env,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// --env=prod opt-in guard (mirrors backfill-classify-content-items.ts)
// ---------------------------------------------------------------------------

export function assertEnvFlag(
  env: 'staging' | 'prod',
  url: string | undefined,
): void {
  if (env === 'prod' && !(url ?? '').includes(PROD_PROJECT_REF)) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${PROD_PROJECT_REF}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/wp-b-triage-report.ts --env=prod`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Candidate row shape (exported for testing)
// ---------------------------------------------------------------------------

export interface TriageRow {
  id: string;
  title: string | null;
  source_url: string | null;
  source_file: string | null;
  created_by: string | null;
  created_at: string;
  current_classification_model: string | null;
  current_embedding_model: string | null;
}

/**
 * Pulls `content_items` rows with NULL `metadata.ingestion_source`,
 * sorted by `created_at ASC` (oldest first per spec §6.7).
 *
 * Pure data access — exported so tests can mock the supabase client.
 */
export async function findNullProvenanceRows(
  supabase: SupabaseClient,
  limit: number | null,
): Promise<TriageRow[]> {
  let query = supabase
    .from('content_items')
    .select(
      'id, title, source_url, source_file, created_by, created_at, classification_model, embedding_model',
    )
    .filter('metadata->>ingestion_source', 'is', null)
    .order('created_at', { ascending: true });

  if (limit !== null) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to query content_items: ${error.message}`);
  }

  return (data ?? []).map(
    (r: {
      id: string;
      title: string | null;
      source_url: string | null;
      source_file: string | null;
      created_by: string | null;
      created_at: string;
      classification_model: string | null;
      embedding_model: string | null;
    }) => ({
      id: r.id,
      title: r.title,
      source_url: r.source_url,
      source_file: r.source_file,
      created_by: r.created_by,
      created_at: r.created_at,
      current_classification_model: r.classification_model,
      current_embedding_model: r.embedding_model,
    }),
  );
}

// ---------------------------------------------------------------------------
// CSV emission
// ---------------------------------------------------------------------------

/**
 * Escape a single CSV cell per RFC 4180:
 *   - NULL / undefined -> empty string
 *   - Wraps in double-quotes if the value contains comma, double-quote,
 *     CR, or LF; doubles any embedded double-quotes.
 *   - Returns the bare value otherwise.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Build a single CSV row in `CSV_COLUMNS` order from a `TriageRow`. */
export function buildCsvRow(row: TriageRow): string {
  return CSV_COLUMNS.map((col) => csvEscape(row[col])).join(',');
}

/** Build the CSV header line in `CSV_COLUMNS` order. */
export function buildCsvHeader(): string {
  return CSV_COLUMNS.join(',');
}

/**
 * Build the full CSV body (header + N rows joined by `\n`, trailing newline).
 * Empty `rows` array yields header-only CSV (per AC test surface).
 */
export function buildCsv(rows: TriageRow[]): string {
  const lines = [buildCsvHeader(), ...rows.map(buildCsvRow)];
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Env loader (matches backfill-classify-content-items.ts pattern)
// ---------------------------------------------------------------------------

function loadEnvFile(path: string): void {
  try {
    // @ts-expect-error Bun-only API
    const content = Bun.file(path).textSync();
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist — fine.
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  loadEnvFile('.env.local');

  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`Error: ${args.error}`);
    process.exit(1);
  }

  // Fail-fast guards (per feedback_branding_client_id_env + spec §6.6).
  if (!process.env.NEXT_PUBLIC_CLIENT_ID) {
    console.error('FATAL: NEXT_PUBLIC_CLIENT_ID is not set. Refusing to run.');
    process.exit(1);
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
    );
    process.exit(1);
  }

  assertEnvFlag(args.env, supabaseUrl);

  // Print the host portion so the operator can confirm targeting (AC0.1-AC6).
  let host = '<unparseable URL>';
  try {
    host = new URL(supabaseUrl).host;
  } catch {
    /* fallthrough — keep placeholder */
  }
  console.log(`Targeting Supabase host: ${host}`);
  console.log(`Env flag: ${args.env}`);
  console.log(`Output path: ${args.output}`);
  console.log(`Limit: ${args.limit ?? 'unlimited'}`);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = await findNullProvenanceRows(supabase, args.limit);

  // Ensure output dir exists (covers `--output /some/new/dir/file.csv`).
  mkdirSync(dirname(args.output), { recursive: true });

  const csv = buildCsv(rows);
  writeFileSync(args.output, csv, 'utf8');

  console.log('');
  console.log(`--- WP-B Phase 0a Triage Report ---`);
  console.log(`NULL-provenance rows: ${rows.length}`);
  console.log(`CSV written to:       ${args.output}`);
  if (rows.length === 0) {
    console.log(
      '(Header-only CSV. Either staging is data-empty, or Phase 0c has' +
        ' attributed all rows. Sanity-check: SELECT COUNT(*) FROM' +
        " content_items WHERE metadata->>'ingestion_source' IS NULL.)",
    );
  }
}

// Only run main when invoked directly (not when imported by tests).
// @ts-expect-error import.meta.main is a Bun extension
if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

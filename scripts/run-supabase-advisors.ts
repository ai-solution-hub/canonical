#!/usr/bin/env bun
/**
 * Supabase advisor lint check (WP-G4.6).
 *
 * Queries the Supabase Management API security + performance advisor
 * endpoints, normalises the response into baseline-compatible records,
 * then diffs against
 * `docs/audits/kh-production-readiness-phase-1/supabase-advisor-baseline.json`.
 *
 * Any finding present in the live response but missing from the baseline
 * (matched by `cache_key`) is treated as a PR-introduced regression and
 * fails CI with exit 1. Findings that are in the baseline but not the
 * live response are logged as informational ("baseline contains stale
 * entries — consider re-baselining") but do NOT fail.
 *
 * **Why this script exists:**
 *   The Supabase advisor surfaces RLS gaps, SECURITY DEFINER overexposure,
 *   missing FK indexes, etc. These regress silently — a developer adds a
 *   new table or function, forgets a `REVOKE EXECUTE FROM anon`, ships,
 *   and only learns about it from a manual dashboard scan weeks later.
 *   This script wires the advisor into PR-blocking CI so new findings
 *   surface within 5 minutes of the offending commit landing.
 *
 *   Spec slot: docs/audits/kh-production-readiness-phase-1/specs/wp-g4.6-…
 *   (deferred — capability lives directly in WP-G4.6 acceptance criteria).
 *
 * **Mechanism (decision rationale):**
 *   Direct fetch against `GET /v1/projects/{ref}/advisors/security` and
 *   `?type=performance` (Supabase Management API). The MCP `get_advisors`
 *   tool is unavailable in CI runners — only the REST API is. Direct SQL
 *   against `lint.<func>()` was considered but rejected: those functions
 *   are not part of the Supabase public API and shape can change without
 *   notice. The Management API is documented (per Supabase "Security
 *   checks for production" guide) and stable.
 *
 *   Pattern lifted from `scripts/migration-replay-check.ts` —
 *   `fetch()` + `Bearer` PAT, no supabase-js (Bun 204 hang gotcha),
 *   no new npm deps.
 *
 * **Required env vars:**
 *   - SUPABASE_ACCESS_TOKEN — PAT with project read access (same one used
 *     by WP-G4.5 migration replay)
 *   - PROJECT_REF — Supabase project ref (defaults to prod if --env=prod)
 *
 * **Usage:**
 *   bun run scripts/run-supabase-advisors.ts                     # CI lint mode
 *   bun run scripts/run-supabase-advisors.ts --capture-baseline  # write baseline file
 *   bun run scripts/run-supabase-advisors.ts --json              # emit raw JSON
 *   bun run scripts/run-supabase-advisors.ts --env=prod          # assert prod ref
 *   bun run scripts/run-supabase-advisors.ts --help              # usage
 *
 * **Exit codes:**
 *   - 0 — pass; no new findings vs baseline
 *   - 1 — new findings present (PR-blocking)
 *   - 2 — infrastructure failure (API unreachable, auth, baseline IO, etc.)
 */

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { resolvePrivateDocsDir } from '@/lib/private-docs';
import {
  platformProjectRef,
  prodProjectRef,
  stagingProjectRef,
} from '@/scripts/lib/project-refs';

// ── Constants ──────────────────────────────────────────────────────────────

const MANAGEMENT_API_BASE = 'https://api.supabase.com/v1';

// The advisor baseline lists prod security + performance findings, so it
// must NOT live in the (soon-public) repo. It is relocated to the PRIVATE
// docs-site at `ops/supabase-advisor-baseline.json` (sibling of the
// identity denylist), resolved via the KH_PRIVATE_DOCS_DIR bridge:
//   - local: the sibling knowledge-hub-docs-site checkout;
//   - CI: the resolve-private-docs action mints an App token + exports it.
// Resolved LAZILY (never at module top-level) so this file stays importable
// for unit-testing the pure helpers (toBaselineRecord, diffAgainstBaseline)
// without the knob set.
const BASELINE_DISPLAY =
  '<KH_PRIVATE_DOCS_DIR>/ops/supabase-advisor-baseline.json';

function baselinePath(): string {
  return path.join(
    resolvePrivateDocsDir(),
    'ops',
    'supabase-advisor-baseline.json',
  );
}

const EXIT_OK = 0;
const EXIT_NEW_FINDINGS = 1;
const EXIT_INFRA_ERROR = 2;

/**
 * Advisor findings intentionally excluded from CI gating.
 *
 * `unused_index` is disabled in the Supabase dashboard for this project and is
 * too noisy for the CI signal. It is filtered before both diff and baseline
 * capture so future baselines do not carry these entries.
 */
const IGNORED_ADVISOR_NAMES = new Set(['unused_index']);

// ── Types ──────────────────────────────────────────────────────────────────

// If Supabase ships new advisor categories beyond security + performance
// (e.g. compliance, deprecation), extend this union and add a corresponding
// fetch-call site in fetchAllFindings — the Management API endpoint shape is
// per-type so adding a third requires both.
type AdvisorType = 'security' | 'performance';

interface AdvisorMetadata {
  name?: string;
  schema?: string;
  type?: string;
  language?: string;
  arguments?: string;
  security_definer?: boolean;
  fkey_name?: string;
  fkey_columns?: number[];
  entity?: string;
}

interface AdvisorLint {
  name: string;
  title: string;
  level: string;
  facing: string;
  categories: string[];
  description: string;
  detail: string;
  remediation: string;
  metadata?: AdvisorMetadata;
  cache_key: string;
}

interface AdvisorResponse {
  lints?: AdvisorLint[];
}

/**
 * Baseline-compatible record shape. Diff key is `cache_key`. The other
 * fields are denormalised for human readability when reviewing the
 * baseline JSON in a PR.
 */
interface BaselineRecord {
  cache_key: string;
  name: string;
  level: string;
  facing: string;
  category: AdvisorType;
  title: string;
  schema?: string;
  table?: string;
  function?: string;
  object?: string;
  snapshot_iso: string;
}

interface CliFlags {
  captureBaseline: boolean;
  json: boolean;
  env: string;
  projectRef: string | undefined;
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseCli(): CliFlags {
  const { values } = parseArgs({
    options: {
      'capture-baseline': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      env: { type: 'string', default: 'auto' },
      'project-ref': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
Supabase advisor lint check (WP-G4.6).

Usage:
  bun run scripts/run-supabase-advisors.ts                       # diff vs baseline
  bun run scripts/run-supabase-advisors.ts --capture-baseline    # rewrite baseline
  bun run scripts/run-supabase-advisors.ts --json                # raw JSON only
  bun run scripts/run-supabase-advisors.ts --env=prod            # assert prod ref
  bun run scripts/run-supabase-advisors.ts --env=staging         # assert staging ref
  bun run scripts/run-supabase-advisors.ts --project-ref=<ref>   # override target

Required env vars:
  SUPABASE_ACCESS_TOKEN  Personal Access Token (project read access)
  PROJECT_REF            Project ref (optional; defaults to the Platform CI project)

Exit codes:
  0  pass; no new findings vs baseline
  1  new findings (PR-blocking)
  2  infrastructure failure (API, auth, baseline IO)

Baseline file: ${BASELINE_DISPLAY}
`);
    process.exit(EXIT_OK);
  }

  return {
    captureBaseline: values['capture-baseline'] ?? false,
    json: values.json ?? false,
    env: (values.env as string) ?? 'auto',
    projectRef: values['project-ref'] as string | undefined,
  };
}

function resolveProjectRef(flags: CliFlags): string {
  // Precedence: --project-ref > $PROJECT_REF > default-by-env-flag.
  if (flags.projectRef) return flags.projectRef;
  if (process.env.PROJECT_REF) return process.env.PROJECT_REF;
  if (flags.env === 'staging') return stagingProjectRef();
  if (flags.env === 'prod') return prodProjectRef();
  // Default for 'auto': the Platform CI project (canonical's own dev/CI DB).
  // Client prod/staging refs are supplied explicitly (--project-ref or
  // $PROJECT_REF) when advisor-linting a specific client DB.
  return platformProjectRef();
}

function assertEnvFlag(env: string, projectRef: string): void {
  if (env === 'prod' && projectRef !== prodProjectRef()) {
    console.error(
      `Refusing to run: --env=prod set but PROJECT_REF='${projectRef}' ` +
        `(expected the configured prod project ref).`,
    );
    process.exit(EXIT_INFRA_ERROR);
  }
  if (env === 'staging' && projectRef !== stagingProjectRef()) {
    console.error(
      `Refusing to run: --env=staging set but PROJECT_REF='${projectRef}' ` +
        `(expected the configured staging project ref).`,
    );
    process.exit(EXIT_INFRA_ERROR);
  }
  if (env !== 'prod' && env !== 'staging' && env !== 'auto') {
    console.error(
      `Unknown --env=${env}; expected 'prod', 'staging', or 'auto'.`,
    );
    process.exit(EXIT_INFRA_ERROR);
  }
}

// ── Management API ─────────────────────────────────────────────────────────

async function fetchAdvisors(
  accessToken: string,
  projectRef: string,
  advisorType: AdvisorType,
): Promise<AdvisorLint[]> {
  const url = `${MANAGEMENT_API_BASE}/projects/${projectRef}/advisors/${advisorType}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Management API GET /advisors/${advisorType} failed: ` +
        `HTTP ${res.status} — ${body.slice(0, 500)}`,
    );
  }
  const json = (await res.json()) as AdvisorResponse;
  return json.lints ?? [];
}

// ── Normalisation ──────────────────────────────────────────────────────────

/**
 * Fold a raw advisor lint into a baseline-compatible record.
 *
 * Stable diff is keyed on `cache_key` alone — Supabase generates this to
 * uniquely identify a finding (lint name + schema + object + sub-object).
 * The other denormalised fields (table/function/etc.) are for human
 * readability when reviewing the baseline JSON in a PR.
 */
export function toBaselineRecord(
  lint: AdvisorLint,
  category: AdvisorType,
  snapshotIso: string,
): BaselineRecord {
  const metadata = lint.metadata ?? {};
  const record: BaselineRecord = {
    cache_key: lint.cache_key,
    name: lint.name,
    level: lint.level,
    facing: lint.facing,
    category,
    title: lint.title,
    snapshot_iso: snapshotIso,
  };
  if (metadata.schema) record.schema = metadata.schema;

  // Function-shaped findings: SECURITY DEFINER lints carry a function name +
  // arguments in metadata; we surface that as `function`. Table-shaped
  // findings (RLS, no_primary_key, unindexed_foreign_keys, unused_index,
  // multiple_permissive_policies) surface as `table`. Anything else falls
  // back to a generic `object` field so we never lose the metadata name.
  const isFunctionLint =
    metadata.security_definer === true ||
    lint.name.endsWith('security_definer_function_executable') ||
    lint.name === 'function_search_path_mutable';
  if (isFunctionLint && metadata.name) {
    record.function = metadata.name;
  } else if (metadata.type === 'table' || metadata.type === 'view') {
    if (metadata.name) record.table = metadata.name;
  } else if (metadata.name) {
    record.object = metadata.name;
  }

  return record;
}

function collectAllRecords(
  security: AdvisorLint[],
  performance: AdvisorLint[],
  snapshotIso: string,
): BaselineRecord[] {
  const records: BaselineRecord[] = [];
  for (const l of security)
    records.push(toBaselineRecord(l, 'security', snapshotIso));
  for (const l of performance)
    records.push(toBaselineRecord(l, 'performance', snapshotIso));
  // Stable order — by cache_key — so diffs in the baseline file are
  // semantically meaningful.
  records.sort((a, b) => a.cache_key.localeCompare(b.cache_key));
  return records;
}

function filterIgnoredFindings(lints: AdvisorLint[]): AdvisorLint[] {
  return lints.filter((lint) => !IGNORED_ADVISOR_NAMES.has(lint.name));
}

// ── Diff ───────────────────────────────────────────────────────────────────

interface DiffResult {
  newFindings: BaselineRecord[];
  staleBaseline: BaselineRecord[];
}

/**
 * Compare live records against baseline. New findings = present live but
 * not in baseline (PR-introduced regression). Stale baseline = present
 * in baseline but not in live (informational; never fails).
 */
export function diffAgainstBaseline(
  live: BaselineRecord[],
  baseline: BaselineRecord[],
): DiffResult {
  const baselineKeys = new Set(baseline.map((r) => r.cache_key));
  const liveKeys = new Set(live.map((r) => r.cache_key));

  const newFindings = live.filter((r) => !baselineKeys.has(r.cache_key));
  const staleBaseline = baseline.filter((r) => !liveKeys.has(r.cache_key));

  return { newFindings, staleBaseline };
}

// ── Baseline IO ────────────────────────────────────────────────────────────

function loadBaseline(): BaselineRecord[] {
  const p = baselinePath();
  if (!existsSync(p)) {
    console.error(
      `Baseline file not found: ${p}\n` +
        `Run with --capture-baseline to create it.`,
    );
    process.exit(EXIT_INFRA_ERROR);
  }
  try {
    const text = readFileSync(p, 'utf-8');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error(
        `Baseline file is not a JSON array (got ${typeof parsed}).`,
      );
    }
    return parsed as BaselineRecord[];
  } catch (err) {
    console.error(
      `Failed to read baseline ${p}: ` + `${(err as Error).message}`,
    );
    process.exit(EXIT_INFRA_ERROR);
  }
}

function writeBaseline(records: BaselineRecord[]): void {
  const p = baselinePath();
  const text = `${JSON.stringify(records, null, 2)}\n`;
  writeFileSync(p, text, 'utf-8');
  console.log(`Wrote ${records.length} records to ${p}`);
}

// ── Reporting ──────────────────────────────────────────────────────────────

function formatRecordLine(r: BaselineRecord): string {
  const target = r.function ?? r.table ?? r.object ?? '(unknown)';
  const schema = r.schema ? `${r.schema}.` : '';
  return `[${r.level}] ${r.name} — ${schema}${target} (${r.category})`;
}

function reportDiff(diff: DiffResult, totalLive: number): void {
  console.log(`Live findings: ${totalLive}`);
  console.log(`New findings: ${diff.newFindings.length}`);
  console.log(`Stale baseline entries: ${diff.staleBaseline.length}`);

  if (diff.newFindings.length > 0) {
    console.error(
      `\n::error::WP-G4.6 — ${diff.newFindings.length} new advisor finding(s) ` +
        `not in baseline:`,
    );
    for (const r of diff.newFindings) {
      console.error(`  - ${formatRecordLine(r)}`);
    }
    console.error(
      `\nFix the underlying issue, OR re-baseline if the finding is\n` +
        `already known/accepted by re-running with --capture-baseline\n` +
        `and committing the updated ${BASELINE_DISPLAY}.`,
    );
  }

  if (diff.staleBaseline.length > 0) {
    // Informational; do not fail.
    console.log(
      `\n::notice::Baseline contains ${diff.staleBaseline.length} entries no ` +
        `longer reported by live advisor — consider re-baselining:`,
    );
    for (const r of diff.staleBaseline) {
      console.log(`  - ${formatRecordLine(r)}`);
    }
  }
}

// ── Orchestration ──────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const flags = parseCli();
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!accessToken) {
    console.error(
      `Missing SUPABASE_ACCESS_TOKEN env var. ` +
        `See script header for the full env contract.`,
    );
    return EXIT_INFRA_ERROR;
  }

  const projectRef = resolveProjectRef(flags);
  assertEnvFlag(flags.env, projectRef);

  console.log(
    `Supabase advisor lint (WP-G4.6)\n` +
      `  project_ref=${projectRef}\n` +
      `  mode=${flags.captureBaseline ? 'capture-baseline' : 'diff-vs-baseline'}\n`,
  );

  let security: AdvisorLint[];
  let performance: AdvisorLint[];
  try {
    [security, performance] = await Promise.all([
      fetchAdvisors(accessToken, projectRef, 'security'),
      fetchAdvisors(accessToken, projectRef, 'performance'),
    ]);
  } catch (err) {
    console.error(`Advisor fetch failed: ${(err as Error).message}`);
    return EXIT_INFRA_ERROR;
  }

  const rawFindingCount = security.length + performance.length;
  security = filterIgnoredFindings(security);
  performance = filterIgnoredFindings(performance);

  const snapshotIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const liveRecords = collectAllRecords(security, performance, snapshotIso);

  if (flags.json) {
    console.log(JSON.stringify(liveRecords, null, 2));
    return EXIT_OK;
  }

  console.log(
    `Fetched: security=${security.length} performance=${performance.length} ` +
      `total=${liveRecords.length} ` +
      `(ignored=${rawFindingCount - liveRecords.length})`,
  );

  if (flags.captureBaseline) {
    try {
      writeBaseline(liveRecords);
      return EXIT_OK;
    } catch (err) {
      console.error(`Failed to write baseline: ${(err as Error).message}`);
      return EXIT_INFRA_ERROR;
    }
  }

  // Diff mode (default + CI path).
  const baseline = loadBaseline();
  console.log(`Loaded baseline: ${baseline.length} record(s)`);

  const diff = diffAgainstBaseline(liveRecords, baseline);
  reportDiff(diff, liveRecords.length);

  return diff.newFindings.length > 0 ? EXIT_NEW_FINDINGS : EXIT_OK;
}

// Guard top-level execution so the file is safely importable for unit
// testing of pure helpers (toBaselineRecord, diffAgainstBaseline).
const isMain =
  process.argv[1]?.endsWith('run-supabase-advisors.ts') ||
  process.argv[1]?.endsWith('run-supabase-advisors');
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`Unhandled exception: ${(err as Error).message}`);
      process.exit(EXIT_INFRA_ERROR);
    });
}

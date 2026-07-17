#!/usr/bin/env bun
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — Standalone Bun script, not part of Next.js build
/**
 * Post-Ingest Quality Gate (OPS-5).
 *
 * Scripted replacement for the 7 manual psql checks used in S181 WP3.
 * Read-only observer — inspects DB state produced by the pipeline and emits
 * pass/fail per a configurable profile. Does NOT trigger ingestion, write
 * rows, or block writes.
 *
 * bl-495: re-pointed onto the post-id-131 schema. `content_items` dropped
 * wholesale — parent-row checks now read `source_documents` (classification
 * cols live there), Q&A-record checks read `q_a_pairs`, non-draft filters
 * join `record_lifecycle` (owner_kind='source_document'), and embedding
 * coverage reads `record_embeddings`. The dedup-family and content_history
 * checks were RETIRED (no successor tables) — see the check registries.
 *
 * Specs:
 *   - Generic gate: docs/specs/post-ingest-quality-gate-spec.md
 *   - Audit-content companion: docs/specs/audit-content-quality-gate-spec.md
 *
 * Usage:
 *   bun run scripts/quality-gate.ts --threshold=re-ingest
 *   bun run scripts/quality-gate.ts --profile=audit-content
 *   bun run scripts/quality-gate.ts --threshold=batch --format=json --output=-
 *   bun run scripts/quality-gate.ts --include-check=corpus_counts --include-check=embedding_coverage
 *
 * Exit codes:
 *   0 — gate passed per --fail-on policy
 *   1 — gate failed
 *   2 — operational failure (DB unreachable, invalid flags, missing config)
 *
 * Sandbox: read-only supabase-js queries use SUPABASE_SERVICE_ROLE_KEY. Runs
 * fine inside the sandbox — no .update() / .insert() / .delete() calls.
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { prodProjectRef } from '@/scripts/lib/project-refs';
import { parseArgs } from 'util';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { execFileSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = 'must-pass' | 'should-pass';
export type Status = 'pass' | 'fail' | 'warn' | 'skipped';
export type FailOn = 'must-pass' | 'any' | 'never';
export type Format = 'markdown' | 'json';

export interface CheckResult {
  name: string;
  severity: Severity;
  status: Status;
  threshold: string;
  observed: string;
  diagnostic: string;
  duration_ms: number;
}

export interface ProfileDef {
  description: string;
  check_severities?: Record<string, Severity>;
  invokes_profile?: string;
  audit_content_checks?: Record<string, Severity>;
}

export interface ProfilesConfig {
  profiles: Record<string, ProfileDef>;
}

export interface CorpusRange {
  min: number;
  max: number;
  target?: number;
}

export interface CorpusExpected {
  baseline_date?: string;
  baseline_project?: string;
  types: Record<string, CorpusRange>;
}

export interface EntityCoverageExpected {
  profile_thresholds: Record<string, Record<string, number>>;
}

export interface RelationshipCoverageExpected {
  profile_thresholds: Record<string, Record<string, number>>;
}

export interface AuditContentFileGroup {
  description: string;
  filename_matchers: { contains_all: string[] };
  qa_count: { min: number; max: number; observed?: number };
  chunks_per_item_estimate: [number, number];
  chunk_count: { min: number; max: number };
}

export interface AuditContentExpected {
  baseline_date?: string;
  baseline_project?: string;
  file_groups: Record<string, AuditContentFileGroup>;
  classification_confidence_threshold: number;
  classification_confidence_min_ratio: number;
  required_entities: Array<{
    accept_any_of: string[];
    entity_type: string;
    reason?: string;
  }>;
  should_pass_entities: Array<{
    accept_any_of: string[];
    entity_type: string;
    reason?: string;
  }>;
  required_relationship_types: string[];
  should_pass_relationship_types: string[];
}

export interface GateContext {
  sb: SupabaseClient;
  profileName: string;
  profileDef: ProfileDef;
  corpus: CorpusExpected;
  entityCov: EntityCoverageExpected;
  relCov: RelationshipCoverageExpected;
  auditContent?: AuditContentExpected;
  workspaceId: string;
  runId: string;
  gitSha: string;
  timestamp: string;
}

export interface GateEnvelope {
  run_id: string;
  git_sha: string;
  timestamp: string;
  profile: string;
  workspace_id: string;
  overall: 'pass' | 'fail' | 'warn';
  run_duration_ms: number;
  checks: CheckResult[];
}

export type CheckFn = (ctx: GateContext) => Promise<CheckResult>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_DIR = resolve(process.cwd(), 'scripts/config/quality-gate');
const DEFAULT_REPORT_DIR = resolve(process.cwd(), 'data/reports');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliArgs {
  threshold: string | null;
  profile: string | null;
  format: Format;
  output: string | null;
  failOn: FailOn;
  includeChecks: string[];
  excludeChecks: string[];
  help: boolean;
  env: string;
}

export function parseCli(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      threshold: { type: 'string' },
      profile: { type: 'string' },
      format: { type: 'string' },
      output: { type: 'string' },
      'fail-on': { type: 'string' },
      'include-check': { type: 'string', multiple: true },
      'exclude-check': { type: 'string', multiple: true },
      help: { type: 'boolean' },
      env: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  const format = (values.format ?? 'markdown') as Format;
  if (format !== 'markdown' && format !== 'json') {
    throw new Error(
      `Invalid --format '${format}'. Must be 'markdown' or 'json'.`,
    );
  }

  const failOn = (values['fail-on'] ?? 'must-pass') as FailOn;
  if (failOn !== 'must-pass' && failOn !== 'any' && failOn !== 'never') {
    throw new Error(
      `Invalid --fail-on '${failOn}'. Must be 'must-pass', 'any', or 'never'.`,
    );
  }

  return {
    threshold: (values.threshold as string | undefined) ?? null,
    profile: (values.profile as string | undefined) ?? null,
    format,
    output: (values.output as string | undefined) ?? null,
    failOn,
    includeChecks: (values['include-check'] as string[] | undefined) ?? [],
    excludeChecks: (values['exclude-check'] as string[] | undefined) ?? [],
    help: Boolean(values.help),
    env: (values.env as string | undefined) ?? '',
  };
}

// ── --env=prod opt-in (WP-S5.3 D-21 F-1) ──────────────────────────────────

function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(prodProjectRef())) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${prodProjectRef()}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/quality-gate.ts --env=prod`,
    );
    process.exit(1);
  }
}

const HELP_TEXT = `
bun run scripts/quality-gate.ts

  --threshold <profile>         Threshold profile: re-ingest (default) | batch | onboarding
  --profile <name>              High-level profile that composes checks.
                                Currently: audit-content (runs re-ingest generic
                                checks first, then audit-content corpus checks).
                                Mutually exclusive with --threshold.
  --format markdown|json        Output format (default: markdown)
  --output <path>               Report path. '-' = stdout. Default timestamped
                                under data/reports/.
  --fail-on must-pass|any|never How to map check failures to exit code.
                                Default: must-pass.
  --include-check <name>        Run ONLY the named checks (multi-flag).
  --exclude-check <name>        Skip the named checks (multi-flag).
  --help                        Show this help.

Env:
  SUPABASE_URL                  Target Supabase project (required).
  SUPABASE_SERVICE_ROLE_KEY           Service role key (required — bypasses RLS).

Examples:
  bun run scripts/quality-gate.ts --threshold=re-ingest
  bun run scripts/quality-gate.ts --profile=audit-content --format=json
  bun run scripts/quality-gate.ts --exclude-check=summary_coverage
`;

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

export function loadJson<T>(relPath: string): T {
  const full = resolve(CONFIG_DIR, relPath);
  try {
    const raw = readFileSync(full, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(
      `Failed to load config file '${full}': ${(err as Error).message}`,
    );
  }
}

export function loadProfiles(): ProfilesConfig {
  return loadJson<ProfilesConfig>('profiles.json');
}

export function loadCorpusExpected(): CorpusExpected {
  return loadJson<CorpusExpected>('corpus-expected.json');
}

export function loadEntityCoverageExpected(): EntityCoverageExpected {
  return loadJson<EntityCoverageExpected>('entity-coverage-expected.json');
}

export function loadRelationshipCoverageExpected(): RelationshipCoverageExpected {
  return loadJson<RelationshipCoverageExpected>(
    'relationship-coverage-expected.json',
  );
}

export function loadAuditContentExpected(): AuditContentExpected {
  return loadJson<AuditContentExpected>('audit-content-expected.json');
}

// ---------------------------------------------------------------------------
// Profile resolution
// ---------------------------------------------------------------------------

export function resolveProfile(
  profiles: ProfilesConfig,
  name: string,
): ProfileDef {
  const def = profiles.profiles[name];
  if (!def) {
    const available = Object.keys(profiles.profiles).join(', ');
    throw new Error(
      `Profile '${name}' not found in config. Available: ${available}`,
    );
  }
  return def;
}

export function severityFor(
  profileDef: ProfileDef,
  checkName: string,
  fallback: Severity = 'should-pass',
): Severity {
  return (
    profileDef.check_severities?.[checkName] ??
    profileDef.audit_content_checks?.[checkName] ??
    fallback
  );
}

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

export function createSb(env = ''): {
  sb: SupabaseClient;
  workspaceId: string;
} {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required.',
    );
  }

  assertEnvFlag(env, url);

  const workspaceId = extractProjectId(url);
  const sb = createScriptClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { sb, workspaceId };
}

export function extractProjectId(url: string): string {
  const m = url.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/);
  return m?.[1] ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function now(): number {
  return Date.now();
}

function fmtRatio(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function tryGitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

function makeSkip(
  name: string,
  severity: Severity,
  reason: string,
): CheckResult {
  return {
    name,
    severity,
    status: 'skipped',
    threshold: '',
    observed: '',
    diagnostic: reason,
    duration_ms: 0,
  };
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as {
      message?: string;
      code?: string;
      details?: string;
      hint?: string;
    };
    if (e.message) {
      const bits = [e.message];
      if (e.code) bits.push(`code=${e.code}`);
      if (e.hint) bits.push(`hint=${e.hint}`);
      if (e.details) bits.push(`details=${e.details}`);
      return bits.join(' ');
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function makeFail(name: string, severity: Severity, err: unknown): CheckResult {
  return {
    name,
    severity,
    status: 'fail',
    threshold: '',
    observed: '',
    diagnostic: `Check errored: ${formatError(err)}`,
    duration_ms: 0,
  };
}

/** Paginated select — supabase-js caps rows at the project's Max Rows setting
 *  (default 1000). Verification finding M-3: full-table selects must paginate
 *  or risk silently truncating as the corpus grows past 1000 items. This
 *  helper fetches in PAGE_SIZE chunks via `.range()` until a short page lands. */
const PAGE_SIZE = 1000;

async function fetchAll<T = Record<string, unknown>>(
  sb: SupabaseClient,
  table: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase PostgrestFilterBuilder is not generically expressible here; the caller chains arbitrary filter methods.
  buildQuery: (q: ReturnType<SupabaseClient['from']>) => any,
): Promise<T[]> {
  const out: T[] = [];
  let page = 0;
  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const q = buildQuery(sb.from(table)).range(from, to);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    page += 1;
  }
  return out;
}

/** Paginated variant of the "chunk IDs then query" pattern. Child-table
 *  queries like `SELECT * FROM entity_mentions WHERE source_document_id IN (...)`
 *  can return many rows per parent ID. Default 1000-row cap would silently
 *  truncate. This helper chunks input IDs and paginates each chunk's result
 *  set until exhausted. */
async function fetchAllInBatches<T = Record<string, unknown>>(
  sb: SupabaseClient,
  table: string,
  ids: string[],
  idColumn: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase PostgrestFilterBuilder is not generically expressible here; the caller chains arbitrary filter methods.
  buildQuery: (q: ReturnType<SupabaseClient['from']>) => any,
  idBatchSize = 500,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += idBatchSize) {
    const slice = ids.slice(i, i + idBatchSize);
    let page = 0;
    while (true) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const q = buildQuery(sb.from(table)).in(idColumn, slice).range(from, to);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data as T[] | null) ?? [];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break;
      page += 1;
    }
  }
  return out;
}

/** Exclude test/artefact rows from generic queries (OPS-21).
 *  E2E and SUPERSEDE items use the prefixes '[E2E' and '[SUPERSEDE' to
 *  identify themselves. These inflate corpus counts and cause false-positive
 *  quality-gate failures. Post-id-131 (bl-495) the marker lands on
 *  `source_documents.filename` (see e2e/fixtures/test-data-fixture.ts) —
 *  default column 'filename'; q_a_pairs artefacts carry it in
 *  'question_text'. Applied to every generic check; NOT applied to
 *  audit-content checks (which scope via filename file-groups already). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic constraint over Supabase query builders whose .not() signature varies by table; any[] keeps the helper table-agnostic.
export function excludeArtefacts<Q extends { not: (...args: any[]) => Q }>(
  q: Q,
  column = 'filename',
): Q {
  return q.not(column, 'like', '[E2E%').not(column, 'like', '[SUPERSEDE%');
}

/** bl-495: `governance_review_status` is no longer a parent-row column — it
 *  lives on the `record_lifecycle` facet (owner_kind + owner_id polymorphic
 *  key; join precedent: migration
 *  20260706103000_id131_attention_counts_rewrite.sql). PostgREST cannot
 *  filter a parent select through that polymorphic join, so the gate fetches
 *  the (small) set of DRAFT source_document ids once and excludes them
 *  client-side. Semantics match the old `.or('governance_review_status.is.
 *  null,governance_review_status.neq.draft')` filter: a document with no
 *  lifecycle row, or a NULL/non-draft status, counts as non-draft. */
async function fetchDraftDocIds(sb: SupabaseClient): Promise<Set<string>> {
  const rows = await fetchAll<{ owner_id: string }>(
    sb,
    'record_lifecycle',
    (q) =>
      q
        .select('owner_id')
        .eq('owner_kind', 'source_document')
        .eq('governance_review_status', 'draft'),
  );
  return new Set(rows.map((r) => r.owner_id));
}

/** Fetch non-draft, artefact-excluded source_documents rows (the parent-row
 *  successor of the old published content_items scope). `select` must
 *  include `id` — draft exclusion happens client-side via the
 *  record_lifecycle draft-id set. */
async function fetchNonDraftDocs<T extends { id: string }>(
  sb: SupabaseClient,
  select: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase PostgrestFilterBuilder is not generically expressible here.
  refine?: (q: any) => any,
): Promise<T[]> {
  const [rows, draftIds] = await Promise.all([
    fetchAll<T>(sb, 'source_documents', (q) => {
      const base = excludeArtefacts(q.select(select));
      return refine ? refine(base) : base;
    }),
    fetchDraftDocIds(sb),
  ]);
  return rows.filter((r) => !draftIds.has(r.id));
}

/** Human-readable label for a source_documents row in diagnostics — the old
 *  content_items.title has no direct successor (BI-11); suggested_title is
 *  the classifier's title, filename the upload's. */
function docLabel(r: {
  suggested_title?: string | null;
  filename?: string | null;
}): string {
  return (r.suggested_title ?? r.filename ?? '(untitled)').slice(0, 60);
}

/** bl-495: per-type non-draft corpus counts. Typed Q&A records moved off the
 *  parent table into `q_a_pairs` (id-131) — the 'q_a_pair' bucket counts that
 *  table directly (its drafts are publication_status='draft' on the row);
 *  every other content_type is counted from `source_documents`. */
async function countNonDraftByType(
  sb: SupabaseClient,
): Promise<Record<string, number>> {
  const docs = await fetchNonDraftDocs<{
    id: string;
    content_type: string | null;
  }>(sb, 'id, content_type');
  const counts: Record<string, number> = {};
  for (const row of docs) {
    const t = row.content_type ?? '(null)';
    counts[t] = (counts[t] ?? 0) + 1;
  }
  const qaRows = await fetchAll<{ id: string }>(sb, 'q_a_pairs', (q) =>
    excludeArtefacts(
      q
        .select('id, publication_status, question_text')
        .or('publication_status.is.null,publication_status.neq.draft'),
      'question_text',
    ),
  );
  counts['q_a_pair'] = qaRows.length;
  return counts;
}

// ---------------------------------------------------------------------------
// Generic checks (12) — spec §3
// ---------------------------------------------------------------------------

/** 3.1 corpus_counts — per content_type count within expected range. */
export async function corpus_counts(ctx: GateContext): Promise<CheckResult> {
  const t0 = now();
  const severity = severityFor(ctx.profileDef, 'corpus_counts');
  try {
    const observed = await countNonDraftByType(ctx.sb);
    const failures: string[] = [];
    const lines: string[] = [];
    for (const [type, range] of Object.entries(ctx.corpus.types)) {
      const n = observed[type] ?? 0;
      const ok = n >= range.min && n <= range.max;
      lines.push(`${type}=${n}∈[${range.min},${range.max}]${ok ? '✓' : '✗'}`);
      if (!ok) {
        failures.push(
          `content_type=${type} observed=${n} expected=[${range.min},${range.max}]`,
        );
      }
    }
    const warnings: string[] = [];
    for (const type of Object.keys(observed)) {
      if (!(type in ctx.corpus.types)) {
        warnings.push(`${type}=${observed[type]} (unlisted)`);
      }
    }
    return {
      name: 'corpus_counts',
      severity,
      status: failures.length ? 'fail' : warnings.length ? 'warn' : 'pass',
      threshold:
        'per-type ranges from scripts/config/quality-gate/corpus-expected.json',
      observed: lines.join(' '),
      diagnostic: failures.length
        ? failures.join('; ')
        : warnings.length
          ? `Unlisted types (warn): ${warnings.join(', ')}`
          : '',
      duration_ms: now() - t0,
    };
  } catch (err) {
    return makeFail('corpus_counts', severity, err);
  }
}

/** 3.2 embedding_coverage — 0 published documents without an embedding.
 *  bl-495: the inline `content_items.embedding` vector column was dropped
 *  (id-131) — embeddings live in `record_embeddings` keyed by
 *  (owner_kind, owner_id). Coverage = every non-draft source_document has
 *  ≥1 record_embeddings row with owner_kind='source_document'. */
export async function embedding_coverage(
  ctx: GateContext,
): Promise<CheckResult> {
  const t0 = now();
  const severity = severityFor(ctx.profileDef, 'embedding_coverage');
  try {
    const docs = await fetchNonDraftDocs<{
      id: string;
      suggested_title: string | null;
      filename: string | null;
    }>(ctx.sb, 'id, suggested_title, filename');
    const embeddedRows = await fetchAll<{ owner_id: string }>(
      ctx.sb,
      'record_embeddings',
      (q) => q.select('owner_id').eq('owner_kind', 'source_document'),
    );
    const embedded = new Set(embeddedRows.map((r) => r.owner_id));
    const missingDocs = docs.filter((r) => !embedded.has(r.id));
    const missing = missingDocs.length;
    const affected = missingDocs
      .slice(0, 5)
      .map((r) => `${r.id}: ${docLabel(r)}`)
      .join('; ');
    return {
      name: 'embedding_coverage',
      severity,
      status: missing > 0 ? 'fail' : 'pass',
      threshold: 'missing = 0',
      observed: `missing=${missing}`,
      diagnostic:
        missing > 0
          ? `Published documents without a record_embeddings row (sample): ${affected}`
          : '',
      duration_ms: now() - t0,
    };
  } catch (err) {
    return makeFail('embedding_coverage', severity, err);
  }
}

/** 3.3 chunk_coverage — every published document has ≥1 content_chunks row.
 *  bl-495: content_chunks was already re-parented onto
 *  `source_documents.id` via `source_document_id` (id-131) — only the parent
 *  query moves. */
export async function chunk_coverage(ctx: GateContext): Promise<CheckResult> {
  const t0 = now();
  const severity = severityFor(ctx.profileDef, 'chunk_coverage');
  try {
    const items = await fetchNonDraftDocs<{
      id: string;
      suggested_title: string | null;
      filename: string | null;
      content_type: string | null;
    }>(ctx.sb, 'id, suggested_title, filename, content_type');
    if (items.length === 0) {
      return {
        name: 'chunk_coverage',
        severity,
        status: 'pass',
        threshold: '0 rows missing chunks',
        observed: 'no published documents',
        diagnostic: '',
        duration_ms: now() - t0,
      };
    }
    const ids = items.map((r) => r.id);
    const chunkRows = await fetchAllInBatches<{ source_document_id: string }>(
      ctx.sb,
      'content_chunks',
      ids,
      'source_document_id',
      (q) => q.select('source_document_id'),
    );
    const chunkSet = new Set<string>();
    for (const row of chunkRows) chunkSet.add(row.source_document_id);
    const missing = items.filter((r) => !chunkSet.has(r.id));
    const sample = missing
      .slice(0, 10)
      .map((r) => `${r.id}: ${docLabel(r)} [${r.content_type ?? '?'}]`)
      .join('; ');
    return {
      name: 'chunk_coverage',
      severity,
      status: missing.length ? 'fail' : 'pass',
      threshold: '0 published documents missing chunks',
      observed: `missing=${missing.length} of ${items.length}`,
      diagnostic: missing.length ? `Documents without chunks: ${sample}` : '',
      duration_ms: now() - t0,
    };
  } catch (err) {
    return makeFail('chunk_coverage', severity, err);
  }
}

/** 3.4 entity_mention_coverage — per type ratio of items with ≥1 mention. */
export async function entity_mention_coverage(
  ctx: GateContext,
): Promise<CheckResult> {
  const t0 = now();
  const severity = severityFor(ctx.profileDef, 'entity_mention_coverage');
  try {
    const thresholds = ctx.entityCov.profile_thresholds[ctx.profileName];
    if (!thresholds) {
      return makeSkip(
        'entity_mention_coverage',
        severity,
        `No thresholds for profile '${ctx.profileName}'`,
      );
    }
    const items = await fetchNonDraftDocs<{
      id: string;
      content_type: string | null;
    }>(ctx.sb, 'id, content_type', (q) => q.not('classified_at', 'is', null));

    const ids = items.map((r) => r.id);
    const mentionRows = await fetchAllInBatches<{ source_document_id: string }>(
      ctx.sb,
      'entity_mentions',
      ids,
      'source_document_id',
      (q) => q.select('source_document_id'),
    );
    const withMentions = new Set<string>();
    for (const row of mentionRows) withMentions.add(row.source_document_id);

    const byType: Record<string, { total: number; withM: number }> = {};
    for (const r of items) {
      const t = r.content_type ?? '(null)';
      byType[t] ??= { total: 0, withM: 0 };
      byType[t].total += 1;
      if (withMentions.has(r.id)) byType[t].withM += 1;
    }
    const failures: string[] = [];
    const lines: string[] = [];
    for (const [t, { total, withM }] of Object.entries(byType)) {
      const ratio = total === 0 ? 1 : withM / total;
      const threshold = thresholds[t];
      if (threshold === undefined) continue;
      lines.push(`${t}=${fmtRatio(ratio)}/≥${fmtRatio(threshold)}`);
      if (ratio < threshold) {
        failures.push(
          `${t} ratio=${fmtRatio(ratio)} (${withM}/${total}) below threshold ${fmtRatio(threshold)}`,
        );
      }
    }
    return {
      name: 'entity_mention_coverage',
      severity,
      status: failures.length ? 'fail' : 'pass',
      threshold: `per-type ratios for profile '${ctx.profileName}'`,
      observed: lines.join(' '),
      diagnostic: failures.join('; '),
      duration_ms: now() - t0,
    };
  } catch (err) {
    return makeFail('entity_mention_coverage', severity, err);
  }
}

/** 3.5 entity_relationship_coverage — per type ratio with ≥1 source-rel. */
export async function entity_relationship_coverage(
  ctx: GateContext,
): Promise<CheckResult> {
  const t0 = now();
  const severity = severityFor(ctx.profileDef, 'entity_relationship_coverage');
  try {
    const thresholds = ctx.relCov.profile_thresholds[ctx.profileName];
    if (!thresholds) {
      return makeSkip(
        'entity_relationship_coverage',
        severity,
        `No thresholds for profile '${ctx.profileName}'`,
      );
    }
    const items = await fetchNonDraftDocs<{
      id: string;
      content_type: string | null;
    }>(ctx.sb, 'id, content_type', (q) => q.not('classified_at', 'is', null));

    const ids = items.map((r) => r.id);
    const relRows = await fetchAllInBatches<{ source_document_id: string }>(
      ctx.sb,
      'entity_relationships',
      ids,
      'source_document_id',
      (q) => q.select('source_document_id'),
    );
    const withRels = new Set<string>();
    for (const row of relRows) withRels.add(row.source_document_id);

    const byType: Record<string, { total: number; withR: number }> = {};
    for (const r of items) {
      const t = r.content_type ?? '(null)';
      byType[t] ??= { total: 0, withR: 0 };
      byType[t].total += 1;
      if (withRels.has(r.id)) byType[t].withR += 1;
    }

    const failures: string[] = [];
    const lines: string[] = [];
    for (const [t, { total, withR }] of Object.entries(byType)) {
      const ratio = total === 0 ? 1 : withR / total;
      const threshold = thresholds[t];
      if (threshold === undefined) continue;
      lines.push(`${t}=${fmtRatio(ratio)}/≥${fmtRatio(threshold)}`);
      if (ratio < threshold) {
        const hint =
          total === 1 && withR === 0
            ? ' [possible MCP-path regression — see WP1 G2 publish-classify]'
            : '';
        failures.push(
          `${t} ratio=${fmtRatio(ratio)} (${withR}/${total}) below ${fmtRatio(threshold)}${hint}`,
        );
      }
    }
    return {
      name: 'entity_relationship_coverage',
      severity,
      status: failures.length ? 'fail' : 'pass',
      threshold: `per-type ratios for profile '${ctx.profileName}'`,
      observed: lines.join(' '),
      diagnostic: failures.join('; '),
      duration_ms: now() - t0,
    };
  } catch (err) {
    return makeFail('entity_relationship_coverage', severity, err);
  }
}

/** 3.6 classified_domains_not_empty — 0 empty-string classification cells. */
export async function classified_domains_not_empty(
  ctx: GateContext,
): Promise<CheckResult> {
  const t0 = now();
  const severity = severityFor(ctx.profileDef, 'classified_domains_not_empty');
  try {
    const { data, error } = await excludeArtefacts(
      ctx.sb
        .from('source_documents')
        .select(
          'id, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic',
        )
        .gt('classification_confidence', 0)
        .or(
          'primary_domain.eq.,primary_subtopic.eq.,secondary_domain.eq.,secondary_subtopic.eq.',
        ),
    ).limit(50);
    if (error) throw error;
    const rows = data ?? [];
    const sample = rows
      .slice(0, 10)
      .map((r) => {
        const bad: string[] = [];
        if (r.primary_domain === '') bad.push('primary_domain');
        if (r.primary_subtopic === '') bad.push('primary_subtopic');
        if (r.secondary_domain === '') bad.push('secondary_domain');
        if (r.secondary_subtopic === '') bad.push('secondary_subtopic');
        return `${r.id} [${bad.join(',')}]`;
      })
      .join('; ');
    return {
      name: 'classified_domains_not_empty',
      severity,
      status: rows.length ? 'fail' : 'pass',
      threshold: '0 rows with empty-string classification cells',
      observed: `found=${rows.length}`,
      diagnostic: rows.length
        ? `Empty-string cells: ${sample} — check NULLIF handling in the classification pipeline`
        : '',
      duration_ms: now() - t0,
    };
  } catch (err) {
    return makeFail('classified_domains_not_empty', severity, err);
  }
}

/** 3.7 guide_domain_filter_resolves — every active guide resolves ≥1 item. */
export async function guide_domain_filter_resolves(
  ctx: GateContext,
): Promise<CheckResult> {
  const t0 = now();
  const severity = severityFor(ctx.profileDef, 'guide_domain_filter_resolves');
  try {
    const { data: guides, error: gerr } = await ctx.sb
      .from('guides')
      .select('id, name, slug, domain_filter')
      .eq('is_published', true)
      .not('domain_filter', 'is', null);
    if (gerr) throw gerr;
    const guideRows = guides ?? [];
    if (guideRows.length === 0) {
      return {
        name: 'guide_domain_filter_resolves',
        severity,
        status: 'pass',
        threshold: 'every published guide with domain_filter resolves ≥1 item',
        observed: 'no published guides with domain_filter',
        diagnostic: '',
        duration_ms: now() - t0,
      };
    }
    // bl-495: draft exclusion needs the record_lifecycle set — fetch it once,
    // then count the non-draft documents per guide domain client-side.
    const draftIds = await fetchDraftDocIds(ctx.sb);
    const failures: string[] = [];
    for (const g of guideRows) {
      const domain = g.domain_filter as string;
      const rows = await fetchAll<{ id: string }>(
        ctx.sb,
        'source_documents',
        (q) => excludeArtefacts(q.select('id').eq('primary_domain', domain)),
      );
      const count = rows.filter((r) => !draftIds.has(r.id)).length;
      if (count === 0) {
        failures.push(`${g.slug}: domain_filter='${domain}' → 0 documents`);
      }
    }
    return {
      name: 'guide_domain_filter_resolves',
      severity,
      status: failures.length ? 'fail' : 'pass',
      threshold: 'n_items ≥ 1 per published guide',
      observed: `guides=${guideRows.length} unresolved=${failures.length}`,
      diagnostic: failures.join('; '),
      duration_ms: now() - t0,
    };
  } catch (err) {
    return makeFail('guide_domain_filter_resolves', severity, err);
  }
}

/** 3.11 classified_but_no_confidence — partial-write detection. */
export async function classified_but_no_confidence(
  ctx: GateContext,
): Promise<CheckResult> {
  const t0 = now();
  const severity = severityFor(ctx.profileDef, 'classified_but_no_confidence');
  try {
    const rows = await fetchNonDraftDocs<{
      id: string;
      suggested_title: string | null;
      filename: string | null;
      classified_at: string | null;
    }>(ctx.sb, 'id, suggested_title, filename, classified_at', (q) =>
      q.not('classified_at', 'is', null).is('classification_confidence', null),
    );
    const sample = rows
      .slice(0, 10)
      .map((r) => `${r.id}: ${docLabel(r)} @ ${r.classified_at}`)
      .join('; ');
    return {
      name: 'classified_but_no_confidence',
      severity,
      status: rows.length ? 'fail' : 'pass',
      threshold:
        '0 rows with classified_at != NULL AND classification_confidence = NULL',
      observed: `found=${rows.length}`,
      diagnostic: rows.length
        ? `Partial classify writes: ${sample} — check classifier write path`
        : '',
      duration_ms: now() - t0,
    };
  } catch (err) {
    return makeFail('classified_but_no_confidence', severity, err);
  }
}

/** 3.12 summary_coverage — classified documents should have summary. */
export async function summary_coverage(ctx: GateContext): Promise<CheckResult> {
  const t0 = now();
  const severity = severityFor(ctx.profileDef, 'summary_coverage');
  try {
    const rows = await fetchNonDraftDocs<{
      id: string;
      suggested_title: string | null;
      filename: string | null;
      content_type: string | null;
    }>(ctx.sb, 'id, suggested_title, filename, content_type', (q) =>
      q.not('classified_at', 'is', null).is('summary', null),
    );
    const sample = rows
      .slice(0, 10)
      .map((r) => `${r.id}: ${docLabel(r)} [${r.content_type ?? '?'}]`)
      .join('; ');
    const ceiling = ctx.profileName === 'batch' ? 10 : 0;
    return {
      name: 'summary_coverage',
      severity,
      status: rows.length > ceiling ? 'fail' : 'pass',
      threshold:
        ceiling === 0
          ? '0 classified rows without summary'
          : `≤ ${ceiling} classified rows without summary (batch profile)`,
      observed: `missing=${rows.length}`,
      diagnostic:
        rows.length > ceiling
          ? `Classified items missing summary: ${sample} — check summariser runner`
          : '',
      duration_ms: now() - t0,
    };
  } catch (err) {
    return makeFail('summary_coverage', severity, err);
  }
}

// ---------------------------------------------------------------------------
// Audit-content helpers
// ---------------------------------------------------------------------------

export function matchFileGroup(
  filename: string,
  groups: Record<string, AuditContentFileGroup>,
): string | null {
  for (const [groupName, def] of Object.entries(groups)) {
    const needles = def.filename_matchers.contains_all;
    const ok = needles.every((n) =>
      filename.toLowerCase().includes(n.toLowerCase()),
    );
    if (ok) return groupName;
  }
  return null;
}

/** bl-495: the audit corpus is now the set of `source_documents` whose
 *  filename matches a configured file_group (spec §2.1 — the client's .docx
 *  bid library; the old content_items rows were per-Q&A-pair, the successor
 *  parent rows are per-document). The old content_type='q_a_pair' +
 *  source_file gate collapses to a filename match: post-id-131 the docx
 *  filename lives on `source_documents.filename` and Q&A pairs are child
 *  `q_a_pairs` rows, not parent rows.
 *
 *  NOTE (spec §2.2): the Stage 2 markdown leg — items tagged
 *  'client-new-markdown-2026' via `user_tags` — has NO successor:
 *  `user_tags` was dropped with content_items (BI-11) and no replacement
 *  tagging surface exists. That leg of the audit scope is retired with it;
 *  the audit corpus is file-group-scoped only. */
async function loadAuditCorpusItems(
  sb: SupabaseClient,
  auditContent: AuditContentExpected,
): Promise<Array<{ id: string; filename: string }>> {
  const rows = await fetchAll<{ id: string; filename: string }>(
    sb,
    'source_documents',
    (q) => q.select('id, filename'),
  );
  return rows.filter(
    (r) =>
      typeof r.filename === 'string' &&
      matchFileGroup(r.filename, auditContent.file_groups) !== null,
  );
}

/** Map audit-scope source_documents ids to their file group. */
async function loadAuditGroupDocIds(
  sb: SupabaseClient,
  auditContent: AuditContentExpected,
): Promise<Record<string, string[]>> {
  const docs = await loadAuditCorpusItems(sb, auditContent);
  const groupToIds: Record<string, string[]> = {};
  for (const d of docs) {
    const group = matchFileGroup(d.filename, auditContent.file_groups);
    if (!group) continue;
    (groupToIds[group] ??= []).push(d.id);
  }
  return groupToIds;
}

// ---------------------------------------------------------------------------
// Audit-content checks (7) — spec §3
// ---------------------------------------------------------------------------

/** 3.1 audit_per_file_qa_count — Q&A pairs extracted per source file group.
 *  bl-495: a Q&A pair is now a `q_a_pairs` row hanging off its parent
 *  source_document (id-131) — count child rows per file-group of parent
 *  documents, which is what this check always measured (extraction yield per
 *  docx), not parent-row counts. */
export async function audit_per_file_qa_count(
  ctx: GateContext,
): Promise<CheckResult> {
  const t0 = now();
  const severity = severityFor(ctx.profileDef, 'audit_per_file_qa_count');
  try {
    if (!ctx.auditContent) {
      return makeSkip(
        'audit_per_file_qa_count',
        severity,
        'audit-content config missing',
      );
    }
    const groupToIds = await loadAuditGroupDocIds(ctx.sb, ctx.auditContent);
    const counts: Record<string, number> = {};
    for (const [group, ids] of Object.entries(groupToIds)) {
      const qaRows = await fetchAllInBatches<{ id: string }>(
        ctx.sb,
        'q_a_pairs',
        ids,
        'source_document_id',
        (q) => q.select('id'),
      );
      counts[group] = qaRows.length;
    }
    const failures: string[] = [];
    const lines: string[] = [];
    for (const [group, def] of Object.entries(ctx.auditContent.file_groups)) {
      const n = counts[group] ?? 0;
      const ok = n >= def.qa_count.min && n <= def.qa_count.max;
      lines.push(
        `${group}=${n}∈[${def.qa_count.min},${def.qa_count.max}]${ok ? '✓' : '✗'}`,
      );
      if (!ok) {
        failures.push(
          `${group} observed=${n} expected=[${def.qa_count.min},${def.qa_count.max}] (${def.description})`,
        );
      }
    }
    return {
      name: 'audit_per_file_qa_count',
      severity,
      status: failures.length ? 'fail' : 'pass',
      threshold: 'per file group Q&A counts within spec ranges',
      observed: lines.join(' '),
      diagnostic: failures.join('; '),
      duration_ms: now() - t0,
    };
  } catch (err) {
    return makeFail('audit_per_file_qa_count', severity, err);
  }
}

/** 3.2 audit_classification_confidence */
export async function audit_classification_confidence(
  ctx: GateContext,
): Promise<CheckResult> {
  const t0 = now();
  const severity = severityFor(
    ctx.profileDef,
    'audit_classification_confidence',
  );
  try {
    if (!ctx.auditContent) {
      return makeSkip(
        'audit_classification_confidence',
        severity,
        'audit-content config missing',
      );
    }
    // bl-495: classification lives on the parent `source_documents` row
    // (id-131 — Q&A pairs are no longer individually classified rows), so
    // the hi-confidence ratio is now measured per DOCUMENT in each file
    // group rather than per Q&A pair. Intent unchanged: the audit corpus
    // must be classified with high confidence — granularity is coarser
    // because that is where classification actually happens now.
    const rows = await fetchAll<{
      id: string;
      filename: string;
      classification_confidence: number | null;
    }>(ctx.sb, 'source_documents', (q) =>
      q.select('id, filename, classification_confidence'),
    );
    const byGroup: Record<string, { hi: number; total: number }> = {};
    for (const r of rows) {
      if (typeof r.filename !== 'string') continue;
      const group = matchFileGroup(r.filename, ctx.auditContent.file_groups);
      if (!group) continue;
      byGroup[group] ??= { hi: 0, total: 0 };
      byGroup[group].total += 1;
      if (
        typeof r.classification_confidence === 'number' &&
        r.classification_confidence >=
          ctx.auditContent.classification_confidence_threshold
      ) {
        byGroup[group].hi += 1;
      }
    }
    const min = ctx.auditContent.classification_confidence_min_ratio;
    const failures: string[] = [];
    const lines: string[] = [];
    for (const [group, { hi, total }] of Object.entries(byGroup)) {
      const ratio = total === 0 ? 1 : hi / total;
      const ok = ratio >= min;
      lines.push(`${group}=${fmtRatio(ratio)}/≥${fmtRatio(min)}`);
      if (!ok) {
        failures.push(
          `${group} hi-conf ratio=${fmtRatio(ratio)} (${hi}/${total}) below ${fmtRatio(min)}`,
        );
      }
    }
    return {
      name: 'audit_classification_confidence',
      severity,
      status: failures.length ? 'fail' : 'pass',
      threshold: `per-group hi-conf ratio ≥ ${fmtRatio(min)} (confidence ≥ ${ctx.auditContent.classification_confidence_threshold})`,
      observed: lines.join(' '),
      diagnostic: failures.join('; '),
      duration_ms: now() - t0,
    };
  } catch (err) {
    return makeFail('audit_classification_confidence', severity, err);
  }
}

/** 3.3 audit_required_entities */
export async function audit_required_entities(
  ctx: GateContext,
): Promise<CheckResult> {
  const t0 = now();
  const severity = severityFor(ctx.profileDef, 'audit_required_entities');
  try {
    if (!ctx.auditContent) {
      return makeSkip(
        'audit_required_entities',
        severity,
        'audit-content config missing',
      );
    }
    const corpusItems = await loadAuditCorpusItems(ctx.sb, ctx.auditContent);
    const itemIds = corpusItems.map((r) => r.id);
    const mentionRows = await fetchAllInBatches<{
      canonical_name: string;
      entity_type: string;
    }>(ctx.sb, 'entity_mentions', itemIds, 'source_document_id', (q) =>
      q.select('canonical_name, entity_type'),
    );
    const foundByType = new Set<string>();
    for (const row of mentionRows) {
      const name = row.canonical_name?.toLowerCase();
      const type = row.entity_type?.toLowerCase();
      if (name) foundByType.add(`${name}|${type}`);
    }
    // Resolve the {CLIENT_ORGANISATION_NAME} placeholder in accept_any_of
    // entries from client config, so the client identity is not hardcoded in
    // the expectations JSON. Lazy import keeps the branding loader out of the
    // CLI script's parse-time module graph.
    const { CLIENT_CONFIG } = await import('@/lib/client-config');
    const clientOrgName = CLIENT_CONFIG.entity_examples.organisation_name;
    const resolveEntityToken = (n: string): string =>
      n.replaceAll('{CLIENT_ORGANISATION_NAME}', clientOrgName);

    const missingRequired: string[] = [];
    for (const req of ctx.auditContent.required_entities) {
      const any = req.accept_any_of.some((n) =>
        foundByType.has(
          `${resolveEntityToken(n).toLowerCase()}|${req.entity_type.toLowerCase()}`,
        ),
      );
      if (!any) {
        missingRequired.push(
          `${req.entity_type}:(${req.accept_any_of.map(resolveEntityToken).join('|')})`,
        );
      }
    }
    const missingShould: string[] = [];
    for (const want of ctx.auditContent.should_pass_entities) {
      const any = want.accept_any_of.some((n) =>
        foundByType.has(`${n.toLowerCase()}|${want.entity_type.toLowerCase()}`),
      );
      if (!any) {
        missingShould.push(
          `${want.entity_type}:(${want.accept_any_of.join('|')})`,
        );
      }
    }
    const status: Status = missingRequired.length
      ? 'fail'
      : missingShould.length
        ? 'warn'
        : 'pass';
    const diagnostic = [
      missingRequired.length
        ? `MISSING required: ${missingRequired.join(', ')}`
        : '',
      missingShould.length
        ? `missing should-pass (warn): ${missingShould.join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join(' — ');
    return {
      name: 'audit_required_entities',
      severity,
      status,
      threshold: 'all required entities present in corpus entity_mentions',
      observed: `required_missing=${missingRequired.length} should_missing=${missingShould.length}`,
      diagnostic,
      duration_ms: now() - t0,
    };
  } catch (err) {
    return makeFail('audit_required_entities', severity, err);
  }
}

/** 3.4 audit_required_relationships */
export async function audit_required_relationships(
  ctx: GateContext,
): Promise<CheckResult> {
  const t0 = now();
  const severity = severityFor(ctx.profileDef, 'audit_required_relationships');
  try {
    if (!ctx.auditContent) {
      return makeSkip(
        'audit_required_relationships',
        severity,
        'audit-content config missing',
      );
    }
    const corpusItems = await loadAuditCorpusItems(ctx.sb, ctx.auditContent);
    const itemIds = corpusItems.map((r) => r.id);
    const relRows = await fetchAllInBatches<{ relationship_type: string }>(
      ctx.sb,
      'entity_relationships',
      itemIds,
      'source_document_id',
      (q) => q.select('relationship_type'),
    );
    const foundTypes = new Set<string>();
    for (const row of relRows) {
      const t = row.relationship_type?.toLowerCase();
      if (t) foundTypes.add(t);
    }
    const missingRequired = ctx.auditContent.required_relationship_types.filter(
      (t) => !foundTypes.has(t.toLowerCase()),
    );
    const missingShould =
      ctx.auditContent.should_pass_relationship_types.filter(
        (t) => !foundTypes.has(t.toLowerCase()),
      );
    const status: Status = missingRequired.length
      ? 'fail'
      : missingShould.length
        ? 'warn'
        : 'pass';
    const diagnostic = [
      missingRequired.length
        ? `MISSING required: ${missingRequired.join(', ')}`
        : '',
      missingShould.length
        ? `missing should-pass (warn): ${missingShould.join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join(' — ');
    return {
      name: 'audit_required_relationships',
      severity,
      status,
      threshold:
        'all required relationship types present in corpus entity_relationships',
      observed: `required_missing=${missingRequired.length} should_missing=${missingShould.length}`,
      diagnostic,
      duration_ms: now() - t0,
    };
  } catch (err) {
    return makeFail('audit_required_relationships', severity, err);
  }
}

/** 3.5 audit_chunk_count_per_doc */
export async function audit_chunk_count_per_doc(
  ctx: GateContext,
): Promise<CheckResult> {
  const t0 = now();
  const severity = severityFor(ctx.profileDef, 'audit_chunk_count_per_doc');
  try {
    if (!ctx.auditContent) {
      return makeSkip(
        'audit_chunk_count_per_doc',
        severity,
        'audit-content config missing',
      );
    }
    // bl-495: content_chunks already hang off source_documents
    // (source_document_id, id-131 re-parent) — group the audit-scope parent
    // documents by filename and count their chunks.
    const groupToIds = await loadAuditGroupDocIds(ctx.sb, ctx.auditContent);
    const failures: string[] = [];
    const lines: string[] = [];
    for (const [group, def] of Object.entries(ctx.auditContent.file_groups)) {
      const ids = groupToIds[group] ?? [];
      let chunkTotal = 0;
      const BATCH = 500;
      for (let i = 0; i < ids.length; i += BATCH) {
        const slice = ids.slice(i, i + BATCH);
        const { count, error } = await ctx.sb
          .from('content_chunks')
          .select('id', { count: 'exact', head: true })
          .in('source_document_id', slice);
        if (error) throw error;
        chunkTotal += count ?? 0;
      }
      const ok =
        chunkTotal >= def.chunk_count.min && chunkTotal <= def.chunk_count.max;
      lines.push(
        `${group}=${chunkTotal}∈[${def.chunk_count.min},${def.chunk_count.max}]${ok ? '✓' : '✗'}`,
      );
      if (!ok) {
        const hint =
          chunkTotal < def.chunk_count.min
            ? 'too low — likely chunk emission skipped at ingest'
            : 'too high — likely duplicate chunk emission';
        failures.push(
          `${group} chunks=${chunkTotal} expected=[${def.chunk_count.min},${def.chunk_count.max}]: ${hint}`,
        );
      }
    }
    return {
      name: 'audit_chunk_count_per_doc',
      severity,
      status: failures.length ? 'fail' : 'pass',
      threshold: 'per group chunk totals within spec ranges',
      observed: lines.join(' '),
      diagnostic: failures.join('; '),
      duration_ms: now() - t0,
    };
  } catch (err) {
    return makeFail('audit_chunk_count_per_doc', severity, err);
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

// bl-495 (id-131 drop): dedup_status_reconciled, suspected_duplicate_backlog
// and history_v1_present RETIRED — the dedup family and content_history were
// dropped with content_items and have no successor (12 generic checks → 9).
export const GENERIC_CHECKS: Array<{ name: string; fn: CheckFn }> = [
  { name: 'corpus_counts', fn: corpus_counts },
  { name: 'embedding_coverage', fn: embedding_coverage },
  { name: 'chunk_coverage', fn: chunk_coverage },
  { name: 'entity_mention_coverage', fn: entity_mention_coverage },
  { name: 'entity_relationship_coverage', fn: entity_relationship_coverage },
  { name: 'classified_domains_not_empty', fn: classified_domains_not_empty },
  { name: 'guide_domain_filter_resolves', fn: guide_domain_filter_resolves },
  { name: 'classified_but_no_confidence', fn: classified_but_no_confidence },
  { name: 'summary_coverage', fn: summary_coverage },
];

// bl-495 (id-131 drop): audit_cross_doc_dedup_ratio + audit_unresolved_dedup_24h
// RETIRED — dedup family dropped, no successor (7 audit checks → 5).
export const AUDIT_CHECKS: Array<{ name: string; fn: CheckFn }> = [
  { name: 'audit_per_file_qa_count', fn: audit_per_file_qa_count },
  {
    name: 'audit_classification_confidence',
    fn: audit_classification_confidence,
  },
  { name: 'audit_required_entities', fn: audit_required_entities },
  { name: 'audit_required_relationships', fn: audit_required_relationships },
  { name: 'audit_chunk_count_per_doc', fn: audit_chunk_count_per_doc },
];

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export function selectChecks(
  all: Array<{ name: string; fn: CheckFn }>,
  include: string[],
  exclude: string[],
): Array<{ name: string; fn: CheckFn }> {
  let selected = all;
  if (include.length > 0) {
    selected = selected.filter((c) => include.includes(c.name));
  }
  if (exclude.length > 0) {
    selected = selected.filter((c) => !exclude.includes(c.name));
  }
  return selected;
}

export function overallVerdict(
  results: CheckResult[],
  failOn: FailOn,
): 'pass' | 'fail' | 'warn' {
  if (failOn === 'never') {
    return results.some((r) => r.status === 'fail' || r.status === 'warn')
      ? 'warn'
      : 'pass';
  }
  const mustFailures = results.filter(
    (r) => r.severity === 'must-pass' && r.status === 'fail',
  );
  if (mustFailures.length > 0) return 'fail';
  if (failOn === 'any') {
    const anyFail = results.some((r) => r.status === 'fail');
    if (anyFail) return 'fail';
  }
  const anyWarn = results.some(
    (r) => r.status === 'warn' || r.status === 'fail',
  );
  return anyWarn ? 'warn' : 'pass';
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

export function renderMarkdown(
  envelope: GateEnvelope,
  profileName: string,
): string {
  const must = envelope.checks.filter((r) => r.severity === 'must-pass');
  const should = envelope.checks.filter((r) => r.severity === 'should-pass');
  const failed = envelope.checks.filter((r) => r.status === 'fail');
  const warned = envelope.checks.filter((r) => r.status === 'warn');
  const passed = envelope.checks.filter((r) => r.status === 'pass');
  const skipped = envelope.checks.filter((r) => r.status === 'skipped');

  const lines: string[] = [];
  lines.push(`# Quality Gate Report — ${envelope.timestamp}`);
  lines.push('');
  lines.push(`**Profile:** ${profileName}`);
  lines.push(`**Project:** ${envelope.workspace_id}`);
  lines.push(`**Run ID:** ${envelope.run_id}`);
  lines.push(`**Git SHA:** ${envelope.git_sha || '(not in git worktree)'}`);
  lines.push(`**Overall:** ${envelope.overall.toUpperCase()}`);
  lines.push(
    `**Run duration:** ${(envelope.run_duration_ms / 1000).toFixed(2)}s`,
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(
    `- ${envelope.checks.length} checks total (${must.length} MUST-PASS, ${should.length} SHOULD-PASS)`,
  );
  lines.push(`- ${passed.length} passed`);
  lines.push(`- ${warned.length} warning`);
  lines.push(`- ${failed.length} failed`);
  if (skipped.length > 0) lines.push(`- ${skipped.length} skipped`);
  lines.push('');

  if (failed.length > 0) {
    lines.push('## Failed Checks');
    lines.push('');
    for (const r of failed) {
      lines.push(`### ❌ \`${r.name}\` (${r.severity})`);
      lines.push('');
      lines.push(`- **Threshold:** ${r.threshold}`);
      lines.push(`- **Observed:** ${r.observed}`);
      lines.push(`- **Diagnostic:** ${r.diagnostic}`);
      lines.push(`- **Duration:** ${r.duration_ms}ms`);
      lines.push('');
    }
  }

  if (warned.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const r of warned) {
      lines.push(`### ⚠️ \`${r.name}\` (${r.severity})`);
      lines.push('');
      lines.push(`- **Threshold:** ${r.threshold}`);
      lines.push(`- **Observed:** ${r.observed}`);
      lines.push(`- **Diagnostic:** ${r.diagnostic}`);
      lines.push(`- **Duration:** ${r.duration_ms}ms`);
      lines.push('');
    }
  }

  if (skipped.length > 0) {
    lines.push('## Skipped Checks');
    lines.push('');
    for (const r of skipped) {
      lines.push(`- \`${r.name}\`: ${r.diagnostic}`);
    }
    lines.push('');
  }

  lines.push('## Passed Checks');
  lines.push('');
  for (const r of passed) {
    lines.push(
      `- ✅ \`${r.name}\` (${r.severity}) — ${r.observed || '—'} — ${r.duration_ms}ms`,
    );
  }
  lines.push('');

  return lines.join('\n');
}

export function renderJson(envelope: GateEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

// ---------------------------------------------------------------------------
// Output path resolution
// ---------------------------------------------------------------------------

export function defaultOutputPath(
  profileName: string,
  format: Format,
  ts: string,
): string {
  const clean = ts.replace(/[:.]/g, '-');
  const ext = format === 'json' ? 'json' : 'md';
  const prefix =
    profileName === 'audit-content'
      ? 'audit-content-gate'
      : `quality-gate-${profileName}`;
  return resolve(DEFAULT_REPORT_DIR, `${prefix}-${clean}.${ext}`);
}

export function writeReport(path: string, content: string): void {
  if (path === '-') {
    process.stdout.write(content);
    if (!content.endsWith('\n')) process.stdout.write('\n');
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runGate(
  args: CliArgs,
): Promise<{ envelope: GateEnvelope; exitCode: number }> {
  const profiles = loadProfiles();
  const corpus = loadCorpusExpected();
  const entityCov = loadEntityCoverageExpected();
  const relCov = loadRelationshipCoverageExpected();

  if (args.threshold && args.profile) {
    throw new Error(
      '--threshold and --profile are mutually exclusive. Pick one.',
    );
  }
  const isAuditProfile = args.profile === 'audit-content';
  const profileName = args.profile ?? args.threshold ?? 're-ingest';
  const profileDef = resolveProfile(profiles, profileName);

  const { sb, workspaceId } = createSb(args.env);

  let auditContent: AuditContentExpected | undefined;
  if (isAuditProfile) {
    auditContent = loadAuditContentExpected();
  }

  // UUIDv7 per spec §4.2 — time-ordered so reports correlate chronologically.
  // Bun.randomUUIDv7 available since Bun 1.1. Prefix 'qg_' dropped to keep
  // JSON.parseable as a plain UUID string.
  const runId = Bun.randomUUIDv7();
  const gitSha = tryGitSha();
  const timestamp = new Date().toISOString();

  // audit-content delegates severity of generic checks to its invokes_profile
  const innerProfileName = isAuditProfile
    ? (profileDef.invokes_profile ?? 're-ingest')
    : profileName;
  const innerProfileDef = isAuditProfile
    ? resolveProfile(profiles, innerProfileName)
    : profileDef;

  const genericCtx: GateContext = {
    sb,
    profileName: innerProfileName,
    profileDef: innerProfileDef,
    corpus,
    entityCov,
    relCov,
    auditContent,
    workspaceId,
    runId,
    gitSha,
    timestamp,
  };

  const t0 = now();
  const selectedGeneric = selectChecks(
    GENERIC_CHECKS,
    args.includeChecks,
    args.excludeChecks,
  );
  const genericResults: CheckResult[] = [];
  for (const { fn } of selectedGeneric) {
    const r = await fn(genericCtx);
    genericResults.push(r);
  }

  let auditResults: CheckResult[] = [];
  if (isAuditProfile) {
    const genericMustFail = genericResults.some(
      (r) => r.severity === 'must-pass' && r.status === 'fail',
    );
    if (genericMustFail) {
      auditResults = AUDIT_CHECKS.filter(
        (c) =>
          args.includeChecks.length === 0 ||
          args.includeChecks.includes(c.name),
      )
        .filter((c) => !args.excludeChecks.includes(c.name))
        .map((c) =>
          makeSkip(
            c.name,
            severityFor(profileDef, c.name),
            'Generic gate MUST-PASS failed — audit-content checks short-circuited',
          ),
        );
    } else {
      const auditCtx: GateContext = { ...genericCtx, profileDef };
      const selectedAudit = selectChecks(
        AUDIT_CHECKS,
        args.includeChecks,
        args.excludeChecks,
      );
      for (const { fn } of selectedAudit) {
        const r = await fn(auditCtx);
        auditResults.push(r);
      }
    }
  }

  const allResults = [...genericResults, ...auditResults];
  const overall = overallVerdict(allResults, args.failOn);
  const envelope: GateEnvelope = {
    run_id: runId,
    git_sha: gitSha,
    timestamp,
    profile: profileName,
    workspace_id: workspaceId,
    overall,
    run_duration_ms: now() - t0,
    checks: allResults,
  };

  const exitCode =
    args.failOn === 'never'
      ? 0
      : overall === 'fail'
        ? 1
        : args.failOn === 'any' && overall === 'warn'
          ? 1
          : 0;
  return { envelope, exitCode };
}

async function main(): Promise<void> {
  const args = parseCli(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP_TEXT.trim() + '\n');
    process.exit(0);
  }
  try {
    const { envelope, exitCode } = await runGate(args);
    const profileName = args.profile ?? args.threshold ?? 're-ingest';
    const out =
      args.format === 'json'
        ? renderJson(envelope)
        : renderMarkdown(envelope, profileName);
    const outputPath =
      args.output ??
      defaultOutputPath(profileName, args.format, envelope.timestamp);
    writeReport(outputPath, out);
    if (outputPath !== '-') {
      process.stdout.write(
        `Report: ${outputPath}\nOverall: ${envelope.overall} (exit=${exitCode})\n`,
      );
    }
    process.exit(exitCode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`quality-gate: ${msg}\n`);
    process.exit(2);
  }
}

if (import.meta.main) {
  await main();
}

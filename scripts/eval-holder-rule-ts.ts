#!/usr/bin/env bun
/**
 * eval-holder-rule-ts.ts — TS classifier holder-rule eval (§1.16 / §12).
 *
 * Holder-rule eval for TS-written metadata.
 * Evaluates the TS classifier's `entity_mentions.metadata.holder` derivation
 * against ground-truth `holds` relationships in `entity_relationships`.
 *
 * Modes:
 *   --mode=snapshot  Read-only dump of current entity_mentions +
 *                    entity_relationships for target items (pre-eval safety
 *                    snapshot per spec §12.2).
 *   --mode=run       Destructive: calls classifyContent({ force: true,
 *                    validate: false }) against target items, reads back
 *                    metadata, compares vs ground truth, emits pass/fail
 *                    per threshold.
 *
 * CLI args:
 *   --mode=snapshot | run            (required)
 *   --output=<path>                  (default: stdout for snapshot, console
 *                                     table for run)
 *   --item-ids=<csv>                 (optional; omit to run against the full
 *                                     ground-truth set)
 *   --dry-run                        (run mode only: do not invoke
 *                                     classifyContent; report what would run)
 *
 * Thresholds (per spec §12.3):
 *   - 100% holder coverage on holds-linked cert mentions
 *   - 3/3 positive control recall (items known to have holder: 'self')
 *   - 78/78 precision (no false-self on supplier items)
 *   - 2/2 residual-item correction (9e8fafee DBS + 7e511dbc USB-ports)
 *
 * Exit codes:
 *   0 = success (snapshot complete, or run passed thresholds)
 *   1 = thresholds not met
 *   2 = configuration / env error
 *
 * Usage:
 *   bun run scripts/eval-holder-rule-ts.ts --mode=snapshot
 *   bun run scripts/eval-holder-rule-ts.ts --mode=snapshot --output=docs/audits/ts-eval-preflight-2026-04-25.json
 *   bun run scripts/eval-holder-rule-ts.ts --mode=run
 *   bun run scripts/eval-holder-rule-ts.ts --mode=run --dry-run
 *   bun run scripts/eval-holder-rule-ts.ts --mode=run --item-ids=9e8fafee,7e511dbc
 *
 * NOTE: Run with dangerouslyDisableSandbox: true in Claude Code — Bun fetch
 * hangs behind the sandbox SOCKS proxy on Supabase reads.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { spawn } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/supabase/types/database.types';
import { prodProjectRef } from '@/scripts/lib/project-refs';

// ──────────────────────────────────────────
// Env loading (same pattern as other eval scripts)
// ──────────────────────────────────────────

function loadEnvFile(path: string): void {
  try {
    const content = readFileSync(path, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
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
  } catch {
    // File does not exist — acceptable
  }
}

const PROJECT_ROOT = new URL('..', import.meta.url).pathname;
loadEnvFile(`${PROJECT_ROOT}.env.local`);
loadEnvFile(`${PROJECT_ROOT}.env`);

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

/**
 * Client organisation name (lowercased) for holder attribution comparison.
 *
 * Resolved at runtime from `BRANDING.organisationName.toLowerCase()` — the
 * same value the production classifier (`deriveHolderMetadata`) uses for the
 * self-vs-supplier split — so the client identity is never hardcoded in this
 * repo. `BRANDING` is driven by `NEXT_PUBLIC_CLIENT_ID`; see
 * `resolveClientOrgLower()`, called at the top of `main()`.
 */
let CLIENT_ORG_LOWER = '';

/**
 * Resolve the client organisation name (lowercased) from the active branding
 * config. Imported lazily to keep the eval script decoupled from Next.js
 * module resolution at parse time (BRANDING depends on Zod parse + branding
 * JSON + env vars that may not be set in script context). Must run before any
 * holder-attribution comparison uses `CLIENT_ORG_LOWER`.
 */
async function resolveClientOrgLower(): Promise<void> {
  const { BRANDING } = await import('@/lib/client-config');
  CLIENT_ORG_LOWER = BRANDING.organisationName.toLowerCase();
}

/**
 * Pipeline service account UUID for `classifyContent` calls.
 * Provisioned by: supabase/migrations/20260406180000_create_pipeline_service_account.sql
 */
const PIPELINE_SERVICE_ACCOUNT_USER_ID = 'a0000000-0000-4000-8000-000000000001';

/**
 * Short-form prefixes for the 2 residual items from spec §13.4.
 * These items had null-holder entity mentions from the TS path before the
 * holder rule shipped. After re-classification they must carry
 * `metadata.holder = 'self'`.
 *
 * - 9e8fafee: DBS screening Q&A
 * - 7e511dbc: USB ports Q&A
 *
 * Full UUIDs are resolved at runtime via a prefix-match query against
 * content_items (the spec uses short-form prefixes; full UUIDs are not
 * committed to avoid stale references).
 */
const RESIDUAL_SHORT_PREFIXES = ['9e8fafee', '7e511dbc'] as const;

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

interface HoldsRelationship {
  id: string;
  source_entity: string;
  target_entity: string;
  relationship_type: string;
  source_item_id: string | null;
  confidence: number | null;
}

interface EntityMention {
  id: string;
  content_item_id: string;
  entity_type: string;
  entity_name: string;
  canonical_name: string;
  confidence: number | null;
  context_snippet: string | null;
  metadata: Json | null;
}

interface SnapshotItem {
  item_id: string;
  title: string | null;
  entity_mentions: EntityMention[];
  holds_relationships: HoldsRelationship[];
}

interface SnapshotOutput {
  generated_at: string;
  mode: 'snapshot';
  supabase_project: string;
  client_org: string;
  total_holds_relationships: number;
  unique_content_items: number;
  residual_items_included: string[];
  items: Record<string, SnapshotItem>;
}

interface RunItemResult {
  item_id: string;
  title: string | null;
  status: 'pass' | 'fail' | 'error' | 'skipped';
  error?: string;
  cert_mentions_with_holds: number;
  cert_mentions_with_holder_metadata: number;
  holder_coverage: number;
  self_count: number;
  supplier_count: number;
  precision_regressions: PrecisionRegression[];
}

interface PrecisionRegression {
  canonical_name: string;
  expected_holder: 'self' | 'supplier';
  actual_holder: string | null;
  source_entity: string;
}

interface RunOutput {
  generated_at: string;
  mode: 'run';
  dry_run: boolean;
  supabase_project: string;
  client_org: string;
  total_holds_relationships: number;
  unique_content_items: number;
  items_evaluated: number;
  thresholds: {
    holder_coverage: { expected: number; actual: number; passed: boolean };
    positive_control_recall: {
      expected: number;
      actual: number;
      passed: boolean;
    };
    precision: { expected: number; actual: number; passed: boolean };
    residual_correction: { expected: number; actual: number; passed: boolean };
  };
  all_passed: boolean;
  per_item: RunItemResult[];
}

interface CliArgs {
  mode: 'snapshot' | 'run';
  output: string | null;
  itemIds: string[] | null;
  dryRun: boolean;
  env: string;
  // ID-101 §{101.9} PC-6 lane 3 — cross-path parity. When `path` is set the
  // script runs the parity comparator INSTEAD of the snapshot/run flows;
  // `mode` is ignored in that case (it stays 'run' as a harmless default so
  // the existing `--mode=run` byte path is never reached). `runs` is N≥3.
  path: 'cocoindex' | 'legacy' | 'both' | null;
  runs: number;
}

// ──────────────────────────────────────────
// Cross-path parity types (ID-101 §{101.9}, PC-6 lane 3)
// ──────────────────────────────────────────

/** A canonicalised relationship triple — the Inv-2 comparison unit. */
interface Triple {
  source_entity: string;
  relationship_type: string;
  target_entity: string;
}

/** Per-cert holder state — the Inv-9 comparison unit. */
interface HolderState {
  holder: 'self' | 'supplier';
  supplier_name?: string;
}

/** One document's cocoindex-path extraction output (from the Python driver). */
interface CocoindexDocResult {
  item_id: string;
  triples: Triple[];
  holder_states: Record<string, HolderState>;
  holder_diagnostics: Record<
    string,
    {
      per_mention_canonical: string;
      relationship_canonical: string;
      cert_space_mismatch: boolean;
      client_org_space_mismatch: boolean;
    }
  >;
  error?: string;
}

interface CocoindexDriverOutput {
  documents: CocoindexDocResult[];
}

/** Triple-set comparison for a SINGLE run of one document (Inv-2). */
interface TripleSetComparison {
  both: Triple[];
  legacyOnly: Triple[];
  cocoOnly: Triple[];
}

/**
 * Holder-state divergence bucket for one cert (Inv-9). `match` = identical
 * holder state across paths; `parity_failure` = a genuine cross-path mismatch;
 * `expected_ts_space_mismatch` = a mismatch attributable to one of the two
 * bl-288 TS-oracle canonical-space bugs the Python port fixes (bucketed
 * SEPARATELY, never counted as a parity failure).
 */
type HolderBucket = 'match' | 'parity_failure' | 'expected_ts_space_mismatch';

interface HolderComparison {
  canonical_name: string;
  legacy: HolderState | null;
  cocoindex: HolderState | null;
  bucket: HolderBucket;
  reason: string;
}

// ──────────────────────────────────────────
// CLI argument parsing
// ──────────────────────────────────────────

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let mode: 'snapshot' | 'run' | null = null;
  let output: string | null = null;
  let itemIds: string[] | null = null;
  let dryRun = false;
  let env = '';
  let path: 'cocoindex' | 'legacy' | 'both' | null = null;
  let runs = 3; // PC-6 lane 3 default: N≥3 recurrence gate.

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (value !== 'snapshot' && value !== 'run') {
        logError(
          `Invalid --mode value: "${value}". Must be "snapshot" or "run".`,
        );
        process.exit(2);
      }
      mode = value;
    } else if (arg.startsWith('--path=')) {
      const value = arg.slice('--path='.length);
      if (value !== 'cocoindex' && value !== 'legacy' && value !== 'both') {
        logError(
          `Invalid --path value: "${value}". Must be "cocoindex", "legacy", or "both".`,
        );
        process.exit(2);
      }
      path = value;
    } else if (arg.startsWith('--runs=')) {
      const value = Number.parseInt(arg.slice('--runs='.length), 10);
      if (!Number.isInteger(value) || value < 1) {
        logError(
          `Invalid --runs value: "${arg.slice('--runs='.length)}". Must be a positive integer.`,
        );
        process.exit(2);
      }
      runs = value;
    } else if (arg.startsWith('--output=')) {
      output = arg.slice('--output='.length);
    } else if (arg.startsWith('--item-ids=')) {
      itemIds = arg
        .slice('--item-ids='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--env=')) {
      env = arg.slice('--env='.length);
    } else if (arg === '--env' && args[i + 1]) {
      env = args[i + 1];
      i++;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      logError(`Unknown argument: "${arg}". Use --help for usage.`);
      process.exit(2);
    }
  }

  // ID-101 §{101.9}: --path selects the cross-path parity flow and makes
  // --mode optional (mode is irrelevant under --path). Without --path the
  // original contract holds: --mode is required.
  if (!path && !mode) {
    logError('--mode is required (or use --path=both for cross-path parity).');
    process.exit(2);
  }

  if (dryRun && mode !== 'run' && !path) {
    logError('--dry-run is only valid with --mode=run or --path=...');
    process.exit(2);
  }

  // Default mode to 'run' under --path so the CliArgs shape is satisfied; the
  // run flow is never reached because main() routes to runParity() first.
  return { mode: mode ?? 'run', output, itemIds, dryRun, env, path, runs };
}

function printUsage(): void {
  const usage = `
Usage: bun run scripts/eval-holder-rule-ts.ts --mode=<snapshot|run> [options]

Modes:
  --mode=snapshot   Read-only dump of current entity data for target items.
  --mode=run        Re-classify target items and verify holder metadata.

Cross-path parity (ID-101 §{101.9}, PC-6 lane 3 — overrides --mode):
  --path=both       Compare LEGACY (persisted TS oracle of record) vs COCOINDEX
                    (in-memory Python driver) over the pinned corpus: triple-set
                    equality after canonicalisation (Inv-2, order-tolerant, N≥3
                    recurrence rule) + per-cert holder-state match (Inv-9), with
                    bl-288 expected-class divergences bucketed separately. ZERO
                    DB writes.
  --path=legacy     Read-only: emit the persisted TS-oracle triples/holders only.
  --path=cocoindex  Emit the in-memory cocoindex-path triples/holders only.
  --runs=<N>        Cocoindex runs for the N≥3 recurrence gate (default: 3).

Options:
  --output=<path>   Write output to file (default: stdout for snapshot/parity).
  --item-ids=<csv>  Comma-separated item ID prefixes (default: all holds items).
  --dry-run         Run/parity mode: report the plan without classifying/LLM.
  --env=prod        Asserts SUPABASE_URL points at current prod
                    (the client production project; ref from PROD_PROJECT_REF). Override invocation:
                    SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key>
                    bun run scripts/eval-holder-rule-ts.ts --mode=run --env=prod
  --help            Show this help message.

DESTRUCTIVE WARNING: --mode=run rebuilds entity_mentions on the live DB
via classifyContent({ force: true }). Always pass --env=prod when running
against production to assert URL is prod-pointed.

Examples:
  bun run scripts/eval-holder-rule-ts.ts --mode=snapshot --output=docs/audits/ts-eval-preflight-2026-04-25.json
  bun run scripts/eval-holder-rule-ts.ts --mode=run --env=prod
  bun run scripts/eval-holder-rule-ts.ts --mode=run --item-ids=9e8fafee,7e511dbc --dry-run
`.trim();
  process.stderr.write(usage + '\n');
}

// ──────────────────────────────────────────
// --env=prod opt-in
// ──────────────────────────────────────────

/**
 * --env=prod opt-in: assert SUPABASE_URL is prod-pointed.
 *
 * Per WP-S5.2 spec v1.1 §7.1, the flag DOES NOT swap env values — it only
 * **asserts** the env-resolved URL points at prod. Critical for this
 * script because --mode=run is destructive (rebuilds entity_mentions).
 */
function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(prodProjectRef())) {
    logError(
      `--env=prod set but SUPABASE_URL does not include '${prodProjectRef()}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<prod-svc-key> bun run scripts/eval-holder-rule-ts.ts --mode=run --env=prod`,
    );
    process.exit(2);
  }
}

// ──────────────────────────────────────────
// Logging helpers (all to stderr so stdout is clean for --output)
// ──────────────────────────────────────────

function log(message: string): void {
  process.stderr.write(`[eval-holder] ${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`[eval-holder] ERROR: ${message}\n`);
}

// ──────────────────────────────────────────
// Supabase client
// ──────────────────────────────────────────

function createServiceRoleClient(): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    logError('SUPABASE_URL is not set. Check .env or .env.local.');
    process.exit(2);
  }
  if (!key) {
    logError('SUPABASE_SERVICE_ROLE_KEY is not set. Check .env or .env.local.');
    process.exit(2);
  }

  // Normalise URL to include https:// prefix if missing
  const normalisedUrl = url.startsWith('http') ? url : `https://${url}`;

  return createClient<Database>(normalisedUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ──────────────────────────────────────────
// Data fetching
// ──────────────────────────────────────────

/**
 * Fetch all entity_relationships with relationship_type = 'holds'.
 */
async function fetchHoldsRelationships(
  supabase: SupabaseClient<Database>,
): Promise<HoldsRelationship[]> {
  const { data, error } = await supabase
    .from('entity_relationships')
    .select(
      'id, source_entity, target_entity, relationship_type, source_item_id, confidence',
    )
    .eq('relationship_type', 'holds')
    .order('source_entity');

  if (error) {
    throw new Error(`Failed to fetch holds relationships: ${error.message}`);
  }

  return (data ?? []) as HoldsRelationship[];
}

/**
 * Fetch entity_mentions for a given content item.
 */
async function fetchEntityMentions(
  supabase: SupabaseClient<Database>,
  itemId: string,
): Promise<EntityMention[]> {
  const { data, error } = await supabase
    .from('entity_mentions')
    .select(
      'id, content_item_id, entity_type, entity_name, canonical_name, confidence, context_snippet, metadata',
    )
    .eq('content_item_id', itemId);

  if (error) {
    throw new Error(
      `Failed to fetch entity_mentions for ${itemId}: ${error.message}`,
    );
  }

  return (data ?? []) as EntityMention[];
}

/**
 * Fetch title for a content item.
 */
async function fetchItemTitle(
  supabase: SupabaseClient<Database>,
  itemId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('content_items')
    .select('title')
    .eq('id', itemId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to fetch content_items title for ${itemId}: ${error.message}`,
    );
  }

  return data?.title ?? null;
}

/**
 * Group holds relationships by source_item_id.
 */
function groupBySourceItem(
  rels: HoldsRelationship[],
): Map<string, HoldsRelationship[]> {
  const map = new Map<string, HoldsRelationship[]>();
  for (const rel of rels) {
    if (!rel.source_item_id) continue;
    const existing = map.get(rel.source_item_id);
    if (existing) {
      existing.push(rel);
    } else {
      map.set(rel.source_item_id, [rel]);
    }
  }
  return map;
}

/**
 * Resolve full item IDs from short prefixes by matching against the
 * known set of item IDs from holds relationships.
 */
function resolveItemIds(prefixes: string[], knownIds: string[]): string[] {
  const resolved: string[] = [];
  for (const prefix of prefixes) {
    const matches = knownIds.filter((id) => id.startsWith(prefix));
    if (matches.length === 1) {
      resolved.push(matches[0]);
    } else if (matches.length === 0) {
      // If no match in holds set, try to use as-is (might be a full UUID
      // or a residual item not in the holds set)
      resolved.push(prefix);
    } else {
      logError(
        `Ambiguous prefix "${prefix}" matches ${matches.length} items: ${matches.join(', ')}`,
      );
      process.exit(2);
    }
  }
  return resolved;
}

/**
 * Resolve residual item IDs. We look them up from content_items since
 * residual items may not have holds relationships.
 *
 * Supabase UUID columns do not support LIKE — we use `id::text` via
 * an RPC-free approach: fetch a broader set and filter client-side.
 * With only ~500 content items on prod 'r', fetching all IDs is cheap.
 */
async function resolveResidualItemIds(
  supabase: SupabaseClient<Database>,
): Promise<string[]> {
  const { data, error } = await supabase.from('content_items').select('id');

  if (error) {
    log(
      `Warning: could not fetch content_items for residual lookup: ${error.message}`,
    );
    return [];
  }

  if (!data || data.length === 0) {
    log('Warning: content_items table is empty.');
    return [];
  }

  const allIds = data.map((r) => r.id);
  const resolved: string[] = [];

  for (const prefix of RESIDUAL_SHORT_PREFIXES) {
    const matches = allIds.filter((id) => id.startsWith(prefix));
    if (matches.length === 0) {
      log(`Warning: no content_items match residual prefix "${prefix}".`);
    } else if (matches.length > 1) {
      log(
        `Warning: ambiguous residual prefix "${prefix}" matches ${matches.length} items. Using first.`,
      );
      resolved.push(matches[0]);
    } else {
      resolved.push(matches[0]);
    }
  }

  return resolved;
}

/**
 * Positive-control supplier entity (lowercased) for the spec §12.3 recall
 * check. Env-driven so the supplier organisation's identity is never
 * hardcoded in this repo (ID-68.17 / TECH PC-7 step 5) — the same
 * fail-fast pattern as the `NEXT_PUBLIC_CLIENT_ID` guard in
 * `runEvaluation()`.
 */
function resolvePositiveControlEntityLower(): string {
  const value = process.env.EVAL_POSITIVE_CONTROL_ENTITY?.trim();
  if (!value) {
    logError(
      `EVAL_POSITIVE_CONTROL_ENTITY is not set. The positive-control recall ` +
        `check (spec §12.3) selects items whose holds relationships ` +
        `attribute certs to the known supplier organisation rather than ` +
        `the client org. Set EVAL_POSITIVE_CONTROL_ENTITY to that ` +
        `supplier's name in your shell or .env.local and retry.`,
    );
    process.exit(2);
  }
  return value.toLowerCase();
}

/**
 * Identify positive-control items — those where source_entity matches
 * client org and the target is a certification that should be self-held.
 *
 * Per spec §4.3 and §12.3, the 3 positive controls are the known
 * false-positive cases (iso 27001, iso 9001, iso 14001) that were
 * incorrectly attributed to the client. After S192 SQL backfill these
 * were corrected.
 *
 * We identify positive-control source_item_ids by finding items whose
 * current `holds` relationships attribute a cert to the positive-control
 * supplier (post-S192 SQL backfill) — the supplier-disclaimer items
 * documented in spec §1.1, where the certs are held by the supplier
 * organisation, not the client org. Per spec §12.3: "Positive control
 * recall | 3/3 | all 3 known false positives must flip."
 *
 * The supplier identity is env-driven via `EVAL_POSITIVE_CONTROL_ENTITY`
 * (see `resolvePositiveControlEntityLower()`). Re-classification under
 * the new skill port must continue producing supplier attribution.
 * Returns up to 3 distinct source_item_ids.
 */
function identifyPositiveControlItems(
  holdsByItem: Map<string, HoldsRelationship[]>,
  positiveControlEntityLower: string,
): string[] {
  const supplierHeldItemIds = new Set<string>();

  for (const [itemId, rels] of holdsByItem) {
    const hasPositiveControlSupplier = rels.some((r) =>
      r.source_entity.toLowerCase().includes(positiveControlEntityLower),
    );
    if (hasPositiveControlSupplier) {
      supplierHeldItemIds.add(itemId);
    }
  }

  return Array.from(supplierHeldItemIds).slice(0, 3);
}

// ──────────────────────────────────────────
// Cross-path parity comparator (ID-101 §{101.9}, PC-6 lane 3)
//
// PURE functions — no DB, no LLM, no subprocess. Exported for Vitest
// (`__tests__/scripts/eval-holder-rule-parity.test.ts`). The comparison units
// are already-canonicalised: legacy triples come from the persisted
// `entity_relationships` rows (the TS oracle of record, written by prior
// production `classifyContent` runs — `resolveAlias(canonicalise(x)).toLowerCase()`
// at classify.ts:1788) and cocoindex triples come from the Python driver
// (`canonicalise_for_relationship`, the cross-language port). Both endpoints
// therefore live in the SAME lowercase relationship-canonical space, so the
// comparator compares on raw set-equality (Inv-2, order-tolerant).
// ──────────────────────────────────────────

/** Stable set-membership key for a canonicalised triple (Inv-2). */
export function tripleKey(t: Triple): string {
  return `${t.source_entity} ${t.relationship_type} ${t.target_entity}`;
}

/**
 * Set-difference of two canonicalised triple lists (Inv-2, order-tolerant).
 * Returns the intersection (`both`) and the one-path-only triples. Duplicates
 * within a single list are collapsed (set semantics).
 */
export function compareTripleSets(
  legacy: Triple[],
  cocoindex: Triple[],
): TripleSetComparison {
  const legacyByKey = new Map<string, Triple>();
  for (const t of legacy) legacyByKey.set(tripleKey(t), t);
  const cocoByKey = new Map<string, Triple>();
  for (const t of cocoindex) cocoByKey.set(tripleKey(t), t);

  const both: Triple[] = [];
  const legacyOnly: Triple[] = [];
  const cocoOnly: Triple[] = [];

  for (const [key, t] of legacyByKey) {
    if (cocoByKey.has(key)) both.push(t);
    else legacyOnly.push(t);
  }
  for (const [key, t] of cocoByKey) {
    if (!legacyByKey.has(key)) cocoOnly.push(t);
  }
  return { both, legacyOnly, cocoOnly };
}

/**
 * Aggregate per-run triple comparisons for ONE document into the recurrence
 * verdict (PC-6 lane 3 non-determinism rule): a one-path-only triple counts as
 * a real parity MISS only if it recurs across ALL `runs` runs (N≥3); a triple
 * one-path-only in SOME but not all runs is TRANSIENT (logged, not failed).
 *
 * `runComparisons` is the list of `compareTripleSets` results, one per run, for
 * the same document. Returns the recurring (real) and transient legacy-only /
 * coco-only key sets plus their triple payloads.
 */
export function aggregateRunComparisons(
  runComparisons: TripleSetComparison[],
): {
  recurringLegacyOnly: Triple[];
  recurringCocoOnly: Triple[];
  transientLegacyOnly: Triple[];
  transientCocoOnly: Triple[];
  parityHolds: boolean;
} {
  const n = runComparisons.length;
  const legacyOnlyCounts = new Map<string, { triple: Triple; count: number }>();
  const cocoOnlyCounts = new Map<string, { triple: Triple; count: number }>();

  for (const cmp of runComparisons) {
    for (const t of cmp.legacyOnly) {
      const key = tripleKey(t);
      const e = legacyOnlyCounts.get(key) ?? { triple: t, count: 0 };
      e.count += 1;
      legacyOnlyCounts.set(key, e);
    }
    for (const t of cmp.cocoOnly) {
      const key = tripleKey(t);
      const e = cocoOnlyCounts.get(key) ?? { triple: t, count: 0 };
      e.count += 1;
      cocoOnlyCounts.set(key, e);
    }
  }

  const recurringLegacyOnly: Triple[] = [];
  const transientLegacyOnly: Triple[] = [];
  for (const { triple, count } of legacyOnlyCounts.values()) {
    if (n > 0 && count === n) recurringLegacyOnly.push(triple);
    else transientLegacyOnly.push(triple);
  }
  const recurringCocoOnly: Triple[] = [];
  const transientCocoOnly: Triple[] = [];
  for (const { triple, count } of cocoOnlyCounts.values()) {
    if (n > 0 && count === n) recurringCocoOnly.push(triple);
    else transientCocoOnly.push(triple);
  }

  const parityHolds =
    recurringLegacyOnly.length === 0 && recurringCocoOnly.length === 0;
  return {
    recurringLegacyOnly,
    recurringCocoOnly,
    transientLegacyOnly,
    transientCocoOnly,
    parityHolds,
  };
}

/**
 * Bucket a per-cert holder-state divergence (Inv-9). `legacy` is the persisted
 * TS-oracle holder (from `entity_mentions.metadata.holder`); `cocoindex` is the
 * Python-driver holder. `diag` carries the two canonical-space flags the Python
 * driver emits (`build_holder_diagnostics`).
 *
 * Expected-class (bl-288): the TS oracle carries two latent canonical-space
 * mismatches the Python port FIXES. A divergence is bucketed
 * `expected_ts_space_mismatch` — NOT a parity failure — when:
 *   (A) the cert's per-mention canonical ≠ its relationship canonical
 *       (`cert_space_mismatch`): the TS Pass-2 membership check builds its sets
 *       from `row.canonical_name` but compares against relationship-canonical
 *       targets/sources, so it MISSES the cert and never stamps a holder the
 *       Python port (correctly) derives; OR
 *   (B) the client org's relationship canonical ≠ its bare lowercase
 *       (`client_org_space_mismatch`): the TS self-comparison uses the merely-
 *       lowercased branding name, so a self-held cert is mis-attributed.
 * Both are documented in holder_rule.py (R2 / R4) and tracked as bl-288.
 *
 * Identical states → `match`. A genuine mismatch with NO known-bug signature →
 * `parity_failure`.
 */
export function classifyHolderDivergence(
  legacy: HolderState | null,
  cocoindex: HolderState | null,
  diag: {
    cert_space_mismatch: boolean;
    client_org_space_mismatch: boolean;
  } | null,
): { bucket: HolderBucket; reason: string } {
  const same =
    (legacy?.holder ?? null) === (cocoindex?.holder ?? null) &&
    (legacy?.supplier_name ?? null) === (cocoindex?.supplier_name ?? null);
  if (same) {
    return { bucket: 'match', reason: 'identical holder state across paths' };
  }
  if (diag?.cert_space_mismatch) {
    return {
      bucket: 'expected_ts_space_mismatch',
      reason:
        'bl-288 bug A: cert per-mention canonical ≠ relationship canonical — ' +
        'TS Pass-2 membership built from row.canonical_name misses this cert',
    };
  }
  if (diag?.client_org_space_mismatch) {
    return {
      bucket: 'expected_ts_space_mismatch',
      reason:
        'bl-288 bug B: client-org relationship canonical ≠ bare-lowercase ' +
        'branding — TS self-comparison mis-attributes a self-held cert',
    };
  }
  return {
    bucket: 'parity_failure',
    reason: `holder mismatch: legacy=${JSON.stringify(legacy)} cocoindex=${JSON.stringify(cocoindex)}`,
  };
}

// ──────────────────────────────────────────
// Snapshot mode
// ──────────────────────────────────────────

async function runSnapshot(
  supabase: SupabaseClient<Database>,
  args: CliArgs,
): Promise<void> {
  log('Mode: snapshot (read-only)');
  log('Fetching holds relationships...');

  const allHolds = await fetchHoldsRelationships(supabase);
  log(`Found ${allHolds.length} holds relationships.`);

  const holdsByItem = groupBySourceItem(allHolds);
  log(
    `Found ${holdsByItem.size} unique content items with holds relationships.`,
  );

  // Determine target item set
  let targetItemIds: string[];

  if (args.itemIds) {
    const knownIds = Array.from(holdsByItem.keys());
    targetItemIds = resolveItemIds(args.itemIds, knownIds);
    log(`Filtering to ${targetItemIds.length} specified items.`);
  } else {
    targetItemIds = Array.from(holdsByItem.keys());
  }

  // Always include residual items in the snapshot
  const residualIds = await resolveResidualItemIds(supabase);
  log(`Resolved ${residualIds.length} residual items.`);
  for (const rid of residualIds) {
    if (!targetItemIds.includes(rid)) {
      targetItemIds.push(rid);
      log(`  Added residual item: ${rid}`);
    }
  }

  log(`Total items to snapshot: ${targetItemIds.length}`);

  // Build snapshot
  const items: Record<string, SnapshotItem> = {};

  for (let i = 0; i < targetItemIds.length; i++) {
    const itemId = targetItemIds[i];
    log(`Snapshotting item ${i + 1}/${targetItemIds.length}: ${itemId}`);

    const [title, mentions] = await Promise.all([
      fetchItemTitle(supabase, itemId),
      fetchEntityMentions(supabase, itemId),
    ]);

    const holdsForItem = holdsByItem.get(itemId) ?? [];

    items[itemId] = {
      item_id: itemId,
      title,
      entity_mentions: mentions,
      holds_relationships: holdsForItem,
    };
  }

  // Extract Supabase project ID from URL for provenance
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const projectMatch = supabaseUrl.match(/([a-z]+)\.supabase/);
  const workspaceId = projectMatch ? projectMatch[1] : supabaseUrl;

  const output: SnapshotOutput = {
    generated_at: new Date().toISOString(),
    mode: 'snapshot',
    supabase_project: workspaceId,
    client_org: CLIENT_ORG_LOWER,
    total_holds_relationships: allHolds.length,
    unique_content_items: holdsByItem.size,
    residual_items_included: residualIds,
    items,
  };

  const json = JSON.stringify(output, null, 2);

  if (args.output) {
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, json, 'utf-8');
    log(`Snapshot written to ${args.output}`);
  } else {
    process.stdout.write(json + '\n');
  }

  log(`Snapshot complete. ${Object.keys(items).length} items captured.`);
}

// ──────────────────────────────────────────
// Run mode
// ──────────────────────────────────────────

async function runEvaluation(
  supabase: SupabaseClient<Database>,
  args: CliArgs,
): Promise<void> {
  log('Mode: run (destructive — will re-classify target items)');

  if (args.dryRun) {
    log('DRY RUN — will not invoke classifyContent.');
  }

  log('Fetching holds relationships...');
  const allHolds = await fetchHoldsRelationships(supabase);
  log(`Found ${allHolds.length} holds relationships.`);

  const holdsByItem = groupBySourceItem(allHolds);
  log(
    `Found ${holdsByItem.size} unique content items with holds relationships.`,
  );

  // Determine target item set
  let targetItemIds: string[];

  if (args.itemIds) {
    const knownIds = Array.from(holdsByItem.keys());
    targetItemIds = resolveItemIds(args.itemIds, knownIds);
    log(`Filtering to ${targetItemIds.length} specified items.`);
  } else {
    targetItemIds = Array.from(holdsByItem.keys());
  }

  // Always include residual items
  const residualIds = await resolveResidualItemIds(supabase);
  log(`Resolved ${residualIds.length} residual items.`);
  for (const rid of residualIds) {
    if (!targetItemIds.includes(rid)) {
      targetItemIds.push(rid);
      log(`  Added residual item: ${rid}`);
    }
  }

  // Identify positive control items. The supplier identity is env-driven
  // (ID-68.17 / TECH PC-7 step 5) — fails fast when the knob is unset.
  const positiveControlEntityLower = resolvePositiveControlEntityLower();
  const positiveControlIds = identifyPositiveControlItems(
    holdsByItem,
    positiveControlEntityLower,
  );
  log(`Identified ${positiveControlIds.length} positive-control items.`);

  log(`Total items to evaluate: ${targetItemIds.length}`);

  // Lazy-import classifyContent to avoid Next.js module resolution at
  // parse time (the import depends on path aliases resolved by Bun).
  const { classifyContent } = await import('@/lib/ai/classify');

  // SAFETY GUARD: `deriveHolderMetadata` reads `BRANDING.organisationName`
  // for the self-vs-supplier split. When `NEXT_PUBLIC_CLIENT_ID` is not
  // set in the shell/env, BRANDING falls back to the `default` client
  // config ("Knowledge Hub") — which would mis-derive every holds rel
  // as `holder: 'supplier'` with supplier_name=<actual client org>. Fail
  // fast before a destructive run would corrupt prod entity_mentions.
  if (!process.env.NEXT_PUBLIC_CLIENT_ID) {
    logError(
      `NEXT_PUBLIC_CLIENT_ID is not set, so BRANDING falls back to the ` +
        `"default" client config ("${CLIENT_ORG_LOWER}"). The classifier ` +
        `would derive holder metadata against the wrong client org and ` +
        `corrupt every cert mention in the target set. Set ` +
        `NEXT_PUBLIC_CLIENT_ID in your shell or .env.local and retry.`,
    );
    process.exit(2);
  }
  log(`✓ Client org resolved from branding: "${CLIENT_ORG_LOWER}"`);

  const perItem: RunItemResult[] = [];
  let totalCertMentionsWithHolds = 0;
  let totalCertMentionsWithHolderMetadata = 0;
  let totalPrecisionRegressions = 0;
  let positiveControlsPassed = 0;
  // Track by item-id to guard against over-counting when a residual item
  // has multiple ISO 27001 mentions (e.g. chunked content).
  const residualItemsCorrected = new Set<string>();

  for (let i = 0; i < targetItemIds.length; i++) {
    const itemId = targetItemIds[i];
    const isResidual = residualIds.includes(itemId);
    const isPositiveControl = positiveControlIds.includes(itemId);
    log(
      `Processing ${i + 1}/${targetItemIds.length}: ${itemId}${isResidual ? ' [RESIDUAL]' : ''}${isPositiveControl ? ' [POSITIVE-CONTROL]' : ''}`,
    );

    if (args.dryRun) {
      perItem.push({
        item_id: itemId,
        title: null,
        status: 'skipped',
        cert_mentions_with_holds: 0,
        cert_mentions_with_holder_metadata: 0,
        holder_coverage: 0,
        self_count: 0,
        supplier_count: 0,
        precision_regressions: [],
      });
      continue;
    }

    try {
      // Re-classify the item
      await classifyContent({
        supabase,
        itemId,
        force: true,
        userId: PIPELINE_SERVICE_ACCOUNT_USER_ID,
        validate: false,
      });

      // Read back entity_mentions after classification
      const mentions = await fetchEntityMentions(supabase, itemId);
      const title = await fetchItemTitle(supabase, itemId);

      // Get the holds relationships for this item (ground truth)
      const holdsForItem = holdsByItem.get(itemId) ?? [];

      // Build a set of cert canonical_names that have holds relationships
      const certNamesWithHolds = new Set<string>();
      const holdsSourceByTarget = new Map<string, string>();
      for (const rel of holdsForItem) {
        certNamesWithHolds.add(rel.target_entity.toLowerCase());
        holdsSourceByTarget.set(
          rel.target_entity.toLowerCase(),
          rel.source_entity.toLowerCase(),
        );
      }

      // Evaluate cert mentions
      const certMentions = mentions.filter(
        (m) => m.entity_type === 'certification',
      );
      const certMentionsLinkedToHolds = certMentions.filter((m) =>
        certNamesWithHolds.has(m.canonical_name.toLowerCase()),
      );

      let itemCertWithHolder = 0;
      let itemSelf = 0;
      let itemSupplier = 0;
      const itemRegressions: PrecisionRegression[] = [];

      for (const mention of certMentionsLinkedToHolds) {
        const metadata = mention.metadata as Record<string, unknown> | null;
        const holder = metadata?.holder as string | null | undefined;
        const certName = mention.canonical_name.toLowerCase();

        if (holder) {
          itemCertWithHolder++;
        }

        if (holder === 'self') {
          itemSelf++;
        } else if (holder === 'supplier') {
          itemSupplier++;
        }

        // Check for precision regressions: a cert whose ground-truth
        // source_entity is not the client org should NOT have holder='self'
        const groundTruthSource = holdsSourceByTarget.get(certName);
        if (groundTruthSource && groundTruthSource !== CLIENT_ORG_LOWER) {
          // This is a supplier-held cert
          if (holder === 'self') {
            itemRegressions.push({
              canonical_name: certName,
              expected_holder: 'supplier',
              actual_holder: holder,
              source_entity: groundTruthSource,
            });
          }
        } else if (groundTruthSource === CLIENT_ORG_LOWER) {
          // This is a self-held cert
          if (holder === 'supplier') {
            itemRegressions.push({
              canonical_name: certName,
              expected_holder: 'self',
              actual_holder: holder,
              source_entity: groundTruthSource,
            });
          }
        }
      }

      // For residual items that might not have holds relationships,
      // check if the re-classification produced holder metadata
      if (isResidual && certMentionsLinkedToHolds.length === 0) {
        // Check all cert mentions for this residual item
        const isoCerts = certMentions.filter(
          (m) => m.canonical_name.toLowerCase() === 'iso 27001',
        );
        for (const isoCert of isoCerts) {
          const metadata = isoCert.metadata as Record<string, unknown> | null;
          const holder = metadata?.holder as string | null | undefined;
          if (holder === 'self') {
            residualItemsCorrected.add(itemId);
            log(
              `  Residual item ${itemId}: ISO 27001 has holder='self' (PASS)`,
            );
          } else {
            log(
              `  Residual item ${itemId}: ISO 27001 holder='${holder ?? 'null'}' (FAIL — expected 'self')`,
            );
          }
        }
        if (isoCerts.length === 0) {
          log(`  Residual item ${itemId}: no ISO 27001 cert mention found.`);
        }
      }

      // Aggregate for residual items that DO have holds relationships
      if (isResidual && certMentionsLinkedToHolds.length > 0) {
        const isoCerts = certMentionsLinkedToHolds.filter(
          (m) => m.canonical_name.toLowerCase() === 'iso 27001',
        );
        for (const isoCert of isoCerts) {
          const metadata = isoCert.metadata as Record<string, unknown> | null;
          const holder = metadata?.holder as string | null | undefined;
          if (holder === 'self') {
            residualItemsCorrected.add(itemId);
            log(
              `  Residual item ${itemId}: ISO 27001 has holder='self' via holds (PASS)`,
            );
          }
        }
      }

      // Positive control check: known supplier false-positive items must
      // produce holder='supplier' with supplier_name containing the
      // positive-control entity after re-classification (spec §12.3 row 2).
      if (isPositiveControl) {
        const allSupplierPositiveControl = certMentionsLinkedToHolds.every(
          (m) => {
            const md = m.metadata as Record<string, unknown> | null;
            const supplierName =
              typeof md?.supplier_name === 'string'
                ? md.supplier_name.toLowerCase()
                : '';
            return (
              md?.holder === 'supplier' &&
              supplierName.includes(positiveControlEntityLower)
            );
          },
        );
        if (
          allSupplierPositiveControl &&
          certMentionsLinkedToHolds.length > 0
        ) {
          positiveControlsPassed++;
          log(
            `  Positive control ${itemId}: all certs holder='supplier'+'${positiveControlEntityLower}' (PASS)`,
          );
        } else {
          log(
            `  Positive control ${itemId}: NOT all certs attributed to the positive-control supplier (FAIL)`,
          );
        }
      }

      totalCertMentionsWithHolds += certMentionsLinkedToHolds.length;
      totalCertMentionsWithHolderMetadata += itemCertWithHolder;
      totalPrecisionRegressions += itemRegressions.length;

      const coverage =
        certMentionsLinkedToHolds.length > 0
          ? itemCertWithHolder / certMentionsLinkedToHolds.length
          : 1;

      perItem.push({
        item_id: itemId,
        title,
        status: itemRegressions.length > 0 ? 'fail' : 'pass',
        cert_mentions_with_holds: certMentionsLinkedToHolds.length,
        cert_mentions_with_holder_metadata: itemCertWithHolder,
        holder_coverage: coverage,
        self_count: itemSelf,
        supplier_count: itemSupplier,
        precision_regressions: itemRegressions,
      });

      log(
        `  -> ${certMentionsLinkedToHolds.length} cert mentions with holds, ` +
          `${itemCertWithHolder} with holder metadata, ` +
          `${itemRegressions.length} regressions`,
      );
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      logError(`Classification failed for ${itemId}: ${errMessage}`);
      perItem.push({
        item_id: itemId,
        title: null,
        status: 'error',
        error: errMessage,
        cert_mentions_with_holds: 0,
        cert_mentions_with_holder_metadata: 0,
        holder_coverage: 0,
        self_count: 0,
        supplier_count: 0,
        precision_regressions: [],
      });
    }
  }

  // Compute thresholds
  const holderCoverage =
    totalCertMentionsWithHolds > 0
      ? totalCertMentionsWithHolderMetadata / totalCertMentionsWithHolds
      : 1;

  const precisionScore =
    totalCertMentionsWithHolds > 0
      ? 1 - totalPrecisionRegressions / totalCertMentionsWithHolds
      : 1;

  // Expected thresholds from spec §12.3
  const expectedPositiveControls = Math.min(positiveControlIds.length, 3);
  const expectedResiduals = residualIds.length;

  const thresholds = {
    holder_coverage: {
      expected: 1.0,
      actual: holderCoverage,
      passed: holderCoverage >= 1.0,
    },
    positive_control_recall: {
      expected: expectedPositiveControls,
      actual: positiveControlsPassed,
      passed: positiveControlsPassed >= expectedPositiveControls,
    },
    precision: {
      expected: 1.0,
      actual: precisionScore,
      passed: totalPrecisionRegressions === 0,
    },
    residual_correction: {
      expected: expectedResiduals,
      actual: residualItemsCorrected.size,
      passed: residualItemsCorrected.size >= expectedResiduals,
    },
  };

  const allPassed = Object.values(thresholds).every((t) => t.passed);

  const output: RunOutput = {
    generated_at: new Date().toISOString(),
    mode: 'run',
    dry_run: args.dryRun,
    supabase_project: process.env.SUPABASE_URL ?? '',
    client_org: CLIENT_ORG_LOWER,
    total_holds_relationships: allHolds.length,
    unique_content_items: holdsByItem.size,
    items_evaluated: targetItemIds.length,
    thresholds,
    all_passed: allPassed,
    per_item: perItem,
  };

  // Write structured report
  const today = new Date().toISOString().split('T')[0];
  const reportPath = args.output ?? `docs/audits/ts-eval-run-${today}.json`;

  const json = JSON.stringify(output, null, 2);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, json, 'utf-8');
  log(`Run report written to ${reportPath}`);

  // Summary table to stderr
  process.stderr.write(`
--- TS Holder Rule Evaluation Summary ---
Items evaluated:        ${targetItemIds.length}
Cert mentions (holds):  ${totalCertMentionsWithHolds}
With holder metadata:   ${totalCertMentionsWithHolderMetadata}
Holder coverage:        ${(holderCoverage * 100).toFixed(1)}% (threshold: 100%)  ${thresholds.holder_coverage.passed ? 'PASS' : 'FAIL'}
Positive controls:      ${positiveControlsPassed}/${expectedPositiveControls} (threshold: ${expectedPositiveControls}/${expectedPositiveControls})  ${thresholds.positive_control_recall.passed ? 'PASS' : 'FAIL'}
Precision regressions:  ${totalPrecisionRegressions} (threshold: 0)  ${thresholds.precision.passed ? 'PASS' : 'FAIL'}
Residuals corrected:    ${residualItemsCorrected.size}/${expectedResiduals} (threshold: ${expectedResiduals}/${expectedResiduals})  ${thresholds.residual_correction.passed ? 'PASS' : 'FAIL'}
Overall:                ${allPassed ? 'ALL PASSED' : 'FAILED'}
---
`);

  // Exit code
  if (!allPassed && !args.dryRun) {
    process.exit(1);
  }
}

// ──────────────────────────────────────────
// Cross-path parity flow (ID-101 §{101.9}, PC-6 lane 3)
//
// Reads the LEGACY side (the TS oracle of record) READ-ONLY from the persisted
// `entity_relationships` + `entity_mentions.metadata.holder` rows — written by
// prior production `classifyContent` runs — and the COCOINDEX side IN-MEMORY via
// the Python parity driver subprocess. ZERO DB writes on either side.
// ──────────────────────────────────────────

/** Persisted item content text needed by the Python cocoindex driver. */
async function fetchItemContent(
  supabase: SupabaseClient<Database>,
  itemId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('content_items')
    .select('content')
    .eq('id', itemId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch content for ${itemId}: ${error.message}`);
  }
  return data?.content ?? null;
}

/**
 * Fetch ALL persisted relationship triples for an item (every relationship_type,
 * not just `holds`). These rows ARE the legacy TS oracle of record — their
 * endpoints were canonicalised by the TS writer
 * (`resolveAlias(canonicalise(x)).toLowerCase()`, classify.ts:1788), so they sit
 * in the SAME relationship-canonical space as the Python driver's
 * `canonicalise_for_relationship` output.
 */
async function fetchAllRelationships(
  supabase: SupabaseClient<Database>,
  itemId: string,
): Promise<Triple[]> {
  const { data, error } = await supabase
    .from('entity_relationships')
    .select('source_entity, relationship_type, target_entity')
    .eq('source_item_id', itemId);
  if (error) {
    throw new Error(
      `Failed to fetch relationships for ${itemId}: ${error.message}`,
    );
  }
  return (data ?? []).map((r) => ({
    source_entity: r.source_entity,
    relationship_type: r.relationship_type,
    target_entity: r.target_entity,
  }));
}

/**
 * Read the persisted legacy holder states for an item's certification mentions,
 * keyed by `canonical_name` — the TS oracle of record (`entity_mentions.metadata`,
 * stamped by `deriveHolderMetadata` at prior production classify time).
 */
async function fetchLegacyHolderStates(
  supabase: SupabaseClient<Database>,
  itemId: string,
): Promise<Record<string, HolderState>> {
  const mentions = await fetchEntityMentions(supabase, itemId);
  const states: Record<string, HolderState> = {};
  for (const m of mentions) {
    if (m.entity_type !== 'certification') continue;
    const md = m.metadata as Record<string, unknown> | null;
    const holder = md?.holder;
    if (holder === 'self') {
      states[m.canonical_name.toLowerCase()] = { holder: 'self' };
    } else if (holder === 'supplier') {
      const supplierName =
        typeof md?.supplier_name === 'string' ? md.supplier_name : undefined;
      states[m.canonical_name.toLowerCase()] = {
        holder: 'supplier',
        supplier_name: supplierName,
      };
    }
    // No holder key → absent (Inv-10 parity: no-signal certs are not stamped).
  }
  return states;
}

/**
 * Invoke the Python cocoindex parity driver as a subprocess on a batch of
 * fixture documents. Replicates the flow.py write-site IN-MEMORY (no DB, no
 * LMDB). `PIPELINE_CLIENT_ORG` is derived from the SAME client-org source the TS
 * eval uses (BRANDING / NEXT_PUBLIC_CLIENT_ID guard) and passed in the env.
 */
async function runCocoindexDriver(
  documents: { item_id: string; content_text: string }[],
  clientOrgRaw: string,
): Promise<CocoindexDriverOutput> {
  const payload = JSON.stringify({ documents });
  const { stdout, stderr, exitCode } = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>((resolve, reject) => {
    const proc = spawn(
      'python3',
      ['-m', 'scripts.cocoindex_pipeline.parity_driver'],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, PIPELINE_CLIENT_ORG: clientOrgRaw },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code: number | null) => {
      resolve({ stdout: out, stderr: err, exitCode: code ?? -1 });
    });
    proc.stdin.write(payload);
    proc.stdin.end();
  });

  if (stderr.trim()) {
    for (const line of stderr.trim().split('\n')) log(`[py-driver] ${line}`);
  }
  if (exitCode !== 0) {
    throw new Error(
      `Python parity driver exited ${exitCode}. stderr:\n${stderr}`,
    );
  }
  try {
    return JSON.parse(stdout) as CocoindexDriverOutput;
  } catch (err) {
    throw new Error(
      `Failed to parse Python driver stdout as JSON: ${err instanceof Error ? err.message : String(err)}\nstdout was:\n${stdout.slice(0, 500)}`,
    );
  }
}

/**
 * Resolve the pinned parity corpus: the residual items + up-to-3 positive-control
 * supplier items the script already knows (PC-6 lane 3 "the residual +
 * positive-control items the script already knows"). Read-only — no writes.
 */
async function resolveParityCorpus(
  supabase: SupabaseClient<Database>,
  args: CliArgs,
): Promise<string[]> {
  const allHolds = await fetchHoldsRelationships(supabase);
  const holdsByItem = groupBySourceItem(allHolds);

  const corpus = new Set<string>();
  if (args.itemIds) {
    const knownIds = Array.from(holdsByItem.keys());
    for (const id of resolveItemIds(args.itemIds, knownIds)) corpus.add(id);
  }

  // Positive-control supplier items (env-driven entity). Optional for parity:
  // when EVAL_POSITIVE_CONTROL_ENTITY is unset we log + skip rather than
  // fail-fast (the residual items + any --item-ids still form a valid corpus).
  // The destructive --mode=run path keeps its hard fail-fast unchanged.
  const positiveControlEntity =
    process.env.EVAL_POSITIVE_CONTROL_ENTITY?.trim();
  if (positiveControlEntity) {
    for (const id of identifyPositiveControlItems(
      holdsByItem,
      positiveControlEntity.toLowerCase(),
    )) {
      corpus.add(id);
    }
  } else {
    log(
      'EVAL_POSITIVE_CONTROL_ENTITY unset — parity corpus omits positive-control items ' +
        '(residual + --item-ids only).',
    );
  }

  // Residual items (always included).
  for (const rid of await resolveResidualItemIds(supabase)) corpus.add(rid);

  return Array.from(corpus);
}

async function runParity(
  supabase: SupabaseClient<Database>,
  args: CliArgs,
): Promise<void> {
  const path = args.path!;
  log(`Mode: parity (--path=${path}, runs=${args.runs})`);

  // FAIL-FAST: the Python holder path needs PIPELINE_CLIENT_ORG; derive it from
  // the same client-org source the TS eval uses (BRANDING / NEXT_PUBLIC_CLIENT_ID
  // guard at the legacy run path). Mirror the existing guard exactly.
  if (path !== 'legacy' && !process.env.NEXT_PUBLIC_CLIENT_ID) {
    logError(
      `NEXT_PUBLIC_CLIENT_ID is not set, so BRANDING falls back to the ` +
        `"default" client config ("${CLIENT_ORG_LOWER}"). The cocoindex holder ` +
        `path would resolve PIPELINE_CLIENT_ORG against the wrong client org. ` +
        `Set NEXT_PUBLIC_CLIENT_ID in your shell or .env.local and retry.`,
    );
    process.exit(2);
  }
  // The Python driver relationship-canonicalises this raw value itself (parity
  // with flow.py:2253). BRANDING.organisationName is the canonical client-org
  // name; CLIENT_ORG_LOWER is its lowercase form, resolved in main().
  const { BRANDING } = await import('@/lib/client-config');
  const clientOrgRaw = BRANDING.organisationName;

  const corpus = await resolveParityCorpus(supabase, args);
  log(`Pinned parity corpus: ${corpus.length} items.`);

  // ── --dry-run: print the plan, no LLM, no subprocess, no DB writes ──────────
  if (args.dryRun) {
    const plan = {
      mode: 'parity',
      path,
      runs: args.runs,
      corpus,
      corpus_size: corpus.length,
      client_org: CLIENT_ORG_LOWER,
      env_checks: {
        NEXT_PUBLIC_CLIENT_ID: Boolean(process.env.NEXT_PUBLIC_CLIENT_ID),
        ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
        SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
        EVAL_POSITIVE_CONTROL_ENTITY: Boolean(
          process.env.EVAL_POSITIVE_CONTROL_ENTITY,
        ),
      },
      legacy_side:
        'read persisted entity_relationships + entity_mentions.metadata.holder (zero writes)',
      cocoindex_side:
        'in-memory python3 -m scripts.cocoindex_pipeline.parity_driver (zero writes)',
    };
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
    log('DRY RUN — plan printed; no LLM calls, no DB writes.');
    return;
  }

  // ── Legacy side: read the persisted TS oracle of record (read-only) ─────────
  const legacyTriplesByItem = new Map<string, Triple[]>();
  const legacyHolderByItem = new Map<string, Record<string, HolderState>>();
  const contentByItem = new Map<string, string>();
  for (const itemId of corpus) {
    if (path !== 'cocoindex') {
      legacyTriplesByItem.set(
        itemId,
        await fetchAllRelationships(supabase, itemId),
      );
      legacyHolderByItem.set(
        itemId,
        await fetchLegacyHolderStates(supabase, itemId),
      );
    }
    const content = await fetchItemContent(supabase, itemId);
    if (content) contentByItem.set(itemId, content);
    else
      log(`Warning: item ${itemId} has no content — skipping coco extraction.`);
  }

  // ── Cocoindex side: N≥3 in-memory runs through the Python driver ────────────
  // Per-run, per-item cocoindex output (path=cocoindex|both).
  const cocoRuns: Map<string, CocoindexDocResult>[] = [];
  if (path !== 'legacy') {
    const documents = corpus
      .filter((id) => contentByItem.has(id))
      .map((id) => ({ item_id: id, content_text: contentByItem.get(id)! }));
    for (let run = 0; run < args.runs; run++) {
      log(
        `Cocoindex run ${run + 1}/${args.runs} (${documents.length} docs)...`,
      );
      const out = await runCocoindexDriver(documents, clientOrgRaw);
      const byItem = new Map<string, CocoindexDocResult>();
      for (const doc of out.documents) byItem.set(doc.item_id, doc);
      cocoRuns.push(byItem);
    }
  }

  // ── Compare per item ────────────────────────────────────────────────────────
  const perItemReports: Array<Record<string, unknown>> = [];
  let anyParityFailure = false;

  for (const itemId of corpus) {
    const legacyTriples = legacyTriplesByItem.get(itemId) ?? [];
    const legacyHolders = legacyHolderByItem.get(itemId) ?? {};

    // Per-run triple comparisons (legacy vs each coco run).
    const runComparisons: TripleSetComparison[] = [];
    for (const run of cocoRuns) {
      const cocoDoc = run.get(itemId);
      const cocoTriples = cocoDoc?.triples ?? [];
      runComparisons.push(compareTripleSets(legacyTriples, cocoTriples));
    }
    const tripleAgg =
      path === 'both' ? aggregateRunComparisons(runComparisons) : null;
    if (tripleAgg && !tripleAgg.parityHolds) anyParityFailure = true;

    // Holder-state comparison (use the FIRST coco run's holder states; holder
    // derivation is deterministic given a fixed mention/relationship set, so it
    // does not need the N-run recurrence rule — only triples vary run-to-run).
    const holderComparisons: HolderComparison[] = [];
    if (path === 'both') {
      const firstRun = cocoRuns[0]?.get(itemId);
      const cocoHolders = firstRun?.holder_states ?? {};
      const cocoDiag = firstRun?.holder_diagnostics ?? {};
      const allCertKeys = new Set<string>([
        ...Object.keys(legacyHolders),
        ...Object.keys(cocoHolders),
      ]);
      for (const key of allCertKeys) {
        const legacy = legacyHolders[key] ?? null;
        const cocoindex = cocoHolders[key] ?? null;
        const diag = cocoDiag[key]
          ? {
              cert_space_mismatch: cocoDiag[key].cert_space_mismatch,
              client_org_space_mismatch:
                cocoDiag[key].client_org_space_mismatch,
            }
          : null;
        const { bucket, reason } = classifyHolderDivergence(
          legacy,
          cocoindex,
          diag,
        );
        if (bucket === 'parity_failure') anyParityFailure = true;
        holderComparisons.push({
          canonical_name: key,
          legacy,
          cocoindex,
          bucket,
          reason,
        });
      }
    }

    perItemReports.push({
      item_id: itemId,
      legacy_triples: legacyTriples.length,
      coco_triples_per_run:
        path !== 'legacy'
          ? cocoRuns.map((r) => r.get(itemId)?.triples.length ?? 0)
          : [],
      triple_parity: tripleAgg
        ? {
            holds: tripleAgg.parityHolds,
            recurring_legacy_only: tripleAgg.recurringLegacyOnly,
            recurring_coco_only: tripleAgg.recurringCocoOnly,
            transient_legacy_only: tripleAgg.transientLegacyOnly,
            transient_coco_only: tripleAgg.transientCocoOnly,
          }
        : null,
      holder_comparisons: holderComparisons,
      holder_buckets: {
        match: holderComparisons.filter((h) => h.bucket === 'match').length,
        parity_failure: holderComparisons.filter(
          (h) => h.bucket === 'parity_failure',
        ).length,
        expected_ts_space_mismatch: holderComparisons.filter(
          (h) => h.bucket === 'expected_ts_space_mismatch',
        ).length,
      },
      coco_errors:
        path !== 'legacy'
          ? cocoRuns
              .map((r) => r.get(itemId)?.error)
              .filter((e): e is string => Boolean(e))
          : [],
    });
  }

  const report = {
    generated_at: new Date().toISOString(),
    mode: 'parity' as const,
    path,
    runs: args.runs,
    supabase_project: process.env.SUPABASE_URL ?? '',
    client_org: CLIENT_ORG_LOWER,
    corpus_size: corpus.length,
    parity_holds: !anyParityFailure,
    per_item: perItemReports,
  };

  const json = JSON.stringify(report, null, 2);
  if (args.output) {
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, json, 'utf-8');
    log(`Parity report written to ${args.output}`);
  } else {
    process.stdout.write(json + '\n');
  }

  // Summary to stderr.
  const totalExpected = perItemReports.reduce(
    (acc, r) =>
      acc +
      ((r.holder_buckets as { expected_ts_space_mismatch: number })
        .expected_ts_space_mismatch ?? 0),
    0,
  );
  const totalHolderFailures = perItemReports.reduce(
    (acc, r) =>
      acc +
      ((r.holder_buckets as { parity_failure: number }).parity_failure ?? 0),
    0,
  );
  process.stderr.write(`
--- Cross-Path Parity Summary (PC-6 lane 3) ---
Path:                      ${path}
Runs (N):                  ${args.runs}
Corpus items:              ${corpus.length}
Triple-set parity:         ${path === 'both' ? (perItemReports.every((r) => !r.triple_parity || (r.triple_parity as { holds: boolean }).holds) ? 'HOLDS' : 'FAILS') : 'n/a (single-path)'}
Holder parity failures:    ${totalHolderFailures}
Holder expected (bl-288):  ${totalExpected}
Overall:                   ${report.parity_holds ? 'PARITY HOLDS' : 'PARITY FAILS'}
---
`);

  if (!report.parity_holds) {
    process.exit(1);
  }
}

// ──────────────────────────────────────────
// Main
// ──────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  // Assert --env=prod when set BEFORE creating client / running anything.
  assertEnvFlag(args.env, process.env.SUPABASE_URL);
  // Resolve the client org from branding before any holder-attribution
  // comparison runs (used by snapshot, evaluation, AND parity paths).
  await resolveClientOrgLower();
  const supabase = createServiceRoleClient();

  if (args.path) {
    // ID-101 §{101.9}: --path routes to the cross-path parity flow, BYPASSING
    // the snapshot/run flows entirely (--mode=run byte path is never reached).
    await runParity(supabase, args);
  } else if (args.mode === 'snapshot') {
    await runSnapshot(supabase, args);
  } else {
    await runEvaluation(supabase, args);
  }
}

// Only run when invoked as a script (`bun run scripts/eval-holder-rule-ts.ts`).
// Guarded so the cross-path comparator functions can be imported by Vitest
// (`__tests__/scripts/eval-holder-rule-parity.test.ts`) WITHOUT triggering a
// live DB/LLM run. Mirrors `scripts/compare-quality.ts:751`. The script entry
// path (`import.meta.main === true`) is unchanged — `--mode=run` is byte-intact.
if (import.meta.main) {
  main().catch((err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(2);
  });
}

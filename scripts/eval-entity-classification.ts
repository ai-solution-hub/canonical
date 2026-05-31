/**
 * Entity Classification Eval Suite
 *
 * Measures entity extraction quality against a hand-labelled gold standard.
 * Supports two modes:
 *   --cached : Compare against existing entity_mentions in DB (free, fast)
 *   --live   : Re-run classification and compare (expensive, slow)
 *
 * Metrics:
 *   - Entity inclusion precision: correct extractions / total extractions
 *   - Entity inclusion recall: correct extractions / total expected
 *   - Entity type accuracy: correctly typed / total matched
 *   - Exclusion compliance: excluded correctly / total excluded expected
 *   - Cross-item type consistency: same entity always gets same type
 *
 * Usage:
 *   bun run scripts/eval-entity-classification.ts --cached
 *   bun run scripts/eval-entity-classification.ts --cached --verbose
 *   bun run scripts/eval-entity-classification.ts --cached --json
 *   bun run scripts/eval-entity-classification.ts --cached --item <uuid>
 *   bun run scripts/eval-entity-classification.ts --cached --save-baseline
 *   bun run scripts/eval-entity-classification.ts --live --confirm
 *   bun run scripts/eval-entity-classification.ts --live --validate --confirm
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createInterface } from 'readline';
import type { Database } from '@/supabase/types/database.types';
import { precision, recall, f1Score, accuracy } from '../lib/eval/metrics';
import {
  loadBaseline,
  saveBaseline,
  checkRegression,
} from '../lib/eval/baseline';
import {
  printReport as printSharedReport,
  printJsonReport,
} from '../lib/eval/reporter';
import type { EvalResult, RegressionResult } from '../lib/eval/types';
import { COST_PER_MILLION } from '../lib/ai/pricing';

// ── Constants ───────────────────────────────────────────────────────

/**
 * Pipeline service account UUID for use as `userId` in classifyContent calls.
 * `content_items.updated_by` is a uuid column, so a string like 'eval-runner'
 * causes a postgres `invalid input syntax for type uuid` error.
 *
 * This user is provisioned by:
 * `supabase/migrations/20260406180000_create_pipeline_service_account.sql`
 *
 * The user has admin role in `user_roles` so RLS allows write access.
 */
const PIPELINE_SERVICE_ACCOUNT_USER_ID = 'a0000000-0000-4000-8000-000000000001';

// ── Types ───────────────────────────────────────────────────────────

interface GoldEntity {
  name: string;
  type: string;
  canonical_name: string;
  /** Additional acceptable types for context-dependent entities (e.g. CREST: organisation OR certification) */
  alternate_types?: string[];
  /** Additional acceptable canonical names for alias matching (e.g. a product short form mapping to its canonical product name) */
  alternate_names?: string[];
}

interface ExcludedEntity {
  name: string;
  reason: string;
}

interface GoldStandardItem {
  content_item_id: string;
  title: string;
  domain: string;
  content_type: string;
  expected_entities: GoldEntity[];
  excluded_entities: ExcludedEntity[];
}

interface DbEntity {
  entity_type: string;
  entity_name: string;
  canonical_name: string;
}

interface ItemScore {
  content_item_id: string;
  title: string;
  domain: string;
  precision: number;
  recall: number;
  type_accuracy: number;
  exclusion_compliance: number;
  true_positives: string[];
  false_positives: string[];
  false_negatives: string[];
  type_errors: Array<{ name: string; expected: string; actual: string }>;
  exclusion_failures: string[];
}

// ── Env loading ─────────────────────────────────────────────────────

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
    // File doesn't exist — that's fine
  }
}

const PROJECT_ROOT = new URL('..', import.meta.url).pathname;
loadEnvFile(`${PROJECT_ROOT}.env.local`);
loadEnvFile(`${PROJECT_ROOT}.env`);

// ── Constants ──────────────────────────────────────────────────────

const SUITE_NAME = 'entity-classification';

const THRESHOLDS: Record<string, { min?: number; max_drop?: number }> = {
  precision: { min: 0.4, max_drop: 0.05 },
  recall: { min: 0.35, max_drop: 0.05 },
  f1: { min: 0.35, max_drop: 0.05 },
  type_accuracy: { min: 0.8, max_drop: 0.05 },
  exclusion_compliance: { min: 0.5, max_drop: 0.1 },
  cross_item_consistency: { min: 0.8, max_drop: 0.1 },
};

// ── Canonicalisation ────────────────────────────────────────────────

/**
 * Normalise an entity name for fuzzy matching.
 * Mirrors the logic in lib/entities/entity-dedup.ts but simplified
 * for eval comparison (lowercase, trimmed, collapsed whitespace).
 */
function normaliseForComparison(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/\.$/, '')
    .replace(/\blimited\b/g, 'limited')
    .replace(/\bltd\.?\b/g, 'limited');
}

/**
 * Check if two entity names match (fuzzy comparison via canonical forms).
 */
function entityNamesMatch(a: string, b: string): boolean {
  return normaliseForComparison(a) === normaliseForComparison(b);
}

// ── DB Access ───────────────────────────────────────────────────────

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    );
    process.exit(1);
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchEntitiesForItems(
  supabase: SupabaseClient<Database>,
  itemIds: string[],
): Promise<Map<string, DbEntity[]>> {
  const { data, error } = await supabase
    .from('entity_mentions')
    .select('content_item_id, entity_type, entity_name, canonical_name')
    .in('content_item_id', itemIds)
    .order('content_item_id')
    .order('entity_type')
    .order('canonical_name');

  if (error) {
    console.error('Failed to fetch entity mentions:', error.message);
    process.exit(1);
  }

  const map = new Map<string, DbEntity[]>();
  for (const row of data ?? []) {
    const id = row.content_item_id;
    if (!map.has(id)) map.set(id, []);
    map.get(id)!.push({
      entity_type: row.entity_type,
      entity_name: row.entity_name,
      canonical_name: row.canonical_name,
    });
  }

  return map;
}

// ── Live Mode: Classification ──────────────────────────────────────

/**
 * Estimate cost for running live entity classification on all gold standard items.
 * Measured S174: ~17,700 input tokens per item (classification prompt ~12,000 +
 * taxonomy ~2,700 + content up to 5,000 chars ~1,500 + tool schema ~1,500) and
 * ~700 output tokens per item (tool use response with entities + relationships).
 */
function estimateLiveCost(itemCount: number): {
  model: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
} {
  const model = process.env.AI_SUMMARY_MODEL || 'claude-sonnet-4-6';
  // Measured S174: classification prompt ~12,000 tokens, taxonomy ~2,700 tokens,
  // content up to 5,000 chars (~1,500 tokens), tool schema ~1,500 tokens.
  // Output: tool use response with entities + relationships ~700 tokens.
  const inputTokensPerItem = 17_700;
  const outputTokensPerItem = 700;
  const estimatedInputTokens = inputTokensPerItem * itemCount;
  const estimatedOutputTokens = outputTokensPerItem * itemCount;

  const rates =
    COST_PER_MILLION[model] ?? COST_PER_MILLION['claude-sonnet-4-5'];
  const estimatedCostUsd =
    (estimatedInputTokens / 1_000_000) * rates.input +
    (estimatedOutputTokens / 1_000_000) * rates.output;

  return {
    model,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd,
  };
}

/**
 * Prompt user for confirmation before running live classification.
 */
async function confirmLiveRun(
  costEstimate: {
    model: string;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    estimatedCostUsd: number;
  },
  itemCount: number,
): Promise<boolean> {
  console.log('\n--- LIVE MODE COST ESTIMATE ---\n');
  console.log(`  Items to classify:       ${itemCount}`);
  console.log(`  Model:                   ${costEstimate.model}`);
  console.log(
    `  Est. input tokens:       ${costEstimate.estimatedInputTokens.toLocaleString()}`,
  );
  console.log(
    `  Est. output tokens:      ${costEstimate.estimatedOutputTokens.toLocaleString()}`,
  );
  console.log(
    `  Est. cost:               $${costEstimate.estimatedCostUsd.toFixed(4)} USD`,
  );
  console.log(`  Rate limit:              1 req/sec`);
  console.log(
    `  Est. time:               ~${Math.ceil(itemCount * 1.5)} seconds\n`,
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('  Proceed? (y/N) ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

/**
 * Run live classification for a single item and extract entities.
 * Returns the entities extracted by the classifier.
 */
async function classifyAndExtractEntities(
  supabase: SupabaseClient<Database>,
  itemId: string,
  validate: boolean,
): Promise<DbEntity[]> {
  // Dynamic import to avoid loading the full classify module for cached mode
  const { classifyContent } = await import('../lib/ai/classify');

  // When validate=true, classifyContent runs two-pass validation (Pass 1
  // extraction + Pass 2 entity verification with Haiku). When false, only
  // Pass 1 runs. The validate flag must be propagated explicitly.
  // userId must be a valid UUID — content_items.updated_by is a uuid column.
  // Use the pipeline service account (provisioned in
  // 20260406180000_create_pipeline_service_account.sql).
  const result = await classifyContent({
    supabase,
    itemId,
    force: true,
    userId: PIPELINE_SERVICE_ACCOUNT_USER_ID,
    validate,
  });

  // Extract entities from the classification result for fallback use
  const entities: DbEntity[] = (result.entities ?? []).map((e) => ({
    entity_type: e.type,
    entity_name: e.name,
    canonical_name: e.canonical_name.toLowerCase(),
  }));

  // Re-fetch from DB to get the post-filtered, deduplicated entities
  // (these reflect the final stored state after deterministic filters and,
  // if validate=true, after Pass 2 validation has removed false positives).
  const map = await fetchEntitiesForItems(supabase, [itemId]);
  return map.get(itemId) ?? entities;
}

/**
 * Delay helper for rate limiting.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Scoring ─────────────────────────────────────────────────────────

function scoreItem(gold: GoldStandardItem, extracted: DbEntity[]): ItemScore {
  const truePositives: string[] = [];
  const falsePositives: string[] = [];
  const falseNegatives: string[] = [];
  const typeErrors: Array<{ name: string; expected: string; actual: string }> =
    [];
  const exclusionFailures: string[] = [];

  // Track which extracted entities have been matched
  const matchedExtracted = new Set<number>();
  const matchedExpected = new Set<number>();

  // 1. Match extracted entities against expected entities
  for (let ei = 0; ei < extracted.length; ei++) {
    const ext = extracted[ei];
    let foundMatch = false;

    for (let gi = 0; gi < gold.expected_entities.length; gi++) {
      if (matchedExpected.has(gi)) continue;

      const exp = gold.expected_entities[gi];
      // Match on canonical name (primary), alternate names, or entity name (fallback)
      const nameMatches =
        entityNamesMatch(ext.canonical_name, exp.canonical_name) ||
        entityNamesMatch(ext.entity_name, exp.name) ||
        entityNamesMatch(ext.canonical_name, exp.name) ||
        (exp.alternate_names ?? []).some(
          (alt) =>
            entityNamesMatch(ext.canonical_name, alt) ||
            entityNamesMatch(ext.entity_name, alt),
        );

      if (nameMatches) {
        matchedExtracted.add(ei);
        matchedExpected.add(gi);
        truePositives.push(ext.entity_name);

        // Check type match including alternate_types
        const typeMatches =
          ext.entity_type === exp.type ||
          (exp.alternate_types ?? []).includes(ext.entity_type);

        if (!typeMatches) {
          typeErrors.push({
            name: ext.entity_name,
            expected: exp.type,
            actual: ext.entity_type,
          });
        }

        foundMatch = true;
        break;
      }
    }

    if (!foundMatch) {
      // Check if this is an excluded entity that was incorrectly extracted
      const isExcluded = gold.excluded_entities.some(
        (excl) =>
          entityNamesMatch(ext.entity_name, excl.name) ||
          entityNamesMatch(ext.canonical_name, excl.name),
      );

      if (isExcluded) {
        exclusionFailures.push(ext.entity_name);
      }

      // It is a false positive whether it is in the excluded list or not
      falsePositives.push(`${ext.entity_name} [${ext.entity_type}]`);
    }
  }

  // 2. Find expected entities that were not extracted (false negatives)
  for (let gi = 0; gi < gold.expected_entities.length; gi++) {
    if (!matchedExpected.has(gi)) {
      const exp = gold.expected_entities[gi];
      falseNegatives.push(`${exp.name} [${exp.type}]`);
    }
  }

  // 3. Count exclusion successes (expected exclusions that were NOT extracted)
  const exclusionSuccesses = gold.excluded_entities.filter(
    (excl) =>
      !extracted.some(
        (ext) =>
          entityNamesMatch(ext.entity_name, excl.name) ||
          entityNamesMatch(ext.canonical_name, excl.name),
      ),
  ).length;

  // Calculate per-item scores
  const totalExtracted = extracted.length;
  const totalExpected = gold.expected_entities.length;
  const tp = truePositives.length;
  const correctlyTyped = tp - typeErrors.length;

  return {
    content_item_id: gold.content_item_id,
    title: gold.title,
    domain: gold.domain,
    precision: totalExtracted > 0 ? tp / totalExtracted : 1.0,
    recall: totalExpected > 0 ? tp / totalExpected : 1.0,
    type_accuracy: tp > 0 ? correctlyTyped / tp : 1.0,
    exclusion_compliance:
      gold.excluded_entities.length > 0
        ? exclusionSuccesses / gold.excluded_entities.length
        : 1.0,
    true_positives: truePositives,
    false_positives: falsePositives,
    false_negatives: falseNegatives,
    type_errors: typeErrors,
    exclusion_failures: exclusionFailures,
  };
}

function computeAggregateMetrics(
  scores: ItemScore[],
  goldStandard: GoldStandardItem[],
): Record<string, number> {
  let totalExtracted = 0;
  let totalExpected = 0;
  let totalExcludedExpected = 0;
  let totalTruePositives = 0;
  let totalFalsePositives = 0;
  let totalFalseNegatives = 0;
  let totalCorrectlyTyped = 0;
  let totalTypeErrors = 0;
  let totalExclusionSuccesses = 0;
  let totalExclusionFailures = 0;

  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    const g = goldStandard[i];

    totalExtracted += s.true_positives.length + s.false_positives.length;
    totalExpected += g.expected_entities.length;
    totalExcludedExpected += g.excluded_entities.length;
    totalTruePositives += s.true_positives.length;
    totalFalsePositives += s.false_positives.length;
    totalFalseNegatives += s.false_negatives.length;
    totalCorrectlyTyped += s.true_positives.length - s.type_errors.length;
    totalTypeErrors += s.type_errors.length;
    totalExclusionFailures += s.exclusion_failures.length;
    totalExclusionSuccesses +=
      g.excluded_entities.length - s.exclusion_failures.length;
  }

  const p = totalExtracted > 0 ? totalTruePositives / totalExtracted : 0;
  const r = totalExpected > 0 ? totalTruePositives / totalExpected : 0;
  const f1 = p + r > 0 ? (2 * p * r) / (p + r) : 0;
  const typeAcc =
    totalTruePositives > 0 ? totalCorrectlyTyped / totalTruePositives : 0;
  const exclusionCompl =
    totalExcludedExpected > 0
      ? totalExclusionSuccesses / totalExcludedExpected
      : 0;

  return {
    precision: p,
    recall: r,
    f1,
    type_accuracy: typeAcc,
    exclusion_compliance: exclusionCompl,
    cross_item_consistency: 0, // set externally
    total_items: scores.length,
    total_extracted: totalExtracted,
    total_expected: totalExpected,
    total_true_positives: totalTruePositives,
    total_false_positives: totalFalsePositives,
    total_false_negatives: totalFalseNegatives,
    total_correctly_typed: totalCorrectlyTyped,
    total_type_errors: totalTypeErrors,
    total_exclusion_successes: totalExclusionSuccesses,
    total_exclusion_failures: totalExclusionFailures,
    total_excluded_expected: totalExcludedExpected,
  };
}

// ── Cross-Item Consistency ──────────────────────────────────────────

function measureCrossItemConsistency(entityMap: Map<string, DbEntity[]>): {
  consistency: number;
  inconsistencies: Array<{ name: string; types: string[] }>;
} {
  // Group all entity mentions by canonical_name across all items
  const entityTypes = new Map<string, Set<string>>();

  for (const entities of entityMap.values()) {
    for (const e of entities) {
      const key = normaliseForComparison(e.canonical_name);
      if (!entityTypes.has(key)) entityTypes.set(key, new Set());
      entityTypes.get(key)!.add(e.entity_type);
    }
  }

  // Count entities with consistent typing
  let consistent = 0;
  let total = 0;
  const inconsistencies: Array<{ name: string; types: string[] }> = [];

  for (const [name, types] of entityTypes) {
    total++;
    if (types.size === 1) {
      consistent++;
    } else {
      inconsistencies.push({ name, types: [...types] });
    }
  }

  return {
    consistency: total > 0 ? consistent / total : 1,
    inconsistencies,
  };
}

// ── Extended Reporting ─────────────────────────────────────────────

/**
 * Print entity-specific detail sections (domain breakdown, type errors,
 * inconsistencies, worst items) that supplement the shared report.
 */
function printEntityDetail(
  scores: ItemScore[],
  metrics: Record<string, number>,
  consistency: {
    consistency: number;
    inconsistencies: Array<{ name: string; types: string[] }>;
  },
  verbose: boolean,
): void {
  // Counts summary
  console.log('--- COUNTS ---\n');
  console.log(`  Total extracted:          ${metrics.total_extracted}`);
  console.log(`  Total expected:           ${metrics.total_expected}`);
  console.log(`  True positives:           ${metrics.total_true_positives}`);
  console.log(`  False positives:          ${metrics.total_false_positives}`);
  console.log(`  False negatives:          ${metrics.total_false_negatives}`);
  console.log(`  Correctly typed:          ${metrics.total_correctly_typed}`);
  console.log(`  Type errors:              ${metrics.total_type_errors}`);
  console.log(
    `  Exclusion successes:      ${metrics.total_exclusion_successes}`,
  );
  console.log(
    `  Exclusion failures:       ${metrics.total_exclusion_failures}`,
  );

  // Per-domain breakdown
  console.log('\n--- PER-DOMAIN BREAKDOWN ---\n');
  const domains = new Map<
    string,
    { scores: ItemScore[]; expectedCount: number }
  >();
  for (const s of scores) {
    if (!domains.has(s.domain))
      domains.set(s.domain, { scores: [], expectedCount: 0 });
    domains.get(s.domain)!.scores.push(s);
  }

  for (const [domain, data] of domains) {
    const domainTp = data.scores.reduce(
      (sum, s) => sum + s.true_positives.length,
      0,
    );
    const domainFp = data.scores.reduce(
      (sum, s) => sum + s.false_positives.length,
      0,
    );
    const domainFn = data.scores.reduce(
      (sum, s) => sum + s.false_negatives.length,
      0,
    );
    const domainTotal = domainTp + domainFp;
    const domainPrecision = domainTotal > 0 ? domainTp / domainTotal : 0;
    const domainRecall =
      domainTp + domainFn > 0 ? domainTp / (domainTp + domainFn) : 0;
    console.log(
      `  ${domain.padEnd(20)} ${data.scores.length} items  P=${(domainPrecision * 100).toFixed(0)}%  R=${(domainRecall * 100).toFixed(0)}%  TP=${domainTp}  FP=${domainFp}  FN=${domainFn}`,
    );
  }

  // Type errors detail
  const allTypeErrors = scores.flatMap((s) => s.type_errors);
  if (allTypeErrors.length > 0) {
    console.log('\n--- TYPE ERRORS ---\n');
    for (const te of allTypeErrors) {
      console.log(
        `  "${te.name}": expected=${te.expected}, actual=${te.actual}`,
      );
    }
  }

  // Cross-item inconsistencies
  if (consistency.inconsistencies.length > 0) {
    console.log('\n--- CROSS-ITEM TYPE INCONSISTENCIES ---\n');
    for (const inc of consistency.inconsistencies) {
      console.log(`  "${inc.name}": appears as [${inc.types.join(', ')}]`);
    }
  }

  // Worst-performing items
  const failingItems = scores
    .filter((s) => s.false_positives.length > 0 || s.false_negatives.length > 0)
    .sort(
      (a, b) =>
        b.false_positives.length +
        b.false_negatives.length -
        (a.false_positives.length + a.false_negatives.length),
    );

  if (failingItems.length > 0) {
    console.log('\n--- ITEMS WITH FAILURES (top 15) ---\n');
    for (const item of failingItems.slice(0, 15)) {
      console.log(
        `  ${item.title.slice(0, 60).padEnd(62)} P=${(item.precision * 100).toFixed(0)}%  R=${(item.recall * 100).toFixed(0)}%  ExCmpl=${(item.exclusion_compliance * 100).toFixed(0)}%`,
      );
      if (item.false_positives.length > 0) {
        console.log(`    FP: ${item.false_positives.join(', ')}`);
      }
      if (item.false_negatives.length > 0) {
        console.log(`    FN: ${item.false_negatives.join(', ')}`);
      }
    }
  }

  // Verbose: per-item detail
  if (verbose) {
    console.log('\n--- PER-ITEM DETAIL ---\n');
    for (const s of scores) {
      console.log(`\n  [${s.content_item_id}] ${s.title.slice(0, 70)}`);
      console.log(
        `    P=${(s.precision * 100).toFixed(0)}%  R=${(s.recall * 100).toFixed(0)}%  TA=${(s.type_accuracy * 100).toFixed(0)}%  EC=${(s.exclusion_compliance * 100).toFixed(0)}%`,
      );
      if (s.true_positives.length > 0)
        console.log(`    TP: ${s.true_positives.join(', ')}`);
      if (s.false_positives.length > 0)
        console.log(`    FP: ${s.false_positives.join(', ')}`);
      if (s.false_negatives.length > 0)
        console.log(`    FN: ${s.false_negatives.join(', ')}`);
      if (s.type_errors.length > 0)
        console.log(
          `    TE: ${s.type_errors.map((e) => `${e.name}: ${e.expected}->${e.actual}`).join(', ')}`,
        );
      if (s.exclusion_failures.length > 0)
        console.log(`    EF: ${s.exclusion_failures.join(', ')}`);
    }
  }

  console.log('');
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--live') ? 'live' : 'cached';
  const verbose = args.includes('--verbose');
  const jsonOutput = args.includes('--json');
  const doSaveBaseline = args.includes('--save-baseline');
  const confirmFlag = args.includes('--confirm');
  const validateFlag = args.includes('--validate');
  const itemFilter = args.includes('--item')
    ? args[args.indexOf('--item') + 1]
    : null;
  // Supports both `--env prod` (space-separated) and `--env=prod` (=-form).
  let envFlag = '';
  if (args.includes('--env')) {
    envFlag = args[args.indexOf('--env') + 1] ?? '';
  }
  const envEqArg = args.find((a) => a.startsWith('--env='));
  if (envEqArg) {
    envFlag = envEqArg.slice('--env='.length);
  }

  // --env=prod opt-in: assert SUPABASE_URL is prod-pointed (per WP-S5.2 spec v1.1 §7.1).
  // This script reads / re-classifies prod entities — wrong env corrupts metadata.
  const PROD_PROJECT_REF = 'rovrymhhffssilaftdwd';
  const envUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (envFlag === 'prod' && !(envUrl ?? '').includes(PROD_PROJECT_REF)) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${PROD_PROJECT_REF}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<prod-svc-key> bun run scripts/eval-entity-classification.ts --env=prod`,
    );
    process.exit(1);
  }

  // Load gold standard
  const fixturePath = resolve(
    PROJECT_ROOT,
    '__tests__/fixtures/entity-eval-gold-standard.json',
  );
  if (!existsSync(fixturePath)) {
    console.error(`Gold standard fixture not found at: ${fixturePath}`);
    process.exit(1);
  }

  let goldStandard: GoldStandardItem[] = JSON.parse(
    readFileSync(fixturePath, 'utf-8'),
  );

  // Filter to single item if requested
  if (itemFilter) {
    goldStandard = goldStandard.filter((g) => g.content_item_id === itemFilter);
    if (goldStandard.length === 0) {
      console.error(`Item ${itemFilter} not found in gold standard`);
      process.exit(1);
    }
  }

  const supabase = createServiceClient();
  const itemIds = goldStandard.map((g) => g.content_item_id);
  let entityMap: Map<string, DbEntity[]>;

  if (mode === 'live') {
    // ── Live mode: re-run classification for each item ──
    const costEstimate = estimateLiveCost(goldStandard.length);

    // Require confirmation unless --confirm flag is passed
    if (!confirmFlag) {
      const confirmed = await confirmLiveRun(costEstimate, goldStandard.length);
      if (!confirmed) {
        console.log('Aborted.');
        process.exit(0);
      }
    } else {
      // Print cost estimate even with --confirm for logging
      console.log(
        `\nLive mode: ${goldStandard.length} items, model=${costEstimate.model}, est. cost=$${costEstimate.estimatedCostUsd.toFixed(4)} USD`,
      );
    }

    console.log(
      `\nRunning live classification for ${goldStandard.length} items (${validateFlag ? 'with validation' : 'standard'})...\n`,
    );

    entityMap = new Map();
    let completed = 0;

    for (const gold of goldStandard) {
      try {
        const entities = await classifyAndExtractEntities(
          supabase,
          gold.content_item_id,
          validateFlag,
        );
        entityMap.set(gold.content_item_id, entities);
        completed++;

        if (!jsonOutput) {
          process.stdout.write(
            `  [${completed}/${goldStandard.length}] ${gold.title.slice(0, 60)} — ${entities.length} entities\n`,
          );
        }

        // Rate limit: 1 request per second
        if (completed < goldStandard.length) {
          await delay(1000);
        }
      } catch (err) {
        console.error(
          `  [${completed + 1}/${goldStandard.length}] FAILED: ${gold.title.slice(0, 60)} — ${err instanceof Error ? err.message : String(err)}`,
        );
        entityMap.set(gold.content_item_id, []);
        completed++;
      }
    }

    console.log(
      `\nLive classification complete: ${completed} items processed.\n`,
    );
  } else {
    // ── Cached mode: read existing entities from DB ──
    console.log(
      `Loading entity data for ${goldStandard.length} gold standard items (cached mode)...`,
    );
    entityMap = await fetchEntitiesForItems(supabase, itemIds);
  }

  // Score each item
  const scores: ItemScore[] = [];
  for (const gold of goldStandard) {
    const extracted = entityMap.get(gold.content_item_id) ?? [];
    scores.push(scoreItem(gold, extracted));
  }

  // Aggregate metrics
  const metrics = computeAggregateMetrics(scores, goldStandard);

  // Cross-item consistency
  const consistency = measureCrossItemConsistency(entityMap);
  metrics.cross_item_consistency = consistency.consistency;

  // Build failures list
  const failures: string[] = [];
  for (const [metricName, threshold] of Object.entries(THRESHOLDS)) {
    const value = metrics[metricName] ?? 0;
    if (threshold.min !== undefined && value < threshold.min) {
      failures.push(
        `${metricName} ${(value * 100).toFixed(1)}% below minimum ${(threshold.min * 100).toFixed(0)}%`,
      );
    }
  }

  // Build shared EvalResult
  const result: EvalResult = {
    suite_name: 'Entity Classification Eval',
    timestamp: new Date().toISOString(),
    total_items: scores.length,
    metrics: {
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
      type_accuracy: metrics.type_accuracy,
      exclusion_compliance: metrics.exclusion_compliance,
      cross_item_consistency: metrics.cross_item_consistency,
    },
    passed: failures.length === 0,
    failures,
  };

  // Baseline handling
  const baseline = loadBaseline(SUITE_NAME);
  let regressions: RegressionResult[] | undefined;

  if (baseline) {
    regressions = checkRegression(baseline, result.metrics);
    const regressionFailures = regressions.filter((r) => !r.passed);
    if (regressionFailures.length > 0) {
      result.passed = false;
      for (const rf of regressionFailures) {
        result.failures.push(
          `Regression: ${rf.metric_name} dropped from ${(rf.baseline_value * 100).toFixed(1)}% to ${(rf.current_value * 100).toFixed(1)}%`,
        );
      }
    }
  }

  if (doSaveBaseline) {
    saveBaseline(SUITE_NAME, result.metrics, THRESHOLDS);
    console.log('Baseline saved.');
  }

  // Output
  if (jsonOutput) {
    printJsonReport(result, regressions);
  } else {
    printSharedReport(result, regressions);
    printEntityDetail(scores, metrics, consistency, verbose);
  }

  // Exit with non-zero if any threshold failed or regression detected
  if (!result.passed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Eval failed:', err);
  process.exit(1);
});

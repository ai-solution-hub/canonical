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
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

// ── Types ───────────────────────────────────────────────────────────

interface GoldEntity {
  name: string;
  type: string;
  canonical_name: string;
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

interface AggregateScore {
  total_items: number;
  total_extracted: number;
  total_expected: number;
  total_excluded_expected: number;
  total_true_positives: number;
  total_false_positives: number;
  total_false_negatives: number;
  total_correctly_typed: number;
  total_type_errors: number;
  total_exclusion_successes: number;
  total_exclusion_failures: number;
  precision: number;
  recall: number;
  f1: number;
  type_accuracy: number;
  exclusion_compliance: number;
  cross_item_consistency: number;
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
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SECRET_KEY',
    );
    process.exit(1);
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchEntitiesForItems(
  supabase: ReturnType<typeof createClient>,
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
    const id = row.content_item_id as string;
    if (!map.has(id)) map.set(id, []);
    map.get(id)!.push({
      entity_type: row.entity_type as string,
      entity_name: row.entity_name as string,
      canonical_name: row.canonical_name as string,
    });
  }

  return map;
}

// ── Scoring ─────────────────────────────────────────────────────────

function scoreItem(
  gold: GoldStandardItem,
  extracted: DbEntity[],
): ItemScore {
  const truePositives: string[] = [];
  const falsePositives: string[] = [];
  const falseNegatives: string[] = [];
  const typeErrors: Array<{ name: string; expected: string; actual: string }> = [];
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
      // Match on canonical name (primary) or entity name (fallback)
      if (
        entityNamesMatch(ext.canonical_name, exp.canonical_name) ||
        entityNamesMatch(ext.entity_name, exp.name) ||
        entityNamesMatch(ext.canonical_name, exp.name)
      ) {
        matchedExtracted.add(ei);
        matchedExpected.add(gi);
        truePositives.push(ext.entity_name);

        if (ext.entity_type !== exp.type) {
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
      falsePositives.push(
        `${ext.entity_name} [${ext.entity_type}]`,
      );
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

function aggregateScores(
  scores: ItemScore[],
  goldStandard: GoldStandardItem[],
): AggregateScore {
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

    totalExtracted +=
      s.true_positives.length + s.false_positives.length;
    totalExpected += g.expected_entities.length;
    totalExcludedExpected += g.excluded_entities.length;
    totalTruePositives += s.true_positives.length;
    totalFalsePositives += s.false_positives.length;
    totalFalseNegatives += s.false_negatives.length;
    totalCorrectlyTyped +=
      s.true_positives.length - s.type_errors.length;
    totalTypeErrors += s.type_errors.length;
    totalExclusionFailures += s.exclusion_failures.length;
    totalExclusionSuccesses +=
      g.excluded_entities.length - s.exclusion_failures.length;
  }

  const precision =
    totalExtracted > 0 ? totalTruePositives / totalExtracted : 0;
  const recall =
    totalExpected > 0 ? totalTruePositives / totalExpected : 0;
  const f1 =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;
  const typeAccuracy =
    totalTruePositives > 0
      ? totalCorrectlyTyped / totalTruePositives
      : 0;
  const exclusionCompliance =
    totalExcludedExpected > 0
      ? totalExclusionSuccesses / totalExcludedExpected
      : 0;

  return {
    total_items: scores.length,
    total_extracted: totalExtracted,
    total_expected: totalExpected,
    total_excluded_expected: totalExcludedExpected,
    total_true_positives: totalTruePositives,
    total_false_positives: totalFalsePositives,
    total_false_negatives: totalFalseNegatives,
    total_correctly_typed: totalCorrectlyTyped,
    total_type_errors: totalTypeErrors,
    total_exclusion_successes: totalExclusionSuccesses,
    total_exclusion_failures: totalExclusionFailures,
    precision,
    recall,
    f1,
    type_accuracy: typeAccuracy,
    exclusion_compliance: exclusionCompliance,
    cross_item_consistency: 0, // calculated separately
  };
}

// ── Cross-Item Consistency ──────────────────────────────────────────

function measureCrossItemConsistency(
  entityMap: Map<string, DbEntity[]>,
): { consistency: number; inconsistencies: Array<{ name: string; types: string[] }> } {
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

// ── Reporting ───────────────────────────────────────────────────────

function printReport(
  scores: ItemScore[],
  aggregate: AggregateScore,
  consistency: { consistency: number; inconsistencies: Array<{ name: string; types: string[] }> },
  verbose: boolean,
): void {
  console.log('\n' + '='.repeat(72));
  console.log('  ENTITY CLASSIFICATION EVAL REPORT');
  console.log('='.repeat(72));

  // Aggregate summary
  console.log('\n--- AGGREGATE SCORES ---\n');
  console.log(
    `  Items evaluated:          ${aggregate.total_items}`,
  );
  console.log(
    `  Total extracted:          ${aggregate.total_extracted}`,
  );
  console.log(
    `  Total expected:           ${aggregate.total_expected}`,
  );
  console.log(
    `  Total excluded expected:  ${aggregate.total_excluded_expected}`,
  );
  console.log('');
  console.log(
    `  Precision:                ${(aggregate.precision * 100).toFixed(1)}%  (${aggregate.total_true_positives} correct / ${aggregate.total_extracted} extracted)`,
  );
  console.log(
    `  Recall:                   ${(aggregate.recall * 100).toFixed(1)}%  (${aggregate.total_true_positives} found / ${aggregate.total_expected} expected)`,
  );
  console.log(
    `  F1 Score:                 ${(aggregate.f1 * 100).toFixed(1)}%`,
  );
  console.log(
    `  Type Accuracy:            ${(aggregate.type_accuracy * 100).toFixed(1)}%  (${aggregate.total_correctly_typed} correct type / ${aggregate.total_true_positives} matched)`,
  );
  console.log(
    `  Exclusion Compliance:     ${(aggregate.exclusion_compliance * 100).toFixed(1)}%  (${aggregate.total_exclusion_successes} excluded / ${aggregate.total_excluded_expected} should be excluded)`,
  );
  console.log(
    `  Cross-Item Consistency:   ${(consistency.consistency * 100).toFixed(1)}%`,
  );

  // Targets
  console.log('\n--- TARGET COMPARISON ---\n');
  const targets = [
    { name: 'Precision', value: aggregate.precision, target: 0.9 },
    { name: 'Recall', value: aggregate.recall, target: 0.8 },
    { name: 'Type Accuracy', value: aggregate.type_accuracy, target: 0.85 },
    {
      name: 'Exclusion Compliance',
      value: aggregate.exclusion_compliance,
      target: 0.9,
    },
    {
      name: 'Cross-Item Consistency',
      value: consistency.consistency,
      target: 0.95,
    },
  ];

  for (const t of targets) {
    const met = t.value >= t.target;
    const icon = met ? 'PASS' : 'FAIL';
    console.log(
      `  [${icon}] ${t.name.padEnd(25)} ${(t.value * 100).toFixed(1)}%  (target: ${(t.target * 100).toFixed(0)}%)`,
    );
  }

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
      console.log(
        `  "${inc.name}": appears as [${inc.types.join(', ')}]`,
      );
    }
  }

  // Worst-performing items
  const failingItems = scores
    .filter(
      (s) => s.false_positives.length > 0 || s.false_negatives.length > 0,
    )
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
        console.log(
          `    FP: ${item.false_positives.join(', ')}`,
        );
      }
      if (item.false_negatives.length > 0) {
        console.log(
          `    FN: ${item.false_negatives.join(', ')}`,
        );
      }
    }
  }

  // Verbose: per-item detail
  if (verbose) {
    console.log('\n--- PER-ITEM DETAIL ---\n');
    for (const s of scores) {
      console.log(
        `\n  [${s.content_item_id}] ${s.title.slice(0, 70)}`,
      );
      console.log(
        `    P=${(s.precision * 100).toFixed(0)}%  R=${(s.recall * 100).toFixed(0)}%  TA=${(s.type_accuracy * 100).toFixed(0)}%  EC=${(s.exclusion_compliance * 100).toFixed(0)}%`,
      );
      if (s.true_positives.length > 0)
        console.log(
          `    TP: ${s.true_positives.join(', ')}`,
        );
      if (s.false_positives.length > 0)
        console.log(
          `    FP: ${s.false_positives.join(', ')}`,
        );
      if (s.false_negatives.length > 0)
        console.log(
          `    FN: ${s.false_negatives.join(', ')}`,
        );
      if (s.type_errors.length > 0)
        console.log(
          `    TE: ${s.type_errors.map((e) => `${e.name}: ${e.expected}->${e.actual}`).join(', ')}`,
        );
      if (s.exclusion_failures.length > 0)
        console.log(
          `    EF: ${s.exclusion_failures.join(', ')}`,
        );
    }
  }

  console.log('\n' + '='.repeat(72));
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--live') ? 'live' : 'cached';
  const verbose = args.includes('--verbose');
  const jsonOutput = args.includes('--json');
  const itemFilter = args.includes('--item')
    ? args[args.indexOf('--item') + 1]
    : null;

  if (mode === 'live') {
    console.error(
      'Live mode (re-running classification) is not yet implemented.',
    );
    console.error('Use --cached mode to compare against existing DB entities.');
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
    goldStandard = goldStandard.filter(
      (g) => g.content_item_id === itemFilter,
    );
    if (goldStandard.length === 0) {
      console.error(`Item ${itemFilter} not found in gold standard`);
      process.exit(1);
    }
  }

  console.log(
    `Loading entity data for ${goldStandard.length} gold standard items (${mode} mode)...`,
  );

  // Fetch existing entities from DB
  const supabase = createServiceClient();
  const itemIds = goldStandard.map((g) => g.content_item_id);
  const entityMap = await fetchEntitiesForItems(supabase, itemIds);

  // Score each item
  const scores: ItemScore[] = [];
  for (const gold of goldStandard) {
    const extracted = entityMap.get(gold.content_item_id) ?? [];
    scores.push(scoreItem(gold, extracted));
  }

  // Aggregate
  const aggregate = aggregateScores(scores, goldStandard);

  // Cross-item consistency
  const consistency = measureCrossItemConsistency(entityMap);
  aggregate.cross_item_consistency = consistency.consistency;

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          mode,
          timestamp: new Date().toISOString(),
          aggregate,
          consistency: {
            score: consistency.consistency,
            inconsistencies: consistency.inconsistencies,
          },
          per_item: scores,
        },
        null,
        2,
      ),
    );
  } else {
    printReport(scores, aggregate, consistency, verbose);
  }

  // Exit with non-zero if below minimum thresholds (for CI gating)
  const minimumPrecision = 0.5; // low bar for current system (baseline)
  const minimumRecall = 0.4;
  if (
    aggregate.precision < minimumPrecision ||
    aggregate.recall < minimumRecall
  ) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Eval failed:', err);
  process.exit(1);
});

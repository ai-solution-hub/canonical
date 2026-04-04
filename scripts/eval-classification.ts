/**
 * Classification Eval Runner
 *
 * Compares DB classifications against a hand-labelled gold standard.
 * No API cost — reads existing DB values only.
 *
 * Metrics:
 *   - Domain accuracy: correct primary_domain / total items
 *   - Subtopic accuracy: correct primary_subtopic / total items
 *   - Secondary domain accuracy: correct secondary_domain (where expected)
 *   - Keyword overlap: intersection of DB keywords vs expected keywords
 *
 * Usage:
 *   bun run eval:classification
 *   bun run eval:classification --verbose
 *   bun run eval:classification --json
 *   bun run eval:classification --save-baseline
 *   bun run eval:classification --item <uuid>
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { accuracy } from '../lib/eval/metrics';
import { loadBaseline, saveBaseline, checkRegression } from '../lib/eval/baseline';
import { printReport, printJsonReport } from '../lib/eval/reporter';
import type { EvalResult, RegressionResult } from '../lib/eval/types';

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

// ── Types ───────────────────────────────────────────────────────────

interface GoldItem {
  content_item_id: string;
  title: string;
  content_type: string;
  expected_domain: string;
  expected_subtopic: string;
  expected_secondary_domain: string | null;
  expected_confidence_min: number;
  expected_keywords: string[];
  notes: string;
}

interface DbRow {
  id: string;
  primary_domain: string | null;
  primary_subtopic: string | null;
  secondary_domain: string | null;
  classification_confidence: number | null;
  ai_keywords: string[] | null;
}

interface ItemScore {
  content_item_id: string;
  title: string;
  domain_match: boolean;
  subtopic_match: boolean;
  secondary_domain_match: boolean | null; // null when not expected
  keyword_overlap: number;
  details: string[];
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

async function fetchClassifications(
  supabase: ReturnType<typeof createClient>,
  itemIds: string[],
): Promise<Map<string, DbRow>> {
  const { data, error } = await supabase
    .from('content_items')
    .select('id, primary_domain, primary_subtopic, secondary_domain, classification_confidence, ai_keywords')
    .in('id', itemIds);

  if (error) {
    console.error('Failed to fetch content items:', error.message);
    process.exit(1);
  }

  const map = new Map<string, DbRow>();
  for (const row of data ?? []) {
    map.set(row.id as string, row as DbRow);
  }
  return map;
}

// ── Scoring ─────────────────────────────────────────────────────────

function computeKeywordOverlap(dbKeywords: string[] | null, expectedKeywords: string[]): number {
  if (!dbKeywords || dbKeywords.length === 0 || expectedKeywords.length === 0) return 0;

  const dbLower = new Set(dbKeywords.map((k) => k.toLowerCase().trim()));
  let matches = 0;

  for (const expected of expectedKeywords) {
    const expectedLower = expected.toLowerCase().trim();
    // Check for exact match or partial containment
    for (const dbK of dbLower) {
      if (dbK === expectedLower || dbK.includes(expectedLower) || expectedLower.includes(dbK)) {
        matches++;
        break;
      }
    }
  }

  return matches / expectedKeywords.length;
}

function scoreItem(gold: GoldItem, db: DbRow | undefined): ItemScore {
  const details: string[] = [];

  if (!db) {
    details.push('Item not found in database');
    return {
      content_item_id: gold.content_item_id,
      title: gold.title,
      domain_match: false,
      subtopic_match: false,
      secondary_domain_match: gold.expected_secondary_domain ? false : null,
      keyword_overlap: 0,
      details,
    };
  }

  const domainMatch = db.primary_domain === gold.expected_domain;
  if (!domainMatch) {
    details.push(`Domain: expected="${gold.expected_domain}", actual="${db.primary_domain}"`);
  }

  const subtopicMatch = db.primary_subtopic === gold.expected_subtopic;
  if (!subtopicMatch) {
    details.push(`Subtopic: expected="${gold.expected_subtopic}", actual="${db.primary_subtopic}"`);
  }

  let secondaryDomainMatch: boolean | null = null;
  if (gold.expected_secondary_domain) {
    secondaryDomainMatch = db.secondary_domain === gold.expected_secondary_domain;
    if (!secondaryDomainMatch) {
      details.push(
        `Secondary domain: expected="${gold.expected_secondary_domain}", actual="${db.secondary_domain}"`,
      );
    }
  }

  const keywordOverlap = computeKeywordOverlap(db.ai_keywords, gold.expected_keywords);
  if (keywordOverlap < 1.0 && gold.expected_keywords.length > 0) {
    details.push(`Keyword overlap: ${(keywordOverlap * 100).toFixed(0)}% (${gold.expected_keywords.join(', ')})`);
  }

  return {
    content_item_id: gold.content_item_id,
    title: gold.title,
    domain_match: domainMatch,
    subtopic_match: subtopicMatch,
    secondary_domain_match: secondaryDomainMatch,
    keyword_overlap: keywordOverlap,
    details,
  };
}

// ── Main ────────────────────────────────────────────────────────────

const SUITE_NAME = 'classification';

const THRESHOLDS: Record<string, { min?: number; max_drop?: number }> = {
  domain_accuracy: { min: 0.70, max_drop: 0.05 },
  subtopic_accuracy: { min: 0.50, max_drop: 0.10 },
  keyword_overlap: { min: 0.40, max_drop: 0.10 },
};

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const jsonOutput = args.includes('--json');
  const doSaveBaseline = args.includes('--save-baseline');
  const itemFilter = args.includes('--item')
    ? args[args.indexOf('--item') + 1]
    : null;

  // Load gold standard
  const fixturePath = resolve(
    PROJECT_ROOT,
    '__tests__/fixtures/classification-eval-gold-standard.json',
  );
  if (!existsSync(fixturePath)) {
    console.error(`Gold standard fixture not found at: ${fixturePath}`);
    process.exit(1);
  }

  let goldStandard: GoldItem[] = JSON.parse(readFileSync(fixturePath, 'utf-8'));

  // Filter to single item if requested
  if (itemFilter) {
    goldStandard = goldStandard.filter((g) => g.content_item_id === itemFilter);
    if (goldStandard.length === 0) {
      console.error(`Item ${itemFilter} not found in gold standard`);
      process.exit(1);
    }
  }

  console.log(`Loading classification data for ${goldStandard.length} gold standard items...`);

  // Fetch from DB
  const supabase = createServiceClient();
  const itemIds = goldStandard.map((g) => g.content_item_id);
  const dbMap = await fetchClassifications(supabase, itemIds);

  const missing = itemIds.filter((id) => !dbMap.has(id));
  if (missing.length > 0) {
    console.log(`Warning: ${missing.length} gold standard items not found in database (skipped)`);
  }

  // Score each item
  const scores: ItemScore[] = [];
  for (const gold of goldStandard) {
    scores.push(scoreItem(gold, dbMap.get(gold.content_item_id)));
  }

  // Aggregate metrics
  const evaluated = scores.filter((s) => s.details[0] !== 'Item not found in database');
  const domainCorrect = evaluated.filter((s) => s.domain_match).length;
  const subtopicCorrect = evaluated.filter((s) => s.subtopic_match).length;
  const secondaryItems = evaluated.filter((s) => s.secondary_domain_match !== null);
  const secondaryCorrect = secondaryItems.filter((s) => s.secondary_domain_match === true).length;
  const avgKeywordOverlap =
    evaluated.length > 0
      ? evaluated.reduce((sum, s) => sum + s.keyword_overlap, 0) / evaluated.length
      : 0;

  const domainAcc = accuracy(domainCorrect, evaluated.length);
  const subtopicAcc = accuracy(subtopicCorrect, evaluated.length);
  const secondaryAcc = secondaryItems.length > 0 ? accuracy(secondaryCorrect, secondaryItems.length) : 1.0;

  const metrics: Record<string, number> = {
    domain_accuracy: domainAcc,
    subtopic_accuracy: subtopicAcc,
    secondary_domain_accuracy: secondaryAcc,
    keyword_overlap: avgKeywordOverlap,
  };

  // Build failures
  const failures: string[] = [];
  if (domainAcc < (THRESHOLDS.domain_accuracy.min ?? 0)) {
    failures.push(`domain_accuracy ${(domainAcc * 100).toFixed(1)}% below minimum ${((THRESHOLDS.domain_accuracy.min ?? 0) * 100).toFixed(0)}%`);
  }
  if (subtopicAcc < (THRESHOLDS.subtopic_accuracy.min ?? 0)) {
    failures.push(`subtopic_accuracy ${(subtopicAcc * 100).toFixed(1)}% below minimum ${((THRESHOLDS.subtopic_accuracy.min ?? 0) * 100).toFixed(0)}%`);
  }
  if (avgKeywordOverlap < (THRESHOLDS.keyword_overlap.min ?? 0)) {
    failures.push(`keyword_overlap ${(avgKeywordOverlap * 100).toFixed(1)}% below minimum ${((THRESHOLDS.keyword_overlap.min ?? 0) * 100).toFixed(0)}%`);
  }

  const result: EvalResult = {
    suite_name: 'Classification Eval',
    timestamp: new Date().toISOString(),
    total_items: evaluated.length,
    metrics,
    passed: failures.length === 0,
    failures,
  };

  // Baseline handling
  const baseline = loadBaseline(SUITE_NAME);
  let regressions: RegressionResult[] | undefined;

  if (baseline) {
    regressions = checkRegression(baseline, metrics);
    const regressionFailures = regressions.filter((r) => !r.passed);
    if (regressionFailures.length > 0) {
      result.passed = false;
      for (const rf of regressionFailures) {
        result.failures.push(`Regression: ${rf.metric_name} dropped from ${(rf.baseline_value * 100).toFixed(1)}% to ${(rf.current_value * 100).toFixed(1)}%`);
      }
    }
  }

  if (doSaveBaseline) {
    saveBaseline(SUITE_NAME, metrics, THRESHOLDS);
    console.log('Baseline saved.');
  }

  // Verbose per-item output
  if (verbose && !jsonOutput) {
    console.log('\n--- PER-ITEM DETAIL ---\n');
    for (const s of scores) {
      const status = s.domain_match && s.subtopic_match ? 'PASS' : 'FAIL';
      console.log(`  [${status}] ${s.title.slice(0, 70)}`);
      for (const d of s.details) {
        console.log(`    ${d}`);
      }
    }
  }

  // Output
  if (jsonOutput) {
    printJsonReport(result, regressions);
  } else {
    printReport(result, regressions);

    // Per-content-type breakdown
    console.log('--- PER-CONTENT-TYPE BREAKDOWN ---\n');
    const byType = new Map<string, { total: number; domainOk: number; subtopicOk: number }>();
    for (let i = 0; i < goldStandard.length; i++) {
      const ct = goldStandard[i].content_type;
      const s = scores[i];
      if (s.details[0] === 'Item not found in database') continue;
      if (!byType.has(ct)) byType.set(ct, { total: 0, domainOk: 0, subtopicOk: 0 });
      const entry = byType.get(ct)!;
      entry.total++;
      if (s.domain_match) entry.domainOk++;
      if (s.subtopic_match) entry.subtopicOk++;
    }
    for (const [ct, data] of byType) {
      console.log(
        `  ${ct.padEnd(20)} ${data.total} items  domain=${(accuracy(data.domainOk, data.total) * 100).toFixed(0)}%  subtopic=${(accuracy(data.subtopicOk, data.total) * 100).toFixed(0)}%`,
      );
    }
    console.log('');
  }

  // Exit code
  if (!result.passed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Eval failed:', err);
  process.exit(1);
});

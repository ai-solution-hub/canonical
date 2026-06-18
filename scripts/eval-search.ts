/**
 * Search Eval Runner
 *
 * Calls hybrid_search RPC for each test case and evaluates result quality.
 * Requires OpenAI API key for embedding generation (cheap).
 *
 * Metrics:
 *   - MRR (Mean Reciprocal Rank)
 *   - Precision@5 and Precision@10
 *   - Domain accuracy: results match expected domains
 *   - Min results compliance: meets minimum result count
 *
 * Usage:
 *   bun run eval:search
 *   bun run eval:search --verbose
 *   bun run eval:search --json
 *   bun run eval:search --save-baseline
 *   bun run eval:search --case SE-01
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { type SupabaseClient } from '@supabase/supabase-js';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { prodProjectRef } from '@/scripts/lib/project-refs';
import OpenAI from 'openai';
import type { Database } from '@/supabase/types/database.types';
import { precisionAtK } from '../lib/eval/metrics';
import {
  loadBaseline,
  saveBaseline,
  checkRegression,
} from '../lib/eval/baseline';
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

interface SearchTestCase {
  id: string;
  category: string;
  query: string;
  expectations: {
    min_results: number;
    max_results?: number;
    expected_domains: string[];
    expected_subtopics?: string[];
    expected_content_types?: string[];
    must_include_titles: string[];
    notes: string;
  };
  relevance_judgements?: Array<{
    content_item_id: string;
    relevant: boolean;
    score: number;
  }>;
}

interface SearchResult {
  id: string;
  title: string;
  primary_domain: string;
  similarity: number;
}

interface CaseScore {
  case_id: string;
  category: string;
  query: string;
  result_count: number;
  min_results_met: boolean;
  max_results_met: boolean;
  domain_accuracy: number;
  mrr_value: number;
  precision_at_5: number;
  precision_at_10: number;
  details: string[];
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

  return createScriptClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Embedding ───────────────────────────────────────────────────────

async function generateEmbedding(
  openai: OpenAI,
  text: string,
): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: text,
    dimensions: 1024,
  });
  return response.data[0].embedding;
}

// ── Search ──────────────────────────────────────────────────────────

async function executeSearch(
  supabase: SupabaseClient<Database>,
  embedding: number[],
  query: string,
): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('hybrid_search', {
    query_embedding: JSON.stringify(embedding),
    query_text: query,
    limit_count: 20,
    similarity_threshold: 0.35,
  });

  if (error) {
    console.error(`Search failed for "${query}":`, error.message);
    return [];
  }

  return (data ?? []) as SearchResult[];
}

// ── Scoring ─────────────────────────────────────────────────────────

function scoreCase(
  testCase: SearchTestCase,
  results: SearchResult[],
): CaseScore {
  const details: string[] = [];

  // Min/max results compliance
  const minResultsMet = results.length >= testCase.expectations.min_results;
  if (!minResultsMet) {
    details.push(
      `Min results: got ${results.length}, expected >= ${testCase.expectations.min_results}`,
    );
  }

  const maxResultsMet = testCase.expectations.max_results
    ? results.length <= testCase.expectations.max_results
    : true;

  // Domain accuracy: proportion of results in expected domains
  const expectedDomains = new Set(testCase.expectations.expected_domains);
  const domainMatches = results.filter((r) =>
    expectedDomains.has(r.primary_domain),
  ).length;
  const domainAccuracy =
    results.length > 0 ? domainMatches / results.length : 0;

  if (domainAccuracy < 0.5 && results.length > 0) {
    const actualDomains = [...new Set(results.map((r) => r.primary_domain))];
    details.push(
      `Domain accuracy: ${(domainAccuracy * 100).toFixed(0)}% (expected: ${[...expectedDomains].join(', ')}, got: ${actualDomains.join(', ')})`,
    );
  }

  // MRR and Precision@K using relevance judgements
  let mrrValue = 0;
  let pAt5 = 0;
  let pAt10 = 0;

  if (
    testCase.relevance_judgements &&
    testCase.relevance_judgements.length > 0
  ) {
    const judgementMap = new Map(
      testCase.relevance_judgements.map((j) => [j.content_item_id, j]),
    );

    // Build relevance flags for results
    const resultRelevance = results.map((r) => {
      const judgement = judgementMap.get(r.id);
      return { relevant: judgement?.relevant ?? false };
    });

    // MRR: find first relevant result
    for (let i = 0; i < resultRelevance.length; i++) {
      if (resultRelevance[i].relevant) {
        mrrValue = 1 / (i + 1);
        break;
      }
    }

    pAt5 = precisionAtK(resultRelevance, 5);
    pAt10 = precisionAtK(resultRelevance, 10);
  }

  return {
    case_id: testCase.id,
    category: testCase.category,
    query: testCase.query,
    result_count: results.length,
    min_results_met: minResultsMet,
    max_results_met: maxResultsMet,
    domain_accuracy: domainAccuracy,
    mrr_value: mrrValue,
    precision_at_5: pAt5,
    precision_at_10: pAt10,
    details,
  };
}

// ── Main ────────────────────────────────────────────────────────────

const SUITE_NAME = 'search';

const THRESHOLDS: Record<string, { min?: number; max_drop?: number }> = {
  mrr: { min: 0.4, max_drop: 0.1 },
  precision_at_5: { min: 0.3, max_drop: 0.1 },
  domain_accuracy: { min: 0.5, max_drop: 0.1 },
  min_results_compliance: { min: 0.8, max_drop: 0.05 },
};

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const jsonOutput = args.includes('--json');
  const doSaveBaseline = args.includes('--save-baseline');
  const caseFilter = args.includes('--case')
    ? args[args.indexOf('--case') + 1]
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
  // This script runs hybrid_search RPC against the prod KB — staging would 0-hit
  // (data-empty) so use --env=prod to assert URL is correctly prod-pointed.
  const envUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (envFlag === 'prod' && !(envUrl ?? '').includes(prodProjectRef())) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${prodProjectRef()}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<prod-svc-key> bun run scripts/eval-search.ts --env=prod`,
    );
    process.exit(1);
  }

  // Check for OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY — required for embedding generation');
    process.exit(1);
  }

  // Load test cases
  const testCasePath = resolve(PROJECT_ROOT, 'scripts/search-evaluation.json');
  if (!existsSync(testCasePath)) {
    console.error(`Search evaluation file not found at: ${testCasePath}`);
    process.exit(1);
  }

  const rawData = JSON.parse(readFileSync(testCasePath, 'utf-8'));
  let testCases: SearchTestCase[] = rawData.test_cases;

  // Filter to single case if requested
  if (caseFilter) {
    testCases = testCases.filter((tc) => tc.id === caseFilter);
    if (testCases.length === 0) {
      console.error(`Test case ${caseFilter} not found`);
      process.exit(1);
    }
  }

  console.log(`Running search eval for ${testCases.length} test cases...`);

  // Initialise clients
  const supabase = createServiceClient();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Run each test case
  const scores: CaseScore[] = [];
  for (const tc of testCases) {
    if (verbose && !jsonOutput) {
      process.stdout.write(`  ${tc.id}: "${tc.query}" ... `);
    }

    const embedding = await generateEmbedding(openai, tc.query);
    const results = await executeSearch(supabase, embedding, tc.query);
    const score = scoreCase(tc, results);
    scores.push(score);

    if (verbose && !jsonOutput) {
      const status = score.min_results_met ? 'OK' : 'FAIL';
      console.log(
        `${status} (${score.result_count} results, MRR=${score.mrr_value.toFixed(2)})`,
      );
    }
  }

  // Aggregate metrics
  const casesWithJudgements = scores.filter((s) => {
    const tc = testCases.find((t) => t.id === s.case_id);
    return tc?.relevance_judgements && tc.relevance_judgements.length > 0;
  });

  // MRR: use the mrr function from metrics.ts with all query results
  const allQueryResults = casesWithJudgements.map((s) => {
    const tc = testCases.find((t) => t.id === s.case_id)!;
    const judgementMap = new Map(
      tc.relevance_judgements!.map((j) => [j.content_item_id, j]),
    );
    // We don't have the raw results here, but we stored mrr_value per case
    // Use the per-case MRR values to compute the average
    return s.mrr_value;
  });

  const avgMrr =
    allQueryResults.length > 0
      ? allQueryResults.reduce((sum, v) => sum + v, 0) / allQueryResults.length
      : 0;

  const avgPAt5 =
    casesWithJudgements.length > 0
      ? casesWithJudgements.reduce((sum, s) => sum + s.precision_at_5, 0) /
        casesWithJudgements.length
      : 0;

  const avgPAt10 =
    casesWithJudgements.length > 0
      ? casesWithJudgements.reduce((sum, s) => sum + s.precision_at_10, 0) /
        casesWithJudgements.length
      : 0;

  const avgDomainAcc =
    scores.length > 0
      ? scores.reduce((sum, s) => sum + s.domain_accuracy, 0) / scores.length
      : 0;

  const minResultsCompliance =
    scores.length > 0
      ? scores.filter((s) => s.min_results_met).length / scores.length
      : 0;

  const metrics: Record<string, number> = {
    mrr: avgMrr,
    precision_at_5: avgPAt5,
    precision_at_10: avgPAt10,
    domain_accuracy: avgDomainAcc,
    min_results_compliance: minResultsCompliance,
  };

  // Build failures
  const failures: string[] = [];
  for (const [metricName, threshold] of Object.entries(THRESHOLDS)) {
    const value = metrics[metricName];
    if (
      value !== undefined &&
      threshold.min !== undefined &&
      value < threshold.min
    ) {
      failures.push(
        `${metricName} ${(value * 100).toFixed(1)}% below minimum ${(threshold.min * 100).toFixed(0)}%`,
      );
    }
  }

  const result: EvalResult = {
    suite_name: 'Search Eval',
    timestamp: new Date().toISOString(),
    total_items: scores.length,
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
        result.failures.push(
          `Regression: ${rf.metric_name} dropped from ${(rf.baseline_value * 100).toFixed(1)}% to ${(rf.current_value * 100).toFixed(1)}%`,
        );
      }
    }
  }

  if (doSaveBaseline) {
    saveBaseline(SUITE_NAME, metrics, THRESHOLDS);
    console.log('Baseline saved.');
  }

  // Output
  if (jsonOutput) {
    printJsonReport(result, regressions);
  } else {
    printReport(result, regressions);

    // Per-category breakdown
    console.log('--- PER-CATEGORY BREAKDOWN ---\n');
    const byCategory = new Map<
      string,
      { total: number; mrrSum: number; domainSum: number; minResultsOk: number }
    >();
    for (const s of scores) {
      if (!byCategory.has(s.category)) {
        byCategory.set(s.category, {
          total: 0,
          mrrSum: 0,
          domainSum: 0,
          minResultsOk: 0,
        });
      }
      const entry = byCategory.get(s.category)!;
      entry.total++;
      entry.mrrSum += s.mrr_value;
      entry.domainSum += s.domain_accuracy;
      if (s.min_results_met) entry.minResultsOk++;
    }
    for (const [cat, data] of byCategory) {
      const avgCatMrr = data.total > 0 ? data.mrrSum / data.total : 0;
      const avgCatDomain = data.total > 0 ? data.domainSum / data.total : 0;
      const minRate = data.total > 0 ? data.minResultsOk / data.total : 0;
      console.log(
        `  ${cat.padEnd(20)} ${data.total} cases  MRR=${(avgCatMrr * 100).toFixed(0)}%  domain=${(avgCatDomain * 100).toFixed(0)}%  min_results=${(minRate * 100).toFixed(0)}%`,
      );
    }
    console.log('');

    // Verbose: per-case detail
    if (verbose) {
      console.log('--- PER-CASE DETAIL ---\n');
      for (const s of scores) {
        const status = s.min_results_met ? 'PASS' : 'FAIL';
        console.log(
          `  [${status}] ${s.case_id}: "${s.query.slice(0, 50)}" => ${s.result_count} results  MRR=${s.mrr_value.toFixed(2)}  P@5=${s.precision_at_5.toFixed(2)}  domain=${(s.domain_accuracy * 100).toFixed(0)}%`,
        );
        for (const d of s.details) {
          console.log(`    ${d}`);
        }
      }
      console.log('');
    }
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

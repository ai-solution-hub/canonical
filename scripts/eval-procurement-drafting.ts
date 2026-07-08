/**
 * Procurement Drafting Eval Runner
 *
 * Evaluates bid response quality against a gold standard.
 * Cached mode only (default) — compares existing form_responses in DB.
 * Live mode is stubbed for future implementation.
 *
 * Metrics:
 *   - Word count compliance: within +/-10% of word_limit
 *   - Citation coverage: cited KB items / expected KB items
 *   - ROUGE-L against reference response
 *   - Structure score: presence of headings, paragraphs, lists
 *
 * Usage:
 *   bun run eval:procurement-drafting
 *   bun run eval:procurement-drafting --cached
 *   bun run eval:procurement-drafting --verbose
 *   bun run eval:procurement-drafting --json
 *   bun run eval:procurement-drafting --save-baseline
 */

import { readFileSync, existsSync } from 'fs';
import { resolveEvalFixture } from '../lib/eval/fixtures';
import { type SupabaseClient } from '@supabase/supabase-js';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { prodProjectRef } from '@/scripts/lib/project-refs';
import { rougeL } from '../lib/eval/metrics';
import type { Database } from '@/supabase/types/database.types';
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

interface GoldItem {
  question_id: string;
  question_text: string;
  word_limit: number;
  section_name: string;
  reference_response: string;
  human_scores: {
    completeness: number;
    evidence_strength: number;
    compliance_language: number;
    structure: number;
    overall: number;
  };
  expected_kb_items_used: string[];
  notes: string;
}

interface DbResponse {
  id: string;
  question_id: string;
  response_text: string;
  source_record_ids: string[] | null;
  metadata: Record<string, unknown> | null;
}

interface ItemScore {
  question_id: string;
  question_text: string;
  word_count_compliant: boolean;
  word_count: number;
  word_limit: number;
  citation_coverage: number;
  rouge_l: number;
  structure_score: number;
  details: string[];
}

// ── --env=prod opt-in (WP-S5.3 D-21 F-1) ──────────────────────────────────

function parseEnvFlag(argv: string[]): string {
  const eqArg = argv.find((a) => a.startsWith('--env='));
  if (eqArg) return eqArg.slice('--env='.length);
  const idx = argv.indexOf('--env');
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return '';
}

function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(prodProjectRef())) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${prodProjectRef()}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/eval-procurement-drafting.ts --env=prod`,
    );
    process.exit(1);
  }
}

// ── DB Access ───────────────────────────────────────────────────────

function createServiceClient(env: string) {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  assertEnvFlag(env, url);

  return createScriptClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchProcurementResponses(
  supabase: SupabaseClient<Database>,
  questionIds: string[],
): Promise<Map<string, DbResponse>> {
  // The gold standard uses synthetic question_ids (eval-bid-NNN), not real UUIDs.
  // Fetch matching question IDs from form_responses joined with form_questions.
  // bl-215: the column is `source_record_ids` (not the dropped `cited_items`),
  // and a real query error MUST surface (no silent `return new Map()` swallow) —
  // otherwise the eval DB path is dead and citation coverage is computed against
  // an always-empty set.
  const { data, error } = await supabase
    .from('form_responses')
    .select('id, question_id, response_text, source_record_ids, metadata')
    .in('question_id', questionIds);

  if (error) {
    throw new Error(
      `fetchProcurementResponses: form_responses query failed: ${error.message}`,
    );
  }

  const map = new Map<string, DbResponse>();
  for (const row of (data ?? []) as unknown as DbResponse[]) {
    map.set(row.question_id, row);
  }
  return map;
}

// ── Scoring ─────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

function computeStructureScore(text: string): number {
  let score = 0;
  const maxScore = 4;

  // Check for headings (lines that look like section headers)
  const headingPatterns = /^#{1,3}\s+.+|^[A-Z][A-Za-z\s]+$/m;
  if (headingPatterns.test(text)) score++;

  // Check for paragraph breaks (multiple newline-separated blocks)
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length >= 2) score++;

  // Check for lists (bullet points or numbered items)
  const listPattern = /^[\s]*[-*•]\s+.+|^[\s]*\d+[.)]\s+.+/m;
  if (listPattern.test(text)) score++;

  // Check for substantive length (at least 100 words)
  if (countWords(text) >= 100) score++;

  return score / maxScore;
}

function scoreItem(gold: GoldItem, db: DbResponse | undefined): ItemScore {
  const details: string[] = [];

  if (!db) {
    return {
      question_id: gold.question_id,
      question_text: gold.question_text,
      word_count_compliant: false,
      word_count: 0,
      word_limit: gold.word_limit,
      citation_coverage: 0,
      rouge_l: 0,
      structure_score: 0,
      details: ['No response found in database'],
    };
  }

  const responseText = db.response_text ?? '';

  // Word count compliance: within +/-10% of word_limit
  const wordCount = countWords(responseText);
  const minWords = Math.floor(gold.word_limit * 0.9);
  const maxWords = Math.ceil(gold.word_limit * 1.1);
  const wordCountCompliant = wordCount >= minWords && wordCount <= maxWords;
  if (!wordCountCompliant) {
    details.push(
      `Word count: ${wordCount} (expected ${minWords}-${maxWords} for ${gold.word_limit} limit)`,
    );
  }

  // Citation coverage: cited items / expected items
  const citedItems = db.source_record_ids ?? [];
  const expectedItems = gold.expected_kb_items_used;
  const citedSet = new Set(citedItems);
  const matchedCitations = expectedItems.filter((id) =>
    citedSet.has(id),
  ).length;
  const citationCoverage =
    expectedItems.length > 0 ? matchedCitations / expectedItems.length : 0;
  if (citationCoverage < 1.0 && expectedItems.length > 0) {
    details.push(
      `Citation coverage: ${matchedCitations}/${expectedItems.length} expected KB items cited`,
    );
  }

  // ROUGE-L against reference response
  const rl = rougeL(responseText, gold.reference_response);

  // Structure score
  const structScore = computeStructureScore(responseText);

  return {
    question_id: gold.question_id,
    question_text: gold.question_text,
    word_count_compliant: wordCountCompliant,
    word_count: wordCount,
    word_limit: gold.word_limit,
    citation_coverage: citationCoverage,
    rouge_l: rl.f1,
    structure_score: structScore,
    details,
  };
}

// ── Main ────────────────────────────────────────────────────────────

const SUITE_NAME = 'bid-drafting';

const THRESHOLDS: Record<string, { min?: number; max_drop?: number }> = {
  word_count_compliance: { min: 0.7, max_drop: 0.1 },
  citation_coverage: { min: 0.4, max_drop: 0.1 },
  rouge_l: { min: 0.1, max_drop: 0.05 },
  structure_score: { min: 0.7, max_drop: 0.1 },
};

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const jsonOutput = args.includes('--json');
  const doSaveBaseline = args.includes('--save-baseline');
  const isLive = args.includes('--live');
  const envFlag = parseEnvFlag(args);

  if (isLive) {
    console.log('Live mode is not yet implemented.');
    console.log(
      'Use --cached (default) to compare existing bid responses against the gold standard.',
    );
    process.exit(0);
  }

  // Load gold standard. Private fixture — lives in the docs-site repo,
  // reached via KH_PRIVATE_DOCS_DIR (ID-68.17 / TECH PC-7). Canonical name
  // reconciled to procurement-drafting (Checker S317: the legacy hardcoded
  // bid-drafting filename never matched the tracked artefact).
  const fixturePath = resolveEvalFixture('procurement-drafting');
  if (!existsSync(fixturePath)) {
    console.error(`Gold standard fixture not found at: ${fixturePath}`);
    process.exit(1);
  }

  const goldStandard: GoldItem[] = JSON.parse(
    readFileSync(fixturePath, 'utf-8'),
  );

  console.log(
    `Loading bid response data for ${goldStandard.length} gold standard items...`,
  );

  // Fetch from DB
  const supabase = createServiceClient(envFlag);
  const questionIds = goldStandard.map((g) => g.question_id);
  const dbMap = await fetchProcurementResponses(supabase, questionIds);

  // If no data found, exit gracefully
  if (dbMap.size === 0) {
    console.log(
      'No bid responses found in database. Run with live data to generate baselines.',
    );
    process.exit(0);
  }

  // Score each item
  const scores: ItemScore[] = [];
  for (const gold of goldStandard) {
    scores.push(scoreItem(gold, dbMap.get(gold.question_id)));
  }

  // Filter to items with responses for aggregation
  const evaluated = scores.filter(
    (s) => s.details[0] !== 'No response found in database',
  );

  if (evaluated.length === 0) {
    console.log(
      'No matching bid responses found for gold standard question IDs.',
    );
    console.log(
      'The gold standard uses synthetic IDs (eval-bid-NNN). Responses must match these IDs.',
    );
    process.exit(0);
  }

  // Aggregate metrics
  const wordCountCompliance =
    evaluated.length > 0
      ? evaluated.filter((s) => s.word_count_compliant).length /
        evaluated.length
      : 0;
  const avgCitationCoverage =
    evaluated.length > 0
      ? evaluated.reduce((sum, s) => sum + s.citation_coverage, 0) /
        evaluated.length
      : 0;
  const avgRougeL =
    evaluated.length > 0
      ? evaluated.reduce((sum, s) => sum + s.rouge_l, 0) / evaluated.length
      : 0;
  const avgStructureScore =
    evaluated.length > 0
      ? evaluated.reduce((sum, s) => sum + s.structure_score, 0) /
        evaluated.length
      : 0;

  const metrics: Record<string, number> = {
    word_count_compliance: wordCountCompliance,
    citation_coverage: avgCitationCoverage,
    rouge_l: avgRougeL,
    structure_score: avgStructureScore,
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
    suite_name: 'Procurement Drafting Eval',
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

  // Verbose per-item output
  if (verbose && !jsonOutput) {
    console.log('\n--- PER-ITEM DETAIL ---\n');
    for (const s of scores) {
      const status = s.word_count_compliant ? 'PASS' : 'FAIL';
      console.log(`  [${status}] ${s.question_text.slice(0, 70)}`);
      console.log(
        `    words=${s.word_count}/${s.word_limit}  citations=${(s.citation_coverage * 100).toFixed(0)}%  ROUGE-L=${(s.rouge_l * 100).toFixed(1)}%  structure=${(s.structure_score * 100).toFixed(0)}%`,
      );
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

    // Per-section breakdown
    console.log('--- PER-SECTION BREAKDOWN ---\n');
    const bySection = new Map<
      string,
      { total: number; wcOk: number; rougeSum: number }
    >();
    for (let i = 0; i < goldStandard.length; i++) {
      const section = goldStandard[i].section_name;
      const s = scores[i];
      if (s.details[0] === 'No response found in database') continue;
      if (!bySection.has(section))
        bySection.set(section, { total: 0, wcOk: 0, rougeSum: 0 });
      const entry = bySection.get(section)!;
      entry.total++;
      if (s.word_count_compliant) entry.wcOk++;
      entry.rougeSum += s.rouge_l;
    }
    for (const [section, data] of bySection) {
      const wcRate = data.total > 0 ? data.wcOk / data.total : 0;
      const avgRL = data.total > 0 ? data.rougeSum / data.total : 0;
      console.log(
        `  ${section.padEnd(25)} ${data.total} items  word_count=${(wcRate * 100).toFixed(0)}%  ROUGE-L=${(avgRL * 100).toFixed(1)}%`,
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

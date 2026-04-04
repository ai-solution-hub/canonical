/**
 * Summarisation Eval Runner
 *
 * Compares DB summaries against reference summaries from gold standard.
 * No API cost — reads existing DB values only.
 *
 * Metrics:
 *   - ROUGE-L between AI executive and reference executive
 *   - ROUGE-L between AI detailed and reference detailed
 *   - ROUGE-1 for both sections
 *   - Structural compliance: summary_data has all three sections
 *   - Length compliance: executive <= 150 chars
 *   - Takeaway count: 3-7 inclusive
 *
 * Usage:
 *   bun run eval:summarisation
 *   bun run eval:summarisation --verbose
 *   bun run eval:summarisation --json
 *   bun run eval:summarisation --save-baseline
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { rougeL, rouge1 } from '../lib/eval/metrics';
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
  domain: string;
  content_type: string;
  reference_executive: string;
  reference_detailed: string;
  reference_takeaways: string[];
  source_text_snippet: string;
  notes: string;
}

interface SummaryData {
  executive?: string;
  detailed?: string;
  takeaways?: string[];
}

interface DbRow {
  id: string;
  summary_data: SummaryData | null;
  ai_summary: string | null;
}

interface ItemScore {
  content_item_id: string;
  title: string;
  content_type: string;
  rouge_l_executive: number;
  rouge_l_detailed: number;
  rouge_1_executive: number;
  rouge_1_detailed: number;
  structural_compliant: boolean;
  length_compliant: boolean;
  takeaway_count_compliant: boolean;
  takeaway_count: number;
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

async function fetchSummaries(
  supabase: ReturnType<typeof createClient>,
  itemIds: string[],
): Promise<Map<string, DbRow>> {
  const { data, error } = await supabase
    .from('content_items')
    .select('id, summary_data, ai_summary')
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

function parseSummaryData(raw: unknown): SummaryData | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as SummaryData;
    } catch {
      return null;
    }
  }
  return raw as SummaryData;
}

function scoreItem(gold: GoldItem, db: DbRow | undefined): ItemScore {
  const details: string[] = [];

  if (!db) {
    details.push('Item not found in database');
    return {
      content_item_id: gold.content_item_id,
      title: gold.title,
      content_type: gold.content_type,
      rouge_l_executive: 0,
      rouge_l_detailed: 0,
      rouge_1_executive: 0,
      rouge_1_detailed: 0,
      structural_compliant: false,
      length_compliant: false,
      takeaway_count_compliant: false,
      takeaway_count: 0,
      details,
    };
  }

  const summary = parseSummaryData(db.summary_data);

  // Structural compliance: summary_data has all three sections
  const hasExecutive = !!(summary?.executive);
  const hasDetailed = !!(summary?.detailed);
  const hasTakeaways = Array.isArray(summary?.takeaways) && summary!.takeaways!.length > 0;
  const structuralCompliant = hasExecutive && hasDetailed && hasTakeaways;

  if (!structuralCompliant) {
    const missing: string[] = [];
    if (!hasExecutive) missing.push('executive');
    if (!hasDetailed) missing.push('detailed');
    if (!hasTakeaways) missing.push('takeaways');
    details.push(`Missing sections: ${missing.join(', ')}`);
  }

  // Get text for ROUGE comparison
  const aiExecutive = summary?.executive ?? db.ai_summary ?? '';
  const aiDetailed = summary?.detailed ?? '';

  // ROUGE-L scores
  const rlExec = rougeL(aiExecutive, gold.reference_executive);
  const rlDet = rougeL(aiDetailed, gold.reference_detailed);
  const r1Exec = rouge1(aiExecutive, gold.reference_executive);
  const r1Det = rouge1(aiDetailed, gold.reference_detailed);

  // Length compliance: executive <= 150 chars
  const execLength = aiExecutive.length;
  const lengthCompliant = execLength <= 150;
  if (!lengthCompliant) {
    details.push(`Executive length: ${execLength} chars (max 150)`);
  }

  // Takeaway count: 3-7 inclusive
  const takeawayCount = summary?.takeaways?.length ?? 0;
  const takeawayCountCompliant = takeawayCount >= 3 && takeawayCount <= 7;
  if (!takeawayCountCompliant && hasTakeaways) {
    details.push(`Takeaway count: ${takeawayCount} (expected 3-7)`);
  }

  return {
    content_item_id: gold.content_item_id,
    title: gold.title,
    content_type: gold.content_type,
    rouge_l_executive: rlExec.f1,
    rouge_l_detailed: rlDet.f1,
    rouge_1_executive: r1Exec.f1,
    rouge_1_detailed: r1Det.f1,
    structural_compliant: structuralCompliant,
    length_compliant: lengthCompliant,
    takeaway_count_compliant: takeawayCountCompliant,
    takeaway_count: takeawayCount,
    details,
  };
}

// ── Main ────────────────────────────────────────────────────────────

const SUITE_NAME = 'summarisation';

const THRESHOLDS: Record<string, { min?: number; max_drop?: number }> = {
  rouge_l_executive: { min: 0.15, max_drop: 0.05 },
  rouge_l_detailed: { min: 0.10, max_drop: 0.05 },
  structural_compliance: { min: 0.95 },
  length_compliance: { min: 0.90 },
};

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const jsonOutput = args.includes('--json');
  const doSaveBaseline = args.includes('--save-baseline');

  // Load gold standard
  const fixturePath = resolve(
    PROJECT_ROOT,
    '__tests__/fixtures/summarisation-eval-gold-standard.json',
  );
  if (!existsSync(fixturePath)) {
    console.error(`Gold standard fixture not found at: ${fixturePath}`);
    process.exit(1);
  }

  const rawGold: Array<Record<string, unknown>> = JSON.parse(readFileSync(fixturePath, 'utf-8'));
  // Filter out the metadata entry (first item has _metadata key)
  const goldStandard: GoldItem[] = rawGold.filter(
    (item) => !('_metadata' in item),
  ) as unknown as GoldItem[];

  console.log(`Loading summary data for ${goldStandard.length} gold standard items...`);

  // Fetch from DB
  const supabase = createServiceClient();
  const itemIds = goldStandard.map((g) => g.content_item_id);
  const dbMap = await fetchSummaries(supabase, itemIds);

  const missing = itemIds.filter((id) => !dbMap.has(id));
  if (missing.length > 0) {
    console.log(`Warning: ${missing.length} gold standard items not found in database (skipped)`);
  }

  // Score each item
  const scores: ItemScore[] = [];
  for (const gold of goldStandard) {
    scores.push(scoreItem(gold, dbMap.get(gold.content_item_id)));
  }

  // Filter out items not found in DB for aggregation
  const evaluated = scores.filter((s) => s.details[0] !== 'Item not found in database');

  // Aggregate metrics
  const avgRougeLExec =
    evaluated.length > 0
      ? evaluated.reduce((sum, s) => sum + s.rouge_l_executive, 0) / evaluated.length
      : 0;
  const avgRougeLDet =
    evaluated.length > 0
      ? evaluated.reduce((sum, s) => sum + s.rouge_l_detailed, 0) / evaluated.length
      : 0;
  const avgRouge1Exec =
    evaluated.length > 0
      ? evaluated.reduce((sum, s) => sum + s.rouge_1_executive, 0) / evaluated.length
      : 0;
  const avgRouge1Det =
    evaluated.length > 0
      ? evaluated.reduce((sum, s) => sum + s.rouge_1_detailed, 0) / evaluated.length
      : 0;
  const structuralCompliance =
    evaluated.length > 0
      ? evaluated.filter((s) => s.structural_compliant).length / evaluated.length
      : 0;
  const lengthCompliance =
    evaluated.length > 0
      ? evaluated.filter((s) => s.length_compliant).length / evaluated.length
      : 0;
  const takeawayCompliance =
    evaluated.length > 0
      ? evaluated.filter((s) => s.takeaway_count_compliant).length / evaluated.length
      : 0;

  const metrics: Record<string, number> = {
    rouge_l_executive: avgRougeLExec,
    rouge_l_detailed: avgRougeLDet,
    rouge_1_executive: avgRouge1Exec,
    rouge_1_detailed: avgRouge1Det,
    structural_compliance: structuralCompliance,
    length_compliance: lengthCompliance,
    takeaway_compliance: takeawayCompliance,
  };

  // Build failures
  const failures: string[] = [];
  for (const [metricName, threshold] of Object.entries(THRESHOLDS)) {
    const value = metrics[metricName];
    if (value !== undefined && threshold.min !== undefined && value < threshold.min) {
      failures.push(
        `${metricName} ${(value * 100).toFixed(1)}% below minimum ${(threshold.min * 100).toFixed(0)}%`,
      );
    }
  }

  const result: EvalResult = {
    suite_name: 'Summarisation Eval',
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
      const status = s.structural_compliant && s.length_compliant ? 'PASS' : 'FAIL';
      console.log(`  [${status}] ${s.title.slice(0, 70)}`);
      console.log(
        `    ROUGE-L exec=${(s.rouge_l_executive * 100).toFixed(1)}%  det=${(s.rouge_l_detailed * 100).toFixed(1)}%  struct=${s.structural_compliant}  len=${s.length_compliant}  takeaways=${s.takeaway_count}`,
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

    // Per-content-type breakdown
    console.log('--- PER-CONTENT-TYPE BREAKDOWN ---\n');
    const byType = new Map<string, { total: number; rougeLExec: number; structural: number }>();
    for (const s of evaluated) {
      const ct = s.content_type;
      if (!byType.has(ct)) byType.set(ct, { total: 0, rougeLExec: 0, structural: 0 });
      const entry = byType.get(ct)!;
      entry.total++;
      entry.rougeLExec += s.rouge_l_executive;
      if (s.structural_compliant) entry.structural++;
    }
    for (const [ct, data] of byType) {
      const avgRL = data.total > 0 ? data.rougeLExec / data.total : 0;
      const structRate = data.total > 0 ? data.structural / data.total : 0;
      console.log(
        `  ${ct.padEnd(20)} ${data.total} items  ROUGE-L(exec)=${(avgRL * 100).toFixed(1)}%  structural=${(structRate * 100).toFixed(0)}%`,
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

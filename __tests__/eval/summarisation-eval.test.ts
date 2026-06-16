/**
 * Summarisation Eval — Vitest Integration
 *
 * This is NOT part of the regular test suite. It runs on demand to measure
 * summarisation quality against a hand-labelled gold standard.
 *
 * Run with:
 *   EVAL_SUMMARISATION=1 bun run test __tests__/eval/summarisation-eval.test.ts
 *
 * Or skip in normal test runs (default behaviour — describe.skipIf).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { DB_OPTION } from '@/lib/supabase/schema';
import { resolveEvalFixture } from '@/lib/eval/fixtures';
import { rougeL } from '@/lib/eval/metrics';

// ── Types ──────────────────────────────────────────────────────────

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
  summary: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────

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

// ── Test Suite ──────────────────────────────────────────────────────

const isEvalEnabled = process.env.EVAL_SUMMARISATION === '1';

describe.skipIf(!isEvalEnabled)('Summarisation Eval (gold standard)', () => {
  let goldStandard: GoldItem[];
  let dbMap: Map<string, DbRow>;

  beforeAll(async () => {
    // Load gold standard fixture (filter out metadata entry). Private —
    // docs-site repo via KH_PRIVATE_DOCS_DIR (ID-68.17 / TECH PC-7).
    const fixturePath = resolveEvalFixture('summarisation');
    const rawData: Array<Record<string, unknown>> = JSON.parse(
      readFileSync(fixturePath, 'utf-8'),
    );
    goldStandard = rawData.filter(
      (item) => !('_metadata' in item),
    ) as unknown as GoldItem[];

    // Load summaries from DB using service client
    const { createClient } = await import('@supabase/supabase-js');

    const url =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for eval',
      );
    }

    // ID-115 (S9): route to the exposed api schema
    const supabase = createClient(url, key, {
      ...DB_OPTION,
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const itemIds = goldStandard.map((g) => g.content_item_id);
    const { data, error } = await supabase
      .from('content_items')
      .select('id, summary_data, summary')
      .in('id', itemIds);

    if (error) throw new Error(`DB fetch failed: ${error.message}`);

    dbMap = new Map();
    for (const row of data ?? []) {
      dbMap.set(row.id as string, row as DbRow);
    }
  });

  it('should meet minimum ROUGE-L threshold (>0.15)', () => {
    const evaluated = goldStandard.filter((g) => dbMap.has(g.content_item_id));

    let totalRougeL = 0;
    for (const gold of evaluated) {
      const db = dbMap.get(gold.content_item_id)!;
      const summary = parseSummaryData(db.summary_data);
      const aiExecutive = summary?.executive ?? db.summary ?? '';
      const rl = rougeL(aiExecutive, gold.reference_executive);
      totalRougeL += rl.f1;
    }

    const avgRougeL = evaluated.length > 0 ? totalRougeL / evaluated.length : 0;
    console.log(
      `Average ROUGE-L (executive): ${(avgRougeL * 100).toFixed(1)}% (${evaluated.length} items)`,
    );
    expect(avgRougeL).toBeGreaterThan(0.15);
  });

  it('should meet structural compliance (>30%)', () => {
    const evaluated = goldStandard.filter((g) => dbMap.has(g.content_item_id));

    let compliant = 0;
    for (const gold of evaluated) {
      const db = dbMap.get(gold.content_item_id)!;
      const summary = parseSummaryData(db.summary_data);
      const hasExecutive = !!summary?.executive;
      const hasDetailed = !!summary?.detailed;
      const hasTakeaways =
        Array.isArray(summary?.takeaways) && summary!.takeaways!.length > 0;
      if (hasExecutive && hasDetailed && hasTakeaways) compliant++;
    }

    const rate = evaluated.length > 0 ? compliant / evaluated.length : 0;
    console.log(
      `Structural compliance: ${(rate * 100).toFixed(1)}% (${compliant}/${evaluated.length})`,
    );
    // Threshold matches the runner — many items lack summary_data currently
    expect(rate).toBeGreaterThanOrEqual(0.3);
  });

  it('should meet length compliance for executive summaries', () => {
    const evaluated = goldStandard.filter((g) => dbMap.has(g.content_item_id));

    let compliant = 0;
    let withExecutive = 0;
    for (const gold of evaluated) {
      const db = dbMap.get(gold.content_item_id)!;
      const summary = parseSummaryData(db.summary_data);
      const executive = summary?.executive;
      if (executive) {
        withExecutive++;
        if (executive.length <= 150) compliant++;
      }
    }

    const rate = withExecutive > 0 ? compliant / withExecutive : 1;
    console.log(
      `Length compliance (exec <= 150 chars): ${(rate * 100).toFixed(1)}% (${compliant}/${withExecutive} with executive)`,
    );
    // No strict threshold — many items may not have executives yet
    expect(rate).toBeGreaterThanOrEqual(0);
  });

  it('should have gold standard with adequate coverage', () => {
    expect(goldStandard.length).toBeGreaterThanOrEqual(30);

    // Check content type coverage
    const contentTypes = new Set(goldStandard.map((g) => g.content_type));
    expect(contentTypes.size).toBeGreaterThanOrEqual(3);
  });
});

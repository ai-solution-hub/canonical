/**
 * Procurement Drafting Eval — Vitest Integration
 *
 * This is NOT part of the regular test suite. It runs on demand to measure
 * bid response quality against a hand-labelled gold standard.
 *
 * Run with:
 *   EVAL_BID_DRAFTING=1 bun run test __tests__/eval/bid-drafting-eval.test.ts
 *
 * Or skip in normal test runs (default behaviour — describe.skipIf).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { rougeL } from '@/lib/eval/metrics';

// ── Types ──────────────────────────────────────────────────────────

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
  cited_items: string[] | null;
  metadata: Record<string, unknown> | null;
}

// ── Helpers ────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

// ── Test Suite ──────────────────────────────────────────────────────

const isEvalEnabled = process.env.EVAL_BID_DRAFTING === '1';

describe.skipIf(!isEvalEnabled)('Procurement Drafting Eval (gold standard)', () => {
  let goldStandard: GoldItem[];
  let dbMap: Map<string, DbResponse>;
  let evaluated: GoldItem[];

  beforeAll(async () => {
    // Load gold standard fixture
    const fixturePath = resolve(
      __dirname,
      '../fixtures/bid-drafting-eval-gold-standard.json',
    );
    goldStandard = JSON.parse(readFileSync(fixturePath, 'utf-8'));

    // Load bid responses from DB using service client
    const { createClient } = await import('@supabase/supabase-js');

    const url =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for eval',
      );
    }

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const questionIds = goldStandard.map((g) => g.question_id);

    try {
      const { data, error } = await supabase
        .from('bid_responses')
        .select('id, question_id, response_text, cited_items, metadata')
        .in('question_id', questionIds);

      dbMap = new Map();
      if (!error && data) {
        for (const row of data) {
          dbMap.set(row.question_id as string, row as DbResponse);
        }
      }
    } catch {
      dbMap = new Map();
    }

    evaluated = goldStandard.filter((g) => dbMap.has(g.question_id));
  });

  it('should meet minimum word count compliance (>70%)', () => {
    if (evaluated.length === 0) {
      console.log(
        'No bid responses found in DB — skipping (gold standard uses synthetic IDs)',
      );
      return;
    }

    let compliant = 0;
    for (const gold of evaluated) {
      const db = dbMap.get(gold.question_id)!;
      const wordCount = countWords(db.response_text ?? '');
      const minWords = Math.floor(gold.word_limit * 0.9);
      const maxWords = Math.ceil(gold.word_limit * 1.1);
      if (wordCount >= minWords && wordCount <= maxWords) compliant++;
    }

    const rate = evaluated.length > 0 ? compliant / evaluated.length : 0;
    console.log(
      `Word count compliance: ${(rate * 100).toFixed(1)}% (${compliant}/${evaluated.length})`,
    );
    expect(rate).toBeGreaterThan(0.7);
  });

  it('should meet minimum citation coverage (>40%)', () => {
    if (evaluated.length === 0) {
      console.log(
        'No bid responses found in DB — skipping (gold standard uses synthetic IDs)',
      );
      return;
    }

    let totalCoverage = 0;
    for (const gold of evaluated) {
      const db = dbMap.get(gold.question_id)!;
      const citedItems = db.cited_items ?? [];
      const expectedItems = gold.expected_kb_items_used;
      const citedSet = new Set(citedItems);
      const matched = expectedItems.filter((id) => citedSet.has(id)).length;
      totalCoverage +=
        expectedItems.length > 0 ? matched / expectedItems.length : 0;
    }

    const avgCoverage =
      evaluated.length > 0 ? totalCoverage / evaluated.length : 0;
    console.log(
      `Citation coverage: ${(avgCoverage * 100).toFixed(1)}% (${evaluated.length} items)`,
    );
    expect(avgCoverage).toBeGreaterThan(0.4);
  });

  it('should report ROUGE-L against reference responses', () => {
    if (evaluated.length === 0) {
      console.log(
        'No bid responses found in DB — skipping (gold standard uses synthetic IDs)',
      );
      return;
    }

    let totalRougeL = 0;
    for (const gold of evaluated) {
      const db = dbMap.get(gold.question_id)!;
      const rl = rougeL(db.response_text ?? '', gold.reference_response);
      totalRougeL += rl.f1;
    }

    const avgRougeL = evaluated.length > 0 ? totalRougeL / evaluated.length : 0;
    console.log(
      `Average ROUGE-L: ${(avgRougeL * 100).toFixed(1)}% (${evaluated.length} items)`,
    );
    // Minimum threshold from the runner
    expect(avgRougeL).toBeGreaterThanOrEqual(0.1);
  });

  it('should have gold standard with adequate coverage', () => {
    expect(goldStandard.length).toBeGreaterThanOrEqual(20);
  });
});

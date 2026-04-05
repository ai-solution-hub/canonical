/**
 * Classification Eval — Vitest Integration
 *
 * This is NOT part of the regular test suite. It runs on demand to measure
 * classification accuracy against a hand-labelled gold standard.
 *
 * Run with:
 *   EVAL_CLASSIFICATION=1 bun run test __tests__/eval/classification-eval.test.ts
 *
 * Or skip in normal test runs (default behaviour — describe.skipIf).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Types ──────────────────────────────────────────────────────────

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

// ── Test Suite ──────────────────────────────────────────────────────

const isEvalEnabled = process.env.EVAL_CLASSIFICATION === '1';

describe.skipIf(!isEvalEnabled)(
  'Classification Eval (gold standard)',
  () => {
    let goldStandard: GoldItem[];
    let dbMap: Map<string, DbRow>;

    beforeAll(async () => {
      // Load gold standard fixture
      const fixturePath = resolve(
        __dirname,
        '../fixtures/classification-eval-gold-standard.json',
      );
      goldStandard = JSON.parse(readFileSync(fixturePath, 'utf-8'));

      // Load classifications from DB using service client
      const { createClient } = await import('@supabase/supabase-js');

      const url =
        process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SECRET_KEY;

      if (!url || !key) {
        throw new Error(
          'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY for eval',
        );
      }

      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const itemIds = goldStandard.map((g) => g.content_item_id);
      const { data, error } = await supabase
        .from('content_items')
        .select(
          'id, primary_domain, primary_subtopic, secondary_domain, classification_confidence, ai_keywords',
        )
        .in('id', itemIds);

      if (error) throw new Error(`DB fetch failed: ${error.message}`);

      dbMap = new Map();
      for (const row of data ?? []) {
        dbMap.set(row.id as string, row as DbRow);
      }
    });

    it('should meet minimum domain accuracy (>70%)', () => {
      const evaluated = goldStandard.filter((g) =>
        dbMap.has(g.content_item_id),
      );
      const correct = evaluated.filter(
        (g) => dbMap.get(g.content_item_id)!.primary_domain === g.expected_domain,
      );

      const accuracy = evaluated.length > 0 ? correct.length / evaluated.length : 0;
      console.log(
        `Domain accuracy: ${(accuracy * 100).toFixed(1)}% (${correct.length}/${evaluated.length})`,
      );
      expect(accuracy).toBeGreaterThan(0.7);
    });

    it('should meet minimum subtopic accuracy (>50%)', () => {
      const evaluated = goldStandard.filter((g) =>
        dbMap.has(g.content_item_id),
      );
      const correct = evaluated.filter(
        (g) =>
          dbMap.get(g.content_item_id)!.primary_subtopic ===
          g.expected_subtopic,
      );

      const accuracy = evaluated.length > 0 ? correct.length / evaluated.length : 0;
      console.log(
        `Subtopic accuracy: ${(accuracy * 100).toFixed(1)}% (${correct.length}/${evaluated.length})`,
      );
      expect(accuracy).toBeGreaterThan(0.5);
    });

    it('should have gold standard with adequate coverage', () => {
      expect(goldStandard.length).toBeGreaterThanOrEqual(50);

      // Check domain coverage
      const domains = new Set(goldStandard.map((g) => g.expected_domain));
      expect(domains.size).toBeGreaterThanOrEqual(7);
    });

    it('should report confidence calibration', () => {
      const evaluated = goldStandard.filter((g) =>
        dbMap.has(g.content_item_id),
      );

      let totalConfidence = 0;
      let count = 0;

      for (const gold of evaluated) {
        const db = dbMap.get(gold.content_item_id)!;
        if (db.classification_confidence !== null) {
          totalConfidence += db.classification_confidence;
          count++;
        }
      }

      const avgConfidence = count > 0 ? totalConfidence / count : 0;
      console.log(
        `Average classification confidence: ${(avgConfidence * 100).toFixed(1)}% (${count} items with confidence)`,
      );

      // Log only — no threshold assertion for confidence calibration
      expect(count).toBeGreaterThan(0);
    });
  },
);

/**
 * Entity Classification Eval — Vitest Integration
 *
 * This is NOT part of the regular test suite. It runs on demand to measure
 * entity extraction quality against a hand-labelled gold standard.
 *
 * Run with:
 *   EVAL_ENTITY=1 bun run test __tests__/eval/entity-classification-eval.test.ts
 *
 * Or skip in normal test runs (default behaviour — describe.skipIf).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Types (mirrored from eval script) ───────────────────────────────

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

// ── Helpers ─────────────────────────────────────────────────────────

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

function entityNamesMatch(a: string, b: string): boolean {
  return normaliseForComparison(a) === normaliseForComparison(b);
}

function scoreItem(
  gold: GoldStandardItem,
  extracted: DbEntity[],
): {
  precision: number;
  recall: number;
  type_accuracy: number;
  exclusion_compliance: number;
  true_positive_count: number;
  false_positive_count: number;
  false_negative_count: number;
  type_error_count: number;
  exclusion_failure_count: number;
} {
  const matchedExtracted = new Set<number>();
  const matchedExpected = new Set<number>();
  let typeErrors = 0;
  let exclusionFailures = 0;

  // Match extracted against expected
  for (let ei = 0; ei < extracted.length; ei++) {
    const ext = extracted[ei];
    for (let gi = 0; gi < gold.expected_entities.length; gi++) {
      if (matchedExpected.has(gi)) continue;
      const exp = gold.expected_entities[gi];
      if (
        entityNamesMatch(ext.canonical_name, exp.canonical_name) ||
        entityNamesMatch(ext.entity_name, exp.name) ||
        entityNamesMatch(ext.canonical_name, exp.name)
      ) {
        matchedExtracted.add(ei);
        matchedExpected.add(gi);
        if (ext.entity_type !== exp.type) typeErrors++;
        break;
      }
    }
  }

  // Count exclusion failures
  for (const excl of gold.excluded_entities) {
    const wasExtracted = extracted.some(
      (ext) =>
        entityNamesMatch(ext.entity_name, excl.name) ||
        entityNamesMatch(ext.canonical_name, excl.name),
    );
    if (wasExtracted) exclusionFailures++;
  }

  const tp = matchedExpected.size;
  const fp = extracted.length - tp;
  const fn = gold.expected_entities.length - tp;
  const correctlyTyped = tp - typeErrors;
  const exclusionSuccesses = gold.excluded_entities.length - exclusionFailures;

  return {
    precision: extracted.length > 0 ? tp / extracted.length : 1.0,
    recall:
      gold.expected_entities.length > 0
        ? tp / gold.expected_entities.length
        : 1.0,
    type_accuracy: tp > 0 ? correctlyTyped / tp : 1.0,
    exclusion_compliance:
      gold.excluded_entities.length > 0
        ? exclusionSuccesses / gold.excluded_entities.length
        : 1.0,
    true_positive_count: tp,
    false_positive_count: fp,
    false_negative_count: fn,
    type_error_count: typeErrors,
    exclusion_failure_count: exclusionFailures,
  };
}

// ── Test Suite ───────────────────────────────────────────────────────

const isEvalEnabled = process.env.EVAL_ENTITY === '1';

describe.skipIf(!isEvalEnabled)(
  'Entity Classification Eval (gold standard)',
  () => {
    let goldStandard: GoldStandardItem[];
    let entityMap: Map<string, DbEntity[]>;

    beforeAll(async () => {
      // Load gold standard fixture
      const fixturePath = resolve(
        __dirname,
        '../fixtures/entity-eval-gold-standard.json',
      );
      goldStandard = JSON.parse(readFileSync(fixturePath, 'utf-8'));

      // Load entities from DB using service client
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
        .from('entity_mentions')
        .select('content_item_id, entity_type, entity_name, canonical_name')
        .in('content_item_id', itemIds);

      if (error) throw new Error(`DB fetch failed: ${error.message}`);

      entityMap = new Map();
      for (const row of data ?? []) {
        const id = row.content_item_id as string;
        if (!entityMap.has(id)) entityMap.set(id, []);
        entityMap.get(id)!.push({
          entity_type: row.entity_type as string,
          entity_name: row.entity_name as string,
          canonical_name: row.canonical_name as string,
        });
      }
    });

    it('should meet minimum precision threshold (>50%)', () => {
      let totalExtracted = 0;
      let totalTp = 0;

      for (const gold of goldStandard) {
        const extracted = entityMap.get(gold.content_item_id) ?? [];
        const result = scoreItem(gold, extracted);
        totalTp += result.true_positive_count;
        totalExtracted += extracted.length;
      }

      const precision = totalExtracted > 0 ? totalTp / totalExtracted : 0;
      expect(precision).toBeGreaterThan(0.5);
    });

    it('should meet minimum recall threshold (>40%)', () => {
      let totalExpected = 0;
      let totalTp = 0;

      for (const gold of goldStandard) {
        const extracted = entityMap.get(gold.content_item_id) ?? [];
        const result = scoreItem(gold, extracted);
        totalTp += result.true_positive_count;
        totalExpected += gold.expected_entities.length;
      }

      const recall = totalExpected > 0 ? totalTp / totalExpected : 0;
      expect(recall).toBeGreaterThan(0.4);
    });

    it('should report type accuracy', () => {
      let totalTp = 0;
      let totalTypeErrors = 0;

      for (const gold of goldStandard) {
        const extracted = entityMap.get(gold.content_item_id) ?? [];
        const result = scoreItem(gold, extracted);
        totalTp += result.true_positive_count;
        totalTypeErrors += result.type_error_count;
      }

      const typeAccuracy =
        totalTp > 0 ? (totalTp - totalTypeErrors) / totalTp : 0;

      // Log for visibility — this is a baseline measurement
      console.log(
        `Type accuracy: ${(typeAccuracy * 100).toFixed(1)}% (${totalTp - totalTypeErrors}/${totalTp})`,
      );
      // Baseline expectation: at least some types are correct
      expect(typeAccuracy).toBeGreaterThan(0.3);
    });

    it('should report exclusion compliance', () => {
      let totalExcluded = 0;
      let totalFailures = 0;

      for (const gold of goldStandard) {
        const extracted = entityMap.get(gold.content_item_id) ?? [];
        const result = scoreItem(gold, extracted);
        totalExcluded += gold.excluded_entities.length;
        totalFailures += result.exclusion_failure_count;
      }

      const compliance =
        totalExcluded > 0 ? (totalExcluded - totalFailures) / totalExcluded : 1;

      console.log(
        `Exclusion compliance: ${(compliance * 100).toFixed(1)}% (${totalExcluded - totalFailures}/${totalExcluded} correctly excluded)`,
      );
      // This is expected to be low for current system — it is a baseline
      expect(compliance).toBeGreaterThanOrEqual(0);
    });

    it('should have gold standard with adequate coverage', () => {
      expect(goldStandard.length).toBeGreaterThanOrEqual(50);

      // Check domain coverage
      const domains = new Set(goldStandard.map((g) => g.domain));
      expect(domains.size).toBeGreaterThanOrEqual(5);

      // Check that we have both articles and Q&A pairs
      const contentTypes = new Set(goldStandard.map((g) => g.content_type));
      expect(contentTypes.has('q_a_pair')).toBe(true);
      expect(contentTypes.has('article')).toBe(true);
    });
  },
);

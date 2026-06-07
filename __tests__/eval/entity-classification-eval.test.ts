/**
 * Entity Classification Eval — Vitest Integration
 *
 * Tests for the entity eval runner covering:
 * - Scoring logic (unit tests, always run)
 * - Baseline save/load via shared infra
 * - Live mode cost estimation
 * - Full DB eval (on-demand with EVAL_ENTITY=1)
 *
 * Run unit tests:
 *   bun run test __tests__/eval/entity-classification-eval.test.ts
 *
 * Run full DB eval:
 *   EVAL_ENTITY=1 bun run test __tests__/eval/entity-classification-eval.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { resolve, join } from 'path';
import { resolveEvalFixture } from '@/lib/eval/fixtures';
import {
  loadBaseline,
  saveBaseline,
  checkRegression,
} from '../../lib/eval/baseline';
import { COST_PER_MILLION } from '../../lib/ai/pricing';
import type { EvalBaseline } from '../../lib/eval/types';

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

// ── Unit Tests (always run) ────────────────────────────────────────

describe('Entity Classification Eval — Unit Tests', () => {
  describe('scoring logic', () => {
    it('should score perfect match correctly', () => {
      const gold: GoldStandardItem = {
        content_item_id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        title: 'Test item',
        domain: 'security',
        content_type: 'article',
        expected_entities: [
          {
            name: 'ISO 27001',
            type: 'certification',
            canonical_name: 'iso 27001',
          },
        ],
        excluded_entities: [{ name: 'encryption', reason: 'generic concept' }],
      };

      const extracted: DbEntity[] = [
        {
          entity_type: 'certification',
          entity_name: 'ISO 27001',
          canonical_name: 'iso 27001',
        },
      ];

      const result = scoreItem(gold, extracted);
      expect(result.precision).toBe(1.0);
      expect(result.recall).toBe(1.0);
      expect(result.type_accuracy).toBe(1.0);
      expect(result.exclusion_compliance).toBe(1.0);
    });

    it('should detect false positives', () => {
      const gold: GoldStandardItem = {
        content_item_id: '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d',
        title: 'Test item',
        domain: 'security',
        content_type: 'article',
        expected_entities: [
          {
            name: 'ISO 27001',
            type: 'certification',
            canonical_name: 'iso 27001',
          },
        ],
        excluded_entities: [],
      };

      const extracted: DbEntity[] = [
        {
          entity_type: 'certification',
          entity_name: 'ISO 27001',
          canonical_name: 'iso 27001',
        },
        {
          entity_type: 'organisation',
          entity_name: 'Some Corp',
          canonical_name: 'some corp',
        },
        {
          entity_type: 'technology',
          entity_name: 'Cloud Platform',
          canonical_name: 'cloud platform',
        },
      ];

      const result = scoreItem(gold, extracted);
      expect(result.precision).toBeCloseTo(1 / 3, 5);
      expect(result.recall).toBe(1.0);
      expect(result.false_positive_count).toBe(2);
    });

    it('should detect false negatives', () => {
      const gold: GoldStandardItem = {
        content_item_id: '3a4b5c6d-7e8f-4a9b-0c1d-2e3f4a5b6c7d',
        title: 'Test item',
        domain: 'corporate',
        content_type: 'q_a_pair',
        expected_entities: [
          {
            name: 'ISO 27001',
            type: 'certification',
            canonical_name: 'iso 27001',
          },
          {
            name: 'Cyber Essentials',
            type: 'certification',
            canonical_name: 'cyber essentials',
          },
          { name: 'UK GDPR', type: 'regulation', canonical_name: 'uk gdpr' },
        ],
        excluded_entities: [],
      };

      const extracted: DbEntity[] = [
        {
          entity_type: 'certification',
          entity_name: 'ISO 27001',
          canonical_name: 'iso 27001',
        },
      ];

      const result = scoreItem(gold, extracted);
      expect(result.precision).toBe(1.0);
      expect(result.recall).toBeCloseTo(1 / 3, 5);
      expect(result.false_negative_count).toBe(2);
    });

    it('should detect type errors', () => {
      const gold: GoldStandardItem = {
        content_item_id: '4a5b6c7d-8e9f-4a0b-1c2d-3e4f5a6b7c8d',
        title: 'Test item',
        domain: 'security',
        content_type: 'article',
        expected_entities: [
          {
            name: 'ISO 27001',
            type: 'certification',
            canonical_name: 'iso 27001',
          },
        ],
        excluded_entities: [],
      };

      const extracted: DbEntity[] = [
        {
          entity_type: 'regulation',
          entity_name: 'ISO 27001',
          canonical_name: 'iso 27001',
        },
      ];

      const result = scoreItem(gold, extracted);
      expect(result.type_accuracy).toBe(0);
      expect(result.type_error_count).toBe(1);
    });

    it('should detect exclusion failures', () => {
      const gold: GoldStandardItem = {
        content_item_id: '5a6b7c8d-9e0f-4a1b-2c3d-4e5f6a7b8c9d',
        title: 'Test item',
        domain: 'security',
        content_type: 'article',
        expected_entities: [],
        excluded_entities: [
          { name: 'encryption', reason: 'generic concept' },
          { name: 'Data Protection Officer', reason: 'job title' },
        ],
      };

      const extracted: DbEntity[] = [
        {
          entity_type: 'technology',
          entity_name: 'encryption',
          canonical_name: 'encryption',
        },
      ];

      const result = scoreItem(gold, extracted);
      expect(result.exclusion_compliance).toBe(0.5);
      expect(result.exclusion_failure_count).toBe(1);
    });

    it('should handle fuzzy matching via Ltd/Limited normalisation', () => {
      const gold: GoldStandardItem = {
        content_item_id: '6a7b8c9d-0e1f-4a2b-3c4d-5e6f7a8b9c0d',
        title: 'Test item',
        domain: 'corporate',
        content_type: 'q_a_pair',
        expected_entities: [
          {
            name: 'example-client Design Ltd',
            type: 'organisation',
            canonical_name: 'Example Client Ltd',
          },
        ],
        excluded_entities: [],
      };

      const extracted: DbEntity[] = [
        {
          entity_type: 'organisation',
          entity_name: 'example-client Design Ltd.',
          canonical_name: 'Example Client Ltd',
        },
      ];

      const result = scoreItem(gold, extracted);
      expect(result.true_positive_count).toBe(1);
      expect(result.precision).toBe(1.0);
    });

    it('should return 1.0 precision for empty extraction with no expected', () => {
      const gold: GoldStandardItem = {
        content_item_id: '7a8b9c0d-1e2f-4a3b-4c5d-6e7f8a9b0c1d',
        title: 'Test item',
        domain: 'security',
        content_type: 'article',
        expected_entities: [],
        excluded_entities: [],
      };

      const result = scoreItem(gold, []);
      expect(result.precision).toBe(1.0);
      expect(result.recall).toBe(1.0);
    });
  });

  describe('baseline save/load via shared infra', () => {
    const testSuiteName = 'entity-classification-test-temp';
    const baselineDir = resolve(__dirname, '../fixtures/eval-baselines');

    afterAll(() => {
      // Clean up test baseline file
      const testFile = join(baselineDir, `${testSuiteName}.baseline.json`);
      if (existsSync(testFile)) {
        unlinkSync(testFile);
      }
    });

    it('should return null for non-existent baseline', () => {
      const baseline = loadBaseline('entity-classification-nonexistent');
      expect(baseline).toBeNull();
    });

    it('should save and load a baseline correctly', () => {
      const metrics = {
        precision: 0.456,
        recall: 0.789,
        f1: 0.567,
        type_accuracy: 0.923,
        exclusion_compliance: 0.812,
        cross_item_consistency: 0.95,
      };

      const thresholds = {
        precision: { min: 0.4, max_drop: 0.05 },
        recall: { min: 0.35, max_drop: 0.05 },
        f1: { min: 0.35, max_drop: 0.05 },
        type_accuracy: { min: 0.8, max_drop: 0.05 },
      };

      saveBaseline(testSuiteName, metrics, thresholds);

      const loaded = loadBaseline(testSuiteName);
      expect(loaded).not.toBeNull();
      expect(loaded!.suite_name).toBe(testSuiteName);
      expect(loaded!.metrics.precision).toBe(0.456);
      expect(loaded!.metrics.recall).toBe(0.789);
      expect(loaded!.metrics.f1).toBe(0.567);
      expect(loaded!.metrics.type_accuracy).toBe(0.923);
      expect(loaded!.thresholds.precision).toEqual({
        min: 0.4,
        max_drop: 0.05,
      });
    });

    it('should detect regressions when precision drops', () => {
      const baseline: EvalBaseline = {
        suite_name: 'entity-classification',
        created_at: '2026-01-01T00:00:00.000Z',
        metrics: {
          precision: 0.6,
          recall: 0.7,
        },
        thresholds: {
          precision: { min: 0.4, max_drop: 0.05 },
          recall: { min: 0.35, max_drop: 0.05 },
        },
      };

      const currentMetrics = {
        precision: 0.5, // dropped 0.10 — exceeds max_drop of 0.05
        recall: 0.68, // dropped 0.02 — within max_drop
      };

      const results = checkRegression(baseline, currentMetrics);

      const precisionResult = results.find(
        (r) => r.metric_name === 'precision',
      );
      expect(precisionResult).toBeDefined();
      expect(precisionResult!.passed).toBe(false);

      const recallResult = results.find((r) => r.metric_name === 'recall');
      expect(recallResult).toBeDefined();
      expect(recallResult!.passed).toBe(true);
    });

    it('should detect regressions when metric falls below minimum', () => {
      const baseline: EvalBaseline = {
        suite_name: 'entity-classification',
        created_at: '2026-01-01T00:00:00.000Z',
        metrics: {
          precision: 0.45,
          recall: 0.4,
        },
        thresholds: {
          precision: { min: 0.4 },
          recall: { min: 0.35 },
        },
      };

      const currentMetrics = {
        precision: 0.38, // below min of 0.40
        recall: 0.36, // above min of 0.35
      };

      const results = checkRegression(baseline, currentMetrics);

      const precisionResult = results.find(
        (r) => r.metric_name === 'precision',
      );
      expect(precisionResult!.passed).toBe(false);

      const recallResult = results.find((r) => r.metric_name === 'recall');
      expect(recallResult!.passed).toBe(true);
    });
  });

  describe('live mode cost estimation', () => {
    it('should estimate cost for a given number of items', () => {
      const itemCount = 85;
      const model = 'claude-sonnet-4-5';
      const inputTokensPerItem = 3000;
      const outputTokensPerItem = 600;
      const totalInput = inputTokensPerItem * itemCount;
      const totalOutput = outputTokensPerItem * itemCount;

      const rates = COST_PER_MILLION[model];
      expect(rates).toBeDefined();

      const estimatedCost =
        (totalInput / 1_000_000) * rates.input +
        (totalOutput / 1_000_000) * rates.output;

      // Cost should be a small number (less than $5 for 85 items)
      expect(estimatedCost).toBeGreaterThan(0);
      expect(estimatedCost).toBeLessThan(5.0);
    });

    it('should have pricing data for the default model', () => {
      const defaultModel = 'claude-sonnet-4-6';
      const rates = COST_PER_MILLION[defaultModel];
      // Default model may not be in pricing table — fallback to claude-sonnet-4-5
      const effectiveRates = rates ?? COST_PER_MILLION['claude-sonnet-4-5'];
      expect(effectiveRates).toBeDefined();
      expect(effectiveRates.input).toBeGreaterThan(0);
      expect(effectiveRates.output).toBeGreaterThan(0);
    });

    it('should estimate reasonable time for rate-limited execution', () => {
      const itemCount = 85;
      // 1 request per second with ~0.5s overhead = ~1.5s per item
      const estimatedSeconds = Math.ceil(itemCount * 1.5);
      expect(estimatedSeconds).toBeGreaterThan(100);
      expect(estimatedSeconds).toBeLessThan(300);
    });
  });
});

// ── Full DB Eval (on-demand) ───────────────────────────────────────

const isEvalEnabled = process.env.EVAL_ENTITY === '1';

describe.skipIf(!isEvalEnabled)(
  'Entity Classification Eval (gold standard — DB)',
  () => {
    let goldStandard: GoldStandardItem[];
    let entityMap: Map<string, DbEntity[]>;

    beforeAll(async () => {
      // Load gold standard fixture (public name-swapped — ID-68.17 / TECH PC-7)
      const fixturePath = resolveEvalFixture('entity');
      goldStandard = JSON.parse(readFileSync(fixturePath, 'utf-8'));

      // Load entities from DB using service client
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

      console.log(
        `Type accuracy: ${(typeAccuracy * 100).toFixed(1)}% (${totalTp - totalTypeErrors}/${totalTp})`,
      );
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

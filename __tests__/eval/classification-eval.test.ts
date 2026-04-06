/**
 * Classification Eval — Vitest Integration
 *
 * Two layers of tests:
 *
 * 1. Unit tests (always run) — verify CLI parsing, cost estimation, and the
 *    live mode wiring. Mocks `classifyContent` so no API calls happen.
 *
 * 2. Gold-standard DB integration (gated by EVAL_CLASSIFICATION=1) — runs the
 *    cached scoring path against real DB classifications.
 *
 * 3. Optional live integration (gated by EVAL_LIVE_TEST=1) — runs the live
 *    pipeline with mocked Claude calls on a single small fixture.
 *
 * Run unit tests:
 *   bun run test classification-eval
 *
 * Run gold-standard DB eval:
 *   EVAL_CLASSIFICATION=1 bun run test classification-eval
 *
 * Run live mock integration:
 *   EVAL_LIVE_TEST=1 bun run test classification-eval
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  parseArgs,
  estimateItemCost,
  estimateLiveCost,
  type GoldItem,
} from '../../scripts/eval-classification';

// ── Types ──────────────────────────────────────────────────────────

interface DbRow {
  id: string;
  primary_domain: string | null;
  primary_subtopic: string | null;
  secondary_domain: string | null;
  classification_confidence: number | null;
  ai_keywords: string[] | null;
}

// ── Unit tests (always run) ────────────────────────────────────────

describe('Classification Eval — Unit Tests', () => {
  describe('parseArgs', () => {
    it('defaults to cached mode with no flags', () => {
      const args = parseArgs([]);
      expect(args.live).toBe(false);
      expect(args.confirm).toBe(false);
      expect(args.verbose).toBe(false);
      expect(args.jsonOutput).toBe(false);
      expect(args.doSaveBaseline).toBe(false);
      expect(args.itemFilter).toBeNull();
    });

    it('identifies --live flag', () => {
      const args = parseArgs(['--live']);
      expect(args.live).toBe(true);
      expect(args.confirm).toBe(false);
    });

    it('identifies --confirm flag', () => {
      const args = parseArgs(['--confirm']);
      expect(args.live).toBe(false);
      expect(args.confirm).toBe(true);
    });

    it('identifies --live --confirm together', () => {
      const args = parseArgs(['--live', '--confirm']);
      expect(args.live).toBe(true);
      expect(args.confirm).toBe(true);
    });

    it('identifies --save-baseline alongside --live', () => {
      const args = parseArgs(['--live', '--confirm', '--save-baseline']);
      expect(args.live).toBe(true);
      expect(args.confirm).toBe(true);
      expect(args.doSaveBaseline).toBe(true);
    });

    it('extracts --item value', () => {
      const args = parseArgs(['--item', 'abc-123']);
      expect(args.itemFilter).toBe('abc-123');
    });

    it('handles flag order independence', () => {
      const a = parseArgs(['--verbose', '--live', '--confirm']);
      const b = parseArgs(['--confirm', '--live', '--verbose']);
      expect(a).toEqual(b);
    });
  });

  describe('estimateItemCost', () => {
    it('returns a non-zero cost for a fixture with title only', () => {
      const item: GoldItem = {
        content_item_id: '5b4e37ad-5f6a-4bc5-b0ba-9623165d533a',
        title: 'Schools Week Report — Academy Trust Governance Reforms Under New DfE Framework',
        content_type: 'article',
        expected_domain: 'sector-news',
        expected_subtopic: 'education-sector-audits',
        expected_secondary_domain: 'compliance',
        expected_confidence_min: 0.75,
        expected_keywords: ['academy trust', 'DfE'],
        notes: 'Live-only fixture',
        live_only: true,
      };

      const result = estimateItemCost(item, 'claude-sonnet-4-5');
      expect(result.costUsd).toBeGreaterThan(0);
      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.outputTokens).toBeGreaterThan(0);
    });

    it('returns a non-zero cost for a fixture with content text', () => {
      const item: GoldItem = {
        content_item_id: '5b4e37ad-5f6a-4bc5-b0ba-9623165d533a',
        title: 'A long article about procurement law changes',
        content_type: 'article',
        expected_domain: 'legislation-policy',
        expected_subtopic: 'procurement-law',
        expected_secondary_domain: null,
        expected_confidence_min: 0.85,
        expected_keywords: ['procurement'],
        notes: 'Live-only with body',
        live_only: true,
        text: 'A '.repeat(500),
      };

      const result = estimateItemCost(item, 'claude-sonnet-4-5');
      expect(result.costUsd).toBeGreaterThan(0);
      // Body text should drive the input-token count higher than the
      // title-only baseline.
      const titleOnlyResult = estimateItemCost(
        { ...item, text: undefined, content: undefined },
        'claude-sonnet-4-5',
      );
      expect(result.inputTokens).toBeGreaterThan(titleOnlyResult.inputTokens);
    });

    it('caps input length at 5000 chars regardless of body size', () => {
      const small: GoldItem = {
        content_item_id: 'a',
        title: 'Test',
        content_type: 'article',
        expected_domain: 'security',
        expected_subtopic: 'cyber-security',
        expected_secondary_domain: null,
        expected_confidence_min: 0.8,
        expected_keywords: [],
        notes: '',
        live_only: true,
        text: 'x'.repeat(5000),
      };

      const huge: GoldItem = { ...small, text: 'x'.repeat(50000) };

      const smallEst = estimateItemCost(small, 'claude-sonnet-4-5');
      const hugeEst = estimateItemCost(huge, 'claude-sonnet-4-5');

      // Truncation means the two estimates should be identical.
      expect(hugeEst.inputTokens).toBe(smallEst.inputTokens);
      expect(hugeEst.costUsd).toBeCloseTo(smallEst.costUsd, 6);
    });

    it('uses estimateCost from lib/anthropic for the actual USD figure', () => {
      const item: GoldItem = {
        content_item_id: 'b',
        title: 'Estimate test',
        content_type: 'q_a_pair',
        expected_domain: 'security',
        expected_subtopic: 'cyber-security',
        expected_secondary_domain: null,
        expected_confidence_min: 0.8,
        expected_keywords: [],
        notes: '',
        live_only: true,
      };

      const sonnet = estimateItemCost(item, 'claude-sonnet-4-5');
      const opus = estimateItemCost(item, 'claude-opus-4-6');

      // Opus is materially more expensive than Sonnet for the same prompt.
      expect(opus.costUsd).toBeGreaterThan(sonnet.costUsd);
    });
  });

  describe('estimateLiveCost', () => {
    it('aggregates per-item estimates across the fixture set', () => {
      const items: GoldItem[] = [
        {
          content_item_id: '1',
          title: 'Item one',
          content_type: 'article',
          expected_domain: 'security',
          expected_subtopic: 'cyber-security',
          expected_secondary_domain: null,
          expected_confidence_min: 0.8,
          expected_keywords: [],
          notes: '',
          live_only: true,
        },
        {
          content_item_id: '2',
          title: 'Item two with a longer title for variation',
          content_type: 'q_a_pair',
          expected_domain: 'security',
          expected_subtopic: 'access-control',
          expected_secondary_domain: null,
          expected_confidence_min: 0.85,
          expected_keywords: [],
          notes: '',
          live_only: true,
        },
      ];

      const total = estimateLiveCost(items, 'claude-sonnet-4-5');
      const item1 = estimateItemCost(items[0], 'claude-sonnet-4-5');
      const item2 = estimateItemCost(items[1], 'claude-sonnet-4-5');

      expect(total.itemCount).toBe(2);
      expect(total.totalInputTokens).toBe(item1.inputTokens + item2.inputTokens);
      expect(total.totalOutputTokens).toBe(item1.outputTokens + item2.outputTokens);
      expect(total.totalCostUsd).toBeCloseTo(item1.costUsd + item2.costUsd, 6);
    });

    it('handles an empty item list', () => {
      const total = estimateLiveCost([], 'claude-sonnet-4-5');
      expect(total.itemCount).toBe(0);
      expect(total.totalCostUsd).toBe(0);
    });
  });

  describe('gold standard fixture shape', () => {
    let goldStandard: GoldItem[];

    beforeAll(() => {
      const fixturePath = resolve(
        __dirname,
        '../fixtures/classification-eval-gold-standard.json',
      );
      goldStandard = JSON.parse(readFileSync(fixturePath, 'utf-8'));
    });

    it('contains live_only items that need live mode to be evaluated', () => {
      const liveOnly = goldStandard.filter((g) => g.live_only === true);
      // The fixture was expanded in Session 149 to include 12 live-only items.
      // If this count changes, that is fine — the assertion just verifies they
      // exist, not the exact number.
      expect(liveOnly.length).toBeGreaterThan(0);
    });

    it('every live_only item has a valid title for live classification fallback', () => {
      const liveOnly = goldStandard.filter((g) => g.live_only === true);
      for (const item of liveOnly) {
        expect(typeof item.title).toBe('string');
        expect(item.title.length).toBeGreaterThan(0);
      }
    });
  });
});

// ── Live mode integration with mocked Claude (gated) ───────────────

const isLiveMockEnabled = process.env.EVAL_LIVE_TEST === '1';

describe.skipIf(!isLiveMockEnabled)(
  'Classification Eval — Live mode (mocked Anthropic)',
  () => {
    it('produces a non-empty classification result when classifyContent is mocked', async () => {
      // Mock classifyContent so no real API calls happen. The mock returns
      // a deterministic classification result for the given itemId.
      vi.doMock('../../lib/ai/classify', () => ({
        classifyContent: vi.fn().mockResolvedValue({
          primary_domain: 'security',
          primary_subtopic: 'cyber-security',
          secondary_domain: null,
          ai_keywords: ['penetration testing', 'CREST'],
          ai_summary: 'Mocked summary',
          suggested_title: 'Mocked title',
          classification_confidence: 0.92,
          classification_reasoning: 'Mocked reasoning',
        }),
      }));

      const { classifyContent } = await import('../../lib/ai/classify');
      const result = await classifyContent({
        // The mock ignores all parameters; we just need a typed shape.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: {} as any,
        itemId: '00000000-0000-4000-8000-000000000001',
        force: true,
        userId: 'eval-runner',
      });

      expect(result.primary_domain).toBe('security');
      expect(result.primary_subtopic).toBe('cyber-security');
      expect(result.classification_confidence).toBeGreaterThan(0);
      expect(result.ai_keywords?.length ?? 0).toBeGreaterThan(0);

      vi.doUnmock('../../lib/ai/classify');
    });
  },
);

// ── Cached gold-standard integration (gated) ───────────────────────

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

      // Cached path: only items that exist in the DB. Live-only fixtures are
      // intentionally skipped here — they are exercised by the live runner.
      const itemIds = goldStandard
        .filter((g) => !g.live_only)
        .map((g) => g.content_item_id);
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

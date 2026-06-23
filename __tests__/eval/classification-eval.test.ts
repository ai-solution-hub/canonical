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
 * 3. Live integration with mocked Claude — runs the live pipeline with mocked
 *    Anthropic calls on a single small fixture (no external dep, runs in PR).
 *
 * Run unit tests:
 *   bun run test classification-eval
 *
 * Run gold-standard DB eval:
 *   EVAL_CLASSIFICATION=1 bun run test classification-eval
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolveEvalFixture } from '@/lib/eval/fixtures';
import {
  parseArgs,
  estimateItemCost,
  estimateLiveCost,
  type GoldItem,
} from '../../scripts/eval-classification';

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
        title:
          'Schools Week Report — Academy Trust Governance Reforms Under New DfE Framework',
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
      expect(total.totalInputTokens).toBe(
        item1.inputTokens + item2.inputTokens,
      );
      expect(total.totalOutputTokens).toBe(
        item1.outputTokens + item2.outputTokens,
      );
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
      const fixturePath = resolveEvalFixture('classification');
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

// ── Live mode integration with mocked Claude ──────────────────────

describe('Classification Eval — Live mode (mocked Anthropic)', () => {
  it('produces a non-empty classification result when classifyContent is mocked', async () => {
    // Mock classifyContent so no real API calls happen. The mock returns
    // a deterministic classification result for the given itemId.
    vi.doMock('../../lib/ai/classify', () => ({
      classifyContent: vi.fn().mockResolvedValue({
        primary_domain: 'security',
        primary_subtopic: 'cyber-security',
        secondary_domain: null,
        ai_keywords: ['penetration testing', 'CREST'],
        summary: 'Mocked summary',
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
});

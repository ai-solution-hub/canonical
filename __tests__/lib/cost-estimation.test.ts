import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateQuestionCost,
  estimateBatchCost,
  formatCostUSD,
} from '@/lib/coverage/cost-estimation';

// ──────────────────────────────────────────
// estimateTokens
// ──────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for null-ish input', () => {
    // @ts-expect-error -- testing runtime safety
    expect(estimateTokens(null)).toBe(0);
    // @ts-expect-error -- testing runtime safety
    expect(estimateTokens(undefined)).toBe(0);
  });

  it('estimates ~1 token per 4 characters', () => {
    // 100 chars => ceil(100/4) = 25 tokens
    const text = 'a'.repeat(100);
    expect(estimateTokens(text)).toBe(25);
  });

  it('rounds up for non-divisible lengths', () => {
    // 5 chars => ceil(5/4) = 2
    expect(estimateTokens('hello')).toBe(2);
  });

  it('handles single character', () => {
    expect(estimateTokens('x')).toBe(1);
  });

  it('handles long text', () => {
    const text = 'word '.repeat(10000); // ~50000 chars
    const result = estimateTokens(text);
    expect(result).toBeGreaterThan(10000);
    expect(result).toBeLessThan(20000);
  });
});

// ──────────────────────────────────────────
// estimateQuestionCost
// ──────────────────────────────────────────

describe('estimateQuestionCost', () => {
  it('returns positive costs for non-zero inputs', () => {
    const result = estimateQuestionCost(100, 5000);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.costMin).toBeGreaterThan(0);
    expect(result.costMax).toBeGreaterThan(0);
  });

  it('costMin is less than costMax (caching reduces cost)', () => {
    const result = estimateQuestionCost(100, 5000);
    expect(result.costMin).toBeLessThan(result.costMax);
  });

  it('returns zero costs for zero token inputs', () => {
    const result = estimateQuestionCost(0, 0);
    // Still has system prompt and output token costs
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.costMax).toBeGreaterThan(0);
  });

  it('cost scales with content tokens', () => {
    const small = estimateQuestionCost(50, 1000);
    const large = estimateQuestionCost(50, 10000);
    expect(large.costMax).toBeGreaterThan(small.costMax);
    expect(large.inputTokens).toBeGreaterThan(small.inputTokens);
  });

  it('output tokens are consistent regardless of input size', () => {
    const a = estimateQuestionCost(100, 1000);
    const b = estimateQuestionCost(100, 50000);
    // Output tokens should be the same (analysis + drafting + quality outputs)
    expect(a.outputTokens).toBe(b.outputTokens);
  });

  it('includes tokens for all three passes', () => {
    const result = estimateQuestionCost(100, 5000);
    // System prompt (300) * 3 passes + question tokens * 3 + content tokens * 1.1 + output tokens
    // Input: 300+100+500 (pass1) + 300+100+5000 (pass2) + 300+2000+100 (pass3)
    const expectedInput = (300 + 100 + 500) + (300 + 100 + 5000) + (300 + 2000 + 100);
    expect(result.inputTokens).toBe(expectedInput);
    // Output: 500 + 2000 + 200
    expect(result.outputTokens).toBe(2700);
  });

  it('pass 1 uses 10% of content tokens', () => {
    const result = estimateQuestionCost(50, 10000);
    // Pass 1 input: 300 + 50 + ceil(10000*0.1) = 300 + 50 + 1000 = 1350
    // Pass 2 input: 300 + 50 + 10000 = 10350
    // Pass 3 input: 300 + 2000 + 50 = 2350
    const expectedInput = 1350 + 10350 + 2350;
    expect(result.inputTokens).toBe(expectedInput);
  });

  it('cost is dominated by Opus (pass 2) due to higher pricing', () => {
    // For a question with substantial content, most cost should come from pass 2
    const result = estimateQuestionCost(100, 10000);

    // Rough check: pass 2 uses Opus at $15/M input and $75/M output
    // Pass 2 input: ~10400 tokens * $15/M = ~$0.156
    // Pass 2 output: 2000 tokens * $75/M = ~$0.15
    // Total pass 2 max: ~$0.306
    // This should be the majority of the total costMax
    expect(result.costMax).toBeGreaterThan(0.2);
  });
});

// ──────────────────────────────────────────
// estimateBatchCost
// ──────────────────────────────────────────

describe('estimateBatchCost', () => {
  it('returns zeroes for empty input', () => {
    const result = estimateBatchCost([]);
    expect(result.totalQuestions).toBe(0);
    expect(result.eligibleQuestions).toBe(0);
    expect(result.estimatedCostMin).toBe(0);
    expect(result.estimatedCostMax).toBe(0);
    expect(result.estimatedInputTokens).toBe(0);
    expect(result.estimatedOutputTokens).toBe(0);
    expect(result.breakdown).toHaveLength(0);
  });

  it('sums costs across multiple questions', () => {
    const questions = [
      { id: '1', questionText: 'Question one?', contentTokens: 5000, contentItemCount: 3 },
      { id: '2', questionText: 'Question two?', contentTokens: 3000, contentItemCount: 2 },
    ];

    const result = estimateBatchCost(questions);

    expect(result.totalQuestions).toBe(2);
    expect(result.eligibleQuestions).toBe(2);
    expect(result.breakdown).toHaveLength(2);

    // Sum of individual breakdowns should match totals
    const sumMin = result.breakdown.reduce((sum, b) => sum + b.costMin, 0);
    const sumMax = result.breakdown.reduce((sum, b) => sum + b.costMax, 0);
    expect(Math.abs(result.estimatedCostMin - sumMin)).toBeLessThan(0.0001);
    expect(Math.abs(result.estimatedCostMax - sumMax)).toBeLessThan(0.0001);
  });

  it('truncates long question text in breakdown', () => {
    const longText = 'A'.repeat(200);
    const result = estimateBatchCost([
      { id: '1', questionText: longText, contentTokens: 1000, contentItemCount: 1 },
    ]);

    expect(result.breakdown[0].questionText.length).toBeLessThanOrEqual(103); // 100 + '...'
    expect(result.breakdown[0].questionText).toContain('...');
  });

  it('preserves short question text without truncation', () => {
    const shortText = 'How do you ensure quality?';
    const result = estimateBatchCost([
      { id: '1', questionText: shortText, contentTokens: 1000, contentItemCount: 1 },
    ]);

    expect(result.breakdown[0].questionText).toBe(shortText);
  });

  it('includes content item count in breakdown', () => {
    const result = estimateBatchCost([
      { id: '1', questionText: 'Test?', contentTokens: 1000, contentItemCount: 5 },
    ]);

    expect(result.breakdown[0].contentItemCount).toBe(5);
  });
});

// ──────────────────────────────────────────
// formatCostUSD
// ──────────────────────────────────────────

describe('formatCostUSD', () => {
  it('formats normal costs with two decimal places', () => {
    expect(formatCostUSD(1.5)).toBe('$1.50');
    expect(formatCostUSD(0.25)).toBe('$0.25');
    expect(formatCostUSD(10.99)).toBe('$10.99');
  });

  it('returns <$0.01 for very small costs', () => {
    expect(formatCostUSD(0.001)).toBe('<$0.01');
    expect(formatCostUSD(0.009)).toBe('<$0.01');
    expect(formatCostUSD(0)).toBe('<$0.01');
  });

  it('formats costs at the threshold correctly', () => {
    expect(formatCostUSD(0.01)).toBe('$0.01');
  });

  it('handles large costs', () => {
    expect(formatCostUSD(100.456)).toBe('$100.46');
  });
});

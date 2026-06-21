import { describe, it, expect } from 'vitest';
import { estimateCost } from '@/lib/anthropic';
import { COST_PER_MILLION } from '@/lib/ai/pricing';

/**
 * AI-H4 — real estimateCost coverage.
 *
 * The S150 verification flagged that every test that touches estimateCost mocks
 * it, so a typo in the real function or in the pricing constants would not be
 * caught. These tests import the real function and assert exact USD values for
 * known token usage against each model in COST_PER_MILLION.
 */

describe('estimateCost (real function)', () => {
  it('computes claude-sonnet-4-6 cost from input/output tokens', () => {
    // Sonnet 4.6: $3 per M input, $15 per M output
    // 1000 input + 500 output = 0.001 * 3 + 0.0005 * 15 = 0.003 + 0.0075 = 0.0105
    const cost = estimateCost('claude-sonnet-4-6', {
      input_tokens: 1000,
      output_tokens: 500,
    });
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it('computes claude-opus-4-6 cost from input/output tokens', () => {
    // Opus 4.6: $5 per M input, $25 per M output
    // 2000 input + 1000 output = 0.002 * 5 + 0.001 * 25 = 0.01 + 0.025 = 0.035
    const cost = estimateCost('claude-opus-4-6', {
      input_tokens: 2000,
      output_tokens: 1000,
    });
    expect(cost).toBeCloseTo(0.035, 6);
  });

  it('computes claude-haiku-4-5 cost from input/output tokens', () => {
    // Haiku 4.5: $1 per M input, $5 per M output
    // 5000 input + 2000 output = 0.005 * 1 + 0.002 * 5 = 0.005 + 0.01 = 0.015
    const cost = estimateCost('claude-haiku-4-5', {
      input_tokens: 5000,
      output_tokens: 2000,
    });
    expect(cost).toBeCloseTo(0.015, 6);
  });

  it('subtracts cache_read tokens from input billing', () => {
    // 1000 input total, 800 of which are cache reads at $0.30/M
    // Effective input = 200 at $3/M = 0.0006
    // Cache read = 800 at $0.30/M = 0.00024
    // Output = 100 at $15/M = 0.0015
    // Total = 0.0006 + 0.00024 + 0.0015 = 0.00234
    const cost = estimateCost('claude-sonnet-4-6', {
      input_tokens: 1000,
      output_tokens: 100,
      cache_read_input_tokens: 800,
    });
    expect(cost).toBeCloseTo(0.00234, 6);
  });

  it('handles cache_creation tokens at write rate', () => {
    // Sonnet 4.6 cache_write = $3.75/M
    // 1000 input total, 500 cache_creation
    // Effective input = 500 at $3/M = 0.0015
    // Cache write = 500 at $3.75/M = 0.001875
    // Output = 100 at $15/M = 0.0015
    // Total = 0.0015 + 0.001875 + 0.0015 = 0.004875
    const cost = estimateCost('claude-sonnet-4-6', {
      input_tokens: 1000,
      output_tokens: 100,
      cache_creation_input_tokens: 500,
    });
    expect(cost).toBeCloseTo(0.004875, 6);
  });

  it('falls back to claude-sonnet-4-5 pricing for unknown models', () => {
    // Unknown model — should fall through to sonnet-4-5 pricing
    const cost = estimateCost('claude-totally-fake-model', {
      input_tokens: 1000,
      output_tokens: 500,
    });
    // Should match sonnet-4-5 cost (which is the same as 4-6 in the pricing table)
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it('returns 0 for zero token usage', () => {
    const cost = estimateCost('claude-sonnet-4-6', {
      input_tokens: 0,
      output_tokens: 0,
    });
    expect(cost).toBe(0);
  });
});

describe('COST_PER_MILLION pricing constants', () => {
  it('has all four current Anthropic models', () => {
    expect(COST_PER_MILLION).toHaveProperty('claude-opus-4-6');
    expect(COST_PER_MILLION).toHaveProperty('claude-sonnet-4-5');
    expect(COST_PER_MILLION).toHaveProperty('claude-sonnet-4-6');
    expect(COST_PER_MILLION).toHaveProperty('claude-haiku-4-5');
  });

  it('has consistent shape for each model', () => {
    for (const model of Object.keys(COST_PER_MILLION)) {
      const pricing = COST_PER_MILLION[model];
      expect(pricing).toHaveProperty('input');
      expect(pricing).toHaveProperty('output');
      expect(pricing).toHaveProperty('cache_read');
      expect(pricing).toHaveProperty('cache_write');
      expect(typeof pricing.input).toBe('number');
      expect(typeof pricing.output).toBe('number');
      expect(typeof pricing.cache_read).toBe('number');
      expect(typeof pricing.cache_write).toBe('number');
    }
  });

  it('has output cost higher than input cost for every model', () => {
    for (const model of Object.keys(COST_PER_MILLION)) {
      const pricing = COST_PER_MILLION[model];
      expect(pricing.output).toBeGreaterThan(pricing.input);
    }
  });

  it('has cache_read cost lower than input cost for every model', () => {
    for (const model of Object.keys(COST_PER_MILLION)) {
      const pricing = COST_PER_MILLION[model];
      expect(pricing.cache_read).toBeLessThan(pricing.input);
    }
  });
});

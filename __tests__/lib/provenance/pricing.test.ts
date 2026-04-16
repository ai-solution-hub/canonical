import { describe, it, expect } from 'vitest';
import {
  estimateClassifyCost,
  estimateEmbedCost,
} from '@/lib/provenance/pricing';

describe('estimateClassifyCost', () => {
  it('returns correct cost for claude-opus-4-6', () => {
    const cost = estimateClassifyCost(1000, 200, 0, 0, 'claude-opus-4-6');
    expect(cost).not.toBeNull();
    // 1000 * 15/1M + 200 * 75/1M = 0.015 + 0.015 = 0.03
    expect(cost).toBeCloseTo(0.03, 6);
  });

  it('returns correct cost for claude-sonnet-4-6', () => {
    const cost = estimateClassifyCost(1000, 200, 0, 0, 'claude-sonnet-4-6');
    expect(cost).not.toBeNull();
    // 1000 * 3/1M + 200 * 15/1M = 0.003 + 0.003 = 0.006
    expect(cost).toBeCloseTo(0.006, 6);
  });

  it('includes cache creation and read tokens in cost', () => {
    const cost = estimateClassifyCost(
      500,
      100,
      1000,
      2000,
      'claude-opus-4-6',
    );
    expect(cost).not.toBeNull();
    // 500 * 15/1M + 100 * 75/1M + 1000 * 18.75/1M + 2000 * 1.5/1M
    // = 0.0075 + 0.0075 + 0.01875 + 0.003 = 0.03675
    expect(cost).toBeCloseTo(0.03675, 6);
  });

  it('returns null for unknown model', () => {
    const cost = estimateClassifyCost(1000, 200, 0, 0, 'unknown-model-xyz');
    expect(cost).toBeNull();
  });

  it('returns 0 for zero tokens', () => {
    const cost = estimateClassifyCost(0, 0, 0, 0, 'claude-opus-4-6');
    expect(cost).toBe(0);
  });

  it('returns correct cost for claude-haiku-3-5', () => {
    const cost = estimateClassifyCost(1000, 500, 0, 0, 'claude-haiku-3-5');
    expect(cost).not.toBeNull();
    // 1000 * 0.8/1M + 500 * 4/1M = 0.0008 + 0.002 = 0.0028
    expect(cost).toBeCloseTo(0.0028, 6);
  });
});

describe('estimateEmbedCost', () => {
  it('returns correct cost for text-embedding-3-large', () => {
    const cost = estimateEmbedCost(1000, 'text-embedding-3-large');
    expect(cost).not.toBeNull();
    // 1000 * 0.13/1M = 0.00013
    expect(cost).toBeCloseTo(0.00013, 8);
  });

  it('returns correct cost for text-embedding-3-small', () => {
    const cost = estimateEmbedCost(1000, 'text-embedding-3-small');
    expect(cost).not.toBeNull();
    // 1000 * 0.02/1M = 0.00002
    expect(cost).toBeCloseTo(0.00002, 8);
  });

  it('returns correct cost for text-embedding-ada-002', () => {
    const cost = estimateEmbedCost(1000, 'text-embedding-ada-002');
    expect(cost).not.toBeNull();
    // 1000 * 0.1/1M = 0.0001
    expect(cost).toBeCloseTo(0.0001, 8);
  });

  it('returns null for unknown model', () => {
    const cost = estimateEmbedCost(1000, 'some-unknown-model');
    expect(cost).toBeNull();
  });

  it('returns 0 for zero tokens', () => {
    const cost = estimateEmbedCost(0, 'text-embedding-3-large');
    expect(cost).toBe(0);
  });

  it('scales linearly with token count', () => {
    const cost1 = estimateEmbedCost(1000, 'text-embedding-3-large');
    const cost2 = estimateEmbedCost(5000, 'text-embedding-3-large');
    expect(cost1).not.toBeNull();
    expect(cost2).not.toBeNull();
    expect(cost2! / cost1!).toBeCloseTo(5, 6);
  });
});

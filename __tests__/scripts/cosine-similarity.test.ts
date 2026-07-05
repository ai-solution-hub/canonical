import { describe, it, expect } from 'vitest';
// ID-131.19 (M6, S450 GO tail): scripts/embedding-smoke-test.ts RETIRED —
// its subject (content_items.embedding, title, content columns) was dropped
// wholesale (content_items table + the inline vector columns). Re-pointed
// onto compare-quality.ts's identical pure implementation (see
// __tests__/scripts/compare-quality.test.ts's "cosineSimilarity" describe).
import { cosineSimilarity } from '@/scripts/compare-quality';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 10);
  });

  it('is invariant to positive scaling', () => {
    const base = cosineSimilarity([1, 2, 3], [4, 5, 6]);
    const scaled = cosineSimilarity([1, 2, 3], [40, 50, 60]);
    expect(scaled).toBeCloseTo(base, 10);
  });

  it('returns 0 when either vector is zero', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it('throws on length mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(
      /length mismatch/i,
    );
  });

  it('handles 1024-dim vectors without overflow', () => {
    const a = new Array(1024).fill(0.1);
    const b = new Array(1024).fill(0.1);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
  });
});

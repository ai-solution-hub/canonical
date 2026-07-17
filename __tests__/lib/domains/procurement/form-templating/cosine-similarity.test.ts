import { describe, it, expect } from 'vitest';
// bl-495: scripts/compare-quality.ts (this suite's previous subject after the
// ID-131.19 embedding-smoke-test retirement) was deleted with its Plan-D
// snapshot companion — re-pointed onto the LIVE production implementation in
// template-coverage.ts. Contract difference from the deleted script: length
// mismatch and null/empty inputs return 0 (defensive), they do not throw.
import { cosineSimilarity } from '@/lib/domains/procurement/form-templating/template-coverage';

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

  it('returns 0 on length mismatch (defensive contract)', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('returns 0 for null or empty inputs (defensive contract)', () => {
    expect(cosineSimilarity(null, [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], null)).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('handles 1024-dim vectors without overflow', () => {
    const a = new Array(1024).fill(0.1);
    const b = new Array(1024).fill(0.1);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
  });
});

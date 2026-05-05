/**
 * Math-contract tests for `e2e/fixtures/admin-dedup-vectors.ts`.
 *
 * These exist to lock the unit-vector + cosine-similarity invariants the
 * §1.7 + §1.9 admin-dedup fixture depends on:
 *   - `baseVector` is unit-norm and bit-identical across calls.
 *   - `perturbVector` lands within ±0.001 of the requested cosine target.
 *   - `cosineSimilarity` matches hand-computed values and survives zero-norm.
 *   - `buildPair` is deterministic across calls and key-distinct across keys.
 *
 * Reference: `docs/audits/s213b-admin-dedup-fixtures-design.md` §4 + §9.3.
 */

import { describe, it, expect } from 'vitest';
import {
  FIXTURE_SEED,
  baseVector,
  perturbVector,
  cosineSimilarity,
  buildPair,
} from '@/e2e/fixtures/admin-dedup-vectors';

const VECTOR_DIM = 1024;
const UNIT_NORM_TOLERANCE = 1e-9;
const COSINE_TARGET_TOLERANCE = 0.001;

function l2Norm(v: readonly number[]): number {
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  return Math.sqrt(sumSq);
}

describe('admin-dedup-vectors / FIXTURE_SEED', () => {
  it('exposes a finite integer seed', () => {
    expect(Number.isFinite(FIXTURE_SEED)).toBe(true);
    expect(Number.isInteger(FIXTURE_SEED)).toBe(true);
  });
});

describe('admin-dedup-vectors / baseVector', () => {
  it('produces a 1024-dim vector', () => {
    const v = baseVector(FIXTURE_SEED);
    expect(v).toHaveLength(VECTOR_DIM);
  });

  it('produces unit vectors for a range of seeds', () => {
    const seeds = [0, 1, 42, FIXTURE_SEED, 0x12345678, -7, 123456789];
    for (const seed of seeds) {
      const v = baseVector(seed);
      expect(Math.abs(l2Norm(v) - 1)).toBeLessThanOrEqual(UNIT_NORM_TOLERANCE);
    }
  });

  it('is bit-identical across repeated calls (determinism)', () => {
    const a = baseVector(FIXTURE_SEED);
    const b = baseVector(FIXTURE_SEED);
    expect(a).toEqual(b);
    // Element-wise strict equality — no float drift permitted.
    for (let i = 0; i < VECTOR_DIM; i += 1) {
      expect(a[i]).toBe(b[i]);
    }
  });

  it('produces non-identical vectors for distinct seeds', () => {
    const a = baseVector(1);
    const b = baseVector(2);
    expect(a).not.toEqual(b);
    // And not just permutations — at least one component differs.
    const differs = a.some((x, i) => x !== b[i]);
    expect(differs).toBe(true);
  });
});

describe('admin-dedup-vectors / perturbVector', () => {
  const targets = [0.86, 0.9, 0.95, 0.97, 0.99];

  for (const target of targets) {
    it(`lands within ±${COSINE_TARGET_TOLERANCE} of cosine = ${target}`, () => {
      const base = baseVector(FIXTURE_SEED);
      const perturbed = perturbVector(base, target, FIXTURE_SEED + 1);
      const actual = cosineSimilarity(base, perturbed);
      expect(Math.abs(actual - target)).toBeLessThanOrEqual(
        COSINE_TARGET_TOLERANCE,
      );
    });
  }

  it('returns a unit vector', () => {
    const base = baseVector(FIXTURE_SEED);
    const perturbed = perturbVector(base, 0.95, FIXTURE_SEED + 1);
    expect(Math.abs(l2Norm(perturbed) - 1)).toBeLessThanOrEqual(
      UNIT_NORM_TOLERANCE,
    );
  });

  it('returns a 1024-dim vector', () => {
    const base = baseVector(FIXTURE_SEED);
    const perturbed = perturbVector(base, 0.9, FIXTURE_SEED + 1);
    expect(perturbed).toHaveLength(VECTOR_DIM);
  });

  it('is deterministic for the same (base, target, noiseSeed)', () => {
    const base = baseVector(FIXTURE_SEED);
    const a = perturbVector(base, 0.95, 7);
    const b = perturbVector(base, 0.95, 7);
    expect(a).toEqual(b);
    for (let i = 0; i < VECTOR_DIM; i += 1) {
      expect(a[i]).toBe(b[i]);
    }
  });

  it('rejects bases of the wrong dimension', () => {
    expect(() => perturbVector([1, 0, 0], 0.95, 1)).toThrow(/1024-dim/);
  });
});

describe('admin-dedup-vectors / cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = baseVector(FIXTURE_SEED);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 12);
  });

  it('returns -1 for opposite vectors', () => {
    const v = baseVector(FIXTURE_SEED);
    const negated = v.map((x) => -x);
    expect(cosineSimilarity(v, negated)).toBeCloseTo(-1, 12);
  });

  it('returns 0 for orthogonal hand-computed vectors', () => {
    const a = [1, 0, 0, 0];
    const b = [0, 1, 0, 0];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('matches the hand-computed value for a known pair', () => {
    // a = [1, 1, 0, 0], b = [1, 0, 1, 0]
    // dot = 1; |a| = sqrt(2); |b| = sqrt(2); cos = 1 / 2 = 0.5
    const a = [1, 1, 0, 0];
    const b = [1, 0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.5, 12);
  });

  it('returns 0 (not NaN) when either input has zero norm', () => {
    const zero = new Array<number>(VECTOR_DIM).fill(0);
    const v = baseVector(FIXTURE_SEED);
    expect(cosineSimilarity(zero, v)).toBe(0);
    expect(cosineSimilarity(v, zero)).toBe(0);
    expect(cosineSimilarity(zero, zero)).toBe(0);
  });

  it('rejects mismatched lengths', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(
      /length mismatch/,
    );
  });
});

describe('admin-dedup-vectors / buildPair', () => {
  it('returns a pair at the requested cosine similarity', () => {
    const target = 0.95;
    const [left, right] = buildPair('test-key', target);
    const actual = cosineSimilarity(left, right);
    expect(Math.abs(actual - target)).toBeLessThanOrEqual(
      COSINE_TARGET_TOLERANCE,
    );
  });

  it('returns 1024-dim vectors on both sides', () => {
    const [left, right] = buildPair('test-key', 0.9);
    expect(left).toHaveLength(VECTOR_DIM);
    expect(right).toHaveLength(VECTOR_DIM);
  });

  it('is deterministic for the same key + target', () => {
    const a = buildPair('pair-A', 0.97);
    const b = buildPair('pair-A', 0.97);
    expect(a[0]).toEqual(b[0]);
    expect(a[1]).toEqual(b[1]);
  });

  it('returns distinct pairs for distinct keys', () => {
    const [leftA] = buildPair('pair-A', 0.95);
    const [leftB] = buildPair('pair-B', 0.95);
    expect(leftA).not.toEqual(leftB);
    // Check that they aren't accidentally degenerate near-copies.
    const sim = cosineSimilarity(leftA, leftB);
    expect(Math.abs(sim)).toBeLessThan(0.5);
  });

  it('honours a range of cosine targets used by the §1.9 fixture', () => {
    for (const target of [0.86, 0.9, 0.95, 0.97]) {
      const [left, right] = buildPair(`fixture-${target}`, target);
      const actual = cosineSimilarity(left, right);
      expect(Math.abs(actual - target)).toBeLessThanOrEqual(
        COSINE_TARGET_TOLERANCE,
      );
    }
  });
});

import { describe, it, expect } from 'vitest';
import {
  precision,
  recall,
  f1Score,
  accuracy,
  rougeL,
  rouge1,
  mrr,
  ndcgAtK,
  precisionAtK,
} from '@/lib/eval/metrics';

describe('eval metrics', () => {
  describe('precision', () => {
    it('returns 0 for 0 tp and 0 fp', () => {
      expect(precision(0, 0)).toBe(0);
    });

    it('returns correct value for typical inputs', () => {
      expect(precision(8, 2)).toBeCloseTo(0.8);
    });

    it('returns 1.0 for perfect precision', () => {
      expect(precision(10, 0)).toBe(1);
    });
  });

  describe('recall', () => {
    it('returns 0 for 0 tp and 0 fn', () => {
      expect(recall(0, 0)).toBe(0);
    });

    it('returns correct value for typical inputs', () => {
      expect(recall(7, 3)).toBeCloseTo(0.7);
    });
  });

  describe('f1Score', () => {
    it('returns harmonic mean of precision and recall', () => {
      // p=0.8, r=0.6 => 2*0.8*0.6 / (0.8+0.6) = 0.96/1.4 ≈ 0.6857
      expect(f1Score(0.8, 0.6)).toBeCloseTo(0.6857, 3);
    });

    it('returns 0 when both precision and recall are 0', () => {
      expect(f1Score(0, 0)).toBe(0);
    });

    it('returns 1.0 for perfect precision and recall', () => {
      expect(f1Score(1, 1)).toBeCloseTo(1.0);
    });
  });

  describe('accuracy', () => {
    it('returns 0 for total of 0', () => {
      expect(accuracy(0, 0)).toBe(0);
    });

    it('returns correct value', () => {
      expect(accuracy(90, 100)).toBeCloseTo(0.9);
    });
  });

  describe('rougeL', () => {
    it('returns 1.0 for identical strings', () => {
      const result = rougeL('the cat sat on the mat', 'the cat sat on the mat');
      expect(result.precision).toBeCloseTo(1.0);
      expect(result.recall).toBeCloseTo(1.0);
      expect(result.f1).toBeCloseTo(1.0);
    });

    it('returns 0 for completely different strings', () => {
      const result = rougeL('alpha beta gamma', 'one two three');
      expect(result.precision).toBe(0);
      expect(result.recall).toBe(0);
      expect(result.f1).toBe(0);
    });

    it('handles empty strings gracefully', () => {
      expect(rougeL('', 'hello world')).toEqual({
        precision: 0,
        recall: 0,
        f1: 0,
      });
      expect(rougeL('hello world', '')).toEqual({
        precision: 0,
        recall: 0,
        f1: 0,
      });
      expect(rougeL('', '')).toEqual({ precision: 0, recall: 0, f1: 0 });
    });

    it('returns partial scores for overlapping strings', () => {
      // "the cat sat" vs "the cat ran" — LCS = ["the", "cat"] length 2
      const result = rougeL('the cat sat', 'the cat ran');
      expect(result.f1).toBeGreaterThan(0);
      expect(result.f1).toBeLessThan(1);
    });
  });

  describe('rouge1', () => {
    it('returns correct unigram overlap (Set-based)', () => {
      // "the cat sat on the mat" vs "the cat on the mat"
      const result = rouge1('the cat sat on the mat', 'the cat on the mat');
      // Candidate set: {the, cat, sat, on, mat} (5 unique)
      // Reference set: {the, cat, on, mat} (4 unique)
      // Overlap: {the, cat, on, mat} = 4
      expect(result.precision).toBeCloseTo(4 / 5, 3);
      expect(result.recall).toBeCloseTo(4 / 4, 3);
    });

    it('returns 1.0 for identical strings', () => {
      const result = rouge1('hello world', 'hello world');
      expect(result.f1).toBeCloseTo(1.0);
    });

    it('returns 0 for completely different strings', () => {
      const result = rouge1('alpha beta', 'gamma delta');
      expect(result.f1).toBe(0);
    });
  });

  describe('mrr', () => {
    it('returns correct rank for simple cases', () => {
      // Query 1: relevant at position 1 => 1/1
      // Query 2: relevant at position 3 => 1/3
      // MRR = (1 + 1/3) / 2 = 2/3
      const results = [
        [{ relevant: true }, { relevant: false }],
        [{ relevant: false }, { relevant: false }, { relevant: true }],
      ];
      expect(mrr(results)).toBeCloseTo(2 / 3, 4);
    });

    it('returns 0 for empty results', () => {
      expect(mrr([])).toBe(0);
    });

    it('returns 0 when no results are relevant', () => {
      const results = [[{ relevant: false }, { relevant: false }]];
      expect(mrr(results)).toBe(0);
    });
  });

  describe('ndcgAtK', () => {
    it('returns 1.0 for perfect ranking', () => {
      const scores = [3, 2, 1, 0];
      const ideal = [3, 2, 1, 0];
      expect(ndcgAtK(scores, ideal, 4)).toBeCloseTo(1.0);
    });

    it('returns less than 1.0 for imperfect ranking', () => {
      const scores = [0, 1, 2, 3]; // worst ordering
      const ideal = [3, 2, 1, 0]; // best ordering
      const result = ndcgAtK(scores, ideal, 4);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1);
    });

    it('returns 0 for k=0', () => {
      expect(ndcgAtK([3, 2, 1], [3, 2, 1], 0)).toBe(0);
    });
  });

  describe('precisionAtK', () => {
    it('returns correct value', () => {
      const results = [
        { relevant: true },
        { relevant: false },
        { relevant: true },
        { relevant: false },
        { relevant: true },
      ];
      // Top 3: 2 relevant out of 3
      expect(precisionAtK(results, 3)).toBeCloseTo(2 / 3, 4);
    });

    it('returns 0 for k=0', () => {
      expect(precisionAtK([{ relevant: true }], 0)).toBe(0);
    });

    it('returns 1.0 when all top-k are relevant', () => {
      const results = [
        { relevant: true },
        { relevant: true },
        { relevant: false },
      ];
      expect(precisionAtK(results, 2)).toBeCloseTo(1.0);
    });
  });
});

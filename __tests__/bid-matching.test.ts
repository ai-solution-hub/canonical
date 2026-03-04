import { describe, it, expect } from 'vitest';
import {
  assessConfidence,
  deduplicateResults,
  MATCH_THRESHOLDS,
  type MatchResult,
} from '@/lib/bid-matching';

describe('bid-matching', () => {
  describe('MATCH_THRESHOLDS', () => {
    it('has expected default values', () => {
      expect(MATCH_THRESHOLDS.strong).toBe(0.70);
      expect(MATCH_THRESHOLDS.partial).toBe(0.50);
      expect(MATCH_THRESHOLDS.minimal).toBe(0.30);
    });
  });

  describe('assessConfidence', () => {
    it('returns strong_match when 2+ results above strong threshold', () => {
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.85 },
        { id: '2', similarity: 0.75 },
        { id: '3', similarity: 0.40 },
      ];
      expect(assessConfidence(matches)).toBe('strong_match');
    });

    it('returns partial_match when 1 result above partial threshold', () => {
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.60 },
        { id: '2', similarity: 0.35 },
      ];
      expect(assessConfidence(matches)).toBe('partial_match');
    });

    it('returns needs_sme when best result is between minimal and partial', () => {
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.40 },
        { id: '2', similarity: 0.25 },
      ];
      expect(assessConfidence(matches)).toBe('needs_sme');
    });

    it('returns no_content when no results', () => {
      expect(assessConfidence([])).toBe('no_content');
    });

    it('returns no_content when all results below minimal threshold', () => {
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.20 },
        { id: '2', similarity: 0.15 },
      ];
      expect(assessConfidence(matches)).toBe('no_content');
    });

    it('returns partial_match with exactly 1 strong result', () => {
      // 1 strong result is not enough for strong_match (needs 2+)
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.80 },
        { id: '2', similarity: 0.25 },
      ];
      // Only 1 strong match, but it's above partial threshold too
      expect(assessConfidence(matches)).toBe('partial_match');
    });

    it('returns strong_match at exactly the threshold', () => {
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.70 },
        { id: '2', similarity: 0.70 },
      ];
      expect(assessConfidence(matches)).toBe('strong_match');
    });

    it('returns partial_match at exactly the partial threshold', () => {
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.50 },
      ];
      expect(assessConfidence(matches)).toBe('partial_match');
    });

    it('returns needs_sme at exactly the minimal threshold', () => {
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.30 },
      ];
      expect(assessConfidence(matches)).toBe('needs_sme');
    });

    it('returns no_content just below minimal threshold', () => {
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.29 },
      ];
      expect(assessConfidence(matches)).toBe('no_content');
    });
  });

  describe('deduplicateResults', () => {
    it('removes duplicate IDs, keeping highest similarity', () => {
      const results: MatchResult[] = [
        { id: '1', similarity: 0.60 },
        { id: '2', similarity: 0.80 },
        { id: '1', similarity: 0.75 }, // Duplicate with higher score
        { id: '3', similarity: 0.50 },
      ];

      const deduplicated = deduplicateResults(results);

      expect(deduplicated).toHaveLength(3);
      expect(deduplicated.find(r => r.id === '1')?.similarity).toBe(0.75);
      expect(deduplicated.find(r => r.id === '2')?.similarity).toBe(0.80);
    });

    it('sorts results by similarity descending', () => {
      const results: MatchResult[] = [
        { id: '1', similarity: 0.50 },
        { id: '2', similarity: 0.90 },
        { id: '3', similarity: 0.70 },
      ];

      const deduplicated = deduplicateResults(results);

      expect(deduplicated[0].id).toBe('2');
      expect(deduplicated[1].id).toBe('3');
      expect(deduplicated[2].id).toBe('1');
    });

    it('handles empty array', () => {
      expect(deduplicateResults([])).toEqual([]);
    });

    it('handles single item', () => {
      const results: MatchResult[] = [{ id: '1', similarity: 0.85 }];
      const deduplicated = deduplicateResults(results);
      expect(deduplicated).toHaveLength(1);
      expect(deduplicated[0]).toEqual({ id: '1', similarity: 0.85 });
    });

    it('handles all duplicates of same ID', () => {
      const results: MatchResult[] = [
        { id: '1', similarity: 0.50 },
        { id: '1', similarity: 0.60 },
        { id: '1', similarity: 0.55 },
      ];

      const deduplicated = deduplicateResults(results);

      expect(deduplicated).toHaveLength(1);
      expect(deduplicated[0].similarity).toBe(0.60);
    });
  });
});

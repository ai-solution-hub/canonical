import { describe, it, expect } from 'vitest';
import {
  assessConfidence,
  deduplicateResults,
  MATCH_THRESHOLDS,
  type MatchResult,
} from '@/lib/ai/match';

describe('bid-matching', () => {
  describe('MATCH_THRESHOLDS', () => {
    it('has expected default values', () => {
      expect(MATCH_THRESHOLDS.strong).toBe(0.7);
      expect(MATCH_THRESHOLDS.partial).toBe(0.5);
      expect(MATCH_THRESHOLDS.minimal).toBe(0.3);
    });
  });

  describe('assessConfidence', () => {
    it('returns strong_match when 2+ results above strong threshold', () => {
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.85 },
        { id: '2', similarity: 0.75 },
        { id: '3', similarity: 0.4 },
      ];
      expect(assessConfidence(matches)).toBe('strong_match');
    });

    it('returns partial_match when 1 result above partial threshold', () => {
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.6 },
        { id: '2', similarity: 0.35 },
      ];
      expect(assessConfidence(matches)).toBe('partial_match');
    });

    it('returns needs_sme when best result is between minimal and partial', () => {
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.4 },
        { id: '2', similarity: 0.25 },
      ];
      expect(assessConfidence(matches)).toBe('needs_sme');
    });

    it('returns no_content when no results', () => {
      expect(assessConfidence([])).toBe('no_content');
    });

    it('returns no_content when all results below minimal threshold', () => {
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.2 },
        { id: '2', similarity: 0.15 },
      ];
      expect(assessConfidence(matches)).toBe('no_content');
    });

    it('returns partial_match with exactly 1 strong result', () => {
      // 1 strong result is not enough for strong_match (needs 2+)
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.8 },
        { id: '2', similarity: 0.25 },
      ];
      // Only 1 strong match, but it's above partial threshold too
      expect(assessConfidence(matches)).toBe('partial_match');
    });

    it('returns strong_match at exactly the threshold', () => {
      const matches: MatchResult[] = [
        { id: '1', similarity: 0.7 },
        { id: '2', similarity: 0.7 },
      ];
      expect(assessConfidence(matches)).toBe('strong_match');
    });

    it('returns partial_match at exactly the partial threshold', () => {
      const matches: MatchResult[] = [{ id: '1', similarity: 0.5 }];
      expect(assessConfidence(matches)).toBe('partial_match');
    });

    it('returns needs_sme at exactly the minimal threshold', () => {
      const matches: MatchResult[] = [{ id: '1', similarity: 0.3 }];
      expect(assessConfidence(matches)).toBe('needs_sme');
    });

    it('returns no_content just below minimal threshold', () => {
      const matches: MatchResult[] = [{ id: '1', similarity: 0.29 }];
      expect(assessConfidence(matches)).toBe('no_content');
    });
  });

  describe('deduplicateResults', () => {
    it('removes duplicate IDs, keeping highest similarity', () => {
      const results: MatchResult[] = [
        { id: '1', similarity: 0.6 },
        { id: '2', similarity: 0.8 },
        { id: '1', similarity: 0.75 }, // Duplicate with higher score
        { id: '3', similarity: 0.5 },
      ];

      const deduplicated = deduplicateResults(results);

      expect(deduplicated).toHaveLength(3);
      expect(deduplicated.find((r) => r.id === '1')?.similarity).toBe(0.75);
      expect(deduplicated.find((r) => r.id === '2')?.similarity).toBe(0.8);
    });

    it('sorts results by similarity descending', () => {
      const results: MatchResult[] = [
        { id: '1', similarity: 0.5 },
        { id: '2', similarity: 0.9 },
        { id: '3', similarity: 0.7 },
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
        { id: '1', similarity: 0.5 },
        { id: '1', similarity: 0.6 },
        { id: '1', similarity: 0.55 },
      ];

      const deduplicated = deduplicateResults(results);

      expect(deduplicated).toHaveLength(1);
      expect(deduplicated[0].similarity).toBe(0.6);
    });
  });
});

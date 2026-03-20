import { describe, it, expect } from 'vitest';
import {
  applySynonymMerges,
  identifySingletonQATags,
  processItemKeywords,
  SYNONYM_MERGES,
} from '@/scripts/cleanup-tags';

describe('cleanup-tags', () => {
  describe('applySynonymMerges', () => {
    it('replaces a known synonym with its canonical form', () => {
      const result = applySynonymMerges(
        ['UK GDPR', 'data protection'],
        SYNONYM_MERGES,
      );
      expect(result).toEqual(['GDPR', 'data protection']);
    });

    it('merges multiple synonyms to the same canonical tag', () => {
      const result = applySynonymMerges(
        ['GDPR compliance', 'GDPR training'],
        SYNONYM_MERGES,
      );
      // Both map to "GDPR", deduplicated to one
      expect(result).toEqual(['GDPR']);
    });

    it('deduplicates when a merge creates a duplicate of an existing tag', () => {
      const result = applySynonymMerges(
        ['GDPR', 'UK GDPR', 'data protection'],
        SYNONYM_MERGES,
      );
      expect(result).toEqual(['GDPR', 'data protection']);
    });

    it('leaves unknown tags unchanged', () => {
      const result = applySynonymMerges(
        ['access control', 'encryption'],
        SYNONYM_MERGES,
      );
      expect(result).toEqual(['access control', 'encryption']);
    });

    it('handles case-insensitive matching for merge keys', () => {
      const result = applySynonymMerges(
        ['uk gdpr', 'iso 27001:2022'],
        SYNONYM_MERGES,
      );
      expect(result).toEqual(['GDPR', 'ISO 27001']);
    });

    it('returns empty array for empty input', () => {
      const result = applySynonymMerges([], SYNONYM_MERGES);
      expect(result).toEqual([]);
    });

    it('handles Cyber Essentials -> Cyber Essentials Plus merge', () => {
      const result = applySynonymMerges(
        ['Cyber Essentials', 'access control'],
        SYNONYM_MERGES,
      );
      expect(result).toEqual(['Cyber Essentials Plus', 'access control']);
    });

    it('does not duplicate when both Cyber Essentials and Cyber Essentials Plus exist', () => {
      const result = applySynonymMerges(
        ['Cyber Essentials', 'Cyber Essentials Plus'],
        SYNONYM_MERGES,
      );
      expect(result).toEqual(['Cyber Essentials Plus']);
    });
  });

  describe('identifySingletonQATags', () => {
    it('identifies a 3+ word singleton tag on a q_a_pair', () => {
      const items = [
        { id: '1', ai_keywords: ['very specific long tag', 'GDPR'], content_type: 'q_a_pair' },
        { id: '2', ai_keywords: ['GDPR', 'data protection'], content_type: 'q_a_pair' },
      ];
      const result = identifySingletonQATags(items);
      expect(result.has('very specific long tag')).toBe(true);
      expect(result.has('GDPR')).toBe(false); // used twice
    });

    it('does not flag 2-word singleton tags', () => {
      const items = [
        { id: '1', ai_keywords: ['two words'], content_type: 'q_a_pair' },
      ];
      const result = identifySingletonQATags(items);
      expect(result.has('two words')).toBe(false);
    });

    it('does not flag singleton tags used on non-q_a_pair items', () => {
      const items = [
        { id: '1', ai_keywords: ['very specific long tag'], content_type: 'article' },
      ];
      const result = identifySingletonQATags(items);
      expect(result.has('very specific long tag')).toBe(false);
    });

    it('does not flag 3+ word tags used more than once', () => {
      const items = [
        { id: '1', ai_keywords: ['three word tag'], content_type: 'q_a_pair' },
        { id: '2', ai_keywords: ['three word tag'], content_type: 'q_a_pair' },
      ];
      const result = identifySingletonQATags(items);
      expect(result.has('three word tag')).toBe(false);
    });

    it('does not flag a 3+ word singleton used on both q_a_pair and another type', () => {
      const items = [
        { id: '1', ai_keywords: ['very specific long tag'], content_type: 'q_a_pair' },
        { id: '2', ai_keywords: ['very specific long tag'], content_type: 'article' },
      ];
      // Tag appears twice so it's not a singleton
      const result = identifySingletonQATags(items);
      expect(result.has('very specific long tag')).toBe(false);
    });

    it('returns empty set when no items match criteria', () => {
      const items = [
        { id: '1', ai_keywords: ['GDPR', 'ISO 27001'], content_type: 'q_a_pair' },
      ];
      const result = identifySingletonQATags(items);
      expect(result.size).toBe(0);
    });

    it('handles items with null content_type', () => {
      const items = [
        { id: '1', ai_keywords: ['very specific long tag'], content_type: null },
      ];
      const result = identifySingletonQATags(items);
      // content_type is null -> maps to 'unknown', not 'q_a_pair'
      expect(result.has('very specific long tag')).toBe(false);
    });
  });

  describe('processItemKeywords', () => {
    it('removes singleton tags and applies merges', () => {
      const singletons = new Set(['overly specific qa tag']);
      const keywords = ['overly specific qa tag', 'UK GDPR', 'data protection'];
      const result = processItemKeywords(keywords, singletons, SYNONYM_MERGES);
      expect(result).toEqual(['GDPR', 'data protection']);
    });

    it('returns null when no changes are needed', () => {
      const singletons = new Set<string>();
      const keywords = ['GDPR', 'data protection'];
      const result = processItemKeywords(keywords, singletons, SYNONYM_MERGES);
      expect(result).toBeNull();
    });

    it('deduplicates after merge creates a collision', () => {
      const singletons = new Set<string>();
      const keywords = ['GDPR', 'GDPR compliance'];
      const result = processItemKeywords(keywords, singletons, SYNONYM_MERGES);
      expect(result).toEqual(['GDPR']);
    });

    it('handles removal only (no merges needed)', () => {
      const singletons = new Set(['long singleton qa tag']);
      const keywords = ['GDPR', 'long singleton qa tag', 'data protection'];
      const result = processItemKeywords(keywords, singletons, SYNONYM_MERGES);
      expect(result).toEqual(['GDPR', 'data protection']);
    });

    it('handles merge only (no removals needed)', () => {
      const singletons = new Set<string>();
      const keywords = ['ISO 27001:2022', 'access control'];
      const result = processItemKeywords(keywords, singletons, SYNONYM_MERGES);
      expect(result).toEqual(['ISO 27001', 'access control']);
    });

    it('handles both removal and merge in the same item', () => {
      const singletons = new Set(['some three word singleton']);
      const keywords = [
        'some three word singleton',
        'UK GDPR',
        'data protection',
        'access control',
      ];
      const result = processItemKeywords(keywords, singletons, SYNONYM_MERGES);
      expect(result).toEqual(['GDPR', 'data protection', 'access control']);
    });
  });

  describe('SYNONYM_MERGES', () => {
    it('contains expected merge entries', () => {
      expect(SYNONYM_MERGES['UK GDPR']).toBe('GDPR');
      expect(SYNONYM_MERGES['GDPR compliance']).toBe('GDPR');
      expect(SYNONYM_MERGES['GDPR training']).toBe('GDPR');
      expect(SYNONYM_MERGES['regulatory compliance']).toBe('compliance');
      expect(SYNONYM_MERGES['policy compliance']).toBe('compliance');
      expect(SYNONYM_MERGES['data protection officer']).toBe('data protection');
      expect(SYNONYM_MERGES['data protection impact assessment']).toBe('data protection');
      expect(SYNONYM_MERGES['information security policy']).toBe('information security');
      expect(SYNONYM_MERGES['ISO 27001:2022']).toBe('ISO 27001');
      expect(SYNONYM_MERGES['Cyber Essentials']).toBe('Cyber Essentials Plus');
    });

    it('has exactly 10 merge rules', () => {
      expect(Object.keys(SYNONYM_MERGES)).toHaveLength(10);
    });
  });
});

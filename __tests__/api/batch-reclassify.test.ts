import { describe, it, expect } from 'vitest';
import { canonicalise } from '@/lib/entities/entity-dedup';

// ── Constants copied from scripts/batch_reclassify.ts ──
// These must stay in sync with the source script. If the script changes,
// update these constants and the tests accordingly.

// Garbled keyword pattern: same word repeated 3+ times with hyphens
const GARBLED_KEYWORD_REGEX = /(\b\w+(?:-\w+)*)\1{2,}|(\b\w+\b)(?:-\2){2,}/;

// Editorial note patterns in content
const EDITORIAL_NOTE_PATTERNS = [
  /^N\.?B\.?\s/i,
  /^MAKE\s+SURE/i,
  /^TODO\s*:/i,
  /^NOTE\s*:/i,
  /^IMPORTANT\s*:/i,
  /^FIXME\s*:/i,
  /^\[.*EDITORIAL.*\]/i,
  /^ACTION\s*:/i,
  /^REMINDER\s*:/i,
];

// Content type priority ordering
const CONTENT_TYPE_PRIORITY = [
  'q_a_pair',
  'case_study',
  'policy',
  'certification',
  'capability',
  'product_description',
  'methodology',
  'compliance',
  'article',
  'blog',
  'pdf',
  'research',
  'note',
  'other',
];

// ── Helper functions (mirrors from script) ──

function hasGarbledKeywords(keywords: string[] | null): boolean {
  if (!keywords || keywords.length === 0) return false;
  return keywords.some((kw) => GARBLED_KEYWORD_REGEX.test(kw));
}

function hasEditorialNotes(content: string): boolean {
  const trimmed = content.trim();
  return EDITORIAL_NOTE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function contentTypeSortKey(contentType: string | null): number {
  const idx = CONTENT_TYPE_PRIORITY.indexOf(contentType ?? 'other');
  return idx === -1 ? CONTENT_TYPE_PRIORITY.length : idx;
}

// ── Tests ──

describe('batch_reclassify helpers', () => {
  describe('GARBLED_KEYWORD_REGEX', () => {
    describe('single-word repetition with hyphens (second alternative)', () => {
      it('matches a single word repeated 3 times with hyphens', () => {
        expect(GARBLED_KEYWORD_REGEX.test('cloud-cloud-cloud')).toBe(true);
      });

      it('matches "security-security-security"', () => {
        expect(GARBLED_KEYWORD_REGEX.test('security-security-security')).toBe(
          true,
        );
      });

      it('matches "data-data-data"', () => {
        expect(GARBLED_KEYWORD_REGEX.test('data-data-data')).toBe(true);
      });

      it('matches a word repeated 4+ times with hyphens', () => {
        expect(
          GARBLED_KEYWORD_REGEX.test('data-data-data-data'),
        ).toBe(true);
      });
    });

    describe('direct substring repetition (first alternative)', () => {
      it('matches a substring repeated 3+ times directly', () => {
        // "abcabcabc" = "abc" x 3, matched by (\b\w+(?:-\w+)*)\1{2,}
        expect(GARBLED_KEYWORD_REGEX.test('abcabcabc')).toBe(true);
      });
    });

    describe('non-matching patterns', () => {
      it('does not match a clean ISO standard keyword', () => {
        expect(GARBLED_KEYWORD_REGEX.test('ISO 27001')).toBe(false);
      });

      it('does not match a single hyphenated compound word', () => {
        expect(GARBLED_KEYWORD_REGEX.test('data-protection')).toBe(false);
      });

      it('does not match two occurrences (needs 3+)', () => {
        expect(
          GARBLED_KEYWORD_REGEX.test('data-data'),
        ).toBe(false);
      });

      it('does not match normal multi-word keywords', () => {
        expect(GARBLED_KEYWORD_REGEX.test('cyber security policy')).toBe(
          false,
        );
      });

      it('does not match an empty string', () => {
        expect(GARBLED_KEYWORD_REGEX.test('')).toBe(false);
      });

      // Note: multi-word hyphenated phrases repeated with hyphens are NOT
      // caught by this regex. "data-encryption-data-encryption-data-encryption"
      // does not match because the backreference requires the separator between
      // the compound words to align with the repeat boundary, which it cannot
      // when both use hyphens. This is a known limitation — the regex catches
      // the most common garbled pattern (single word repeated) but not all
      // possible garbled keywords.
      it('does not match multi-word hyphenated phrases repeated with hyphens (known limitation)', () => {
        expect(
          GARBLED_KEYWORD_REGEX.test(
            'data-encryption-data-encryption-data-encryption',
          ),
        ).toBe(false);
      });
    });
  });

  describe('hasGarbledKeywords', () => {
    it('returns false for null keywords', () => {
      expect(hasGarbledKeywords(null)).toBe(false);
    });

    it('returns false for empty array', () => {
      expect(hasGarbledKeywords([])).toBe(false);
    });

    it('returns false for clean keywords', () => {
      expect(
        hasGarbledKeywords(['ISO 27001', 'data protection', 'GDPR']),
      ).toBe(false);
    });

    it('returns true when any keyword is garbled', () => {
      expect(
        hasGarbledKeywords([
          'ISO 27001',
          'security-security-security',
          'GDPR',
        ]),
      ).toBe(true);
    });

    it('returns true when all keywords are garbled', () => {
      expect(
        hasGarbledKeywords([
          'data-data-data',
          'cloud-cloud-cloud',
        ]),
      ).toBe(true);
    });
  });

  describe('EDITORIAL_NOTE_PATTERNS', () => {
    it('matches "N.B. MAKE SURE..." (nota bene)', () => {
      expect(hasEditorialNotes('N.B. MAKE SURE this is updated')).toBe(true);
    });

    it('matches "NB " without periods', () => {
      expect(hasEditorialNotes('NB check the reference numbers')).toBe(true);
    });

    it('matches "TODO: fix this"', () => {
      expect(hasEditorialNotes('TODO: fix this section')).toBe(true);
    });

    it('matches "TODO:" without space after colon', () => {
      expect(hasEditorialNotes('TODO:update references')).toBe(true);
    });

    it('matches "NOTE: ..."', () => {
      expect(hasEditorialNotes('NOTE: this needs review')).toBe(true);
    });

    it('matches "IMPORTANT: ..."', () => {
      expect(hasEditorialNotes('IMPORTANT: do not delete')).toBe(true);
    });

    it('matches "FIXME: ..."', () => {
      expect(hasEditorialNotes('FIXME: broken formatting')).toBe(true);
    });

    it('matches "[EDITORIAL NOTE]"', () => {
      expect(hasEditorialNotes('[EDITORIAL NOTE] remove before publishing')).toBe(
        true,
      );
    });

    it('matches "ACTION: ..."', () => {
      expect(hasEditorialNotes('ACTION: complete by Friday')).toBe(true);
    });

    it('matches "REMINDER: ..."', () => {
      expect(hasEditorialNotes('REMINDER: update annually')).toBe(true);
    });

    it('matches "MAKE SURE..." at start of content', () => {
      expect(hasEditorialNotes('MAKE SURE all dates are current')).toBe(true);
    });

    it('does not match normal content about security', () => {
      expect(hasEditorialNotes('Normal content about security')).toBe(false);
    });

    it('does not match content containing "note" in the middle', () => {
      expect(
        hasEditorialNotes('Please note that ISO 27001 requires annual audits'),
      ).toBe(false);
    });

    it('does not match empty content', () => {
      expect(hasEditorialNotes('')).toBe(false);
    });

    it('does not match content with only whitespace', () => {
      expect(hasEditorialNotes('   ')).toBe(false);
    });

    it('handles leading whitespace before editorial pattern', () => {
      // The function trims before testing
      expect(hasEditorialNotes('  TODO: fix this')).toBe(true);
    });

    it('matches case-insensitively', () => {
      expect(hasEditorialNotes('todo: fix this')).toBe(true);
      expect(hasEditorialNotes('Note: check reference')).toBe(true);
      expect(hasEditorialNotes('important: review')).toBe(true);
    });
  });

  describe('contentTypeSortKey', () => {
    it('returns 0 for q_a_pair (highest priority)', () => {
      expect(contentTypeSortKey('q_a_pair')).toBe(0);
    });

    it('returns 1 for case_study', () => {
      expect(contentTypeSortKey('case_study')).toBe(1);
    });

    it('returns the last index for "other"', () => {
      expect(contentTypeSortKey('other')).toBe(
        CONTENT_TYPE_PRIORITY.length - 1,
      );
    });

    it('returns the array length for unknown content types (sorted last)', () => {
      expect(contentTypeSortKey('unknown_type')).toBe(
        CONTENT_TYPE_PRIORITY.length,
      );
    });

    it('treats null as "other"', () => {
      expect(contentTypeSortKey(null)).toBe(
        CONTENT_TYPE_PRIORITY.indexOf('other'),
      );
    });

    it('sorts q_a_pair before all other types', () => {
      const types = ['article', 'q_a_pair', 'policy', 'blog'];
      const sorted = [...types].sort(
        (a, b) => contentTypeSortKey(a) - contentTypeSortKey(b),
      );
      expect(sorted[0]).toBe('q_a_pair');
    });

    it('preserves full priority ordering when sorting', () => {
      const shuffled = [...CONTENT_TYPE_PRIORITY].reverse();
      const sorted = [...shuffled].sort(
        (a, b) => contentTypeSortKey(a) - contentTypeSortKey(b),
      );
      expect(sorted).toEqual(CONTENT_TYPE_PRIORITY);
    });
  });

  describe('canonicalise integration', () => {
    // Verify the import from @/lib/entity-dedup works and the function
    // behaves as expected — the batch_reclassify script relies on this import.

    it('normalises ISO standard names', () => {
      expect(canonicalise('ISO27001')).toBe('ISO 27001');
    });

    it('normalises Cyber Essentials variants', () => {
      expect(canonicalise('cyber essentials')).toBe('Cyber Essentials');
    });

    it('strips trailing periods from entity names', () => {
      expect(canonicalise('BSI.')).toBe('BSI');
    });

    it('strips ISO version suffixes', () => {
      expect(canonicalise('ISO 27001:2022')).toBe('ISO 27001');
    });

    it('passes through normal names unchanged', () => {
      expect(canonicalise('example-client Design')).toBe('example-client Design');
    });
  });
});

/**
 * Tests for lib/date-extraction.ts — the date extraction engine.
 *
 * Covers:
 * - UK date formats (DD/MM/YYYY, DD-MM-YYYY, DD Month YYYY, Month YYYY)
 * - ISO 8601 format (YYYY-MM-DD)
 * - Relative/contextual dates ("valid until 2027", "expires December 2026")
 * - Context classification (expiry, effective, review, publication, historical)
 * - DD/MM vs MM/DD ambiguity handling (UK default)
 * - False positive rejection (legislation, standards, versions, page numbers)
 * - Confidence scoring (high, medium, low)
 * - Edge cases (empty text, past dates, far future dates, malformed dates)
 * - Multiple dates in the same text
 * - Context snippet extraction
 * - findExpiryDate() utility
 * - extractTemporalReferences() main entry point
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractDates,
  findExpiryDate,
  extractTemporalReferences,
  classifyDateType,
  type DateExtraction,
  type TemporalReference,
} from '@/lib/date-extraction';

// ──────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────

/**
 * Find a specific extraction by its ISO date string.
 * Useful when multiple dates are extracted from a single text.
 */
function findByDate(extractions: DateExtraction[], isoDate: string): DateExtraction | undefined {
  return extractions.find((e) => e.date === isoDate);
}

// ──────────────────────────────────────────
// UK Date Formats
// ──────────────────────────────────────────

describe('extractDates', () => {
  describe('UK date formats', () => {
    it('extracts DD/MM/YYYY format', () => {
      const results = extractDates('Certificate expires 25/03/2027');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2027-03-25');
      expect(results[0].original_text).toBe('25/03/2027');
    });

    it('extracts DD-MM-YYYY format', () => {
      const results = extractDates('Valid until 15-06-2026');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2026-06-15');
    });

    it('extracts DD.MM.YYYY format', () => {
      const results = extractDates('Issued on 01.09.2025');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2025-09-01');
    });

    it('extracts DD Month YYYY format (full month)', () => {
      const results = extractDates('Expiry date: 25 March 2027');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2027-03-25');
      expect(results[0].original_text).toBe('25 March 2027');
    });

    it('extracts DD Month YYYY format (abbreviated month)', () => {
      const results = extractDates('Registered on 1 Jan 2025');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2025-01-01');
    });

    it('extracts dates with ordinal suffixes (1st, 2nd, 3rd, 4th)', () => {
      const results = extractDates('Due by 3rd February 2027');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2027-02-03');
    });

    it('extracts Month YYYY format (partial date)', () => {
      const results = extractDates('Next review: June 2026');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2026-06-01');
    });

    it('extracts Month DD, YYYY format (US-style with named month)', () => {
      const results = extractDates('Published: March 15, 2025');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2025-03-15');
    });

    it('extracts ISO 8601 YYYY-MM-DD format', () => {
      const results = extractDates('Effective date: 2026-09-01');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2026-09-01');
    });
  });

  // ──────────────────────────────────────────
  // Contextual / relative dates
  // ──────────────────────────────────────────

  describe('relative and contextual dates', () => {
    it('extracts "valid until YYYY" as expiry', () => {
      const results = extractDates('This certificate is valid until 2027');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2027-12-31');
      expect(results[0].context_type).toBe('expiry');
    });

    it('extracts "expires December 2026"', () => {
      const results = extractDates('ICO registration expires December 2026');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2026-12-01');
      expect(results[0].context_type).toBe('expiry');
    });

    it('extracts "expiry date: DD/MM/YYYY"', () => {
      const results = extractDates('Expiry date: 15/06/2026');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2026-06-15');
      expect(results[0].context_type).toBe('expiry');
    });

    it('extracts "renewal due" context', () => {
      const results = extractDates('Renewal due 01/03/2027');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('expiry');
    });
  });

  // ──────────────────────────────────────────
  // Context classification
  // ──────────────────────────────────────────

  describe('context classification', () => {
    it('classifies expiry dates with high confidence', () => {
      const results = extractDates('Certificate expires 25/03/2027');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('expiry');
      expect(results[0].confidence).toBe('high');
    });

    it('classifies review dates', () => {
      const results = extractDates('Next review date: June 2026');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('review');
    });

    it('classifies publication dates', () => {
      const results = extractDates('Published: 15/01/2025');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('publication');
    });

    it('classifies effective/issued dates', () => {
      const results = extractDates('Issued on 01/04/2024');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('effective');
    });

    it('classifies historical dates', () => {
      const results = extractDates('The company was founded in 15/06/2010');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('historical');
    });

    it('classifies "established" dates as historical', () => {
      const results = extractDates('Established 1 January 2005');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('historical');
    });

    it('classifies dates with no context as unknown', () => {
      const results = extractDates('The meeting is on 15/09/2027');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('unknown');
    });

    it('classifies "valid until" as expiry', () => {
      const results = extractDates('Valid until 15/06/2026');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('expiry');
    });

    it('classifies "due for renewal" as expiry', () => {
      const results = extractDates('Due for renewal 30 September 2026');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('expiry');
    });

    it('classifies "next audit" as review', () => {
      const results = extractDates('Next audit 15 March 2027');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('review');
    });

    it('classifies "last updated" as publication', () => {
      const results = extractDates('Last updated 10/02/2026');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('publication');
    });

    it('classifies "effective from" as effective', () => {
      const results = extractDates('Effective from 01 April 2025');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('effective');
    });
  });

  // ──────────────────────────────────────────
  // DD/MM ambiguity
  // ──────────────────────────────────────────

  describe('DD/MM vs MM/DD ambiguity', () => {
    it('parses 03/04/2027 as 3 April (UK default) with medium confidence', () => {
      const results = extractDates('The deadline is 03/04/2027');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2027-04-03'); // UK: day=3, month=4
      expect(results[0].confidence).toBe('medium');
    });

    it('parses unambiguous 25/03/2027 as 25 March with high confidence when keyword present', () => {
      const results = extractDates('Expires 25/03/2027');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2027-03-25');
      expect(results[0].confidence).toBe('high');
    });

    it('parses 13/06/2026 unambiguously (day > 12 must be UK)', () => {
      const results = extractDates('Date: 13/06/2026');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2026-06-13');
    });

    it('parses 06/13/2026 as month=6, day=13 (US-style detected)', () => {
      // When second number > 12, first must be month
      const results = extractDates('Date: 06/13/2026');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2026-06-13');
    });

    it('ambiguous date with expiry keyword gets medium confidence', () => {
      const results = extractDates('Certificate expires 03/04/2027');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('expiry');
      expect(results[0].confidence).toBe('medium');
    });

    it('same day and month is not ambiguous', () => {
      const results = extractDates('Expires 06/06/2027');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2027-06-06');
      expect(results[0].confidence).toBe('high'); // Same day/month — not ambiguous
    });
  });

  // ──────────────────────────────────────────
  // False positive rejection
  // ──────────────────────────────────────────

  describe('false positive rejection', () => {
    it('rejects "Data Protection Act 2018"', () => {
      const results = extractDates('Compliant with the Data Protection Act 2018.');
      expect(results).toHaveLength(0);
    });

    it('rejects "ISO 27001:2022"', () => {
      const results = extractDates('We hold ISO 27001:2022 certification.');
      expect(results).toHaveLength(0);
    });

    it('rejects "BS EN 12345:2020"', () => {
      const results = extractDates('Tested to BS EN 12345:2020 standard.');
      expect(results).toHaveLength(0);
    });

    it('rejects "v2.0" and version numbers', () => {
      const results = extractDates('System upgraded to v2.0 in the latest release.');
      expect(results).toHaveLength(0);
    });

    it('rejects "Version 3.1"', () => {
      const results = extractDates('This is Version 3.1 of the document.');
      expect(results).toHaveLength(0);
    });

    it('rejects "page 3" and page references', () => {
      const results = extractDates('See page 3 for details.');
      expect(results).toHaveLength(0);
    });

    it('rejects "section 4.2"', () => {
      const results = extractDates('As described in section 4.2 of the manual.');
      expect(results).toHaveLength(0);
    });

    it('rejects copyright notices', () => {
      const results = extractDates('Copyright 2024 Example Ltd.');
      expect(results).toHaveLength(0);
    });

    it('rejects "Regulation 2016"', () => {
      const results = extractDates('Under the General Data Protection Regulation 2016.');
      expect(results).toHaveLength(0);
    });

    it('rejects "ISO 9001" (standard number, not a year)', () => {
      const results = extractDates('We are ISO 9001 certified.');
      expect(results).toHaveLength(0);
    });

    it('still extracts real dates near false positive text', () => {
      const results = extractDates(
        'Our ISO 27001:2022 certification expires 25 March 2027.'
      );
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2027-03-25');
      expect(results[0].context_type).toBe('expiry');
    });

    it('extracts ISO date but not years from a year range in the same text', () => {
      const results = extractDates(
        'Budget period 2020-2025 and expiry 2027-03-15'
      );
      // Should extract the ISO date 2027-03-15 as expiry
      const isoDate = findByDate(results, '2027-03-15');
      expect(isoDate).toBeDefined();
      expect(isoDate!.context_type).toBe('expiry');

      // Should NOT extract 2020 or 2025 from the year range "2020-2025"
      const year2020 = findByDate(results, '2020-12-31');
      const year2025 = findByDate(results, '2025-12-31');
      expect(year2020).toBeUndefined();
      expect(year2025).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────
  // Confidence levels
  // ──────────────────────────────────────────

  describe('confidence levels', () => {
    it('assigns high confidence for explicit keyword + unambiguous date', () => {
      const results = extractDates('Certificate expires 25/03/2027');
      expect(results[0].confidence).toBe('high');
    });

    it('assigns medium confidence for keyword + ambiguous date', () => {
      const results = extractDates('Expires 03/04/2027');
      expect(results[0].confidence).toBe('medium');
    });

    it('assigns medium confidence for future date without keyword', () => {
      const results = extractDates('Some event on 25/09/2027');
      expect(results[0].confidence).toBe('medium');
    });

    it('assigns low confidence for past date without keyword', () => {
      const results = extractDates('Something happened on 15/06/2018');
      // Pre-2020 with no keyword becomes historical with low confidence
      expect(results[0].confidence).toBe('low');
    });

    it('assigns high confidence for keyword + named month (never ambiguous)', () => {
      const results = extractDates('Valid until 25 March 2027');
      expect(results[0].confidence).toBe('high');
    });

    it('assigns high confidence for keyword + partial date (Month YYYY)', () => {
      const results = extractDates('Expires December 2026');
      expect(results[0].confidence).toBe('high');
    });
  });

  // ──────────────────────────────────────────
  // Edge cases
  // ──────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty array for empty string', () => {
      expect(extractDates('')).toEqual([]);
    });

    it('returns empty array for whitespace-only string', () => {
      expect(extractDates('   \n\t  ')).toEqual([]);
    });

    it('returns empty array for text with no dates', () => {
      const results = extractDates('This is a paragraph about quality management systems and best practices.');
      expect(results).toEqual([]);
    });

    it('handles past dates correctly', () => {
      const results = extractDates('Issued on 15/06/2022');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2022-06-15');
      expect(results[0].context_type).toBe('effective');
    });

    it('marks far future dates (> 10 years) as unknown with low confidence', () => {
      const results = extractDates('Some date: 25/03/2050');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('unknown');
      expect(results[0].confidence).toBe('low');
    });

    it('rejects invalid dates like 31 February', () => {
      const results = extractDates('Date: 31/02/2027');
      expect(results).toHaveLength(0);
    });

    it('rejects invalid dates like 32 January', () => {
      const results = extractDates('Date: 32/01/2027');
      expect(results).toHaveLength(0);
    });

    it('rejects month > 12 in DD/MM format', () => {
      const results = extractDates('Date: 25/13/2027');
      expect(results).toHaveLength(0);
    });

    it('handles dates at the start of text', () => {
      const results = extractDates('25/03/2027 is the expiry date');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2027-03-25');
    });

    it('handles dates at the end of text', () => {
      const results = extractDates('Expires on 25/03/2027');
      expect(results).toHaveLength(1);
    });

    it('handles very short text with just a date', () => {
      const results = extractDates('25/03/2027');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2027-03-25');
    });

    it('does not extract dates embedded in phone numbers or IDs', () => {
      // "12345/06/2027" — the "06/2027" part should not be treated as a date
      // because of the preceding digits
      const results = extractDates('Reference number: 12345/06/2027');
      expect(results).toHaveLength(0);
    });

    it('handles text with newlines and special formatting', () => {
      const text = 'Certificate Details:\n  Expiry: 25/03/2027\n  Issued: 01/01/2025';
      const results = extractDates(text);
      expect(results).toHaveLength(2);
    });

    it('handles pre-2020 dates with expiry keyword as expiry not historical', () => {
      const results = extractDates('Certificate expired 15/06/2019');
      expect(results).toHaveLength(1);
      expect(results[0].context_type).toBe('expiry');
      // Has keyword so it is classified as expiry, not overridden to historical
    });

    it('handles September abbreviation "Sept"', () => {
      const results = extractDates('Review date: 15 Sept 2027');
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe('2027-09-15');
    });
  });

  // ──────────────────────────────────────────
  // Multiple dates
  // ──────────────────────────────────────────

  describe('multiple dates in text', () => {
    it('extracts multiple dates from the same text', () => {
      const text = 'Issued on 01/01/2025. Certificate expires 25/03/2027. Next review: June 2026.';
      const results = extractDates(text);
      expect(results.length).toBeGreaterThanOrEqual(3);

      const issued = findByDate(results, '2025-01-01');
      const expiry = findByDate(results, '2027-03-25');
      const review = findByDate(results, '2026-06-01');

      expect(issued).toBeDefined();
      expect(issued!.context_type).toBe('effective');

      expect(expiry).toBeDefined();
      expect(expiry!.context_type).toBe('expiry');

      expect(review).toBeDefined();
      expect(review!.context_type).toBe('review');
    });

    it('returns dates sorted by position in text', () => {
      const text = 'Start: 01/01/2025. Middle: 15/06/2026. End: 25/12/2027.';
      const results = extractDates(text);
      expect(results.length).toBe(3);

      // Verify sorted by position
      for (let i = 1; i < results.length; i++) {
        expect(results[i].position).toBeGreaterThan(results[i - 1].position);
      }
    });

    it('handles mixed date formats in the same text', () => {
      const text = 'Effective from 2025-01-15. Expires 25 March 2027. Review: June 2026.';
      const results = extractDates(text);
      expect(results.length).toBeGreaterThanOrEqual(3);
    });

    it('does not duplicate dates at the same position', () => {
      // "25 March 2027" should match once, not twice (from DD Month YYYY and Month DD YYYY patterns)
      const results = extractDates('Certificate expires 25 March 2027.');
      const marchDates = results.filter((r) => r.date === '2027-03-25');
      expect(marchDates).toHaveLength(1);
    });
  });

  // ──────────────────────────────────────────
  // Context snippet extraction
  // ──────────────────────────────────────────

  describe('context snippet extraction', () => {
    it('includes surrounding text in context_snippet', () => {
      const results = extractDates('Our ISO 27001 certificate expires 25 March 2027. Please renew.');
      expect(results).toHaveLength(1);
      expect(results[0].context_snippet).toContain('certificate expires');
      expect(results[0].context_snippet).toContain('25 March 2027');
    });

    it('handles dates at the start of text without leading ellipsis', () => {
      const results = extractDates('25/03/2027 is the deadline');
      expect(results[0].context_snippet).not.toMatch(/^\.\.\./);
    });

    it('adds ellipsis for truncated context', () => {
      const longText = 'A'.repeat(200) + ' expires 25/03/2027 ' + 'B'.repeat(200);
      const results = extractDates(longText);
      expect(results).toHaveLength(1);
      expect(results[0].context_snippet).toMatch(/^\.\.\./);
      expect(results[0].context_snippet).toMatch(/\.\.\.$/);
    });

    it('normalises whitespace in context snippet', () => {
      const text = 'Certificate\n  expires\n  25/03/2027\n  Please renew.';
      const results = extractDates(text);
      expect(results[0].context_snippet).not.toContain('\n');
    });
  });
});

// ──────────────────────────────────────────
// classifyDateType
// ──────────────────────────────────────────

describe('classifyDateType', () => {
  it('returns expiry for text with "expires"', () => {
    const text = 'This certificate expires on this date.';
    const pos = text.indexOf('date');
    const result = classifyDateType(text, pos, 4);
    expect(result.context_type).toBe('expiry');
    expect(result.hasKeyword).toBe(true);
  });

  it('returns review for text with "next review"', () => {
    const text = 'Next review scheduled for this date.';
    const pos = text.indexOf('date');
    const result = classifyDateType(text, pos, 4);
    expect(result.context_type).toBe('review');
    expect(result.hasKeyword).toBe(true);
  });

  it('returns effective for text with "issued on"', () => {
    const text = 'This was issued on this date originally.';
    const pos = text.indexOf('date');
    const result = classifyDateType(text, pos, 4);
    expect(result.context_type).toBe('effective');
    expect(result.hasKeyword).toBe(true);
  });

  it('returns publication for text with "published"', () => {
    const text = 'This document was published on a date.';
    const pos = text.indexOf('date');
    const result = classifyDateType(text, pos, 4);
    expect(result.context_type).toBe('publication');
    expect(result.hasKeyword).toBe(true);
  });

  it('returns historical for text with "established"', () => {
    const text = 'The organisation was established around this date.';
    const pos = text.indexOf('date');
    const result = classifyDateType(text, pos, 4);
    expect(result.context_type).toBe('historical');
    expect(result.hasKeyword).toBe(true);
  });

  it('returns unknown when no keywords present', () => {
    const text = 'Something will happen on this date.';
    const pos = text.indexOf('date');
    const result = classifyDateType(text, pos, 4);
    expect(result.context_type).toBe('unknown');
    expect(result.hasKeyword).toBe(false);
  });
});

// ──────────────────────────────────────────
// findExpiryDate
// ──────────────────────────────────────────

describe('findExpiryDate', () => {
  it('returns the earliest future expiry date', () => {
    const dates: DateExtraction[] = [
      {
        date: '2028-06-15',
        original_text: '15/06/2028',
        context_type: 'expiry',
        confidence: 'high',
        position: 0,
        context_snippet: 'Expires 15/06/2028',
      },
      {
        date: '2027-03-25',
        original_text: '25/03/2027',
        context_type: 'expiry',
        confidence: 'high',
        position: 50,
        context_snippet: 'Expires 25/03/2027',
      },
    ];

    const result = findExpiryDate(dates);
    expect(result).toBe('2027-03-25'); // Earliest
  });

  it('returns null when no expiry dates found', () => {
    const dates: DateExtraction[] = [
      {
        date: '2027-03-25',
        original_text: '25/03/2027',
        context_type: 'publication',
        confidence: 'high',
        position: 0,
        context_snippet: 'Published 25/03/2027',
      },
    ];

    expect(findExpiryDate(dates)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(findExpiryDate([])).toBeNull();
  });

  it('ignores low confidence expiry dates', () => {
    const dates: DateExtraction[] = [
      {
        date: '2027-03-25',
        original_text: '25/03/2027',
        context_type: 'expiry',
        confidence: 'low',
        position: 0,
        context_snippet: '25/03/2027',
      },
    ];

    expect(findExpiryDate(dates)).toBeNull();
  });

  it('ignores past expiry dates', () => {
    const dates: DateExtraction[] = [
      {
        date: '2020-01-01',
        original_text: '01/01/2020',
        context_type: 'expiry',
        confidence: 'high',
        position: 0,
        context_snippet: 'Expired 01/01/2020',
      },
    ];

    expect(findExpiryDate(dates)).toBeNull();
  });

  it('accepts medium confidence expiry dates', () => {
    const dates: DateExtraction[] = [
      {
        date: '2028-06-15',
        original_text: '15/06/2028',
        context_type: 'expiry',
        confidence: 'medium',
        position: 0,
        context_snippet: 'Expires 15/06/2028',
      },
    ];

    expect(findExpiryDate(dates)).toBe('2028-06-15');
  });
});

// ──────────────────────────────────────────
// extractTemporalReferences
// ──────────────────────────────────────────

describe('extractTemporalReferences', () => {
  it('returns simplified TemporalReference format', () => {
    const results = extractTemporalReferences('Certificate expires 25/03/2027');
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('date', '2027-03-25');
    expect(results[0]).toHaveProperty('type', 'expiry');
    expect(results[0]).toHaveProperty('confidence', 'high');
    expect(results[0]).toHaveProperty('context');
    // Should NOT have the DateExtraction-specific fields
    expect(results[0]).not.toHaveProperty('original_text');
    expect(results[0]).not.toHaveProperty('position');
    expect(results[0]).not.toHaveProperty('context_snippet');
  });

  it('returns empty array for no dates', () => {
    expect(extractTemporalReferences('No dates here')).toEqual([]);
  });

  it('returns multiple temporal references', () => {
    const text = 'Issued: 01/01/2025. Expires: 25/03/2027.';
    const results = extractTemporalReferences(text);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});

// ──────────────────────────────────────────
// Real-world document scenarios
// ──────────────────────────────────────────

describe('real-world document scenarios', () => {
  it('extracts dates from a certificate-style document', () => {
    const text = `
      ISO 27001 Certificate of Registration
      Certificate Number: IS 12345
      Date of Initial Registration: 15 March 2022
      Valid Until: 14 March 2025
      Next Surveillance Audit: September 2023
    `;
    const results = extractDates(text);

    const registration = findByDate(results, '2022-03-15');
    expect(registration).toBeDefined();
    expect(registration!.context_type).toBe('effective');

    const expiry = findByDate(results, '2025-03-14');
    expect(expiry).toBeDefined();
    expect(expiry!.context_type).toBe('expiry');

    // September 2023 should be extracted (review context from "audit")
    const audit = findByDate(results, '2023-09-01');
    expect(audit).toBeDefined();
    expect(audit!.context_type).toBe('review');
  });

  it('extracts dates from a Q&A pair about registration', () => {
    const text = `
      Q: When does our ICO registration expire?
      A: Our ICO registration (reference ZA123456) expires on 15/06/2026.
      The registration was originally obtained on 15/06/2023 and is renewed annually.
    `;
    const results = extractDates(text);

    const expiry = findByDate(results, '2026-06-15');
    expect(expiry).toBeDefined();
    expect(expiry!.context_type).toBe('expiry');
    expect(expiry!.confidence).toBe('high');
  });

  it('handles text with both legislation references and real dates', () => {
    const text = `
      Under the Data Protection Act 2018 and UK GDPR, our ICO registration
      expires on 30 June 2026. We comply with ISO 27001:2022 requirements.
      Certificate renewal date: 15/12/2026.
    `;
    const results = extractDates(text);

    // Should NOT extract Act 2018 or ISO 27001:2022
    expect(findByDate(results, '2018-01-01')).toBeUndefined();

    // Should extract the real dates
    const icoExpiry = findByDate(results, '2026-06-30');
    expect(icoExpiry).toBeDefined();
    expect(icoExpiry!.context_type).toBe('expiry');

    const certRenewal = findByDate(results, '2026-12-15');
    expect(certRenewal).toBeDefined();
    expect(certRenewal!.context_type).toBe('expiry');
  });

  it('extracts from a policy document with multiple date types', () => {
    const text = `
      Information Security Policy
      Published: 1 January 2025
      Effective from: 1 February 2025
      Next review date: 1 January 2026
      Policy owner: IT Director
    `;
    const results = extractDates(text);

    const published = findByDate(results, '2025-01-01');
    expect(published).toBeDefined();
    expect(published!.context_type).toBe('publication');

    const effective = findByDate(results, '2025-02-01');
    expect(effective).toBeDefined();
    expect(effective!.context_type).toBe('effective');

    const review = findByDate(results, '2026-01-01');
    expect(review).toBeDefined();
    expect(review!.context_type).toBe('review');
  });
});

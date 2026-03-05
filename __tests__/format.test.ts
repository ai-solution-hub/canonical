import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatRelativeDate,
  formatDateUK,
  getDisplayTitle,
  formatSimilarity,
  formatSecondsToTimestamp,
  formatPlatform,
  formatSmartDate,
  getConfidenceDisplay,
  formatContentType,
  formatDateShort,
  formatTimeShort,
  formatDateTime,
  formatDuration,
} from '@/lib/format';

describe('formatDate', () => {
  it('should format an ISO date as "d MMM yyyy"', () => {
    expect(formatDate('2026-01-15T10:00:00Z')).toBe('15 Jan 2026');
  });

  it('should format a date-only string', () => {
    expect(formatDate('2025-12-25')).toBe('25 Dec 2025');
  });

  it('should return empty string for null', () => {
    expect(formatDate(null)).toBe('');
  });

  it('should return empty string for invalid date', () => {
    expect(formatDate('not-a-date')).toBe('');
  });
});

describe('formatRelativeDate', () => {
  it('should return a string containing "ago" for past dates', () => {
    // Use a date far in the past to ensure stability
    const result = formatRelativeDate('2020-01-01T00:00:00Z');
    expect(result).toContain('ago');
  });

  it('should return empty string for null', () => {
    expect(formatRelativeDate(null)).toBe('');
  });

  it('should return empty string for invalid date', () => {
    expect(formatRelativeDate('garbage')).toBe('');
  });
});

describe('formatDateUK', () => {
  it('should format a date as DD/MM/YYYY', () => {
    expect(formatDateUK('2026-02-24T12:00:00Z')).toBe('24/02/2026');
  });

  it('should handle a date-only string', () => {
    expect(formatDateUK('2025-07-04')).toBe('04/07/2025');
  });

  it('should return empty string for null', () => {
    expect(formatDateUK(null)).toBe('');
  });

  it('should return empty string for invalid date', () => {
    expect(formatDateUK('xyz')).toBe('');
  });
});

describe('getDisplayTitle', () => {
  it('should prefer suggested_title over title', () => {
    expect(
      getDisplayTitle({
        suggested_title: 'Suggested',
        title: 'Original',
        content: 'Some content',
      }),
    ).toBe('Suggested');
  });

  it('should fall back to title when suggested_title is null', () => {
    expect(
      getDisplayTitle({
        suggested_title: null,
        title: 'Original Title',
        content: 'Some content',
      }),
    ).toBe('Original Title');
  });

  it('should fall back to title when suggested_title is empty', () => {
    expect(
      getDisplayTitle({
        suggested_title: '   ',
        title: 'Fallback Title',
      }),
    ).toBe('Fallback Title');
  });

  it('should fall back to truncated content when no title fields exist', () => {
    const longContent = 'A'.repeat(100);
    const result = getDisplayTitle({ content: longContent });
    expect(result).toHaveLength(83); // 80 chars + "..."
    expect(result).toMatch(/\.\.\.$/);
  });

  it('should use full content when under 80 characters', () => {
    expect(getDisplayTitle({ content: 'Short content' })).toBe('Short content');
  });

  it('should return "Untitled" when all fields are null/empty', () => {
    expect(getDisplayTitle({})).toBe('Untitled');
    expect(
      getDisplayTitle({ suggested_title: null, title: null, content: null }),
    ).toBe('Untitled');
  });

  it('should trim whitespace from titles', () => {
    expect(getDisplayTitle({ suggested_title: '  Hello  ' })).toBe('Hello');
  });
});

describe('formatSimilarity', () => {
  it('should convert 0.93 to "93%"', () => {
    expect(formatSimilarity(0.93)).toBe('93%');
  });

  it('should convert 1.0 to "100%"', () => {
    expect(formatSimilarity(1.0)).toBe('100%');
  });

  it('should convert 0 to "0%"', () => {
    expect(formatSimilarity(0)).toBe('0%');
  });

  it('should round 0.876 to "88%"', () => {
    expect(formatSimilarity(0.876)).toBe('88%');
  });
});

describe('formatSecondsToTimestamp', () => {
  it('should format seconds under a minute as m:ss', () => {
    expect(formatSecondsToTimestamp(45)).toBe('0:45');
  });

  it('should format minutes and seconds as m:ss', () => {
    expect(formatSecondsToTimestamp(125)).toBe('2:05');
  });

  it('should format hours as h:mm:ss', () => {
    expect(formatSecondsToTimestamp(3661)).toBe('1:01:01');
  });

  it('should handle zero seconds', () => {
    expect(formatSecondsToTimestamp(0)).toBe('0:00');
  });

  it('should handle exactly one hour', () => {
    expect(formatSecondsToTimestamp(3600)).toBe('1:00:00');
  });

  it('should pad seconds and minutes in h:mm:ss format', () => {
    expect(formatSecondsToTimestamp(7205)).toBe('2:00:05');
  });
});

describe('formatPlatform', () => {
  it('should return human-friendly labels for known platforms', () => {
    expect(formatPlatform('web')).toBe('Web article');
    expect(formatPlatform('email')).toBe('Email');
    expect(formatPlatform('manual')).toBe('Manual entry');
    expect(formatPlatform('extraction')).toBe('Imported');
    expect(formatPlatform('upload')).toBe('Uploaded');
    expect(formatPlatform('other')).toBe('Other');
  });

  it('should capitalise unknown platforms as fallback', () => {
    expect(formatPlatform('custom')).toBe('Custom');
  });

  it('should return empty string for null', () => {
    expect(formatPlatform(null)).toBe('');
  });

  it('should return empty string for empty string', () => {
    expect(formatPlatform('')).toBe('');
  });
});

describe('formatContentType', () => {
  it('should convert kebab-case to Title Case', () => {
    expect(formatContentType('product-page')).toBe('Product Page');
  });

  it('should capitalise single-word types', () => {
    expect(formatContentType('article')).toBe('Article');
    expect(formatContentType('post')).toBe('Post');
  });

  it('should format underscore-separated types using display name map', () => {
    expect(formatContentType('q_a_pair')).toBe('Q&A Pair');
    expect(formatContentType('case_study')).toBe('Case Study');
    expect(formatContentType('product_description')).toBe('Product Description');
  });

  it('should format unmapped underscore types as Title Case', () => {
    expect(formatContentType('methodology')).toBe('Methodology');
    expect(formatContentType('certification')).toBe('Certification');
    expect(formatContentType('compliance')).toBe('Compliance');
    expect(formatContentType('capability')).toBe('Capability');
    expect(formatContentType('policy')).toBe('Policy');
  });

  it('should return empty string for null', () => {
    expect(formatContentType(null)).toBe('');
  });

  it('should return empty string for empty string', () => {
    expect(formatContentType('')).toBe('');
  });
});

describe('formatDateShort', () => {
  it('should format as "d MMM"', () => {
    expect(formatDateShort('2026-02-25T14:32:00Z')).toBe('25 Feb');
  });

  it('should return empty string for null', () => {
    expect(formatDateShort(null)).toBe('');
  });

  it('should return empty string for invalid date', () => {
    expect(formatDateShort('not-a-date')).toBe('');
  });
});

describe('formatTimeShort', () => {
  it('should format as "HH:mm"', () => {
    expect(formatTimeShort('2026-02-25T14:32:00Z')).toBe('14:32');
  });

  it('should return empty string for null', () => {
    expect(formatTimeShort(null)).toBe('');
  });

  it('should return empty string for invalid date', () => {
    expect(formatTimeShort('not-a-date')).toBe('');
  });
});

describe('formatDateTime', () => {
  it('should format as "d MMM HH:mm"', () => {
    expect(formatDateTime('2026-02-25T14:32:00Z')).toBe('25 Feb 14:32');
  });

  it('should return empty string for null', () => {
    expect(formatDateTime(null)).toBe('');
  });

  it('should return empty string for invalid date', () => {
    expect(formatDateTime('not-a-date')).toBe('');
  });
});

describe('formatDuration', () => {
  it('should format hours and minutes', () => {
    expect(formatDuration(4980)).toBe('1h 23m');
  });

  it('should format minutes only', () => {
    expect(formatDuration(2700)).toBe('45m');
  });

  it('should handle zero', () => {
    expect(formatDuration(0)).toBe('0m');
  });

  it('should format large durations', () => {
    expect(formatDuration(7200)).toBe('2h 0m');
  });
});

describe('formatSmartDate', () => {
  it('should return "Today" for today', () => {
    const today = new Date().toISOString();
    expect(formatSmartDate(today)).toBe('Today');
  });

  it('should return "Yesterday" for yesterday', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    expect(formatSmartDate(yesterday)).toBe('Yesterday');
  });

  it('should return absolute date for >7 days', () => {
    expect(formatSmartDate('2025-01-15T00:00:00Z')).toBe('15 Jan 2025');
  });

  it('should return empty string for null', () => {
    expect(formatSmartDate(null)).toBe('');
  });

  it('should return empty string for invalid date', () => {
    expect(formatSmartDate('not-a-date')).toBe('');
  });
});

describe('getConfidenceDisplay', () => {
  it('should return High for >= 0.8', () => {
    const result = getConfidenceDisplay(0.82);
    expect(result.label).toBe('High (82%)');
    expect(result.colourClass).toContain('success');
  });

  it('should return Medium for >= 0.5', () => {
    const result = getConfidenceDisplay(0.55);
    expect(result.label).toBe('Medium (55%)');
    expect(result.colourClass).toContain('warning');
  });

  it('should return Low for < 0.5', () => {
    const result = getConfidenceDisplay(0.3);
    expect(result.label).toBe('Low (30%)');
    expect(result.colourClass).toContain('destructive');
  });

  it('should return Unknown for null', () => {
    const result = getConfidenceDisplay(null);
    expect(result.label).toBe('Unknown');
    expect(result.colourClass).toContain('muted');
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  parseJsonb,
  parseJsonbArray,
  toJson,
  SummaryDataSchema,
  TranscriptSegmentSchema,
  TranscriptHighlightSchema,
  DigestDomainSummarySchema,
  ThemeClusterSchema,
} from '@/lib/validation/jsonb';

describe('parseJsonb', () => {
  it('should parse valid SummaryData', () => {
    const valid = {
      executive: 'A short summary',
      detailed: 'A longer detailed summary paragraph.',
      takeaways: ['Takeaway 1', 'Takeaway 2'],
      generated_at: '2026-02-24T10:00:00.000Z',
      model: 'claude-sonnet-4-6',
      tokens_used: 1500,
    };

    const result = parseJsonb(SummaryDataSchema, valid);
    expect(result).not.toBeNull();
    expect(result?.executive).toBe('A short summary');
    expect(result?.takeaways).toHaveLength(2);
    expect(result?.tokens_used).toBe(1500);
  });

  it('should parse SummaryData with deprecated fields', () => {
    const withDeprecated = {
      executive: 'Summary',
      detailed: 'Details',
      takeaways: ['Point'],
      generated_at: '2026-01-01T00:00:00Z',
      model: 'claude-sonnet-4-6',
      one_line: 'Old one-liner',
      generated_by: 'old-model',
    };

    const result = parseJsonb(SummaryDataSchema, withDeprecated);
    expect(result).not.toBeNull();
    expect(result?.one_line).toBe('Old one-liner');
    expect(result?.generated_by).toBe('old-model');
  });

  it('should return null for invalid SummaryData (missing required fields)', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const invalid = {
      executive: 'Only executive field present',
    };

    const result = parseJsonb(SummaryDataSchema, invalid);
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should return null for null input', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = parseJsonb(SummaryDataSchema, null);
    expect(result).toBeNull();

    consoleSpy.mockRestore();
  });

  it('should allow extra fields via passthrough', () => {
    const withExtra = {
      executive: 'Summary',
      detailed: 'Details',
      takeaways: ['Point'],
      generated_at: '2026-01-01T00:00:00Z',
      model: 'claude-sonnet-4-6',
      some_future_field: 'future value',
    };

    const result = parseJsonb(SummaryDataSchema, withExtra);
    expect(result).not.toBeNull();
    // Extra field should be preserved via passthrough
    expect((result as Record<string, unknown>).some_future_field).toBe(
      'future value',
    );
  });

  it('should parse valid ThemeCluster', () => {
    const valid = {
      theme: 'AI Governance',
      item_count: 5,
      description: 'Items about AI governance and regulation',
    };

    const result = parseJsonb(ThemeClusterSchema, valid);
    expect(result).not.toBeNull();
    expect(result?.theme).toBe('AI Governance');
    expect(result?.item_count).toBe(5);
  });

  it('should return null for invalid ThemeCluster', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const invalid = {
      theme: 'Missing required fields',
    };

    const result = parseJsonb(ThemeClusterSchema, invalid);
    expect(result).toBeNull();

    consoleSpy.mockRestore();
  });

  it('should parse valid DigestDomainSummary', () => {
    const valid = {
      domain: 'AI & Emerging Tech',
      item_count: 10,
      summary: 'This week featured several AI developments.',
      top_items: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'New AI Model Released',
          content_type: 'article',
        },
      ],
      key_themes: ['model releases', 'safety'],
    };

    const result = parseJsonb(DigestDomainSummarySchema, valid);
    expect(result).not.toBeNull();
    expect(result?.domain).toBe('AI & Emerging Tech');
    expect(result?.top_items).toHaveLength(1);
    expect(result?.key_themes).toHaveLength(2);
  });

  it('should parse valid TranscriptSegment', () => {
    const valid = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      chapter_index: 0,
      title: 'Introduction',
      summary: 'The episode begins with introductions.',
      key_points: ['Point 1', 'Point 2'],
      start_seconds: 0,
      end_seconds: 300,
      start_time: '0:00',
      end_time: '5:00',
      duration_seconds: 300,
      word_count: 1500,
      read_time_minutes: 8,
    };

    const result = parseJsonb(TranscriptSegmentSchema, valid);
    expect(result).not.toBeNull();
    expect(result?.title).toBe('Introduction');
    expect(result?.chapter_index).toBe(0);
  });

  it('should parse valid TranscriptHighlight', () => {
    const valid = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      quote: 'This is a notable quote from the transcript.',
      timestamp: '5:30',
      approximate_timestamp: 330,
      chapter_index: 1,
      category: 'insight',
      significance: 'Key insight about AI development.',
      starred: false,
    };

    const result = parseJsonb(TranscriptHighlightSchema, valid);
    expect(result).not.toBeNull();
    expect(result?.quote).toBe('This is a notable quote from the transcript.');
    expect(result?.starred).toBe(false);
  });
});

describe('parseJsonbArray', () => {
  it('should parse array of valid items', () => {
    const validArray = [
      {
        theme: 'AI Safety',
        item_count: 3,
        description: 'Items about AI safety',
      },
      {
        theme: 'Business Strategy',
        item_count: 7,
        description: 'Items about strategy',
      },
    ];

    const result = parseJsonbArray(ThemeClusterSchema, validArray);
    expect(result).toHaveLength(2);
    expect(result[0].theme).toBe('AI Safety');
    expect(result[1].theme).toBe('Business Strategy');
  });

  it('should filter out invalid items from mixed array', () => {
    const mixedArray = [
      {
        theme: 'Valid Theme',
        item_count: 5,
        description: 'Valid description',
      },
      {
        theme: 'Invalid - missing item_count',
      },
      {
        theme: 'Another Valid',
        item_count: 2,
        description: 'Another description',
      },
    ];

    const result = parseJsonbArray(ThemeClusterSchema, mixedArray);
    expect(result).toHaveLength(2);
    expect(result[0].theme).toBe('Valid Theme');
    expect(result[1].theme).toBe('Another Valid');
  });

  it('should return empty array for non-array input', () => {
    expect(parseJsonbArray(ThemeClusterSchema, null)).toEqual([]);
    expect(parseJsonbArray(ThemeClusterSchema, undefined)).toEqual([]);
    expect(parseJsonbArray(ThemeClusterSchema, 'string')).toEqual([]);
    expect(parseJsonbArray(ThemeClusterSchema, 42)).toEqual([]);
    expect(parseJsonbArray(ThemeClusterSchema, {})).toEqual([]);
  });

  it('should return empty array for empty array input', () => {
    const result = parseJsonbArray(ThemeClusterSchema, []);
    expect(result).toEqual([]);
  });

  it('should return empty array when all items are invalid', () => {
    const allInvalid = [
      { theme: 'Missing fields' },
      { description: 'Also missing' },
    ];

    const result = parseJsonbArray(ThemeClusterSchema, allInvalid);
    expect(result).toEqual([]);
  });
});

describe('toJson', () => {
  it('should return the input value wrapped as Json type', () => {
    const summaryData = {
      executive: 'Summary',
      detailed: 'Details',
      takeaways: ['Point'],
      generated_at: '2026-01-01T00:00:00Z',
      model: 'claude-sonnet-4-6',
    };

    const result = toJson(summaryData);
    // toJson is a thin wrapper — the result should be the same object
    expect(result).toBe(summaryData);
  });

  it('should handle arrays', () => {
    const segments = [
      { id: '1', title: 'Chapter 1' },
      { id: '2', title: 'Chapter 2' },
    ];

    const result = toJson(segments);
    expect(result).toBe(segments);
  });

  it('should handle null', () => {
    const result = toJson(null);
    expect(result).toBeNull();
  });

  it('should handle primitive values', () => {
    expect(toJson('string')).toBe('string');
    expect(toJson(42)).toBe(42);
    expect(toJson(true)).toBe(true);
  });
});

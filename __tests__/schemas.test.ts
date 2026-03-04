import { describe, it, expect } from 'vitest';
import {
  SearchBodySchema,
  ReviewActionBodySchema,
  SummaryGenerateBodySchema,
  DigestGenerateBodySchema,
  DigestListParamsSchema,
  EmbedBodySchema,
  HighlightStarBodySchema,
  ReviewQueueParamsSchema,
  ReadMarkBodySchema,
  ItemUpdateBodySchema,
} from '@/lib/validation/schemas';

// Helper: generate a valid UUID for tests
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const INVALID_UUID = 'not-a-uuid';

describe('SearchBodySchema', () => {
  it('should accept a valid query with defaults', () => {
    const result = SearchBodySchema.safeParse({ query: 'machine learning' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query).toBe('machine learning');
      expect(result.data.threshold).toBe(0.35);
      expect(result.data.limit).toBe(20);
    }
  });

  it('should accept custom threshold and limit', () => {
    const result = SearchBodySchema.safeParse({
      query: 'AI agents',
      threshold: 0.5,
      limit: 50,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.threshold).toBe(0.5);
      expect(result.data.limit).toBe(50);
    }
  });

  it('should reject an empty query', () => {
    const result = SearchBodySchema.safeParse({ query: '' });
    expect(result.success).toBe(false);
  });

  it('should reject a query with only whitespace', () => {
    const result = SearchBodySchema.safeParse({ query: '   ' });
    expect(result.success).toBe(false);
  });

  it('should reject a missing query field', () => {
    const result = SearchBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject threshold above 1', () => {
    const result = SearchBodySchema.safeParse({
      query: 'test',
      threshold: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('should reject threshold below 0', () => {
    const result = SearchBodySchema.safeParse({
      query: 'test',
      threshold: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject limit above 100', () => {
    const result = SearchBodySchema.safeParse({ query: 'test', limit: 101 });
    expect(result.success).toBe(false);
  });

  it('should reject limit of 0', () => {
    const result = SearchBodySchema.safeParse({ query: 'test', limit: 0 });
    expect(result.success).toBe(false);
  });

  it('should trim the query string', () => {
    const result = SearchBodySchema.safeParse({ query: '  hello world  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query).toBe('hello world');
    }
  });
});

describe('ReviewActionBodySchema', () => {
  it('should accept a valid verify action', () => {
    const result = ReviewActionBodySchema.safeParse({
      item_id: VALID_UUID,
      action: 'verify',
    });
    expect(result.success).toBe(true);
  });

  it('should accept all valid action types', () => {
    const actions = ['verify', 'flag', 'skip', 'unverify'] as const;
    for (const action of actions) {
      const result = ReviewActionBodySchema.safeParse({
        item_id: VALID_UUID,
        action,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should accept flag action with details', () => {
    const result = ReviewActionBodySchema.safeParse({
      item_id: VALID_UUID,
      action: 'flag',
      flag_details: 'Wrong classification — should be compliance not security',
    });
    expect(result.success).toBe(true);
  });

  it('should reject an invalid UUID', () => {
    const result = ReviewActionBodySchema.safeParse({
      item_id: INVALID_UUID,
      action: 'verify',
    });
    expect(result.success).toBe(false);
  });

  it('should reject an invalid action', () => {
    const result = ReviewActionBodySchema.safeParse({
      item_id: VALID_UUID,
      action: 'delete',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing item_id', () => {
    const result = ReviewActionBodySchema.safeParse({ action: 'read' });
    expect(result.success).toBe(false);
  });

  it('should reject missing action', () => {
    const result = ReviewActionBodySchema.safeParse({ item_id: VALID_UUID });
    expect(result.success).toBe(false);
  });
});

describe('SummaryGenerateBodySchema', () => {
  it('should accept a valid item_id', () => {
    const result = SummaryGenerateBodySchema.safeParse({ item_id: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it('should accept item_id with force flag', () => {
    const result = SummaryGenerateBodySchema.safeParse({
      item_id: VALID_UUID,
      force: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.force).toBe(true);
    }
  });

  it('should reject an invalid UUID', () => {
    const result = SummaryGenerateBodySchema.safeParse({ item_id: 'abc123' });
    expect(result.success).toBe(false);
  });

  it('should reject missing item_id', () => {
    const result = SummaryGenerateBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should accept without force (optional field)', () => {
    const result = SummaryGenerateBodySchema.safeParse({ item_id: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.force).toBeUndefined();
    }
  });
});

describe('DigestGenerateBodySchema', () => {
  it('should apply defaults when no fields provided', () => {
    const result = DigestGenerateBodySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period_days).toBe(7);
      expect(result.data.digest_type).toBe('weekly');
    }
  });

  it('should accept custom period_days within bounds', () => {
    const result = DigestGenerateBodySchema.safeParse({ period_days: 30 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period_days).toBe(30);
    }
  });

  it('should accept all valid digest types', () => {
    for (const digestType of ['weekly', 'daily', 'custom']) {
      const result = DigestGenerateBodySchema.safeParse({
        digest_type: digestType,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject period_days above 90', () => {
    const result = DigestGenerateBodySchema.safeParse({ period_days: 91 });
    expect(result.success).toBe(false);
  });

  it('should reject period_days below 1', () => {
    const result = DigestGenerateBodySchema.safeParse({ period_days: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer period_days', () => {
    const result = DigestGenerateBodySchema.safeParse({ period_days: 7.5 });
    expect(result.success).toBe(false);
  });

  it('should reject invalid digest_type', () => {
    const result = DigestGenerateBodySchema.safeParse({
      digest_type: 'monthly',
    });
    expect(result.success).toBe(false);
  });
});

describe('DigestListParamsSchema', () => {
  it('should apply defaults when no fields provided', () => {
    const result = DigestListParamsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(0);
    }
  });

  it('should reject limit above 50', () => {
    const result = DigestListParamsSchema.safeParse({ limit: 51 });
    expect(result.success).toBe(false);
  });

  it('should reject negative offset', () => {
    const result = DigestListParamsSchema.safeParse({ offset: -1 });
    expect(result.success).toBe(false);
  });
});

describe('EmbedBodySchema', () => {
  it('should accept valid text', () => {
    const result = EmbedBodySchema.safeParse({ text: 'Some text to embed' });
    expect(result.success).toBe(true);
  });

  it('should reject empty text', () => {
    const result = EmbedBodySchema.safeParse({ text: '' });
    expect(result.success).toBe(false);
  });

  it('should reject whitespace-only text', () => {
    const result = EmbedBodySchema.safeParse({ text: '   ' });
    expect(result.success).toBe(false);
  });
});

describe('HighlightStarBodySchema', () => {
  it('should accept valid star request', () => {
    const result = HighlightStarBodySchema.safeParse({
      item_id: VALID_UUID,
      highlight_id: VALID_UUID,
      starred: true,
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid item_id UUID', () => {
    const result = HighlightStarBodySchema.safeParse({
      item_id: 'bad',
      highlight_id: VALID_UUID,
      starred: true,
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid highlight_id UUID', () => {
    const result = HighlightStarBodySchema.safeParse({
      item_id: VALID_UUID,
      highlight_id: 'bad',
      starred: false,
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing starred field', () => {
    const result = HighlightStarBodySchema.safeParse({
      item_id: VALID_UUID,
      highlight_id: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });
});

describe('ReviewQueueParamsSchema', () => {
  it('should apply default limit when no fields provided', () => {
    const result = ReviewQueueParamsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it('should accept optional filter arrays', () => {
    const result = ReviewQueueParamsSchema.safeParse({
      domain: ['AI & EMERGING TECH'],
      content_type: ['post', 'article'],
      platform: ['web'],
    });
    expect(result.success).toBe(true);
  });

  it('should reject limit above 100', () => {
    const result = ReviewQueueParamsSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });
});

describe('ReadMarkBodySchema', () => {
  it('should accept a valid mark_read action', () => {
    const result = ReadMarkBodySchema.safeParse({
      action: 'mark_read',
      item_id: VALID_UUID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe('mark_read');
      if (result.data.action === 'mark_read') {
        expect(result.data.source).toBe('manual');
      }
    }
  });

  it('should accept mark_read with custom source', () => {
    const result = ReadMarkBodySchema.safeParse({
      action: 'mark_read',
      item_id: VALID_UUID,
      source: 'review',
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.action === 'mark_read') {
      expect(result.data.source).toBe('review');
    }
  });

  it('should accept all valid sources for mark_read', () => {
    for (const source of ['manual', 'review', 'digest', 'bulk']) {
      const result = ReadMarkBodySchema.safeParse({
        action: 'mark_read',
        item_id: VALID_UUID,
        source,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should accept a valid mark_unread action', () => {
    const result = ReadMarkBodySchema.safeParse({
      action: 'mark_unread',
      item_id: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it('should accept a valid mark_bulk_read action', () => {
    const result = ReadMarkBodySchema.safeParse({
      action: 'mark_bulk_read',
      item_ids: [VALID_UUID, '660e8400-e29b-41d4-a716-446655440001'],
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.action === 'mark_bulk_read') {
      expect(result.data.source).toBe('bulk');
    }
  });

  it('should reject mark_read with invalid UUID', () => {
    const result = ReadMarkBodySchema.safeParse({
      action: 'mark_read',
      item_id: INVALID_UUID,
    });
    expect(result.success).toBe(false);
  });

  it('should reject mark_unread with invalid UUID', () => {
    const result = ReadMarkBodySchema.safeParse({
      action: 'mark_unread',
      item_id: INVALID_UUID,
    });
    expect(result.success).toBe(false);
  });

  it('should reject mark_bulk_read with empty array', () => {
    const result = ReadMarkBodySchema.safeParse({
      action: 'mark_bulk_read',
      item_ids: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject mark_bulk_read with invalid UUIDs', () => {
    const result = ReadMarkBodySchema.safeParse({
      action: 'mark_bulk_read',
      item_ids: [VALID_UUID, 'not-valid'],
    });
    expect(result.success).toBe(false);
  });

  it('should reject an invalid action', () => {
    const result = ReadMarkBodySchema.safeParse({
      action: 'delete',
      item_id: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });

  it('should reject mark_read with invalid source', () => {
    const result = ReadMarkBodySchema.safeParse({
      action: 'mark_read',
      item_id: VALID_UUID,
      source: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should discriminate between action types', () => {
    // mark_read requires item_id (singular)
    const readResult = ReadMarkBodySchema.safeParse({
      action: 'mark_read',
      item_ids: [VALID_UUID],
    });
    expect(readResult.success).toBe(false);

    // mark_bulk_read requires item_ids (plural)
    const bulkResult = ReadMarkBodySchema.safeParse({
      action: 'mark_bulk_read',
      item_id: VALID_UUID,
    });
    expect(bulkResult.success).toBe(false);
  });
});

describe('ItemUpdateBodySchema', () => {
  it('should accept a valid string field update', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'suggested_title',
      value: 'New Title',
    });
    expect(result.success).toBe(true);
  });

  it('should accept a valid array field update (ai_keywords)', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'ai_keywords',
      value: ['machine learning', 'AI', 'agents'],
    });
    expect(result.success).toBe(true);
  });

  it('should accept null value for clearing a field', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'secondary_domain',
      value: null,
    });
    expect(result.success).toBe(true);
  });

  it('should accept all valid editable fields', () => {
    const fields = [
      'suggested_title',
      'ai_keywords',
      'primary_domain',
      'primary_subtopic',
      'secondary_domain',
      'secondary_subtopic',
      'ai_summary',
      'author_name',
      'content_type',
      'platform',
    ];
    for (const field of fields) {
      const result = ItemUpdateBodySchema.safeParse({
        field,
        value: 'test',
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject an invalid field name', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'id',
      value: 'bad',
    });
    expect(result.success).toBe(false);
  });

  it('should reject dangerous field names', () => {
    for (const field of ['embedding', 'created_at', 'content', 'metadata']) {
      const result = ItemUpdateBodySchema.safeParse({
        field,
        value: 'test',
      });
      expect(result.success).toBe(false);
    }
  });

  it('should reject missing field', () => {
    const result = ItemUpdateBodySchema.safeParse({ value: 'test' });
    expect(result.success).toBe(false);
  });

  it('should reject missing value', () => {
    const result = ItemUpdateBodySchema.safeParse({ field: 'suggested_title' });
    expect(result.success).toBe(false);
  });

  it('should reject string values over 5000 characters', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'ai_summary',
      value: 'x'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it('should accept string values at exactly 5000 characters', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'ai_summary',
      value: 'x'.repeat(5000),
    });
    expect(result.success).toBe(true);
  });
});

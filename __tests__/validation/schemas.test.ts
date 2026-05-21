import { describe, it, expect } from 'vitest';
import {
  SearchBodySchema,
  ReviewActionBodySchema,
  SummaryGenerateBodySchema,
  ChangeReportGenerateBodySchema,
  ChangeReportListParamsSchema,
  EmbedBodySchema,
  ReviewQueueParamsSchema,
  ReadMarkBodySchema,
  ItemCreateBodySchema,
  ItemUpdateBodySchema,
  KBIntegrationBodySchema,
  ActivityParamsSchema,
  QualityFlagsParamsSchema,
  PipelineRunsParamsSchema,
  ProcurementListParamsSchema,
  GovernanceReviewParamsSchema,
  CoverageGapsParamsSchema,
  ContentSuggestionsParamsSchema,
  WorkspaceItemsParamsSchema,
  EntityCoOccurrenceParamsSchema,
} from '@/lib/validation/schemas';
import { IngestUrlBodySchema } from '@/lib/validation/ingest-schemas';

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

  it('should clamp limit above 100 to 100', () => {
    const result = SearchBodySchema.safeParse({ query: 'test', limit: 101 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(100);
    }
  });

  it('should clamp limit of 0 to 1', () => {
    const result = SearchBodySchema.safeParse({ query: 'test', limit: 0 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(1);
    }
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

describe('ChangeReportGenerateBodySchema', () => {
  it('should apply defaults when no fields provided', () => {
    const result = ChangeReportGenerateBodySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period_days).toBe(7);
      expect(result.data.frequency).toBe('weekly');
    }
  });

  it('should accept custom period_days within bounds', () => {
    const result = ChangeReportGenerateBodySchema.safeParse({ period_days: 30 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period_days).toBe(30);
    }
  });

  it('should accept all valid digest types', () => {
    for (const digestType of ['weekly', 'daily', 'custom']) {
      const result = ChangeReportGenerateBodySchema.safeParse({
        frequency: digestType,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject period_days above 90', () => {
    const result = ChangeReportGenerateBodySchema.safeParse({ period_days: 91 });
    expect(result.success).toBe(false);
  });

  it('should reject period_days below 1', () => {
    const result = ChangeReportGenerateBodySchema.safeParse({ period_days: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer period_days', () => {
    const result = ChangeReportGenerateBodySchema.safeParse({ period_days: 7.5 });
    expect(result.success).toBe(false);
  });

  it('should reject invalid frequency', () => {
    const result = ChangeReportGenerateBodySchema.safeParse({
      frequency: 'monthly',
    });
    expect(result.success).toBe(false);
  });
});

describe('ChangeReportListParamsSchema', () => {
  it('should apply defaults when no fields provided', () => {
    const result = ChangeReportListParamsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(0);
    }
  });

  it('should clamp limit above 50 to 50', () => {
    const result = ChangeReportListParamsSchema.safeParse({ limit: 51 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
    }
  });

  it('should clamp negative offset to 0', () => {
    const result = ChangeReportListParamsSchema.safeParse({ offset: -1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.offset).toBe(0);
    }
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

describe('ReviewQueueParamsSchema', () => {
  it('should apply default limit and offset when no fields provided', () => {
    const result = ReviewQueueParamsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it('should accept optional filter arrays', () => {
    const result = ReviewQueueParamsSchema.safeParse({
      domain: ['SECURITY'],
      content_type: ['post', 'article'],
      platform: ['web'],
    });
    expect(result.success).toBe(true);
  });

  it('should clamp limit above 100 to 100', () => {
    const result = ReviewQueueParamsSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(100);
    }
  });

  it('should accept sort=confidence_asc', () => {
    const result = ReviewQueueParamsSchema.safeParse({
      sort: 'confidence_asc',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toBe('confidence_asc');
    }
  });

  it('should accept sort=quality_score_asc', () => {
    const result = ReviewQueueParamsSchema.safeParse({
      sort: 'quality_score_asc',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toBe('quality_score_asc');
    }
  });

  it('should accept sort=created_at', () => {
    const result = ReviewQueueParamsSchema.safeParse({ sort: 'created_at' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toBe('created_at');
    }
  });

  it('should reject invalid sort value', () => {
    const result = ReviewQueueParamsSchema.safeParse({ sort: 'invalid_sort' });
    expect(result.success).toBe(false);
  });

  it('should default sort to created_at when omitted', () => {
    const result = ReviewQueueParamsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toBe('created_at');
    }
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
    for (const source of ['manual', 'review', 'change_report', 'bulk']) {
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
      'summary',
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
    for (const field of ['embedding', 'created_at', 'metadata']) {
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
      field: 'summary',
      value: 'x'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it('should accept string values at exactly 5000 characters', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'summary',
      value: 'x'.repeat(5000),
    });
    expect(result.success).toBe(true);
  });

  // ──────────────────────────────────────────
  // S200 WP5 §5.5 Phase 1 — review cadence fields
  // ──────────────────────────────────────────

  it('should accept next_review_date with a valid ISO-8601 date string', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'next_review_date',
      value: '2027-04-27',
    });
    expect(result.success).toBe(true);
  });

  it('should reject next_review_date with a non-date string', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'next_review_date',
      value: 'not-a-date',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['value']);
      expect(result.error.issues[0]?.message).toContain('ISO-8601');
    }
  });

  it('should reject next_review_date with a logically-invalid calendar date (2026-02-30)', () => {
    // JS Date.parse('2026-02-30') silently rolls to 2026-03-02; the round-trip
    // check should reject this so the user gets a Zod error (not a delayed
    // Postgres CHECK violation).
    const result = ItemUpdateBodySchema.safeParse({
      field: 'next_review_date',
      value: '2026-02-30',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['value']);
      expect(result.error.issues[0]?.message).toContain('calendar date');
    }
  });

  it('should accept next_review_date with null (explicit clear)', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'next_review_date',
      value: null,
    });
    expect(result.success).toBe(true);
  });

  it('should reject review_cadence_days below the minimum (0)', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'review_cadence_days',
      value: '0',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['value']);
      expect(result.error.issues[0]?.message).toContain('1 and 1095');
    }
  });

  it('should reject review_cadence_days above the maximum (1096)', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'review_cadence_days',
      value: '1096',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['value']);
      expect(result.error.issues[0]?.message).toContain('1 and 1095');
    }
  });

  it('should reject review_cadence_days with a negative value', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'review_cadence_days',
      value: '-5',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['value']);
    }
  });

  it('should reject review_cadence_days with a decimal value', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'review_cadence_days',
      value: '180.5',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['value']);
    }
  });

  it('should accept review_cadence_days with null (explicit clear)', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'review_cadence_days',
      value: null,
    });
    expect(result.success).toBe(true);
  });

  it('should accept review_cadence_days with a valid integer string (180)', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'review_cadence_days',
      value: '180',
    });
    expect(result.success).toBe(true);
  });
});

// ──────────────────────────────────────────
// Category B: Parameterised clamping tests
// ──────────────────────────────────────────

/**
 * Schemas with limit fields that use .transform() clamping.
 * Each entry defines the schema, its default limit, and the allowed range.
 */
const LIMIT_CLAMPING_SCHEMAS = [
  {
    name: 'ActivityParamsSchema',
    schema: ActivityParamsSchema,
    field: 'limit',
    defaultValue: 20,
    min: 1,
    max: 100,
  },
  {
    name: 'QualityFlagsParamsSchema',
    schema: QualityFlagsParamsSchema,
    field: 'limit',
    defaultValue: 50,
    min: 1,
    max: 200,
  },
  {
    name: 'PipelineRunsParamsSchema',
    schema: PipelineRunsParamsSchema,
    field: 'limit',
    defaultValue: 20,
    min: 1,
    max: 100,
  },
  {
    name: 'ProcurementListParamsSchema',
    schema: ProcurementListParamsSchema,
    field: 'limit',
    defaultValue: 50,
    min: 1,
    max: 100,
  },
  {
    name: 'GovernanceReviewParamsSchema',
    schema: GovernanceReviewParamsSchema,
    field: 'limit',
    defaultValue: 20,
    min: 1,
    max: 100,
  },
  {
    name: 'CoverageGapsParamsSchema',
    schema: CoverageGapsParamsSchema,
    field: 'limit',
    defaultValue: 25,
    min: 1,
    max: 100,
  },
  {
    name: 'ContentSuggestionsParamsSchema',
    schema: ContentSuggestionsParamsSchema,
    field: 'limit',
    defaultValue: 5,
    min: 1,
    max: 20,
  },
  {
    name: 'WorkspaceItemsParamsSchema',
    schema: WorkspaceItemsParamsSchema,
    field: 'limit',
    defaultValue: 10,
    min: 1,
    max: 50,
  },
  {
    name: 'EntityCoOccurrenceParamsSchema',
    schema: EntityCoOccurrenceParamsSchema,
    field: 'limit',
    defaultValue: 20,
    min: 1,
    max: 50,
  },
] as const;

describe.each(LIMIT_CLAMPING_SCHEMAS)(
  '$name limit clamping',
  ({ schema, field, defaultValue, min, max }) => {
    it(`should apply default ${field} of ${defaultValue}`, () => {
      const result = schema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[field]).toBe(defaultValue);
      }
    });

    it(`should accept ${field} within range`, () => {
      const midpoint = Math.floor((min + max) / 2);
      const result = schema.safeParse({ [field]: midpoint });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[field]).toBe(midpoint);
      }
    });

    it(`should clamp ${field} above ${max} to ${max}`, () => {
      const result = schema.safeParse({ [field]: max + 1 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[field]).toBe(max);
      }
    });

    it(`should clamp ${field} of 0 to ${min}`, () => {
      const result = schema.safeParse({ [field]: 0 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[field]).toBe(min);
      }
    });

    it(`should clamp negative ${field} to ${min}`, () => {
      const result = schema.safeParse({ [field]: -10 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[field]).toBe(min);
      }
    });

    it(`should accept ${field} at exact min (${min})`, () => {
      const result = schema.safeParse({ [field]: min });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[field]).toBe(min);
      }
    });

    it(`should accept ${field} at exact max (${max})`, () => {
      const result = schema.safeParse({ [field]: max });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[field]).toBe(max);
      }
    });
  },
);

const OFFSET_CLAMPING_SCHEMAS = [
  { name: 'QualityFlagsParamsSchema', schema: QualityFlagsParamsSchema },
  { name: 'ProcurementListParamsSchema', schema: ProcurementListParamsSchema },
  {
    name: 'GovernanceReviewParamsSchema',
    schema: GovernanceReviewParamsSchema,
  },
  { name: 'CoverageGapsParamsSchema', schema: CoverageGapsParamsSchema },
] as const;

describe.each(OFFSET_CLAMPING_SCHEMAS)(
  '$name offset clamping',
  ({ schema }) => {
    it('should default offset to 0', () => {
      const result = schema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.offset).toBe(0);
      }
    });

    it('should clamp negative offset to 0', () => {
      const result = schema.safeParse({ offset: -5 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.offset).toBe(0);
      }
    });

    it('should accept positive offset', () => {
      const result = schema.safeParse({ offset: 50 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.offset).toBe(50);
      }
    });
  },
);

// ──────────────────────────────────────────
// S206 WP-A Phase 2 (AC3.3) — content_owner_id schema widening
// ──────────────────────────────────────────
//
// 5 of 6 ingest entry-point schemas accept an optional `content_owner_id`
// (admin-only override; non-admins are silent-forced route-side via
// `resolveContentOwnerId()`).
//
// EP10 (`KBIntegrationBodySchema`) is intentionally NOT widened per H-4
// fix in the impl plan: bid-outcome integration always sets
// `content_owner_id = user.id` route-side. Adding the field to the schema
// would suggest admin-override semantics that the route does not honour.

describe('S206 content_owner_id schema widening', () => {
  const VALID_OWNER_UUID = '11111111-2222-4333-8444-555555555555';
  const NON_UUID = 'not-a-uuid';

  const baseItemCreate = {
    title: 'Test',
    content: 'Some content body',
    content_type: 'note' as const,
  };

  describe('ItemCreateBodySchema (EP1)', () => {
    it('accepts an optional content_owner_id UUID', () => {
      const result = ItemCreateBodySchema.safeParse({
        ...baseItemCreate,
        content_owner_id: VALID_OWNER_UUID,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content_owner_id).toBe(VALID_OWNER_UUID);
      }
    });

    it('accepts when content_owner_id is omitted', () => {
      const result = ItemCreateBodySchema.safeParse(baseItemCreate);
      expect(result.success).toBe(true);
    });

    it('rejects a non-UUID content_owner_id', () => {
      const result = ItemCreateBodySchema.safeParse({
        ...baseItemCreate,
        content_owner_id: NON_UUID,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('IngestUrlBodySchema (EP4)', () => {
    it('accepts an optional content_owner_id UUID', () => {
      const result = IngestUrlBodySchema.safeParse({
        url: 'https://example.com/article',
        content_owner_id: VALID_OWNER_UUID,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content_owner_id).toBe(VALID_OWNER_UUID);
      }
    });

    it('rejects a non-UUID content_owner_id', () => {
      const result = IngestUrlBodySchema.safeParse({
        url: 'https://example.com/article',
        content_owner_id: NON_UUID,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('KBIntegrationBodySchema (EP10) — H-4 NOT widened', () => {
    // EP10 sets content_owner_id route-side only (peer to created_by).
    // The schema must not silently accept the field — Zod default strip
    // mode would drop it but the test confirms a non-UUID value isn't
    // flagged as an error (because the schema doesn't know about the
    // field) AND that the parsed output never contains it.
    it('strips content_owner_id from parsed output (not accepted)', () => {
      const result = KBIntegrationBodySchema.safeParse({
        integrations: [
          {
            question_id: VALID_OWNER_UUID,
            action: 'skip' as const,
          },
        ],
        content_owner_id: VALID_OWNER_UUID,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        // Field is stripped — schema does not declare it.
        expect(
          (result.data as { content_owner_id?: string }).content_owner_id,
        ).toBeUndefined();
      }
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  SearchBodySchema,
  ReviewActionBodySchema,
  SummaryGenerateBodySchema,
  EmbedBodySchema,
  ReviewQueueParamsSchema,
  ReadMarkBodySchema,
  KBIntegrationBodySchema,
  ActivityParamsSchema,
  QualityFlagsParamsSchema,
  PipelineRunsParamsSchema,
  ProcurementListParamsSchema,
  GovernanceReviewParamsSchema,
  EntityCoOccurrenceParamsSchema,
} from '@/lib/validation/schemas';
import { IngestUrlBodySchema } from '@/lib/validation/ingest-schemas';
import type { EditIntent } from '@/lib/edit-intent/arbitrate';

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

  // ID-144.6 (OBS-4 fix): kind/domain/subtopic/dateFrom/dateTo must be
  // RETAINED (previously silently stripped by Zod, so BI-16 filters never
  // reached the server).
  it('retains kind/dateFrom/dateTo and strips the retired domain/subtopic keys (DR-130)', () => {
    const result = SearchBodySchema.safeParse({
      query: 'test',
      kind: 'document',
      domain: 'finance',
      subtopic: 'invoicing',
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-06-30T23:59:59.999Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('document');
      // Legacy domain/subtopic keys from a stale client are silently
      // stripped — the subject-axis filters retired with DR-130.
      expect(result.data).not.toHaveProperty('domain');
      expect(result.data).not.toHaveProperty('subtopic');
      expect(result.data.dateFrom).toBe('2026-01-01T00:00:00.000Z');
      expect(result.data.dateTo).toBe('2026-06-30T23:59:59.999Z');
    }
  });

  it('should accept all three kind enum values', () => {
    for (const kind of ['answer', 'document', 'reference'] as const) {
      const result = SearchBodySchema.safeParse({ query: 'test', kind });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.kind).toBe(kind);
      }
    }
  });

  it('should default kind/dateFrom/dateTo to undefined when omitted', () => {
    const result = SearchBodySchema.safeParse({ query: 'test' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBeUndefined();
      expect(result.data.dateFrom).toBeUndefined();
      expect(result.data.dateTo).toBeUndefined();
    }
  });

  it('should reject an invalid kind enum value', () => {
    const result = SearchBodySchema.safeParse({
      query: 'test',
      kind: 'bogus-kind',
    });
    expect(result.success).toBe(false);
  });

  // TECH §2.5 as amended S460: the sole shipped caller is the native
  // <input type="date"> in corpus-search-controls.tsx, which emits bare
  // YYYY-MM-DD (no time component) via e.target.value. A Z-suffixed-only
  // schema rejected that shape and 400'd the whole /api/search request the
  // moment a user picked a date — a real regression vs. the old silent
  // strip. The schema now accepts EITHER shape; boundary normalisation to
  // UTC day-start/day-end happens in the route, not here.
  it('should accept a bare YYYY-MM-DD dateFrom and dateTo', () => {
    const result = SearchBodySchema.safeParse({
      query: 'test',
      dateFrom: '2026-01-01',
      dateTo: '2026-06-30',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dateFrom).toBe('2026-01-01');
      expect(result.data.dateTo).toBe('2026-06-30');
    }
  });

  it('should reject an offsetted (non-Z) datetime for dateFrom and dateTo', () => {
    const from = SearchBodySchema.safeParse({
      query: 'test',
      dateFrom: '2026-01-01T00:00:00.000+01:00',
    });
    expect(from.success).toBe(false);

    const to = SearchBodySchema.safeParse({
      query: 'test',
      dateTo: '2026-01-01T00:00:00.000+01:00',
    });
    expect(to.success).toBe(false);
  });

  it('should reject a malformed dateFrom or dateTo string', () => {
    const badFrom = SearchBodySchema.safeParse({
      query: 'test',
      dateFrom: 'not-a-date',
    });
    expect(badFrom.success).toBe(false);

    const badTo = SearchBodySchema.safeParse({
      query: 'test',
      dateTo: 'not-a-date',
    });
    expect(badTo.success).toBe(false);
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

  // ID-152 (owner ruling Option B): owner_kind discriminator for the
  // polymorphic {source_document, q_a_pair} existence lookup.
  it('should accept omitted owner_kind (back-compat default path)', () => {
    const result = ReviewActionBodySchema.safeParse({
      item_id: VALID_UUID,
      action: 'verify',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.owner_kind).toBeUndefined();
    }
  });

  it('should accept an explicit owner_kind of source_document or q_a_pair', () => {
    for (const owner_kind of ['source_document', 'q_a_pair'] as const) {
      const result = ReviewActionBodySchema.safeParse({
        item_id: VALID_UUID,
        action: 'verify',
        owner_kind,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.owner_kind).toBe(owner_kind);
      }
    }
  });

  it('should reject an invalid owner_kind', () => {
    const result = ReviewActionBodySchema.safeParse({
      item_id: VALID_UUID,
      action: 'verify',
      owner_kind: 'reference_item',
    });
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

  it('should reject the retired sort=confidence_asc (id-417 / DR-130)', () => {
    const result = ReviewQueueParamsSchema.safeParse({
      sort: 'confidence_asc',
    });
    expect(result.success).toBe(false);
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

// (ItemUpdateBodySchema tests removed — id-417: the schema was deleted with
// the retired /api/items routes.)

describe('PipelineRunsParamsSchema status filter (ID-76)', () => {
  it.each([
    'running',
    'in_progress',
    'completed',
    'completed_with_errors',
    'failed',
    'cancelled',
  ] as const)('accepts status=%s', (status) => {
    const result = PipelineRunsParamsSchema.safeParse({ status });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(status);
    }
  });

  it('rejects an unknown status value', () => {
    const result = PipelineRunsParamsSchema.safeParse({
      status: 'not_a_real_status',
    });
    expect(result.success).toBe(false);
  });

  it('treats status as optional (omitted → undefined)', () => {
    const result = PipelineRunsParamsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBeUndefined();
    }
  });
});

const OFFSET_CLAMPING_SCHEMAS = [
  { name: 'QualityFlagsParamsSchema', schema: QualityFlagsParamsSchema },
  { name: 'ProcurementListParamsSchema', schema: ProcurementListParamsSchema },
  {
    name: 'GovernanceReviewParamsSchema',
    schema: GovernanceReviewParamsSchema,
  },
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

  // (ItemCreateBodySchema (EP1) block removed — id-417: schema deleted.)

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

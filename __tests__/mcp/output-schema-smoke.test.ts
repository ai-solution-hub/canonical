/**
 * Smoke tests for MCP `outputSchema` scaffold (R-WP20).
 *
 * Verifies that the Zod schemas registered as `outputSchema` on 5 high-usage
 * MCP tools correctly accept known-good payloads and reject known-bad ones.
 *
 * The 5 tools covered (selected by test-hit-count audit + TECH.md §WP-E):
 *   1. search_knowledge_base  — SearchResponseSchema
 *   2. search_content_chunks  — ChunkSearchResponseSchema
 *   3. get_governance_queue   — GovernanceQueueResponseSchema
 *   4. review_governance_item — GovernanceReviewActionResultSchema
 *   5. get_change_report      — ChangeReportDataSchema
 *
 * Test philosophy: assertions exercise the exported Zod schemas through their
 * `.safeParse()` public API — the same pathway the MCP SDK uses at runtime.
 * We do NOT reach into the tool handler internals; we assert on the schema's
 * parse outcomes, which are the observable contract for downstream consumers.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { SearchResponseSchema, ChunkSearchResponseSchema } from '@/lib/mcp/formatters/search';
import {
  GovernanceQueueResponseSchema,
  GovernanceReviewActionResultSchema,
} from '@/lib/mcp/formatters/governance';
import { ChangeReportDataSchema } from '@/lib/mcp/formatters/change-report';

// ---------------------------------------------------------------------------
// Fixture factories — minimal valid objects for each schema
// ---------------------------------------------------------------------------

function makeSearchResponse(overrides: Partial<z.infer<typeof SearchResponseSchema>> = {}): z.infer<typeof SearchResponseSchema> {
  return {
    query: 'ISO certification',
    offset: 0,
    count: 1,
    has_more: false,
    results: [
      {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        title: 'ISO 9001 Overview',
        suggested_title: null,
        content_type: 'article',
        primary_domain: 'compliance',
        primary_subtopic: null,
        summary: 'An overview of ISO 9001 requirements.',
        similarity: 0.87,
      },
    ],
    ...overrides,
  };
}

function makeChunkSearchResponse(overrides: Partial<z.infer<typeof ChunkSearchResponseSchema>> = {}): z.infer<typeof ChunkSearchResponseSchema> {
  return {
    query: 'risk assessment',
    count: 1,
    content_item_id: null,
    overdue_review_filter: null,
    review_due_within_days_filter: null,
    visibility_filter: 'default',
    results: [
      {
        chunk_id: 'c1c2c3c4-1111-2222-3333-444455556666',
        content_item_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        item_title: 'Health and Safety Policy',
        item_suggested_title: null,
        item_content_type: 'policy',
        item_primary_domain: 'compliance',
        item_primary_subtopic: 'health-and-safety',
        heading_text: 'Risk Assessment',
        heading_level: 2,
        heading_path: ['Health and Safety Policy', 'Risk Assessment'],
        content: 'The following risk assessment process applies...',
        position: 3,
        char_count: 512,
        word_count: 87,
        similarity: 0.91,
      },
    ],
    ...overrides,
  };
}

function makeGovernanceQueueResponse(overrides: Partial<z.infer<typeof GovernanceQueueResponseSchema>> = {}): z.infer<typeof GovernanceQueueResponseSchema> {
  return {
    items: [
      {
        id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
        title: 'GDPR Data Retention Policy',
        suggested_title: null,
        primary_domain: 'compliance',
        governance_review_status: 'pending',
        governance_review_due: '2026-06-01T00:00:00.000Z',
        governance_reviewer_id: null,
        updated_by: 'e1f2a3b4-c5d6-7890-ef12-34567890abcd',
        updated_at: '2026-05-10T14:30:00.000Z',
      },
    ],
    total: 1,
    offset: 0,
    limit: 20,
    domain_filter: null,
    publication_status_filter: null,
    review_status_filter: ['pending', 'review_overdue'],
    ...overrides,
  };
}

function makeGovernanceReviewResult(overrides: Partial<z.infer<typeof GovernanceReviewActionResultSchema>> = {}): z.infer<typeof GovernanceReviewActionResultSchema> {
  return {
    item_id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    title: 'GDPR Data Retention Policy',
    action: 'approve',
    new_status: 'approved',
    reviewer_id: 'e1f2a3b4-c5d6-7890-ef12-34567890abcd',
    notes: null,
    ...overrides,
  };
}

function makeChangeReportData(overrides: Partial<z.infer<typeof ChangeReportDataSchema>> = {}): z.infer<typeof ChangeReportDataSchema> {
  return {
    period_days: 7,
    start_date: '2026-05-11T00:00:00.000Z',
    end_date: '2026-05-18T00:00:00.000Z',
    domain: null,
    keywords: null,
    additions: {
      count: 2,
      items: [
        {
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          title: 'New Policy Document',
          primary_domain: 'compliance',
          content_type: 'policy',
          date: '2026-05-15T10:00:00.000Z',
        },
        {
          id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
          title: null,
          primary_domain: null,
          content_type: null,
          date: '2026-05-14T09:00:00.000Z',
        },
      ],
    },
    updates: { count: 0, items: [] },
    removals: { count: 0, items: [] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. search_knowledge_base — SearchResponseSchema
// ---------------------------------------------------------------------------

describe('SearchResponseSchema (search_knowledge_base outputSchema)', () => {
  it('accepts a valid search response payload', () => {
    const result = SearchResponseSchema.safeParse(makeSearchResponse());
    expect(result.success).toBe(true);
  });

  it('accepts a payload with all nullable fields set to null', () => {
    const result = SearchResponseSchema.safeParse(
      makeSearchResponse({
        results: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            title: null,
            suggested_title: null,
            content_type: null,
            primary_domain: null,
            primary_subtopic: null,
            summary: null,
            similarity: 0.65,
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a payload with has_more=true and multiple results', () => {
    const result = SearchResponseSchema.safeParse(
      makeSearchResponse({
        count: 2,
        has_more: true,
        results: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            title: 'Item A',
            suggested_title: null,
            content_type: 'article',
            primary_domain: 'compliance',
            primary_subtopic: null,
            summary: null,
            similarity: 0.9,
          },
          {
            id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
            title: 'Item B',
            suggested_title: 'Item B (suggested)',
            content_type: 'q_a_pair',
            primary_domain: 'security',
            primary_subtopic: 'access-control',
            summary: 'An answer about access control.',
            similarity: 0.82,
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a payload where similarity is a string instead of number', () => {
    const bad = makeSearchResponse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bad.results[0] as any).similarity = 'high';
    const result = SearchResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('similarity');
    }
  });

  it('rejects a payload missing the required results field', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad: any = { query: 'test', offset: 0, count: 0, has_more: false };
    const result = SearchResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects a payload where has_more is not a boolean', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad: any = { ...makeSearchResponse(), has_more: 'yes' };
    const result = SearchResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. search_content_chunks — ChunkSearchResponseSchema
// ---------------------------------------------------------------------------

describe('ChunkSearchResponseSchema (search_content_chunks outputSchema)', () => {
  it('accepts a valid chunk search response payload', () => {
    const result = ChunkSearchResponseSchema.safeParse(makeChunkSearchResponse());
    expect(result.success).toBe(true);
  });

  it('accepts a payload with content_item_id filter set', () => {
    const result = ChunkSearchResponseSchema.safeParse(
      makeChunkSearchResponse({
        content_item_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a payload with review-cadence filters set', () => {
    const result = ChunkSearchResponseSchema.safeParse(
      makeChunkSearchResponse({
        overdue_review_filter: true,
        review_due_within_days_filter: 30,
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a chunk with nullable heading fields', () => {
    const payload = makeChunkSearchResponse();
    payload.results[0].heading_text = null;
    payload.results[0].heading_level = null;
    payload.results[0].heading_path = null;
    const result = ChunkSearchResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects a payload where chunk_id is missing', () => {
    const bad = makeChunkSearchResponse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (bad.results[0] as any).chunk_id;
    const result = ChunkSearchResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects a payload where similarity is undefined on a chunk', () => {
    const bad = makeChunkSearchResponse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (bad.results[0] as any).similarity;
    const result = ChunkSearchResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. get_governance_queue — GovernanceQueueResponseSchema
// ---------------------------------------------------------------------------

describe('GovernanceQueueResponseSchema (get_governance_queue outputSchema)', () => {
  it('accepts a valid governance queue response', () => {
    const result = GovernanceQueueResponseSchema.safeParse(
      makeGovernanceQueueResponse(),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a response with publication_status_filter set', () => {
    const result = GovernanceQueueResponseSchema.safeParse(
      makeGovernanceQueueResponse({ publication_status_filter: 'in_review' }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a response with domain_filter set', () => {
    const result = GovernanceQueueResponseSchema.safeParse(
      makeGovernanceQueueResponse({ domain_filter: 'compliance' }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts an empty items array (no items pending review)', () => {
    const result = GovernanceQueueResponseSchema.safeParse(
      makeGovernanceQueueResponse({
        items: [],
        total: 0,
        review_status_filter: ['pending'],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing review_status_filter', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad: any = { ...makeGovernanceQueueResponse() };
    delete bad.review_status_filter;
    const result = GovernanceQueueResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects a payload where total is a string', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad: any = { ...makeGovernanceQueueResponse(), total: 'many' };
    const result = GovernanceQueueResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. review_governance_item — GovernanceReviewActionResultSchema
// ---------------------------------------------------------------------------

describe('GovernanceReviewActionResultSchema (review_governance_item outputSchema)', () => {
  it('accepts a valid approve action result', () => {
    const result = GovernanceReviewActionResultSchema.safeParse(
      makeGovernanceReviewResult(),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a request_changes result with notes', () => {
    const result = GovernanceReviewActionResultSchema.safeParse(
      makeGovernanceReviewResult({
        action: 'request_changes',
        new_status: 'pending',
        notes: 'Please clarify the retention period.',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a revert action result with null notes', () => {
    const result = GovernanceReviewActionResultSchema.safeParse(
      makeGovernanceReviewResult({ action: 'revert', notes: null }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a payload where action is an unknown verb', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad: any = { ...makeGovernanceReviewResult(), action: 'reject' };
    const result = GovernanceReviewActionResultSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('action');
    }
  });

  it('rejects a payload missing item_id', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad: any = { ...makeGovernanceReviewResult() };
    delete bad.item_id;
    const result = GovernanceReviewActionResultSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. get_change_report — ChangeReportDataSchema
// ---------------------------------------------------------------------------

describe('ChangeReportDataSchema (get_change_report outputSchema)', () => {
  it('accepts a valid change report payload', () => {
    const result = ChangeReportDataSchema.safeParse(makeChangeReportData());
    expect(result.success).toBe(true);
  });

  it('accepts a report with domain and keyword filters set', () => {
    const result = ChangeReportDataSchema.safeParse(
      makeChangeReportData({
        domain: 'compliance',
        keywords: ['GDPR', 'retention'],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a report where all three buckets contain items', () => {
    const item = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      title: 'Policy Update',
      primary_domain: 'compliance',
      content_type: 'policy',
      date: '2026-05-15T10:00:00.000Z',
    };
    const result = ChangeReportDataSchema.safeParse(
      makeChangeReportData({
        additions: { count: 1, items: [item] },
        updates: { count: 1, items: [item] },
        removals: { count: 1, items: [item] },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a ChangeReportItem with nullable fields set to null', () => {
    const result = ChangeReportDataSchema.safeParse(
      makeChangeReportData({
        additions: {
          count: 1,
          items: [
            {
              id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              title: null,
              primary_domain: null,
              content_type: null,
              date: '2026-05-15T10:00:00.000Z',
            },
          ],
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a payload where period_days is not a number', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad: any = { ...makeChangeReportData(), period_days: 'seven' };
    const result = ChangeReportDataSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('period_days');
    }
  });

  it('rejects a payload where an additions item is missing the date field', () => {
    const bad = makeChangeReportData();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (bad.additions.items[0] as any).date;
    const result = ChangeReportDataSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

/**
 * Review Queue API — sort parameter, quality_score, and assigned_to_me tests.
 *
 * Tests server-side sorting by confidence and quality score,
 * verifies quality_score is included in the response,
 * and tests the assigned_to_me filter intersection logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createMockSupabaseClient,
  configureRole,
} from '../../helpers/mock-supabase';
import { createTestRequest } from '../../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handler under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { GET as getQueue } from '@/app/api/review/queue/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';

/**
 * Create a NextRequest with multi-value searchParams support.
 * The standard createTestRequest only supports single-value params via .set().
 * This helper uses .append() so keys like domain can appear multiple times.
 */
function createMultiParamRequest(
  path: string,
  params: [string, string][],
): NextRequest {
  const url = new URL(path, 'http://localhost:3000');
  for (const [key, value] of params) {
    url.searchParams.append(key, value);
  }
  return new NextRequest(url, { method: 'GET' });
}

function makeMockItem(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID,
    title: 'Test Item',
    suggested_title: 'Suggested Title',
    summary: 'A summary',
    primary_domain: 'Technology',
    primary_subtopic: 'AI',
    secondary_domain: null,
    secondary_subtopic: null,
    content_type: 'article',
    platform: 'web',
    author_name: 'Author',
    source_domain: 'example.com',
    thumbnail_url: null,
    captured_date: '2026-01-01',
    ai_keywords: ['test'],
    classification_confidence: 0.9,
    quality_score: 72,
    priority: 'medium',
    user_tags: [],
    metadata: null,
    content: 'Some content',
    source_url: 'https://example.com',
    verified_at: null,
    verified_by: null,
    freshness: 'fresh',
    governance_review_status: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainableMethods = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'is',
    'not',
    'ilike',
    'contains',
    'gte',
    'lte',
    'gt',
    'lt',
    'or',
    'order',
    'limit',
    'range',
  ] as const;
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/review/queue — sort parameter', () => {
  beforeEach(resetMocks);

  it('defaults to created_at descending when no sort param', async () => {
    configureRole(mockSupabase, 'editor');

    const mockItems = [makeMockItem()];
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({ data: mockItems, error: null, count: 1 });
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue');
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    // Verify order was called with created_at descending
    expect(mockSupabase._chain.order).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
  });

  it('sorts by classification_confidence ASC NULLS FIRST when sort=confidence_asc', async () => {
    configureRole(mockSupabase, 'editor');

    const mockItems = [makeMockItem()];
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({ data: mockItems, error: null, count: 1 });
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { sort: 'confidence_asc' },
    });
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    expect(mockSupabase._chain.order).toHaveBeenCalledWith(
      'classification_confidence',
      { ascending: true, nullsFirst: true },
    );
  });

  it('sorts by quality_score ASC NULLS FIRST when sort=quality_score_asc', async () => {
    configureRole(mockSupabase, 'editor');

    const mockItems = [makeMockItem()];
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({ data: mockItems, error: null, count: 1 });
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { sort: 'quality_score_asc' },
    });
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    expect(mockSupabase._chain.order).toHaveBeenCalledWith('quality_score', {
      ascending: true,
      nullsFirst: true,
    });
  });

  it('falls back to created_at when sort=created_at is explicit', async () => {
    configureRole(mockSupabase, 'editor');

    const mockItems = [makeMockItem()];
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({ data: mockItems, error: null, count: 1 });
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { sort: 'created_at' },
    });
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    expect(mockSupabase._chain.order).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
  });
});

describe('GET /api/review/queue — quality_score in response', () => {
  beforeEach(resetMocks);

  it('includes quality_score in mapped response items', async () => {
    configureRole(mockSupabase, 'editor');

    const mockItems = [makeMockItem({ quality_score: 85 })];
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({ data: mockItems, error: null, count: 1 });
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue');
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items[0].quality_score).toBe(85);
  });

  it('maps null quality_score when missing', async () => {
    configureRole(mockSupabase, 'editor');

    const mockItems = [makeMockItem({ quality_score: null })];
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({ data: mockItems, error: null, count: 1 });
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue');
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items[0].quality_score).toBeNull();
  });

  it('maps undefined quality_score to null', async () => {
    configureRole(mockSupabase, 'editor');

    const mockItems = [makeMockItem({ quality_score: undefined })];
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({ data: mockItems, error: null, count: 1 });
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue');
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items[0].quality_score).toBeNull();
  });
});

// ===========================================================================
// assigned_to_me intersection logic (H-1)
// ===========================================================================

describe('GET /api/review/queue — assigned_to_me filter', () => {
  beforeEach(resetMocks);

  it('filters by union of assignment domains and content types', async () => {
    configureRole(mockSupabase, 'editor');

    // Track which table each from() call targets
    const fromCalls: string[] = [];
    const assignmentChain = {
      ...mockSupabase._chain,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              filter_domains: ['Health & Safety'],
              filter_content_types: ['policy'],
            },
            {
              filter_domains: ['Environmental'],
              filter_content_types: null,
            },
          ],
          error: null,
        }),
      ),
    };

    // Wire up assignment chain methods to return themselves
    for (const method of ['select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'order', 'range'] as const) {
      if (method !== 'then') {
        (assignmentChain as Record<string, ReturnType<typeof vi.fn>>)[method] =
          vi.fn().mockReturnValue(assignmentChain);
      }
    }

    mockSupabase.from.mockImplementation((table: string) => {
      fromCalls.push(table);
      if (table === 'review_assignments') {
        return assignmentChain;
      }
      return mockSupabase._chain;
    });

    // Content items query resolves with one item
    const mockItems = [makeMockItem()];
    let contentThenCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        contentThenCount++;
        if (contentThenCount === 1) {
          return resolve({ data: mockItems, error: null, count: 1 });
        }
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { assigned_to_me: 'true' },
    });
    const res = await getQueue(req);

    expect(res.status).toBe(200);

    // Assert the content_items query received the UNION of assignment filters
    // Domains: ['Health & Safety'] + ['Environmental'] = both
    const inCalls = mockSupabase._chain.in.mock.calls;
    const domainInCall = inCalls.find(
      (call: unknown[]) => call[0] === 'primary_domain',
    );
    expect(domainInCall).toBeDefined();
    expect(domainInCall![1]).toEqual(
      expect.arrayContaining(['Health & Safety', 'Environmental']),
    );
    expect(domainInCall![1]).toHaveLength(2);

    // Content types: ['policy'] (only one assignment had non-null types)
    const ctInCall = inCalls.find(
      (call: unknown[]) => call[0] === 'content_type',
    );
    expect(ctInCall).toBeDefined();
    expect(ctInCall![1]).toEqual(['policy']);
  });

  it('returns empty result immediately when user has no active assignments', async () => {
    configureRole(mockSupabase, 'editor');

    // Assignment query returns empty list
    const assignmentChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      ),
    };

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'review_assignments') {
        return assignmentChain;
      }
      return mockSupabase._chain;
    });

    const req = createTestRequest('/api/review/queue', {
      searchParams: { assigned_to_me: 'true' },
    });
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toEqual([]);
    expect(json.total).toBe(0);
    expect(json.has_more).toBe(false);

    // Verify content_items was never queried — no from('content_items') call
    const fromCalls = mockSupabase.from.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(fromCalls).not.toContain('content_items');
  });

  it('intersects user-selected domain with assignment domains', async () => {
    configureRole(mockSupabase, 'editor');

    // Assignment has two domains; user selects only one of them
    const assignmentChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              filter_domains: ['Health & Safety', 'Finance'],
              filter_content_types: null,
            },
          ],
          error: null,
        }),
      ),
    };

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'review_assignments') {
        return assignmentChain;
      }
      return mockSupabase._chain;
    });

    // Content items query
    let contentThenCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        contentThenCount++;
        if (contentThenCount === 1) {
          return resolve({ data: [], error: null, count: 0 });
        }
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    // User selects domain=Finance AND assigned_to_me=true
    const req = createMultiParamRequest('/api/review/queue', [
      ['assigned_to_me', 'true'],
      ['domain', 'Finance'],
    ]);
    const res = await getQueue(req);

    expect(res.status).toBe(200);

    // The content_items query should receive domain=['Finance'] (the intersection)
    const inCalls = mockSupabase._chain.in.mock.calls;
    const domainInCall = inCalls.find(
      (call: unknown[]) => call[0] === 'primary_domain',
    );
    expect(domainInCall).toBeDefined();
    // Intersection: ['Finance'] only, not ['Health & Safety', 'Finance']
    expect(domainInCall![1]).toEqual(['Finance']);
  });

  it('passes through unrestricted when assignment has null filter arrays', async () => {
    configureRole(mockSupabase, 'editor');

    // Assignment with both filter arrays null = unrestricted
    const assignmentChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              filter_domains: null,
              filter_content_types: null,
            },
          ],
          error: null,
        }),
      ),
    };

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'review_assignments') {
        return assignmentChain;
      }
      return mockSupabase._chain;
    });

    // Content items query
    const mockItems = [makeMockItem()];
    let contentThenCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        contentThenCount++;
        if (contentThenCount === 1) {
          return resolve({ data: mockItems, error: null, count: 1 });
        }
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { assigned_to_me: 'true' },
    });
    const res = await getQueue(req);

    expect(res.status).toBe(200);

    // With null assignment filters and no user domain/content_type params,
    // the query should NOT have .in('primary_domain', ...) or .in('content_type', ...)
    const inCalls = mockSupabase._chain.in.mock.calls;
    const domainInCall = inCalls.find(
      (call: unknown[]) => call[0] === 'primary_domain',
    );
    const ctInCall = inCalls.find(
      (call: unknown[]) => call[0] === 'content_type',
    );
    expect(domainInCall).toBeUndefined();
    expect(ctInCall).toBeUndefined();
  });
});

// ===========================================================================
// V2-M5 (S202 §5.2 / Wave 3) — orthogonality between publication_status and
// governance_review_status.
//
// Spec §3.1 declares these two columns as ORTHOGONAL axes — a row may sit in
// `publication_status='draft'` AND simultaneously have
// `governance_review_status='pending'`. The queue read paths must surface
// the row independently in both filter modes:
//
//   1. The /api/review/queue "drafts only" filter (status='draft') reads
//      `publication_status='draft'` post-T8b row 11 rewire — surfaces the
//      row when filtered by publication state.
//   2. The MCP `get_governance_queue` tool reads
//      `governance_review_status='pending'` — surfaces the same row when
//      filtered by change-management review state.
//
// No precedence collision: setting one filter does not exclude the other.
// MCP-side coverage lives in __tests__/mcp/update-publication-status.test.ts
// ("get_governance_queue — publication_status filter (S202 §5.2 T7)").
// This test owns the queue-route side of the orthogonality assertion.
// ===========================================================================

describe('GET /api/review/queue — orthogonality with governance_review_status (V2-M5)', () => {
  beforeEach(resetMocks);

  it('publication_status="draft" + governance_review_status="pending" row surfaces in drafts-only filter, queue does NOT add a governance_review_status filter', async () => {
    configureRole(mockSupabase, 'editor');

    // Fixture row that sits in BOTH axes simultaneously per spec §3.1.
    const orthogonalRow = makeMockItem({
      governance_review_status: 'pending',
    });

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          return resolve({ data: [orthogonalRow], error: null, count: 1 });
        }
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    // /api/review/queue?status=draft — drafts-only filter mode.
    // Per app/api/review/queue/route.ts:174 (T8b row 11 rewire):
    //   if (status === 'draft') query = query.eq('publication_status', 'draft');
    const req = createTestRequest('/api/review/queue', {
      searchParams: { status: 'draft' },
    });
    const res = await getQueue(req);
    expect(res.status).toBe(200);

    // (a) The .eq filter MUST target publication_status='draft' (T8b read
    //     path). This is the "drafts only" filter mode.
    const eqCalls = mockSupabase._chain.eq.mock.calls as Array<
      [string, unknown]
    >;
    const pubFilter = eqCalls.find(
      ([col, val]) => col === 'publication_status' && val === 'draft',
    );
    expect(pubFilter).toBeDefined();

    // (b) Crucially: the queue route MUST NOT add a
    //     .eq('governance_review_status', ...) filter — surfacing rows in
    //     this mode is purely about publication_status. So a row with
    //     governance_review_status='pending' is neither hidden nor
    //     double-filtered. The two axes compose orthogonally.
    const govFilter = eqCalls.find(
      ([col]) => col === 'governance_review_status',
    );
    expect(govFilter).toBeUndefined();

    // (c) The orthogonal row appears in the response and its pending
    //     governance_review_status surfaces through unmodified. This
    //     confirms the queue surfaces governance review state as data
    //     even when not filtering on it — proving the axes are
    //     independent within a single result row.
    const json = await res.json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].id).toBe(orthogonalRow.id);
    expect(json.items[0].governance_review_status).toBe('pending');
  });
});

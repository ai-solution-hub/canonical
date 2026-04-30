/**
 * GET /api/review/queue?publication_status=in_review — publication-review
 * branch unit tests.
 *
 * V_W1 Finding 2 fix — `handlePublicationReviewQuery` (route.ts:475-560)
 * was untested at the unit level. This file exercises the four contract
 * points the spec + V_W1 finding called out:
 *   (a) default 200 response shape
 *   (b) domain filter merge with publication_status
 *   (c) limit/offset pagination
 *   (d) viewer role → 403
 *
 * Uses the shared `createMockSupabaseClient()` helper per CLAUDE.md to
 * mirror the patterns in `__tests__/api/review/queue.test.ts`.
 *
 * Spec: docs/specs/review-page-tabs-refactor-spec.md §8 (f).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { _resetRateLimitStore } from '@/lib/rate-limit';

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

// Import handler under test (AFTER mocks)
import { GET as getQueue } from '@/app/api/review/queue/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';

/**
 * Create a NextRequest with multi-value searchParams support. Mirrors the
 * helper in queue.test.ts so domain=a&domain=b case is supported.
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
    title: 'Awaiting Item',
    suggested_title: 'Suggested Title',
    summary: 'A summary',
    primary_domain: 'Technology',
    primary_subtopic: 'AI',
    secondary_domain: null,
    secondary_subtopic: null,
    content_type: 'q_a_pair',
    platform: 'manual',
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
    next_review_date: null,
    review_cadence_days: null,
    publication_status: 'in_review',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function resetMocks() {
  vi.clearAllMocks();
  _resetRateLimitStore();

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

describe('GET /api/review/queue?publication_status=in_review (publication-review branch)', () => {
  beforeEach(resetMocks);

  // -------------------------------------------------------------------------
  // (a) Default 200 response — admin auth, no extra filters
  // -------------------------------------------------------------------------
  it('returns 200 with ReviewQueueResponse shape when admin requests in_review queue (a)', async () => {
    configureRole(mockSupabase, 'admin');

    const mockItems = [
      makeMockItem({ publication_status: 'in_review', id: VALID_UUID }),
    ];
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        // First call = content_items query, subsequent = verification_history
        if (thenCallCount === 1) {
          return resolve({ data: mockItems, error: null, count: 1 });
        }
        return resolve({ data: [], error: null, count: 0 });
      },
    );

    const req = createMultiParamRequest('/api/review/queue', [
      ['publication_status', 'in_review'],
    ]);
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    const json = await res.json();

    // Shape: ReviewQueueResponse with verified_count + flagged_count both
    // hard-coded to 0 because the publication-review tab is orthogonal to
    // governance state per spec §6.7 line 1196.
    expect(json).toMatchObject({
      items: expect.any(Array),
      total: 1,
      verified_count: 0,
      flagged_count: 0,
      has_more: false,
    });
    expect(json.items).toHaveLength(1);
    expect(json.items[0].id).toBe(VALID_UUID);
    expect(json.items[0].publication_status).toBe('in_review');

    // The route MUST filter on publication_status='in_review'.
    const eqCalls = mockSupabase._chain.eq.mock.calls as Array<
      [string, unknown]
    >;
    const pubFilter = eqCalls.find(
      ([col, val]) => col === 'publication_status' && val === 'in_review',
    );
    expect(pubFilter).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // (b) Domain filter merge — both publication_status AND domain applied
  // -------------------------------------------------------------------------
  it('applies BOTH publication_status=in_review AND domain filter when domain present (b)', async () => {
    configureRole(mockSupabase, 'editor');

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          return resolve({ data: [], error: null, count: 0 });
        }
        return resolve({ data: [], error: null, count: 0 });
      },
    );

    const req = createMultiParamRequest('/api/review/queue', [
      ['publication_status', 'in_review'],
      ['domain', 'technical'],
    ]);
    const res = await getQueue(req);

    expect(res.status).toBe(200);

    // Both filters MUST land on the Supabase query.
    const eqCalls = mockSupabase._chain.eq.mock.calls as Array<
      [string, unknown]
    >;
    const pubFilter = eqCalls.find(
      ([col, val]) => col === 'publication_status' && val === 'in_review',
    );
    expect(pubFilter).toBeDefined();

    const inCalls = mockSupabase._chain.in.mock.calls as Array<
      [string, string[]]
    >;
    const domainFilter = inCalls.find(
      ([col, vals]) =>
        col === 'primary_domain' &&
        Array.isArray(vals) &&
        vals.includes('technical'),
    );
    expect(domainFilter).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // (c) Pagination — limit + offset translate to range() call
  // -------------------------------------------------------------------------
  it('paginates via range(offset, offset+limit-1) for limit=5 offset=10 (c)', async () => {
    configureRole(mockSupabase, 'admin');

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          return resolve({ data: [], error: null, count: 0 });
        }
        return resolve({ data: [], error: null, count: 0 });
      },
    );

    const req = createMultiParamRequest('/api/review/queue', [
      ['publication_status', 'in_review'],
      ['limit', '5'],
      ['offset', '10'],
    ]);
    const res = await getQueue(req);

    expect(res.status).toBe(200);

    // Per the publication-review branch helper, `query.range(offset, offset+limit-1)`.
    // With limit=5 + offset=10, the call MUST be range(10, 14).
    const rangeCalls = mockSupabase._chain.range.mock.calls as Array<
      [number, number]
    >;
    expect(rangeCalls).toContainEqual([10, 14]);
  });

  it('clamps limit to max 100 when caller requests 500', async () => {
    configureRole(mockSupabase, 'admin');

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        return resolve({ data: [], error: null, count: 0 });
      },
    );

    const req = createMultiParamRequest('/api/review/queue', [
      ['publication_status', 'in_review'],
      ['limit', '500'],
    ]);
    const res = await getQueue(req);
    expect(res.status).toBe(200);

    // limit=500 → clamped to 100, offset default 0 → range(0, 99)
    const rangeCalls = mockSupabase._chain.range.mock.calls as Array<
      [number, number]
    >;
    expect(rangeCalls).toContainEqual([0, 99]);
  });

  // -------------------------------------------------------------------------
  // (d) Auth fail — viewer role → 403
  // -------------------------------------------------------------------------
  it('returns 403 for viewer role (d)', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createMultiParamRequest('/api/review/queue', [
      ['publication_status', 'in_review'],
    ]);
    const res = await getQueue(req);
    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createMultiParamRequest('/api/review/queue', [
      ['publication_status', 'in_review'],
    ]);
    const res = await getQueue(req);
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Bonus: verifies the publication-review branch BYPASSES the verified_at
  // and governance filters that drive the standard queue branch (per spec
  // §6.7 line 1196 + route comment at route.ts:46-48).
  // -------------------------------------------------------------------------
  it('does NOT add a verified_at IS NULL filter (orthogonal to verification axis)', async () => {
    configureRole(mockSupabase, 'admin');

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        return resolve({ data: [], error: null, count: 0 });
      },
    );

    const req = createMultiParamRequest('/api/review/queue', [
      ['publication_status', 'in_review'],
    ]);
    await getQueue(req);

    const isCalls = mockSupabase._chain.is.mock.calls as Array<
      [string, unknown]
    >;
    const verifiedAtIsNull = isCalls.find(
      ([col, val]) => col === 'verified_at' && val === null,
    );
    expect(verifiedAtIsNull).toBeUndefined();
  });
});

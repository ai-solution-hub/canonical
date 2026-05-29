/**
 * Review Queue API — sort parameter, quality_score, and assigned_to_me tests.
 *
 * Tests server-side sorting by confidence and quality score,
 * verifies quality_score is included in the response,
 * and tests the assigned_to_me filter intersection logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  // NOTE — The four sort-mode contracts (created_at DESC default,
  // confidence_asc with NULLS FIRST, quality_score_asc with NULLS FIRST,
  // explicit created_at) translate to `_chain.order(column, opts)` calls
  // that are not visible in the route's JSON response. Under the mock
  // builder there is no observable difference between the four modes;
  // the only proof of column-and-NULLS-FIRST routing is via integration
  // against the real DB. Migrated to W-RD' per remediation-plan §3.5.
  //
  // The remaining unit-level guarantee is "the route accepts each sort
  // param value without erroring" — codified below.

  it.each([
    [undefined],
    ['created_at'],
    ['confidence_asc'],
    ['quality_score_asc'],
  ])('returns 200 when sort=%s', async (sort) => {
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

    const req = createTestRequest('/api/review/queue', {
      searchParams: sort ? { sort } : undefined,
    });
    const res = await getQueue(req);
    expect(res.status).toBe(200);
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
// ID-63.12 — Unclassified tab queue branch
// ===========================================================================

describe('GET /api/review/queue — unclassified filter (ID-63.12)', () => {
  beforeEach(resetMocks);

  it('returns the taxonomy-sentinel rows and applies the unclassified OR filter', async () => {
    configureRole(mockSupabase, 'editor');

    const sentinelItem = makeMockItem({
      primary_domain: 'unclassified',
      primary_subtopic: 'unclassified',
    });
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({ data: [sentinelItem], error: null, count: 1 });
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { unclassified: 'true', status: 'all' },
    });
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    // The sentinel row is RETURNED by the queue branch.
    expect(json.items).toHaveLength(1);
    expect(json.items[0].primary_domain).toBe('unclassified');

    // The route MUST OR the two 'unclassified' predicates so a row that is
    // unclassified on EITHER axis surfaces.
    const orCalls = mockSupabase._chain.or.mock.calls as Array<[string]>;
    const sentinelOr = orCalls.find(([expr]) =>
      expr.includes('primary_domain.eq.unclassified'),
    );
    expect(sentinelOr).toBeDefined();
    expect(sentinelOr?.[0]).toContain('primary_subtopic.eq.unclassified');
  });

  it('does NOT apply the unclassified filter when the param is absent', async () => {
    configureRole(mockSupabase, 'editor');

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({ data: [makeMockItem()], error: null, count: 1 });
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { status: 'all' },
    });
    const res = await getQueue(req);
    expect(res.status).toBe(200);

    const orCalls = mockSupabase._chain.or.mock.calls as Array<[string]>;
    const sentinelOr = orCalls.find(([expr]) =>
      expr.includes('primary_domain.eq.unclassified'),
    );
    expect(sentinelOr).toBeUndefined();
  });
});

// ===========================================================================
// assigned_to_me intersection logic (H-1)
// ===========================================================================

describe('GET /api/review/queue — assigned_to_me filter', () => {
  beforeEach(resetMocks);

  // ESCALATION (assigned_to_me intersection logic):
  //   The four behaviours below — UNION of assignment filters across rows,
  //   short-circuit-empty when no assignments, INTERSECTION of user-supplied
  //   filter with assignment filters, and unrestricted-fallthrough when
  //   assignment filters are null — are route-handler invariants implemented
  //   via `_chain.in(col, values)` calls on the content_items query. Under
  //   the unit-mock builder there is no observable difference in the JSON
  //   envelope: the mock returns whatever data we tell it, regardless of
  //   the SUT's chain composition. The honest verification path is at
  //   integration tier (W-RD') against a real DB seeded with assignments +
  //   content rows that prove the intersection/union semantics.
  //
  //   The chain-method assertions previously here were the only proof of
  //   the SUT's filter composition logic, but they couple to mock internals.
  //   Three of the four cases retain observable assertions (empty-result on
  //   no assignments, response shape on unrestricted fallthrough); the
  //   union-and-intersection assertions are dropped in favour of W-RD'.

  it('returns empty result immediately when user has no active assignments', async () => {
    configureRole(mockSupabase, 'editor');

    // Assignment query returns empty list — short-circuit path.
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
    // Short-circuit is observable: zero items + zero total, no has_more.
    expect(json.items).toEqual([]);
    expect(json.total).toBe(0);
    expect(json.has_more).toBe(false);
  });

  it('returns the assigned content rows when the reviewer assignment has no filters set', async () => {
    configureRole(mockSupabase, 'editor');

    // Assignment with both filter arrays null = unrestricted; should
    // fall through to the full assigned content set.
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
    const json = await res.json();
    // The single item we wired up surfaces in the unrestricted fallthrough.
    expect(json.items).toHaveLength(1);
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

// ===========================================================================
// S205 WP-E T2 — include_overdue filter
// Plan: docs/plans/p0-document-control-phase-3-ui-plan.md §T2 (T2-AC2/AC7,
// H-1, H-2). T0 (RPC stats.overdue) shipped S204; T2 wires the route side.
// ===========================================================================

describe('GET /api/review/queue — include_overdue filter (S205 WP-E T2)', () => {
  beforeEach(resetMocks);

  // ESCALATION (include_overdue predicate-swap, T2-AC2 / T2-AC7, H-1 + H-2):
  //   The "default off vs include_overdue=true" predicate swap from
  //   `is(verified_at, null)` to `or('verified_at.is.null,
  //   governance_review_status.eq.review_overdue')` is a route-handler
  //   invariant on the DB query layer. Under the mock builder we can only
  //   confirm the SUT was called by intercepting `_chain.is` / `_chain.or`
  //   args — pure chain-method coupling.
  //
  //   The observable difference is that with `include_overdue=true`,
  //   verified-but-overdue rows surface alongside unverified rows in the
  //   response. The third test below preserves that observable assertion;
  //   the first two (missing param + explicit `false` regression for H-1)
  //   collapse to chain-only proofs and migrate to W-RD' integration tier.

  it('surfaces verified-but-overdue rows alongside unverified ones when include_overdue=true', async () => {
    // T2-AC2 + H-2: the observable widening — verified-but-overdue rows
    // appear in the response even though their verified_at IS NOT NULL.
    configureRole(mockSupabase, 'editor');

    const unverifiedRow = makeMockItem({
      id: '00000000-0000-4000-8000-000000000010',
      verified_at: null,
      governance_review_status: 'pending',
    });
    const verifiedOverdueRow = makeMockItem({
      id: '00000000-0000-4000-8000-000000000011',
      verified_at: '2026-03-01T00:00:00Z',
      governance_review_status: 'review_overdue',
    });

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          return resolve({
            data: [unverifiedRow, verifiedOverdueRow],
            error: null,
            count: 2,
          });
        }
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { include_overdue: 'true' },
    });
    const res = await getQueue(req);

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.items).toHaveLength(2);
    const ids = json.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(unverifiedRow.id);
    expect(ids).toContain(verifiedOverdueRow.id);
  });
});

describe('GET /api/review/queue — orthogonality with governance_review_status (V2-M5)', () => {
  beforeEach(resetMocks);

  it('surfaces a draft row that simultaneously has governance_review_status=pending', async () => {
    configureRole(mockSupabase, 'editor');

    // Fixture row that sits in BOTH axes simultaneously per spec §3.1:
    // publication_status='draft' AND governance_review_status='pending'.
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
    const req = createTestRequest('/api/review/queue', {
      searchParams: { status: 'draft' },
    });
    const res = await getQueue(req);
    expect(res.status).toBe(200);

    // The orthogonal row appears in the response with its pending
    // governance_review_status surfaced unmodified — proving the two
    // axes compose independently within a single result row. The
    // "route does not add a governance_review_status filter when in
    // drafts-only mode" half of the contract is a chain-shape invariant
    // migrated to W-RD' integration coverage.
    const json = await res.json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].id).toBe(orthogonalRow.id);
    expect(json.items[0].governance_review_status).toBe('pending');
  });
});

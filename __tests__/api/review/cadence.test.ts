/**
 * GET /api/review/cadence — review health metrics tests.
 *
 * Tests auth, response shape, overdue calculation, domain breakdown,
 * and never-reviewed item handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// ---------------------------------------------------------------------------
// Import handler under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/review/cadence/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_1 = '00000000-0000-4000-8000-000000000001';
const UUID_2 = '00000000-0000-4000-8000-000000000002';
const UUID_3 = '00000000-0000-4000-8000-000000000003';
const UUID_4 = '00000000-0000-4000-8000-000000000004';

// Pin Date.now() so the route handler's `new Date()` and our helper agree.
const FIXED_NOW = new Date('2026-02-15T12:00:00.000Z').getTime();

function daysAgo(days: number): string {
  // Subtract an extra 2 hours so Math.floor always produces exactly `days`.
  const buffer = 2 * 60 * 60 * 1000;
  return new Date(
    FIXED_NOW - days * 24 * 60 * 60 * 1000 - buffer,
  ).toISOString();
}

function makeMockItem(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID_1,
    title: 'Test Item',
    suggested_title: 'Test Title',
    primary_domain: 'Technology',
    verified_at: null,
    governance_review_status: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Deterministic time — pin both Date.now() and new Date() to FIXED_NOW so
// the route handler's `const now = new Date()` produces a predictable value.
// ---------------------------------------------------------------------------

const OriginalDate = globalThis.Date;

function mockDateNow() {
  // Create a Date subclass that returns FIXED_NOW when called with no args
  // but delegates to the original for explicit args (e.g. new Date('2026-01-01'))
  const MockDate = function (...args: ConstructorParameters<typeof Date>) {
    if (args.length === 0) {
      return new OriginalDate(FIXED_NOW);
    }
    // @ts-expect-error -- spread into Date constructor
    return new OriginalDate(...args);
  } as unknown as DateConstructor;

  // Copy static methods and properties
  MockDate.now = () => FIXED_NOW;
  MockDate.parse = OriginalDate.parse;
  MockDate.UTC = OriginalDate.UTC;
  MockDate.prototype = OriginalDate.prototype;

  globalThis.Date = MockDate;
}

function restoreDateNow() {
  globalThis.Date = OriginalDate;
}

function resetMocks() {
  vi.clearAllMocks();
  _resetRateLimitStore();

  mockDateNow();

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

describe('GET /api/review/cadence', () => {
  beforeEach(resetMocks);
  afterEach(restoreDateNow);

  // -- Auth tests --

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await GET();
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const res = await GET();
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Forbidden');
  });

  it('allows editor role', async () => {
    configureRole(mockSupabase, 'editor');

    // First .then = content_items query, second .then = governance_config query
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) return resolve({ data: [], error: null });
        return resolve({ data: [], error: null });
      },
    );

    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('allows admin role', async () => {
    configureRole(mockSupabase, 'admin');

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) return resolve({ data: [], error: null });
        return resolve({ data: [], error: null });
      },
    );

    const res = await GET();
    expect(res.status).toBe(200);
  });

  // -- Response shape tests --

  it('returns correct response shape with empty data', async () => {
    configureRole(mockSupabase, 'editor');

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) return resolve({ data: [], error: null });
        return resolve({ data: [], error: null });
      },
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json).toHaveProperty('summary');
    expect(json).toHaveProperty('overdue_items');
    expect(json).toHaveProperty('by_domain');

    expect(json.summary).toEqual({
      total_items: 0,
      never_reviewed: 0,
      reviewed_last_7_days: 0,
      reviewed_last_30_days: 0,
      reviewed_last_90_days: 0,
      overdue: 0,
      average_days_since_review: 0,
    });

    expect(json.overdue_items).toEqual([]);
    expect(json.by_domain).toEqual({});
  });

  // -- Cadence calculation tests --

  it('correctly counts never-reviewed items as overdue', async () => {
    configureRole(mockSupabase, 'editor');

    const items = [
      makeMockItem({ id: UUID_1, verified_at: null }),
      makeMockItem({
        id: UUID_2,
        verified_at: null,
        primary_domain: 'Operations',
      }),
    ];

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) return resolve({ data: items, error: null });
        return resolve({ data: [], error: null });
      },
    );

    const res = await GET();
    const json = await res.json();

    expect(json.summary.total_items).toBe(2);
    expect(json.summary.never_reviewed).toBe(2);
    expect(json.summary.overdue).toBe(2);
    expect(json.overdue_items).toHaveLength(2);

    // Never-reviewed items have days_since_review = -1
    for (const item of json.overdue_items) {
      expect(item.days_since_review).toBe(-1);
      expect(item.verified_at).toBeNull();
    }
  });

  it('correctly classifies items by review recency', async () => {
    configureRole(mockSupabase, 'editor');

    const items = [
      makeMockItem({ id: UUID_1, verified_at: daysAgo(3) }), // within 7d
      makeMockItem({ id: UUID_2, verified_at: daysAgo(15) }), // within 30d
      makeMockItem({ id: UUID_3, verified_at: daysAgo(60) }), // within 90d
      makeMockItem({ id: UUID_4, verified_at: daysAgo(120) }), // overdue (>90d)
    ];

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) return resolve({ data: items, error: null });
        return resolve({ data: [], error: null });
      },
    );

    const res = await GET();
    const json = await res.json();

    expect(json.summary.total_items).toBe(4);
    expect(json.summary.never_reviewed).toBe(0);
    expect(json.summary.reviewed_last_7_days).toBe(1);
    expect(json.summary.reviewed_last_30_days).toBe(2);
    expect(json.summary.reviewed_last_90_days).toBe(3);
    expect(json.summary.overdue).toBe(1);
  });

  it('computes average days since review (excluding never-reviewed)', async () => {
    configureRole(mockSupabase, 'editor');

    const items = [
      makeMockItem({ id: UUID_1, verified_at: daysAgo(10) }),
      makeMockItem({ id: UUID_2, verified_at: daysAgo(20) }),
      makeMockItem({ id: UUID_3, verified_at: null }), // excluded from avg
    ];

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) return resolve({ data: items, error: null });
        return resolve({ data: [], error: null });
      },
    );

    const res = await GET();
    const json = await res.json();

    // With pinned Date.now, Math.floor gives exactly 10 and 20,
    // and Math.round((10 + 20) / 2) = 15
    expect(json.summary.average_days_since_review).toBe(15);
  });

  // -- Domain breakdown tests --

  it('groups items by primary_domain', async () => {
    configureRole(mockSupabase, 'editor');

    const items = [
      makeMockItem({
        id: UUID_1,
        primary_domain: 'Technology',
        verified_at: daysAgo(5),
      }),
      makeMockItem({
        id: UUID_2,
        primary_domain: 'Technology',
        verified_at: null,
      }),
      makeMockItem({
        id: UUID_3,
        primary_domain: 'Operations',
        verified_at: daysAgo(100),
      }),
    ];

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) return resolve({ data: items, error: null });
        return resolve({ data: [], error: null });
      },
    );

    const res = await GET();
    const json = await res.json();

    expect(json.by_domain).toHaveProperty('Technology');
    expect(json.by_domain).toHaveProperty('Operations');

    expect(json.by_domain.Technology.total).toBe(2);
    expect(json.by_domain.Technology.never_reviewed).toBe(1);
    expect(json.by_domain.Technology.overdue).toBe(1); // never-reviewed counts as overdue

    expect(json.by_domain.Operations.total).toBe(1);
    expect(json.by_domain.Operations.overdue).toBe(1); // 100 > 90 days
  });

  it('uses Uncategorised for items without primary_domain', async () => {
    configureRole(mockSupabase, 'editor');

    const items = [
      makeMockItem({ id: UUID_1, primary_domain: null, verified_at: null }),
    ];

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) return resolve({ data: items, error: null });
        return resolve({ data: [], error: null });
      },
    );

    const res = await GET();
    const json = await res.json();

    expect(json.by_domain).toHaveProperty('Uncategorised');
    expect(json.by_domain.Uncategorised.total).toBe(1);
  });

  // -- Overdue item ordering --

  it('sorts overdue items: never-reviewed first, then by days_since_review descending', async () => {
    configureRole(mockSupabase, 'editor');

    const items = [
      makeMockItem({
        id: UUID_1,
        verified_at: daysAgo(120),
        suggested_title: 'Old',
      }),
      makeMockItem({ id: UUID_2, verified_at: null, suggested_title: 'Never' }),
      makeMockItem({
        id: UUID_3,
        verified_at: daysAgo(200),
        suggested_title: 'Oldest',
      }),
    ];

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) return resolve({ data: items, error: null });
        return resolve({ data: [], error: null });
      },
    );

    const res = await GET();
    const json = await res.json();

    expect(json.overdue_items).toHaveLength(3);
    // Never-reviewed first
    expect(json.overdue_items[0].title).toBe('Never');
    expect(json.overdue_items[0].days_since_review).toBe(-1);
    // Then by days descending: 200 before 120
    expect(json.overdue_items[1].title).toBe('Oldest');
    expect(json.overdue_items[2].title).toBe('Old');
  });

  // -- Error handling --

  it('returns 500 when content_items query fails', async () => {
    configureRole(mockSupabase, 'editor');

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({ data: null, error: { message: 'DB error' } });
        return resolve({ data: [], error: null });
      },
    );

    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch content items');
  });

  it('falls back to default timeout when governance_config query fails', async () => {
    configureRole(mockSupabase, 'editor');

    const items = [
      makeMockItem({ id: UUID_1, verified_at: daysAgo(95) }), // overdue with 90d default
    ];

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) return resolve({ data: items, error: null });
        // governance_config query fails
        return resolve({ data: null, error: { message: 'Config error' } });
      },
    );

    const res = await GET();
    const json = await res.json();

    // Should still work, using 90-day default
    expect(res.status).toBe(200);
    expect(json.summary.overdue).toBe(1);
  });

  // -- Display title fallback --

  it('uses suggested_title then title then Untitled for overdue items', async () => {
    configureRole(mockSupabase, 'editor');

    const items = [
      makeMockItem({
        id: UUID_1,
        verified_at: null,
        suggested_title: 'Suggested',
        title: 'Title',
      }),
      makeMockItem({
        id: UUID_2,
        verified_at: null,
        suggested_title: null,
        title: 'Fallback Title',
      }),
      makeMockItem({
        id: UUID_3,
        verified_at: null,
        suggested_title: null,
        title: null,
      }),
    ];

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) return resolve({ data: items, error: null });
        return resolve({ data: [], error: null });
      },
    );

    const res = await GET();
    const json = await res.json();

    const titles = json.overdue_items.map((i: { title: string }) => i.title);
    expect(titles).toContain('Suggested');
    expect(titles).toContain('Fallback Title');
    expect(titles).toContain('Untitled');
  });
});

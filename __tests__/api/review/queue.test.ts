/**
 * Review Queue API — sort parameter and quality_score tests.
 *
 * Tests server-side sorting by confidence and quality score,
 * and verifies quality_score is included in the response.
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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Import route AFTER mocks are registered
const { GET } = await import('@/app/api/entities/co-occurrence/route');

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainable = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockReset().mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockReset().mockImplementation(
    (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 }),
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/entities/co-occurrence', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/entities/co-occurrence');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns empty pairs when no entity mentions exist', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/entities/co-occurrence');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pairs).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('returns co-occurring entity pairs sorted by shared count', async () => {
    const ITEM_1 = 'a1b2c3d4-0001-0000-0000-000000000000';
    const ITEM_2 = 'a1b2c3d4-0002-0000-0000-000000000000';
    const ITEM_3 = 'a1b2c3d4-0003-0000-0000-000000000000';

    // Acme Corp and ISO 27001 appear in items 1, 2, and 3 (shared_count = 3)
    // Acme Corp and GDPR appear in items 1 and 2 (shared_count = 2)
    // ISO 27001 and GDPR appear in items 1 and 2 (shared_count = 2)
    const mentions = [
      { canonical_name: 'Acme Corp', entity_type: 'organisation', content_item_id: ITEM_1 },
      { canonical_name: 'ISO 27001', entity_type: 'certification', content_item_id: ITEM_1 },
      { canonical_name: 'GDPR', entity_type: 'regulation', content_item_id: ITEM_1 },
      { canonical_name: 'Acme Corp', entity_type: 'organisation', content_item_id: ITEM_2 },
      { canonical_name: 'ISO 27001', entity_type: 'certification', content_item_id: ITEM_2 },
      { canonical_name: 'GDPR', entity_type: 'regulation', content_item_id: ITEM_2 },
      { canonical_name: 'Acme Corp', entity_type: 'organisation', content_item_id: ITEM_3 },
      { canonical_name: 'ISO 27001', entity_type: 'certification', content_item_id: ITEM_3 },
    ];

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: mentions, error: null }),
    );

    const req = createTestRequest('/api/entities/co-occurrence', {
      searchParams: { min: '2' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pairs.length).toBeGreaterThanOrEqual(2);

    // Acme Corp + ISO 27001 should be first (shared_count = 3)
    expect(body.pairs[0].entity_a).toBe('Acme Corp');
    expect(body.pairs[0].entity_b).toBe('ISO 27001');
    expect(body.pairs[0].shared_count).toBe(3);
    expect(body.pairs[0].type_a).toBe('organisation');
    expect(body.pairs[0].type_b).toBe('certification');
  });

  it('filters co-occurrence by entity type', async () => {
    const ITEM_1 = 'a1b2c3d4-0001-0000-0000-000000000000';
    const ITEM_2 = 'a1b2c3d4-0002-0000-0000-000000000000';

    const mentions = [
      { canonical_name: 'ISO 27001', entity_type: 'certification', content_item_id: ITEM_1 },
      { canonical_name: 'ISO 9001', entity_type: 'certification', content_item_id: ITEM_1 },
      { canonical_name: 'ISO 27001', entity_type: 'certification', content_item_id: ITEM_2 },
      { canonical_name: 'ISO 9001', entity_type: 'certification', content_item_id: ITEM_2 },
    ];

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: mentions, error: null }),
    );

    const req = createTestRequest('/api/entities/co-occurrence', {
      searchParams: { type: 'certification', min: '2' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pairs).toHaveLength(1);
    expect(body.pairs[0].entity_a).toBe('ISO 27001');
    expect(body.pairs[0].entity_b).toBe('ISO 9001');
    expect(body.pairs[0].shared_count).toBe(2);

    // Verify the type filter was applied to the query
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('entity_type', 'certification');
  });

  it('respects limit parameter', async () => {
    const ITEM_1 = 'a1b2c3d4-0001-0000-0000-000000000000';
    const ITEM_2 = 'a1b2c3d4-0002-0000-0000-000000000000';

    // Create enough pairs to test limit
    const mentions = [
      { canonical_name: 'Entity A', entity_type: 'organisation', content_item_id: ITEM_1 },
      { canonical_name: 'Entity B', entity_type: 'organisation', content_item_id: ITEM_1 },
      { canonical_name: 'Entity C', entity_type: 'organisation', content_item_id: ITEM_1 },
      { canonical_name: 'Entity A', entity_type: 'organisation', content_item_id: ITEM_2 },
      { canonical_name: 'Entity B', entity_type: 'organisation', content_item_id: ITEM_2 },
      { canonical_name: 'Entity C', entity_type: 'organisation', content_item_id: ITEM_2 },
    ];

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: mentions, error: null }),
    );

    const req = createTestRequest('/api/entities/co-occurrence', {
      searchParams: { limit: '1', min: '2' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pairs).toHaveLength(1);
  });

  it('excludes pairs below minimum shared count', async () => {
    const ITEM_1 = 'a1b2c3d4-0001-0000-0000-000000000000';

    // Only 1 item — pairs will have shared_count = 1
    const mentions = [
      { canonical_name: 'Entity A', entity_type: 'organisation', content_item_id: ITEM_1 },
      { canonical_name: 'Entity B', entity_type: 'organisation', content_item_id: ITEM_1 },
    ];

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: mentions, error: null }),
    );

    const req = createTestRequest('/api/entities/co-occurrence', {
      searchParams: { min: '2' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pairs).toEqual([]);
  });

  it('returns 500 when Supabase query fails', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({
        data: null,
        error: { message: 'DB error', code: '50000' },
      }),
    );

    const req = createTestRequest('/api/entities/co-occurrence');
    const res = await GET(req);
    expect(res.status).toBe(500);
  });

  it('deduplicates entities within the same content item', async () => {
    const ITEM_1 = 'a1b2c3d4-0001-0000-0000-000000000000';
    const ITEM_2 = 'a1b2c3d4-0002-0000-0000-000000000000';

    // Same entity appears twice in the same item — should only count once
    const mentions = [
      { canonical_name: 'Acme Corp', entity_type: 'organisation', content_item_id: ITEM_1 },
      { canonical_name: 'Acme Corp', entity_type: 'organisation', content_item_id: ITEM_1 },
      { canonical_name: 'ISO 27001', entity_type: 'certification', content_item_id: ITEM_1 },
      { canonical_name: 'Acme Corp', entity_type: 'organisation', content_item_id: ITEM_2 },
      { canonical_name: 'ISO 27001', entity_type: 'certification', content_item_id: ITEM_2 },
    ];

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: mentions, error: null }),
    );

    const req = createTestRequest('/api/entities/co-occurrence', {
      searchParams: { min: '2' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pairs).toHaveLength(1);
    // shared_count should be 2 (items 1 and 2), not 3
    expect(body.pairs[0].shared_count).toBe(2);
  });
});

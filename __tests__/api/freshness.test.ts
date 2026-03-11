import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

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

// Mock batchCalculateFreshness — vi.hoisted to avoid hoisting issues
const mockBatchCalculateFreshness = vi.hoisted(() => vi.fn());

vi.mock('@/lib/freshness', () => ({
  batchCalculateFreshness: mockBatchCalculateFreshness,
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handlers under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { POST as postCalculate } from '@/app/api/freshness/calculate/route';
import { POST as postRecalculateAll } from '@/app/api/freshness/recalculate-all/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';
const VALID_UUID_2 = '00000000-0000-4000-8000-000000000002';

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainableMethods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null, count: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({ data: null, error: null, count: null });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

// ===========================================================================
// POST /api/freshness/calculate
// ===========================================================================

describe('POST /api/freshness/calculate', () => {
  beforeEach(resetMocks);

  it('returns 403 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/freshness/calculate', {
      method: 'POST',
      body: { item_ids: [VALID_UUID] },
    });
    const res = await postCalculate(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Forbidden');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/freshness/calculate', {
      method: 'POST',
      body: { item_ids: [VALID_UUID] },
    });
    const res = await postCalculate(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 for missing item_ids', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/freshness/calculate', {
      method: 'POST',
      body: {},
    });
    const res = await postCalculate(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 400 for empty item_ids array', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/freshness/calculate', {
      method: 'POST',
      body: { item_ids: [] },
    });
    const res = await postCalculate(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 400 for non-UUID item_ids', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/freshness/calculate', {
      method: 'POST',
      body: { item_ids: ['not-a-uuid'] },
    });
    const res = await postCalculate(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 500 when item fetch fails', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'DB error' } }),
    );

    const req = createTestRequest('/api/freshness/calculate', {
      method: 'POST',
      body: { item_ids: [VALID_UUID] },
    });
    const res = await postCalculate(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch items');
  });

  it('returns 404 when no items found for provided IDs', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/freshness/calculate', {
      method: 'POST',
      body: { item_ids: [VALID_UUID] },
    });
    const res = await postCalculate(req);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('No items found for the provided IDs');
  });

  it('calculates freshness and returns results', async () => {
    configureRole(mockSupabase, 'editor');

    const mockItems = [
      { id: VALID_UUID, lifecycle_type: 'evergreen', updated_at: '2026-01-01T00:00:00Z', expiry_date: null },
      { id: VALID_UUID_2, lifecycle_type: 'date_bound', updated_at: '2025-06-01T00:00:00Z', expiry_date: '2026-06-01' },
    ];

    // Fetch items
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: mockItems, error: null }),
    );

    // batchCalculateFreshness returns a Map
    const freshnessMap = new Map<string, string>();
    freshnessMap.set(VALID_UUID, 'fresh');
    freshnessMap.set(VALID_UUID_2, 'aging');
    mockBatchCalculateFreshness.mockReturnValue(freshnessMap);

    const req = createTestRequest('/api/freshness/calculate', {
      method: 'POST',
      body: { item_ids: [VALID_UUID, VALID_UUID_2] },
    });
    const res = await postCalculate(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(2);
    expect(json.total).toBe(2);
    expect(json.results).toHaveLength(2);
    expect(json.results).toEqual(
      expect.arrayContaining([
        { id: VALID_UUID, freshness: 'fresh' },
        { id: VALID_UUID_2, freshness: 'aging' },
      ]),
    );
  });

  it('handles partial update failures gracefully', async () => {
    configureRole(mockSupabase, 'editor');

    const mockItems = [
      { id: VALID_UUID, lifecycle_type: 'evergreen', updated_at: '2026-01-01T00:00:00Z', expiry_date: null },
      { id: VALID_UUID_2, lifecycle_type: 'evergreen', updated_at: '2025-01-01T00:00:00Z', expiry_date: null },
    ];

    // Fetch items succeeds
    let fetchCalled = false;
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) => {
      if (!fetchCalled) {
        fetchCalled = true;
        return resolve({ data: mockItems, error: null });
      }
      // Subsequent .then calls (from update chain) — first succeeds, second fails
      return resolve({ data: null, error: { message: 'Update failed' } });
    });

    const freshnessMap = new Map<string, string>();
    freshnessMap.set(VALID_UUID, 'fresh');
    freshnessMap.set(VALID_UUID_2, 'stale');
    mockBatchCalculateFreshness.mockReturnValue(freshnessMap);

    const req = createTestRequest('/api/freshness/calculate', {
      method: 'POST',
      body: { item_ids: [VALID_UUID, VALID_UUID_2] },
    });
    const res = await postCalculate(req);

    // Should still return 200 — partial updates are OK
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(2);
  });
});

// ===========================================================================
// POST /api/freshness/recalculate-all
// ===========================================================================

describe('POST /api/freshness/recalculate-all', () => {
  beforeEach(resetMocks);

  it('returns 403 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await postRecalculateAll();

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Forbidden');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const res = await postRecalculateAll();
    expect(res.status).toBe(403);
  });

  it('returns 403 for editor role (admin-only)', async () => {
    configureRole(mockSupabase, 'editor');

    const res = await postRecalculateAll();
    expect(res.status).toBe(403);
  });

  it('returns 200 with summary on success', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        total_count: 150,
        fresh_count: 80,
        aging_count: 40,
        stale_count: 20,
        expired_count: 10,
      },
      error: null,
    });

    const res = await postRecalculateAll();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(150);
    expect(json.total).toBe(150);
    expect(json.summary).toEqual({
      fresh: 80,
      aging: 40,
      stale: 20,
      expired: 10,
    });
    expect(json.recalculated_at).toBeDefined();

    expect(mockSupabase.rpc).toHaveBeenCalledWith('recalculate_all_freshness');
  });

  it('handles array-wrapped RPC response', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{
        total_count: 50,
        fresh_count: 30,
        aging_count: 10,
        stale_count: 5,
        expired_count: 5,
      }],
      error: null,
    });

    const res = await postRecalculateAll();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(50);
    expect(json.summary.fresh).toBe(30);
  });

  it('returns 500 when RPC fails', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC failed' },
    });

    const res = await postRecalculateAll();

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to recalculate freshness');
  });

  it('returns zeroes when RPC returns null data', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const res = await postRecalculateAll();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(0);
    expect(json.total).toBe(0);
    expect(json.summary).toEqual({
      fresh: 0,
      aging: 0,
      stale: 0,
      expired: 0,
    });
  });
});

/**
 * API route tests for intelligence metrics trend endpoint.
 *
 * Route tested:
 *   GET /api/intelligence/workspaces/:id/metrics/trend
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../../helpers/mock-next';

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

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/intelligence/workspaces/[id]/metrics/trend/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** Build RPC-shaped trend rows (matches get_filter_ratio_trend return type) */
function makeTrendRows(
  entries: Array<{
    date: string;
    total: number;
    passed: number;
    filtered: number;
    ratio: number;
  }>,
) {
  return entries;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/intelligence/workspaces/:id/metrics/trend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain defaults
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );
    mockSupabase._chain.single.mockResolvedValue({
      data: null,
      error: null,
    });
  });

  it('returns trend data points with daily granularity', async () => {
    configureRole(mockSupabase, 'admin');

    const rows = makeTrendRows([
      { date: '2026-03-01', total: 3, passed: 2, filtered: 1, ratio: 67 },
      { date: '2026-03-02', total: 2, passed: 0, filtered: 2, ratio: 0 },
    ]);

    mockSupabase.rpc.mockResolvedValueOnce({ data: rows, error: null });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/trend`,
      { searchParams: { granularity: 'daily', period: '30d' } },
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(2);

    // Sorted oldest first (RPC returns pre-sorted)
    expect(data[0].date).toBe('2026-03-01');
    expect(data[0].total).toBe(3);
    expect(data[0].passed).toBe(2);
    expect(data[0].filtered).toBe(1);
    expect(data[0].ratio).toBe(67);

    expect(data[1].date).toBe('2026-03-02');
    expect(data[1].total).toBe(2);
    expect(data[1].passed).toBe(0);
    expect(data[1].filtered).toBe(2);
    expect(data[1].ratio).toBe(0);
  });

  it('returns weekly aggregated buckets', async () => {
    configureRole(mockSupabase, 'admin');

    // RPC returns pre-aggregated weekly bucket
    const rows = makeTrendRows([
      { date: '2026-03-02', total: 3, passed: 2, filtered: 1, ratio: 67 },
    ]);

    mockSupabase.rpc.mockResolvedValueOnce({ data: rows, error: null });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/trend`,
      { searchParams: { granularity: 'weekly', period: '30d' } },
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(1); // All same week
    expect(data[0].total).toBe(3);
    expect(data[0].passed).toBe(2);
    expect(data[0].ratio).toBe(67);
  });

  it('uses default granularity (daily) and period (90d)', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/trend`,
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([]);

    // Verify RPC was called with defaults
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_filter_ratio_trend', {
      p_workspace_id: WORKSPACE_UUID,
      p_granularity: 'daily',
      p_period_days: 90,
    });
  });

  it('returns empty array when no articles exist', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/trend`,
      { searchParams: { period: '180d' } },
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([]);
  });

  it('returns results in order from RPC (oldest-first)', async () => {
    configureRole(mockSupabase, 'admin');

    // RPC returns pre-sorted oldest-first
    const rows = makeTrendRows([
      { date: '2026-03-01', total: 1, passed: 1, filtered: 0, ratio: 100 },
      { date: '2026-03-05', total: 1, passed: 0, filtered: 1, ratio: 0 },
      { date: '2026-03-10', total: 1, passed: 1, filtered: 0, ratio: 100 },
    ]);

    mockSupabase.rpc.mockResolvedValueOnce({ data: rows, error: null });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/trend`,
      { searchParams: { granularity: 'daily', period: '30d' } },
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    expect(data[0].date).toBe('2026-03-01');
    expect(data[1].date).toBe('2026-03-05');
    expect(data[2].date).toBe('2026-03-10');
  });

  it('passes through ratio from RPC as percentage 0-100', async () => {
    configureRole(mockSupabase, 'admin');

    const rows = makeTrendRows([
      { date: '2026-03-01', total: 4, passed: 3, filtered: 1, ratio: 75 },
    ]);

    mockSupabase.rpc.mockResolvedValueOnce({ data: rows, error: null });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/trend`,
      { searchParams: { granularity: 'daily', period: '30d' } },
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    expect(data[0].ratio).toBe(75);
    expect(data[0].ratio).toBeGreaterThanOrEqual(0);
    expect(data[0].ratio).toBeLessThanOrEqual(100);
  });

  it('returns 401 for unauthenticated request', async () => {
    configureUnauthenticated(mockSupabase);

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/trend`,
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);

    expect(response.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/trend`,
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);

    expect(response.status).toBe(403);
  });

  it('validates period param', async () => {
    configureRole(mockSupabase, 'admin');

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/trend`,
      { searchParams: { period: '999d' } },
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);

    expect(response.status).toBe(400);
  });

  it('validates granularity param', async () => {
    configureRole(mockSupabase, 'admin');

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/trend`,
      { searchParams: { granularity: 'monthly' } },
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);

    expect(response.status).toBe(400);
  });

  it('each data point has required fields', async () => {
    configureRole(mockSupabase, 'admin');

    const rows = makeTrendRows([
      { date: '2026-03-01', total: 1, passed: 1, filtered: 0, ratio: 100 },
    ]);

    mockSupabase.rpc.mockResolvedValueOnce({ data: rows, error: null });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/trend`,
      { searchParams: { granularity: 'daily', period: '30d' } },
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    expect(data[0]).toEqual(
      expect.objectContaining({
        date: expect.any(String),
        total: expect.any(Number),
        passed: expect.any(Number),
        filtered: expect.any(Number),
        ratio: expect.any(Number),
      }),
    );
  });
});

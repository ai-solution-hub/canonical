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

function makeArticles(
  entries: Array<{ date: string; passed: boolean }>,
) {
  return entries.map((e) => ({
    ingested_at: `${e.date}T12:00:00Z`,
    passed: e.passed,
  }));
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

    const articles = makeArticles([
      { date: '2026-03-01', passed: true },
      { date: '2026-03-01', passed: false },
      { date: '2026-03-01', passed: true },
      { date: '2026-03-02', passed: false },
      { date: '2026-03-02', passed: false },
    ]);

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: articles, error: null, count: articles.length }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/trend`,
      { searchParams: { granularity: 'daily', period: '30d' } },
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(2);

    // Sorted oldest first
    expect(data[0].date).toBe('2026-03-01');
    expect(data[0].total).toBe(3);
    expect(data[0].passed).toBe(2);
    expect(data[0].filtered).toBe(1);
    expect(data[0].ratio).toBe(67); // Math.round(2/3 * 100)

    expect(data[1].date).toBe('2026-03-02');
    expect(data[1].total).toBe(2);
    expect(data[1].passed).toBe(0);
    expect(data[1].filtered).toBe(2);
    expect(data[1].ratio).toBe(0);
  });

  it('returns weekly aggregated buckets', async () => {
    configureRole(mockSupabase, 'admin');

    // All dates in the same ISO week (Mon 2 March to Sun 8 March 2026)
    const articles = makeArticles([
      { date: '2026-03-02', passed: true }, // Monday
      { date: '2026-03-04', passed: true }, // Wednesday
      { date: '2026-03-06', passed: false }, // Friday
    ]);

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: articles, error: null, count: articles.length }),
    );

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

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/trend`,
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([]);
  });

  it('returns empty array when no articles exist', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

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

  it('sorts results oldest-first', async () => {
    configureRole(mockSupabase, 'admin');

    const articles = makeArticles([
      { date: '2026-03-10', passed: true },
      { date: '2026-03-01', passed: true },
      { date: '2026-03-05', passed: false },
    ]);

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: articles, error: null, count: articles.length }),
    );

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

  it('computes ratio as percentage 0-100', async () => {
    configureRole(mockSupabase, 'admin');

    const articles = makeArticles([
      { date: '2026-03-01', passed: true },
      { date: '2026-03-01', passed: true },
      { date: '2026-03-01', passed: true },
      { date: '2026-03-01', passed: false },
    ]);

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: articles, error: null, count: articles.length }),
    );

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

    const articles = makeArticles([
      { date: '2026-03-01', passed: true },
    ]);

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: articles, error: null, count: articles.length }),
    );

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

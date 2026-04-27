/**
 * Tests for GET /api/admin/provenance/pipeline-runs.
 *
 * Verifies auth gates, parameter validation, keyset pagination,
 * rollup computation, partial failure via warningsEnvelope,
 * and the 20k truncation guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Shared mock client + module mocks
// ---------------------------------------------------------------------------

const mockSupabase: MockSupabaseClient = createMockSupabaseClient();

vi.mock('@/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    getAuthorisedClient: vi.fn(),
  };
});

import { GET } from '@/app/api/admin/provenance/pipeline-runs/route';
import { getAuthorisedClient } from '@/lib/auth';

const getAuthorisedClientMock = vi.mocked(getAuthorisedClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PipelineRunRow {
  id: string;
  pipeline_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  items_processed: number | null;
  error_message: string | null;
  source_filename: string | null;
  workspace_id: string | null;
  created_by: string | null;
  result: unknown;
  progress: unknown;
  items_created: string[] | null;
  cost: number | null;
}

function makeRow(
  overrides: Partial<PipelineRunRow> & { id: string; pipeline_name: string },
): PipelineRunRow {
  return {
    status: 'completed',
    started_at: '2026-04-16T08:00:00.000Z',
    completed_at: '2026-04-16T08:01:00.000Z',
    items_processed: 10,
    error_message: null,
    source_filename: null,
    workspace_id: null,
    created_by: null,
    result: null,
    progress: null,
    items_created: null,
    cost: null,
    ...overrides,
  };
}

/**
 * Track how many times `then` is called to resolve list vs rollup queries.
 * The route makes two queries: list first, rollup second.
 */
let thenCallCount = 0;

function mockTwoQueries(
  listRows: PipelineRunRow[],
  rollupRows: Array<{
    pipeline_name: string;
    status: string;
    started_at: string;
    completed_at: string | null;
  }>,
) {
  thenCallCount = 0;
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) => {
      thenCallCount += 1;
      if (thenCallCount === 1) {
        // List query
        return resolve({
          data: listRows,
          error: null,
          count: listRows.length,
        });
      }
      // Rollup query
      return resolve({
        data: rollupRows,
        error: null,
        count: rollupRows.length,
      });
    },
  );
}

function mockListOkRollupError(listRows: PipelineRunRow[]) {
  thenCallCount = 0;
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) => {
      thenCallCount += 1;
      if (thenCallCount === 1) {
        return resolve({
          data: listRows,
          error: null,
          count: listRows.length,
        });
      }
      return resolve({
        data: null,
        error: {
          message: 'rollup failed',
          code: 'PGRST500',
          details: '',
          hint: '',
        },
        count: null,
      });
    },
  );
}

function mockAuthSuccess() {
  getAuthorisedClientMock.mockResolvedValueOnce({
    success: true,
    user: { id: 'admin-user-id', email: 'admin@example.com' },
    supabase: mockSupabase as unknown as Awaited<
      ReturnType<typeof getAuthorisedClient>
    > extends { success: true; supabase: infer S }
      ? S
      : never,
    role: 'admin',
  });
}

function makeRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/admin/provenance/pipeline-runs');
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return new NextRequest(url);
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  getAuthorisedClientMock.mockReset();
  thenCallCount = 0;

  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  const chain = mockSupabase._chain;
  const chainableMethods: (keyof typeof chain)[] = [
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
  ];
  for (const method of chainableMethods) {
    chain[method].mockClear();
    chain[method].mockReturnValue(chain);
  }
  mockSupabase.from.mockClear();
  mockSupabase.from.mockReturnValue(chain);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/provenance/pipeline-runs', () => {
  // ── Auth gates ──────────────────────────
  describe('auth gates', () => {
    it('returns 403 for non-admin users', async () => {
      getAuthorisedClientMock.mockResolvedValueOnce({
        success: false,
        reason: 'forbidden',
      });

      const res = await GET(makeRequest());
      expect(res.status).toBe(403);
    });

    it('returns 401 for unauthenticated users', async () => {
      getAuthorisedClientMock.mockResolvedValueOnce({
        success: false,
        reason: 'unauthenticated',
      });

      const res = await GET(makeRequest());
      expect(res.status).toBe(401);
    });

    it('returns 500 for role lookup failure', async () => {
      getAuthorisedClientMock.mockResolvedValueOnce({
        success: false,
        reason: 'role_lookup_failed',
      });

      const res = await GET(makeRequest());
      expect(res.status).toBe(500);
    });
  });

  // ── Default params ─────────────────────
  describe('default params', () => {
    it('returns 200 with empty rows and rollup when no data', async () => {
      mockAuthSuccess();
      mockTwoQueries([], []);

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.rows).toEqual([]);
      expect(body.rollup).toEqual([]);
      expect(body.hasMore).toBe(false);
      expect(body.nextCursor).toBeNull();
      expect(body.window.range).toBe('24h');
      expect(body.warnings).toBeUndefined();
    });
  });

  // ── Filter application ─────────────────
  describe('filter application', () => {
    it('passes kinds filter to the query chain', async () => {
      mockAuthSuccess();
      mockTwoQueries([], []);

      await GET(makeRequest({ kinds: 'content_gaps,freshness' }));

      // parseSearchParams splits comma-separated values into an array,
      // but the schema transforms string → array. Since parseSearchParams
      // already created the array, the .in() receives the split array.
      const inCalls = mockSupabase._chain.in.mock.calls.filter(
        (c: unknown[]) => c[0] === 'pipeline_name',
      );
      expect(inCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('applies range to the gte filter', async () => {
      // Pin Date.now BEFORE calling the route
      const now = new Date('2026-04-16T12:00:00.000Z').getTime();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      mockAuthSuccess();
      mockTwoQueries([], []);

      await GET(makeRequest({ range: '1h' }));

      // gte should be called with a timestamp ~1h before now
      const gteCall = mockSupabase._chain.gte.mock.calls.find(
        (c: unknown[]) => c[0] === 'started_at',
      );
      expect(gteCall).toBeDefined();
      const sinceTs = new Date(gteCall![1] as string).getTime();
      // The since value should be within 1 second of (now - 1 hour)
      expect(Math.abs(sinceTs - (now - 60 * 60 * 1000))).toBeLessThan(1000);

      vi.restoreAllMocks();
    });
  });

  // ── Invalid range ──────────────────────
  describe('invalid range', () => {
    it('returns 400 for an invalid range value', async () => {
      mockAuthSuccess();

      const res = await GET(makeRequest({ range: '99h' }));
      expect(res.status).toBe(400);
    });
  });

  // ── Limit clamping ─────────────────────
  describe('limit clamping', () => {
    it('clamps limit to max 200', async () => {
      mockAuthSuccess();
      mockTwoQueries([], []);

      await GET(makeRequest({ limit: '500' }));

      // Both list and rollup queries call .limit() on the same mock chain.
      // The list query uses limit+1, the rollup query uses 20000.
      // Find the list limit call (the one that's not 20000).
      const limitCalls = mockSupabase._chain.limit.mock.calls;
      const listLimitCall = limitCalls.find(
        (c: unknown[]) => (c[0] as number) !== 20_000,
      );
      expect(listLimitCall).toBeDefined();
      // Clamped to 200, then +1 for hasMore detection = 201
      expect(listLimitCall![0]).toBe(201);
    });

    it('clamps limit to min 1', async () => {
      mockAuthSuccess();
      mockTwoQueries([], []);

      await GET(makeRequest({ limit: '0' }));

      // Find the list limit call (not the rollup's 20000)
      const limitCalls = mockSupabase._chain.limit.mock.calls;
      const listLimitCall = limitCalls.find(
        (c: unknown[]) => (c[0] as number) !== 20_000,
      );
      expect(listLimitCall).toBeDefined();
      // Clamped to 1, then +1 for hasMore detection = 2
      expect(listLimitCall![0]).toBe(2);
    });
  });

  // ── Cursor pagination ──────────────────
  describe('cursor pagination', () => {
    it('sets hasMore and nextCursor when more rows exist', async () => {
      mockAuthSuccess();

      // Create limit+1 rows (default limit=50, so 51 rows)
      const rows = Array.from({ length: 51 }, (_, i) =>
        makeRow({
          id: `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          pipeline_name: 'test_pipeline',
          started_at: new Date(Date.now() - i * 60_000).toISOString(),
        }),
      );

      mockTwoQueries(rows, []);

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.hasMore).toBe(true);
      expect(body.nextCursor).not.toBeNull();
      expect(body.nextCursor.started_at).toBeDefined();
      expect(body.nextCursor.id).toBeDefined();
      // Should have 50 rows, not 51
      expect(body.rows).toHaveLength(50);
    });

    it('applies keyset cursor via .or() clause', async () => {
      mockAuthSuccess();
      mockTwoQueries([], []);

      await GET(
        makeRequest({
          cursor_started_at: '2026-04-16T08:00:00.000Z',
          cursor_id: 'a0000000-0000-4000-8000-000000000001',
        }),
      );

      expect(mockSupabase._chain.or).toHaveBeenCalledWith(
        expect.stringContaining('started_at.lt.2026-04-16T08:00:00.000Z'),
      );
    });
  });

  // ── 20k truncation warning ─────────────
  describe('rollup truncation', () => {
    it('adds a warning when rollup hits the 20k scan limit', async () => {
      mockAuthSuccess();

      // Generate exactly 20k rollup rows
      const rollupRows = Array.from({ length: 20_000 }, () => ({
        pipeline_name: 'test_pipeline',
        status: 'completed',
        started_at: '2026-04-16T08:00:00.000Z',
        completed_at: '2026-04-16T08:01:00.000Z',
      }));

      mockTwoQueries([], rollupRows);

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.warnings).toBeDefined();
      expect(body.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('truncated')]),
      );
    });
  });

  // ── Partial failure ────────────────────
  describe('partial failure (list ok, rollup error)', () => {
    it('returns rows with a rollup warning', async () => {
      mockAuthSuccess();

      const rows = [
        makeRow({
          id: 'a0000000-0000-4000-8000-000000000001',
          pipeline_name: 'content_gaps',
        }),
      ];

      mockListOkRollupError(rows);

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.rows).toHaveLength(1);
      expect(body.rollup).toEqual([]);
      expect(body.warnings).toBeDefined();
      expect(body.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('rollup could not be computed'),
        ]),
      );
    });
  });

  // ── Rollup computation ─────────────────
  describe('rollup computation', () => {
    it('computes success percentage and groups by pipeline', async () => {
      mockAuthSuccess();

      const rollupRows = [
        {
          pipeline_name: 'alpha',
          status: 'completed',
          started_at: '2026-04-16T10:00:00.000Z',
          completed_at: '2026-04-16T10:01:00.000Z',
        },
        {
          pipeline_name: 'alpha',
          status: 'failed',
          started_at: '2026-04-16T09:00:00.000Z',
          completed_at: null,
        },
        {
          pipeline_name: 'beta',
          status: 'completed',
          started_at: '2026-04-16T10:00:00.000Z',
          completed_at: '2026-04-16T10:02:00.000Z',
        },
      ];

      mockTwoQueries([], rollupRows);

      const res = await GET(makeRequest());
      const body = await res.json();

      // Alpha: 1 completed + 1 failed = 50% success
      const alpha = body.rollup.find(
        (r: { pipelineName: string }) => r.pipelineName === 'alpha',
      );
      expect(alpha).toBeDefined();
      expect(alpha.runs).toBe(2);
      expect(alpha.completed).toBe(1);
      expect(alpha.failed).toBe(1);
      expect(alpha.successPct).toBe(50);

      // Beta: 1 completed / 1 = 100%
      const beta = body.rollup.find(
        (r: { pipelineName: string }) => r.pipelineName === 'beta',
      );
      expect(beta).toBeDefined();
      expect(beta.runs).toBe(1);
      expect(beta.successPct).toBe(100);

      // Sorted alphabetically
      expect(body.rollup[0].pipelineName).toBe('alpha');
      expect(body.rollup[1].pipelineName).toBe('beta');
    });
  });
});

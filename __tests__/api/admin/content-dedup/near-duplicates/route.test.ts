/**
 * GET /api/admin/content-dedup/near-duplicates
 *
 * §1.9 Near-Duplicate Merge Dashboard list endpoint.
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §5.3, §9 AC1/AC2/AC3/AC9/AC10/AC11
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../../../helpers/mock-supabase';
import { createTestRequest } from '../../../../helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
}));

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

vi.mock('@/lib/logger', () => ({
  logger: loggerMocks,
  getRequestContext: () => undefined,
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T) => fn(),
  updateRequestContext: vi.fn(),
  withRequestContext: <T>(handler: T) => handler,
  withRequestContextBare: <T>(handler: T) => handler,
  applyRequestContextToSentry: vi.fn(),
}));

afterEach(() => {
  loggerMocks.info.mockClear();
  loggerMocks.warn.mockClear();
  loggerMocks.error.mockClear();
});

import { GET } from '@/app/api/admin/content-dedup/near-duplicates/route';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';
const ID_D = '44444444-4444-4444-8444-444444444444';

function resetMocks() {
  vi.clearAllMocks();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'admin-user-id', email: 'admin@example.com' } },
    error: null,
  });

  const chainable = [
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
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

function configureRpcRows(rows: Array<Record<string, unknown>>) {
  mockSupabase.rpc.mockResolvedValueOnce({ data: rows, error: null });
}

function configureStatusRows(
  rows: Array<{ id: string; dedup_status: string }>,
) {
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({ data: rows, error: null, count: rows.length }),
  );
}

const SAMPLE_PAIR_AB = {
  id1: ID_A,
  title1: 'How are elevated access rights reviewed?',
  type1: 'q_a_pair',
  domain1: 'access-control',
  id2: ID_B,
  title2: 'How are elevated access rights to systems reviewed? Please specify…',
  type2: 'q_a_pair',
  domain2: 'access-control',
  similarity: 0.943,
};

const SAMPLE_PAIR_CD = {
  id1: ID_C,
  title1: 'Cloud security policy v3',
  type1: 'policy',
  domain1: 'tech-it',
  id2: ID_D,
  title2: 'Cloud security policy v3 (draft)',
  type2: 'policy',
  domain2: 'tech-it',
  similarity: 0.921,
};

describe('GET /api/admin/content-dedup/near-duplicates', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('authentication / RBAC (AC9)', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
      );
      const response = await GET(request);
      expect(response.status).toBe(401);
    });

    it('returns 403 when user has editor role', async () => {
      configureRole(mockSupabase, 'editor');
      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
      );
      const response = await GET(request);
      expect(response.status).toBe(403);
    });

    it('returns 403 when user has viewer role', async () => {
      configureRole(mockSupabase, 'viewer');
      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
      );
      const response = await GET(request);
      expect(response.status).toBe(403);
    });
  });

  describe('threshold validation (AC2)', () => {
    it('returns 400 when threshold below 0.85', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
        { searchParams: { threshold: '0.8' } },
      );
      const response = await GET(request);
      expect(response.status).toBe(400);
    });

    it('returns 400 when threshold above 0.99', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
        { searchParams: { threshold: '1.0' } },
      );
      const response = await GET(request);
      expect(response.status).toBe(400);
    });

    it('returns 400 when limit above 200', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
        { searchParams: { limit: '500' } },
      );
      const response = await GET(request);
      expect(response.status).toBe(400);
    });

    it('defaults the similarity threshold to 0.95 when none is supplied', async () => {
      configureRole(mockSupabase, 'admin');
      configureRpcRows([]);
      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
      );
      const response = await GET(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.threshold).toBe(0.95);
      // Verify RPC called with correct params
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'find_duplicate_pairs',
        expect.objectContaining({
          similarity_threshold: 0.95,
          limit_count: 50,
        }),
      );
    });
  });

  describe('happy path (AC1)', () => {
    it('returns pairs above threshold with similarity scores', async () => {
      configureRole(mockSupabase, 'admin');
      configureRpcRows([SAMPLE_PAIR_AB, SAMPLE_PAIR_CD]);
      configureStatusRows([
        { id: ID_A, dedup_status: 'clean' },
        { id: ID_B, dedup_status: 'clean' },
        { id: ID_C, dedup_status: 'clean' },
        { id: ID_D, dedup_status: 'clean' },
      ]);

      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
        { searchParams: { threshold: '0.92' } },
      );
      const response = await GET(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.threshold).toBe(0.92);
      expect(body.total).toBe(2);
      expect(body.pairs).toHaveLength(2);
      // Nested shape — API remaps RPC's flat ordinal columns into
      // `{ left, right }` so the fetcher type and component consumer
      // line up (V_W1 F1).
      expect(body.pairs[0]).toMatchObject({
        pairId: `${ID_A}__${ID_B}`,
        similarity: 0.943,
        left: {
          id: ID_A,
          title: 'How are elevated access rights reviewed?',
          contentType: 'q_a_pair',
          primaryDomain: 'access-control',
        },
        right: {
          id: ID_B,
          title:
            'How are elevated access rights to systems reviewed? Please specify…',
          contentType: 'q_a_pair',
          primaryDomain: 'access-control',
        },
      });
    });

    it('restricts duplicate pairs to the requested domain (AC3)', async () => {
      configureRole(mockSupabase, 'admin');
      configureRpcRows([]);
      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
        { searchParams: { domain: 'access-control' } },
      );
      const response = await GET(request);
      expect(response.status).toBe(200);
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'find_duplicate_pairs',
        expect.objectContaining({ p_domain: 'access-control' }),
      );
    });
  });

  describe('terminal-status exclusion (AC11)', () => {
    it('filters out pairs where either side is suspected_duplicate', async () => {
      configureRole(mockSupabase, 'admin');
      configureRpcRows([SAMPLE_PAIR_AB, SAMPLE_PAIR_CD]);
      configureStatusRows([
        { id: ID_A, dedup_status: 'suspected_duplicate' }, // AB excluded
        { id: ID_B, dedup_status: 'clean' },
        { id: ID_C, dedup_status: 'clean' },
        { id: ID_D, dedup_status: 'clean' }, // CD kept
      ]);

      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
      );
      const response = await GET(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.total).toBe(1);
      expect(body.pairs[0].left.id).toBe(ID_C);
    });

    it('filters out pairs where either side is confirmed_duplicate', async () => {
      configureRole(mockSupabase, 'admin');
      configureRpcRows([SAMPLE_PAIR_AB]);
      configureStatusRows([
        { id: ID_A, dedup_status: 'clean' },
        { id: ID_B, dedup_status: 'confirmed_duplicate' },
      ]);

      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
      );
      const response = await GET(request);
      const body = await response.json();
      expect(body.total).toBe(0);
    });

    it('filters out pairs where either side is superseded', async () => {
      configureRole(mockSupabase, 'admin');
      configureRpcRows([SAMPLE_PAIR_AB]);
      configureStatusRows([
        { id: ID_A, dedup_status: 'superseded' },
        { id: ID_B, dedup_status: 'clean' },
      ]);

      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
      );
      const response = await GET(request);
      const body = await response.json();
      expect(body.total).toBe(0);
    });

    it('keeps pairs where both sides are clean OR confirmed_unique', async () => {
      configureRole(mockSupabase, 'admin');
      configureRpcRows([SAMPLE_PAIR_AB, SAMPLE_PAIR_CD]);
      configureStatusRows([
        { id: ID_A, dedup_status: 'confirmed_unique' },
        { id: ID_B, dedup_status: 'clean' },
        { id: ID_C, dedup_status: 'clean' },
        { id: ID_D, dedup_status: 'clean' },
      ]);

      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
      );
      const response = await GET(request);
      const body = await response.json();
      expect(body.total).toBe(2);
    });
  });

  describe('empty state (AC10)', () => {
    it('returns empty pairs array when RPC returns no rows', async () => {
      configureRole(mockSupabase, 'admin');
      configureRpcRows([]);

      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
      );
      const response = await GET(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        pairs: [],
        threshold: 0.95,
        total: 0,
      });
    });
  });

  describe('error handling', () => {
    it('returns 500 when RPC errors', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'rpc boom' },
      });

      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
      );
      const response = await GET(request);
      expect(response.status).toBe(500);
    });

    it('returns 500 when status lookup errors', async () => {
      configureRole(mockSupabase, 'admin');
      configureRpcRows([SAMPLE_PAIR_AB]);
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: null,
            error: { message: 'status lookup boom' },
            count: 0,
          }),
      );

      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates',
      );
      const response = await GET(request);
      expect(response.status).toBe(500);
    });
  });
});

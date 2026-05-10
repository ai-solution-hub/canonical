/**
 * POST /api/admin/content-dedup/near-duplicates/[pairId]/confirm-unique
 *
 * §1.9 Near-Duplicate Merge Dashboard confirm-unique action.
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §5.6, §9 AC6/AC7/AC9
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../../../helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '../../../../helpers/mock-next';

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

import { POST } from '@/app/api/admin/content-dedup/near-duplicates/[pairId]/confirm-unique/route';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const PAIR_ID = `${ID_A}__${ID_B}`;

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

function configurePairExists() {
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({
        data: [{ id: ID_A }, { id: ID_B }],
        error: null,
        count: 2,
      }),
  );
}

function configureRpcOk() {
  mockSupabase.rpc.mockResolvedValueOnce({
    data: [
      { id: ID_A, dedup_status: 'confirmed_unique' },
      { id: ID_B, dedup_status: 'confirmed_unique' },
    ],
    error: null,
  });
}

describe('POST /api/admin/content-dedup/near-duplicates/[pairId]/confirm-unique', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('authentication / RBAC (AC9)', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(401);
    });

    it('returns 403 when user has editor role', async () => {
      configureRole(mockSupabase, 'editor');
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(403);
    });

    it('returns 403 when user has viewer role', async () => {
      configureRole(mockSupabase, 'viewer');
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(403);
    });
  });

  describe('pair-id + body validation', () => {
    it('returns 400 for invalid pair-id', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        '/api/admin/content-dedup/near-duplicates/not-a-pair/confirm-unique',
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: 'not-a-pair' }),
      });
      expect(response.status).toBe(400);
    });

    it('returns 400 when note > 500 chars', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        { method: 'POST', body: { note: 'x'.repeat(501) } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(400);
    });

    it('accepts empty body (note is optional)', async () => {
      configureRole(mockSupabase, 'admin');
      configurePairExists();
      configureRpcOk();
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(200);
    });
  });

  describe('happy path (AC6)', () => {
    it('returns 200 with confirm-unique response shape', async () => {
      configureRole(mockSupabase, 'admin');
      configurePairExists();
      configureRpcOk();

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        { method: 'POST', body: { note: 'intentionally distinct' } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        pairId: PAIR_ID,
        leftDedupStatus: 'confirmed_unique',
        rightDedupStatus: 'confirmed_unique',
      });
    });

    it('invokes RPC with correct params (AC6, AC7)', async () => {
      configureRole(mockSupabase, 'admin');
      configurePairExists();
      configureRpcOk();

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        { method: 'POST', body: { note: 'intentionally distinct' } },
      );
      await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'resolve_near_dup_confirm_unique',
        {
          p_left_id: ID_A,
          p_right_id: ID_B,
          p_actor_user_id: 'admin-user-id',
          p_pair_id: PAIR_ID,
          p_note: 'intentionally distinct',
          p_similarity_at_resolution: undefined,
          p_threshold_at_resolution: undefined,
        },
      );
    });

    it('omits the resolution note when none is supplied in the request body', async () => {
      configureRole(mockSupabase, 'admin');
      configurePairExists();
      configureRpcOk();

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'resolve_near_dup_confirm_unique',
        expect.objectContaining({ p_note: undefined }),
      );
    });

    it('records similarity and threshold scores at resolution time (OQ2)', async () => {
      configureRole(mockSupabase, 'admin');
      configurePairExists();
      configureRpcOk();

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        {
          method: 'POST',
          body: {
            note: 'intentionally distinct',
            similarity_at_resolution: 0.943,
            threshold_at_resolution: 0.92,
          },
        },
      );
      await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'resolve_near_dup_confirm_unique',
        expect.objectContaining({
          p_similarity_at_resolution: 0.943,
          p_threshold_at_resolution: 0.92,
        }),
      );
    });

    it('does NOT write content_history from the route (RPC owns it)', async () => {
      configureRole(mockSupabase, 'admin');
      configurePairExists();
      configureRpcOk();

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });

      // Route MUST NOT call .from('content_history').insert(...) — that is
      // the RPC's responsibility per §5.6 transactional integrity decision.
      // Only `from('content_items')` is permitted (pre-check).
      const fromCalls = mockSupabase.from.mock.calls.map((c) => c[0]);
      expect(fromCalls).not.toContain('content_history');
    });
  });

  describe('idempotency', () => {
    it('returns 200 even when both rows are already confirmed_unique (RPC short-circuits)', async () => {
      configureRole(mockSupabase, 'admin');
      configurePairExists();
      // RPC returns the unchanged state (no flips, no history rows)
      mockSupabase.rpc.mockResolvedValueOnce({
        data: [
          { id: ID_A, dedup_status: 'confirmed_unique' },
          { id: ID_B, dedup_status: 'confirmed_unique' },
        ],
        error: null,
      });

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(200);
    });
  });

  describe('not found', () => {
    it('returns 404 when pair does not exist', async () => {
      configureRole(mockSupabase, 'admin');
      // pair-existence pre-check returns 0 rows
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null, count: 0 }),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(404);
      // RPC must NOT be called if pair pre-check fails
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });

    it('returns 404 when only one row exists', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [{ id: ID_A }], error: null, count: 1 }),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(404);
    });
  });

  describe('error handling', () => {
    it('returns 500 when pre-check errors', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: null,
            error: { message: 'pre-check boom' },
            count: 0,
          }),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(500);
    });

    it('returns 500 when RPC errors', async () => {
      configureRole(mockSupabase, 'admin');
      configurePairExists();
      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'rpc boom' },
      });

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(500);
    });
  });
});

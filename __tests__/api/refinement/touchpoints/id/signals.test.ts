/**
 * GET /api/refinement/touchpoints/[id]/signals
 *
 * ID-104.16 — /admin/refinement stub-spine (T22 / B-INV-22).
 * Spec: specs/id-104-eval-engine/TECH.md §T22, PRODUCT.md §B-INV-22.
 *
 * Auth: admin-only, gated via authFailureResponse(auth).
 * NOT in proxy.ts publicRoutes — non-admins redirect to /login.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  },
  getRequestContext: () => undefined,
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T) => fn(),
  updateRequestContext: vi.fn(),
  withRequestContext: <T>(handler: T) => handler,
  withRequestContextBare: <T>(handler: T) => handler,
  applyRequestContextToSentry: vi.fn(),
}));

import { GET } from '@/app/api/refinement/touchpoints/[id]/signals/route';

const TOUCHPOINT_ID = 'mcp:search-documents';

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
}

describe('GET /api/refinement/touchpoints/[id]/signals', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('authentication', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const req = createTestRequest(
        `/api/refinement/touchpoints/${TOUCHPOINT_ID}/signals`,
      );
      const res = await GET(req, {
        params: createTestParams({ id: TOUCHPOINT_ID }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 403 for editor role', async () => {
      configureRole(mockSupabase, 'editor');
      const req = createTestRequest(
        `/api/refinement/touchpoints/${TOUCHPOINT_ID}/signals`,
      );
      const res = await GET(req, {
        params: createTestParams({ id: TOUCHPOINT_ID }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');
      const req = createTestRequest(
        `/api/refinement/touchpoints/${TOUCHPOINT_ID}/signals`,
      );
      const res = await GET(req, {
        params: createTestParams({ id: TOUCHPOINT_ID }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('happy path — admin', () => {
    it('returns 200 with signal rows for a registered touchpoint', async () => {
      configureRole(mockSupabase, 'admin');
      const signalRows = [
        {
          id: '1',
          touchpoint_id: TOUCHPOINT_ID,
          outcome_signal: 'win',
          created_at: '2026-06-01T10:00:00Z',
        },
        {
          id: '2',
          touchpoint_id: TOUCHPOINT_ID,
          outcome_signal: 'fail',
          created_at: '2026-06-02T10:00:00Z',
        },
      ];
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: signalRows, error: null, count: 2 }),
      );

      const req = createTestRequest(
        `/api/refinement/touchpoints/${TOUCHPOINT_ID}/signals`,
      );
      const res = await GET(req, {
        params: createTestParams({ id: TOUCHPOINT_ID }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.touchpoint_id).toBe(TOUCHPOINT_ID);
      expect(Array.isArray(body.signals)).toBe(true);
      expect(body.signals).toHaveLength(2);
    });

    it('returns 200 with empty signals array when no events recorded', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null, count: 0 }),
      );

      const req = createTestRequest(
        `/api/refinement/touchpoints/${TOUCHPOINT_ID}/signals`,
      );
      const res = await GET(req, {
        params: createTestParams({ id: TOUCHPOINT_ID }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.signals).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('returns 500 when Supabase query fails', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: null,
            error: { message: 'connection refused' },
            count: null,
          }),
      );

      const req = createTestRequest(
        `/api/refinement/touchpoints/${TOUCHPOINT_ID}/signals`,
      );
      const res = await GET(req, {
        params: createTestParams({ id: TOUCHPOINT_ID }),
      });
      expect(res.status).toBe(500);
    });
  });
});

/**
 * GET /api/refinement/touchpoints/[id]/version-history
 *
 * ID-104.16 — /admin/refinement stub-spine (T22 / B-INV-22).
 * Spec: specs/id-104-eval-engine/TECH.md §T22, PRODUCT.md §B-INV-22.
 *
 * Returns the contract_version history for a touchpoint from eval_touchpoints.
 * Auth: admin-only. NOT in proxy.ts publicRoutes.
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

import { GET } from '@/app/api/refinement/touchpoints/[id]/version-history/route';

const TOUCHPOINT_ID = 'mcp:search-documents';

const TOUCHPOINT_ROW = {
  touchpoint_id: TOUCHPOINT_ID,
  kind: 'mcp-tool',
  owner: 'search',
  suite_name: 'l1',
  grounding_shape: 'document-search',
  severity_on_fail: 'warn',
  variance_band: 0.02,
  graduation_metric: null,
  contract_version: 3,
  registry_version: 5,
  file_sha256: null,
};

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

describe('GET /api/refinement/touchpoints/[id]/version-history', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('authentication', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const req = createTestRequest(
        `/api/refinement/touchpoints/${TOUCHPOINT_ID}/version-history`,
      );
      const res = await GET(req, {
        params: createTestParams({ id: TOUCHPOINT_ID }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin roles', async () => {
      configureRole(mockSupabase, 'editor');
      const req = createTestRequest(
        `/api/refinement/touchpoints/${TOUCHPOINT_ID}/version-history`,
      );
      const res = await GET(req, {
        params: createTestParams({ id: TOUCHPOINT_ID }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('happy path — admin', () => {
    it('returns 200 with touchpoint contract_version and registry_version', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: TOUCHPOINT_ROW,
        error: null,
      });

      const req = createTestRequest(
        `/api/refinement/touchpoints/${TOUCHPOINT_ID}/version-history`,
      );
      const res = await GET(req, {
        params: createTestParams({ id: TOUCHPOINT_ID }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.touchpoint_id).toBe(TOUCHPOINT_ID);
      expect(body.contract_version).toBe(3);
      expect(body.registry_version).toBe(5);
    });

    it('returns 404 when touchpoint not registered', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const req = createTestRequest(
        `/api/refinement/touchpoints/${TOUCHPOINT_ID}/version-history`,
      );
      const res = await GET(req, {
        params: createTestParams({ id: TOUCHPOINT_ID }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('error handling', () => {
    it('returns 500 on Supabase error', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'connection refused', code: 'PGRST999' },
      });

      const req = createTestRequest(
        `/api/refinement/touchpoints/${TOUCHPOINT_ID}/version-history`,
      );
      const res = await GET(req, {
        params: createTestParams({ id: TOUCHPOINT_ID }),
      });
      expect(res.status).toBe(500);
    });
  });
});

/**
 * GET /api/refinement/touchpoints/[id]/patterns
 *
 * ID-104.16 — /admin/refinement stub-spine (T22 / B-INV-22).
 * Spec: specs/id-104-eval-engine/TECH.md §T22, PRODUCT.md §B-INV-22.
 *
 * `patterns` ships PRESENT-BUT-EMPTY — empty-200 with a stable shape,
 * NOT 404/absent. Backs the deferred organ (T24 / {104.19}).
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

import { GET } from '@/app/api/refinement/touchpoints/[id]/patterns/route';

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

describe('GET /api/refinement/touchpoints/[id]/patterns', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('authentication', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const req = createTestRequest(
        `/api/refinement/touchpoints/${TOUCHPOINT_ID}/patterns`,
      );
      const res = await GET(req, {
        params: createTestParams({ id: TOUCHPOINT_ID }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin roles', async () => {
      configureRole(mockSupabase, 'editor');
      const req = createTestRequest(
        `/api/refinement/touchpoints/${TOUCHPOINT_ID}/patterns`,
      );
      const res = await GET(req, {
        params: createTestParams({ id: TOUCHPOINT_ID }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('present-but-empty (deferred organ anchor)', () => {
    it('returns 200 with stable empty shape — NOT 404', async () => {
      configureRole(mockSupabase, 'admin');
      const req = createTestRequest(
        `/api/refinement/touchpoints/${TOUCHPOINT_ID}/patterns`,
      );
      const res = await GET(req, {
        params: createTestParams({ id: TOUCHPOINT_ID }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.touchpoint_id).toBe(TOUCHPOINT_ID);
      expect(Array.isArray(body.patterns)).toBe(true);
      expect(body.patterns).toHaveLength(0);
      // Stable shape: deferred flag present so follow-up task ({104.19}) can fill it
      expect(body.deferred).toBe(true);
      // Anchor names the deferred organ it backs ({104.19} / B-INV-24).
      expect(body.deferred_organs).toEqual(['pattern_detector']);
    });
  });
});

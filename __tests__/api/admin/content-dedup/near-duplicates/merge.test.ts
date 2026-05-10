/**
 * POST /api/admin/content-dedup/near-duplicates/[pairId]/merge
 *
 * §1.9 Near-Duplicate Merge Dashboard merge action.
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §5.5, §9 AC5/AC7/AC9
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

const { mockSetSupersession } = vi.hoisted(() => ({
  mockSetSupersession: vi.fn(),
}));

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

vi.mock('@/lib/supersession/set', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supersession/set')>(
    '@/lib/supersession/set',
  );
  return {
    ...actual,
    setSupersession: mockSetSupersession,
  };
});

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

import { POST } from '@/app/api/admin/content-dedup/near-duplicates/[pairId]/merge/route';
import { SupersessionError } from '@/lib/supersession/set';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_OTHER = '99999999-9999-4999-8999-999999999999';
const PAIR_ID = `${ID_A}__${ID_B}`;

const LOSER_ROW = {
  id: ID_A,
  title: 'Loser title',
  suggested_title: null,
  content: 'loser body',
  brief: null,
  detail: null,
  reference: null,
  metadata: { foo: 'bar' },
};

function resetMocks() {
  vi.clearAllMocks();
  mockSetSupersession.mockReset();

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

function configureLoserLoadOk() {
  // First chain hit after auth/role: maybeSingle on loser row
  mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
    data: LOSER_ROW,
    error: null,
  });
}

function configureHelperOk() {
  mockSetSupersession.mockResolvedValue({
    oldItem: {
      id: ID_A,
      title: LOSER_ROW.title,
      superseded_by: ID_B,
      dedup_status: 'superseded',
    },
    newItem: {
      id: ID_B,
      title: 'Winner title',
      superseded_by: null,
      dedup_status: 'clean',
    },
  });
  // history version lookup
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [{ version: 2 }], error: null, count: 1 }),
  );
}

describe('POST /api/admin/content-dedup/near-duplicates/[pairId]/merge', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('authentication / RBAC (AC9)', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_A, newId: ID_B } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(401);
    });

    it('returns 403 when user has editor role', async () => {
      configureRole(mockSupabase, 'editor');
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_A, newId: ID_B } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(403);
    });

    it('returns 403 when user has viewer role', async () => {
      configureRole(mockSupabase, 'viewer');
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_A, newId: ID_B } },
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
        '/api/admin/content-dedup/near-duplicates/not-a-pair/merge',
        { method: 'POST', body: { oldId: ID_A, newId: ID_B } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: 'not-a-pair' }),
      });
      expect(response.status).toBe(400);
    });

    it('returns 400 when oldId is missing', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { newId: ID_B } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(400);
    });

    it('returns 400 when newId is missing', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_A } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(400);
    });

    it('returns 400 when oldId === newId (Zod refine)', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_A, newId: ID_A } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(400);
    });

    it('returns 400 when oldId is not a member of the pair', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_OTHER, newId: ID_B } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(400);
      expect(mockSetSupersession).not.toHaveBeenCalled();
    });

    it('returns 400 when newId is not a member of the pair', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_A, newId: ID_OTHER } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(400);
      expect(mockSetSupersession).not.toHaveBeenCalled();
    });

    it('returns 400 when note > 500 chars', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        {
          method: 'POST',
          body: { oldId: ID_A, newId: ID_B, note: 'x'.repeat(501) },
        },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('happy path (AC5, AC7)', () => {
    it('returns 200 with merge response shape', async () => {
      configureRole(mockSupabase, 'admin');
      configureLoserLoadOk();
      configureHelperOk();

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_A, newId: ID_B } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        pairId: PAIR_ID,
        oldId: ID_A,
        newId: ID_B,
        dedup_status: 'superseded',
      });
    });

    it('invokes setSupersession with oldId, newId, actorUserId (AC5)', async () => {
      configureRole(mockSupabase, 'admin');
      configureLoserLoadOk();
      configureHelperOk();

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_A, newId: ID_B } },
      );
      await POST(request, { params: createTestParams({ pairId: PAIR_ID }) });

      expect(mockSetSupersession).toHaveBeenCalledTimes(1);
      expect(mockSetSupersession.mock.calls[0][0]).toEqual({
        oldId: ID_A,
        newId: ID_B,
        actorUserId: 'admin-user-id',
      });
    });

    it('inserts content_history with metadata.pairId/oldId/newId/note + similarity_at_resolution + threshold_at_resolution (AC7)', async () => {
      configureRole(mockSupabase, 'admin');
      configureLoserLoadOk();
      configureHelperOk();

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        {
          method: 'POST',
          body: {
            oldId: ID_A,
            newId: ID_B,
            note: 'merging duplicate ingest',
            similarity_at_resolution: 0.943,
            threshold_at_resolution: 0.92,
          },
        },
      );
      await POST(request, { params: createTestParams({ pairId: PAIR_ID }) });

      expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          content_item_id: ID_A,
          version: 3, // 2 + 1
          change_type: 'merge',
          change_reason: 'dedup_admin_review_near_dup_merged',
          created_by: 'admin-user-id',
          metadata: expect.objectContaining({
            pairId: PAIR_ID,
            oldId: ID_A,
            newId: ID_B,
            peerId: ID_B,
            note: 'merging duplicate ingest',
            similarity_at_resolution: 0.943,
            threshold_at_resolution: 0.92,
            dedup_review_action: 'near_dup_merge',
          }),
        }),
      );
    });

    it('still records the merge with placeholder snapshot when loading the loser fails', async () => {
      configureRole(mockSupabase, 'admin');
      // Loser load returns error — route should still proceed
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'loser load boom' },
      });
      configureHelperOk();

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_A, newId: ID_B } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(200);
      // history insert still happens with fallback title/content
      expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Untitled',
          content: '',
        }),
      );
    });
  });

  describe('SupersessionError mapping', () => {
    it('returns 404 on OLD_NOT_FOUND', async () => {
      configureRole(mockSupabase, 'admin');
      configureLoserLoadOk();
      mockSetSupersession.mockRejectedValueOnce(
        new SupersessionError('OLD_NOT_FOUND', `Old item not found: ${ID_A}`, {
          oldId: ID_A,
        }),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_A, newId: ID_B } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.code).toBe('OLD_NOT_FOUND');
    });

    it('returns 404 on NEW_NOT_FOUND', async () => {
      configureRole(mockSupabase, 'admin');
      configureLoserLoadOk();
      mockSetSupersession.mockRejectedValueOnce(
        new SupersessionError('NEW_NOT_FOUND', `New item not found: ${ID_B}`, {
          newId: ID_B,
        }),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_A, newId: ID_B } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(404);
    });

    it('returns 409 on OLD_ALREADY_SUPERSEDED', async () => {
      configureRole(mockSupabase, 'admin');
      configureLoserLoadOk();
      mockSetSupersession.mockRejectedValueOnce(
        new SupersessionError(
          'OLD_ALREADY_SUPERSEDED',
          `Old item ${ID_A} already superseded`,
          { oldId: ID_A, existingSupersededBy: ID_B },
        ),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_A, newId: ID_B } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.code).toBe('OLD_ALREADY_SUPERSEDED');
    });

    it('returns 409 on NEW_ALREADY_SUPERSEDED', async () => {
      configureRole(mockSupabase, 'admin');
      configureLoserLoadOk();
      mockSetSupersession.mockRejectedValueOnce(
        new SupersessionError('NEW_ALREADY_SUPERSEDED', 'chain prevention', {}),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_A, newId: ID_B } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(409);
    });

    it('returns 409 on SAME_ID (defensive — Zod refine catches first)', async () => {
      configureRole(mockSupabase, 'admin');
      configureLoserLoadOk();
      mockSetSupersession.mockRejectedValueOnce(
        new SupersessionError('SAME_ID', 'cannot supersede self', {}),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        // We bypass Zod's same-id refine by sending different valid pair
        // members, so the helper-level SAME_ID is the only path here. The
        // route maps it to 409 per spec §5.7.
        { method: 'POST', body: { oldId: ID_A, newId: ID_B } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(409);
    });

    it('returns 500 on unexpected helper error', async () => {
      configureRole(mockSupabase, 'admin');
      configureLoserLoadOk();
      mockSetSupersession.mockRejectedValueOnce(
        new Error('boom — unexpected DB failure'),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}/merge`,
        { method: 'POST', body: { oldId: ID_A, newId: ID_B } },
      );
      const response = await POST(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(500);
    });
  });
});

/**
 * POST /api/admin/content-dedup/[id]/supersede
 *
 * §1.7 Admin Cross-System Dedup Review (S211B).
 * Spec: docs/specs/§1.7-admin-dedup-review-spec.md §5.1, §4.2, §4.3
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../../helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '../../../helpers/mock-next';

// ---------------------------------------------------------------------------
// Hoisted mocks for supersession helper
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockSetSupersession } = vi.hoisted(() => ({
  mockSetSupersession: vi.fn(),
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
  const actual =
    await vi.importActual<typeof import('@/lib/supersession/set')>(
      '@/lib/supersession/set',
    );
  return {
    ...actual,
    setSupersession: mockSetSupersession,
  };
});

vi.spyOn(console, 'error').mockImplementation(() => {});

import { POST } from '@/app/api/admin/content-dedup/[id]/supersede/route';
import { SupersessionError } from '@/lib/supersession/set';

const SUBJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const CANONICAL_ID = 'a4d8e1f2-3b6c-4d7e-9f8a-1b2c3d4e5f60';

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

const SUBJECT_ROW = {
  id: SUBJECT_ID,
  title: 'Cloud security policy v3',
  suggested_title: null,
  content: 'subject body',
  brief: null,
  detail: null,
  reference: null,
  metadata: { suspected_duplicate_of: CANONICAL_ID },
  dedup_status: 'suspected_duplicate',
  archived_at: null,
  superseded_by: null,
};

function configureSubjectLoadOk() {
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: SUBJECT_ROW,
    error: null,
  });
}

function configureHelperHappyPath() {
  mockSetSupersession.mockResolvedValue({
    oldItem: {
      id: SUBJECT_ID,
      title: SUBJECT_ROW.title,
      superseded_by: CANONICAL_ID,
      dedup_status: 'superseded',
    },
    newItem: {
      id: CANONICAL_ID,
      title: 'Cloud security policy',
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

describe('POST /api/admin/content-dedup/[id]/supersede', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('authentication', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        { method: 'POST', body: { canonicalId: CANONICAL_ID } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(401);
    });

    it('returns 403 when user has editor role', async () => {
      configureRole(mockSupabase, 'editor');
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        { method: 'POST', body: { canonicalId: CANONICAL_ID } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(403);
    });
  });

  describe('UUID + body validation', () => {
    it('returns 400 for invalid path UUID', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        '/api/admin/content-dedup/not-a-uuid/supersede',
        { method: 'POST', body: { canonicalId: CANONICAL_ID } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: 'not-a-uuid' }),
      });
      expect(response.status).toBe(400);
    });

    it('returns 400 when canonicalId is missing', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(400);
    });

    it('returns 400 when canonicalId is invalid UUID', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        { method: 'POST', body: { canonicalId: 'not-a-uuid' } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(400);
    });

    it('returns 400 when note > 500 chars', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        {
          method: 'POST',
          body: { canonicalId: CANONICAL_ID, note: 'x'.repeat(501) },
        },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('happy path', () => {
    it('returns 200 with id, superseded_by, dedup_status="superseded"', async () => {
      configureRole(mockSupabase, 'admin');
      configureSubjectLoadOk();
      configureHelperHappyPath();

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        {
          method: 'POST',
          body: { canonicalId: CANONICAL_ID, note: 'rev2 supersedes' },
        },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe(SUBJECT_ID);
      expect(body.superseded_by).toBe(CANONICAL_ID);
      expect(body.dedup_status).toBe('superseded');
    });

    it('invokes setSupersession with oldId=subject, newId=canonical, actorUserId=user.id', async () => {
      configureRole(mockSupabase, 'admin');
      configureSubjectLoadOk();
      configureHelperHappyPath();

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        { method: 'POST', body: { canonicalId: CANONICAL_ID } },
      );
      await POST(request, { params: createTestParams({ id: SUBJECT_ID }) });

      expect(mockSetSupersession).toHaveBeenCalledTimes(1);
      const callArgs = mockSetSupersession.mock.calls[0];
      expect(callArgs[0]).toEqual({
        oldId: SUBJECT_ID,
        newId: CANONICAL_ID,
        actorUserId: 'admin-user-id',
      });
    });

    it('inserts content_history with change_reason="dedup_admin_review_superseded"', async () => {
      configureRole(mockSupabase, 'admin');
      configureSubjectLoadOk();
      configureHelperHappyPath();

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        { method: 'POST', body: { canonicalId: CANONICAL_ID } },
      );
      await POST(request, { params: createTestParams({ id: SUBJECT_ID }) });

      expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          content_item_id: SUBJECT_ID,
          version: 3, // 2 + 1
          change_type: 'merge',
          change_reason: 'dedup_admin_review_superseded',
          created_by: 'admin-user-id',
          metadata: expect.objectContaining({
            superseded_by: CANONICAL_ID,
            dedup_review_action: 'supersede',
          }),
        }),
      );
    });
  });

  describe('helper error mapping', () => {
    it('returns 404 on OLD_NOT_FOUND from setSupersession', async () => {
      configureRole(mockSupabase, 'admin');
      configureSubjectLoadOk();
      mockSetSupersession.mockRejectedValueOnce(
        new SupersessionError('OLD_NOT_FOUND', `Old item not found: ${SUBJECT_ID}`, {
          oldId: SUBJECT_ID,
        }),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        { method: 'POST', body: { canonicalId: CANONICAL_ID } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.code).toBe('OLD_NOT_FOUND');
    });

    it('returns 404 on NEW_NOT_FOUND', async () => {
      configureRole(mockSupabase, 'admin');
      configureSubjectLoadOk();
      mockSetSupersession.mockRejectedValueOnce(
        new SupersessionError(
          'NEW_NOT_FOUND',
          `New item not found: ${CANONICAL_ID}`,
          { newId: CANONICAL_ID },
        ),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        { method: 'POST', body: { canonicalId: CANONICAL_ID } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(404);
    });

    it('returns 409 on OLD_ALREADY_SUPERSEDED', async () => {
      configureRole(mockSupabase, 'admin');
      configureSubjectLoadOk();
      mockSetSupersession.mockRejectedValueOnce(
        new SupersessionError(
          'OLD_ALREADY_SUPERSEDED',
          `Old item ${SUBJECT_ID} already superseded`,
          { oldId: SUBJECT_ID, existingSupersededBy: CANONICAL_ID },
        ),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        { method: 'POST', body: { canonicalId: CANONICAL_ID } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.code).toBe('OLD_ALREADY_SUPERSEDED');
    });

    it('returns 409 on NEW_ALREADY_SUPERSEDED', async () => {
      configureRole(mockSupabase, 'admin');
      configureSubjectLoadOk();
      mockSetSupersession.mockRejectedValueOnce(
        new SupersessionError(
          'NEW_ALREADY_SUPERSEDED',
          'chain prevention',
          {},
        ),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        { method: 'POST', body: { canonicalId: CANONICAL_ID } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(409);
    });

    it('returns 409 on SAME_ID', async () => {
      configureRole(mockSupabase, 'admin');
      configureSubjectLoadOk();
      mockSetSupersession.mockRejectedValueOnce(
        new SupersessionError('SAME_ID', 'cannot supersede self', {}),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        { method: 'POST', body: { canonicalId: CANONICAL_ID } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(409);
    });

    it('returns 500 on unexpected helper error (e.g. SupabaseError)', async () => {
      configureRole(mockSupabase, 'admin');
      configureSubjectLoadOk();
      mockSetSupersession.mockRejectedValueOnce(
        new Error('boom — unexpected DB failure'),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        { method: 'POST', body: { canonicalId: CANONICAL_ID } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(500);
    });
  });

  describe('subject guards', () => {
    it('returns 404 when subject not found (PGRST116) before helper is called', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'no rows' },
      });

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        { method: 'POST', body: { canonicalId: CANONICAL_ID } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(404);
      expect(mockSetSupersession).not.toHaveBeenCalled();
    });

    it('returns 409 when subject is no longer suspected_duplicate', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { ...SUBJECT_ROW, dedup_status: 'confirmed_duplicate' },
        error: null,
      });

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        { method: 'POST', body: { canonicalId: CANONICAL_ID } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(409);
      expect(mockSetSupersession).not.toHaveBeenCalled();
    });
  });
});

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

  describe('happy path (Direction A — default)', () => {
    it('returns 200 with new D9 response shape (canonical-supersedes-subject)', async () => {
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
      expect(body).toEqual({
        pathId: SUBJECT_ID,
        retiredId: SUBJECT_ID,
        canonicalId: CANONICAL_ID,
        direction: 'canonical-supersedes-subject',
        retiredDedupStatus: 'superseded',
      });
      // Direction-A response intentionally omits pathDedupStatus — the
      // path IS the retired side.
      expect(body.pathDedupStatus).toBeUndefined();
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

    it('inserts content_history with new metadata (direction + peerId)', async () => {
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
            direction: 'canonical-supersedes-subject',
            peerId: CANONICAL_ID,
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

  // ─────────────────────────────────────────────────────────────────────
  // Direction-B + new-guard tests (B-1..B-6 from §1.7 fix-spec §2.8).
  // ─────────────────────────────────────────────────────────────────────

  describe('Direction B (subject-supersedes-canonical)', () => {
    function configureDirectionBHappyPath() {
      mockSetSupersession.mockResolvedValue({
        oldItem: {
          id: CANONICAL_ID,
          title: 'Cloud security policy',
          superseded_by: SUBJECT_ID,
          dedup_status: 'superseded',
        },
        newItem: {
          id: SUBJECT_ID,
          title: SUBJECT_ROW.title,
          superseded_by: null,
          dedup_status: 'suspected_duplicate',
        },
      });
      // Direction-B awaits the chain five times in sequence (each
      // `await` on the chain consumes a `.then` mock):
      //   1. UPDATE subject dedup_status='confirmed_unique'
      //   2. SELECT version on canonical (history lookup)
      //   3. INSERT canonical history (await consumes the chain)
      //   4. SELECT version on subject (history lookup)
      //   5. INSERT subject history (await consumes the chain)
      // We mock #2 + #4 to return the per-row version sequence; #1, #3,
      // #5 we leave for the default mockImplementation (data=[], no err).
      // .then() consumes mockImplementationOnce in order, so we
      // explicitly enqueue 5 entries to keep the sequence deterministic.
      mockSupabase._chain.then
        // #1 UPDATE subject
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null, count: 0 }),
        )
        // #2 canonical version lookup → 2 (next=3)
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({ data: [{ version: 2 }], error: null, count: 1 }),
        )
        // #3 canonical INSERT
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null, count: 0 }),
        )
        // #4 subject version lookup → 2 (next=3)
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({ data: [{ version: 2 }], error: null, count: 1 }),
        )
        // #5 subject INSERT
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null, count: 0 }),
        );
    }

    it('B-1: happy path — helper called with reversed oldId/newId, response shape matches D9 reverse', async () => {
      configureRole(mockSupabase, 'admin');
      configureSubjectLoadOk();
      configureDirectionBHappyPath();

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        {
          method: 'POST',
          body: {
            canonicalId: CANONICAL_ID,
            direction: 'subject-supersedes-canonical',
          },
        },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        pathId: SUBJECT_ID,
        retiredId: CANONICAL_ID,
        canonicalId: CANONICAL_ID,
        direction: 'subject-supersedes-canonical',
        retiredDedupStatus: 'superseded',
        pathDedupStatus: 'confirmed_unique',
      });

      // Helper called with the ROLE-SWAPPED ids: canonical = old, subject = new.
      expect(mockSetSupersession).toHaveBeenCalledTimes(1);
      expect(mockSetSupersession.mock.calls[0][0]).toEqual({
        oldId: CANONICAL_ID,
        newId: SUBJECT_ID,
        actorUserId: 'admin-user-id',
      });

      // Subject UPDATE flips dedup_status to 'confirmed_unique' so the
      // queue clears.
      expect(mockSupabase._chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ dedup_status: 'confirmed_unique' }),
      );

      // 2 history rows inserted: against canonical (merge) + against
      // subject (metadata_change), both with the new metadata fields.
      expect(mockSupabase._chain.insert).toHaveBeenCalledTimes(2);
      expect(mockSupabase._chain.insert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          content_item_id: CANONICAL_ID,
          version: 3,
          change_type: 'merge',
          change_reason: 'dedup_admin_review_superseded',
          metadata: expect.objectContaining({
            superseded_by: SUBJECT_ID,
            direction: 'subject-supersedes-canonical',
            peerId: SUBJECT_ID,
          }),
        }),
      );
      expect(mockSupabase._chain.insert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          content_item_id: SUBJECT_ID,
          version: 3,
          change_type: 'metadata_change',
          change_reason: 'dedup_admin_review_superseded',
          metadata: expect.objectContaining({
            direction: 'subject-supersedes-canonical',
            peerId: CANONICAL_ID,
            resolution: 'kept_as_canonical',
          }),
        }),
      );
    });

    it('B-2: returns 409 on OLD_ALREADY_SUPERSEDED (canonical already retired)', async () => {
      configureRole(mockSupabase, 'admin');
      configureSubjectLoadOk();
      mockSetSupersession.mockRejectedValueOnce(
        new SupersessionError(
          'OLD_ALREADY_SUPERSEDED',
          `Old item ${CANONICAL_ID} already superseded`,
          { oldId: CANONICAL_ID, existingSupersededBy: SUBJECT_ID },
        ),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        {
          method: 'POST',
          body: {
            canonicalId: CANONICAL_ID,
            direction: 'subject-supersedes-canonical',
          },
        },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.code).toBe('OLD_ALREADY_SUPERSEDED');
    });

    it('B-3: returns 409 on NEW_ALREADY_SUPERSEDED (defensive — subject normally guards via dedup_status)', async () => {
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
        {
          method: 'POST',
          body: {
            canonicalId: CANONICAL_ID,
            direction: 'subject-supersedes-canonical',
          },
        },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.code).toBe('NEW_ALREADY_SUPERSEDED');
    });
  });

  describe('SAME_ID + invalid direction', () => {
    it('B-4: returns 400 SAME_ID_PRE_HELPER when canonicalId === path id (direction A)', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        {
          method: 'POST',
          body: {
            canonicalId: SUBJECT_ID,
            direction: 'canonical-supersedes-subject',
          },
        },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe('SAME_ID_PRE_HELPER');
      expect(mockSetSupersession).not.toHaveBeenCalled();
    });

    it('B-4b: returns 400 SAME_ID_PRE_HELPER when canonicalId === path id (direction B)', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        {
          method: 'POST',
          body: {
            canonicalId: SUBJECT_ID,
            direction: 'subject-supersedes-canonical',
          },
        },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe('SAME_ID_PRE_HELPER');
      expect(mockSetSupersession).not.toHaveBeenCalled();
    });

    it('B-5: returns 400 on invalid direction enum value', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        {
          method: 'POST',
          body: { canonicalId: CANONICAL_ID, direction: 'banana' },
        },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });

      expect(response.status).toBe(400);
      expect(mockSetSupersession).not.toHaveBeenCalled();
    });
  });

  describe('explicit direction A regression', () => {
    it('B-6: explicit direction="canonical-supersedes-subject" works the same as default', async () => {
      configureRole(mockSupabase, 'admin');
      configureSubjectLoadOk();
      configureHelperHappyPath();

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
        {
          method: 'POST',
          body: {
            canonicalId: CANONICAL_ID,
            direction: 'canonical-supersedes-subject',
          },
        },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.direction).toBe('canonical-supersedes-subject');
      expect(body.pathId).toBe(SUBJECT_ID);
      expect(body.retiredId).toBe(SUBJECT_ID);

      expect(mockSetSupersession).toHaveBeenCalledWith(
        { oldId: SUBJECT_ID, newId: CANONICAL_ID, actorUserId: 'admin-user-id' },
        expect.anything(),
      );
    });
  });
});

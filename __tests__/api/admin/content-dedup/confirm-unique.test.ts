/**
 * POST /api/admin/content-dedup/[id]/confirm-unique
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

vi.spyOn(console, 'error').mockImplementation(() => {});

import { POST } from '@/app/api/admin/content-dedup/[id]/confirm-unique/route';

const SUBJECT_ID = '550e8400-e29b-41d4-a716-446655440000';

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

const SUBJECT_ROW = {
  id: SUBJECT_ID,
  title: 'Quarterly Boilerplate Q1',
  suggested_title: null,
  content: 'subject body',
  brief: null,
  detail: null,
  reference: null,
  metadata: null,
  dedup_status: 'suspected_duplicate',
  archived_at: null,
  superseded_by: null,
};

function configureHappyPath() {
  // 1) subject load
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: SUBJECT_ROW,
    error: null,
  });
  // 2) update + return
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: { id: SUBJECT_ID, dedup_status: 'confirmed_unique' },
    error: null,
  });
  // 3) latest history version
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [{ version: 1 }], error: null, count: 1 }),
  );
}

describe('POST /api/admin/content-dedup/[id]/confirm-unique', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('authentication', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(401);
    });

    it('returns 403 when user has editor role', async () => {
      configureRole(mockSupabase, 'editor');
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(403);
    });
  });

  describe('UUID validation', () => {
    it('returns 400 for invalid UUID', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        '/api/admin/content-dedup/not-a-uuid/confirm-unique',
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ id: 'not-a-uuid' }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('happy path', () => {
    it('returns 200 with id, dedup_status', async () => {
      configureRole(mockSupabase, 'admin');
      configureHappyPath();

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-unique`,
        {
          method: 'POST',
          body: { note: 'false positive — quarterly boilerplate' },
        },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe(SUBJECT_ID);
      expect(body.dedup_status).toBe('confirmed_unique');
      // Should NOT have archived_at in response
      expect(body.archived_at).toBeUndefined();
    });

    it('updates content_items with dedup_status only — no archive fields', async () => {
      configureRole(mockSupabase, 'admin');
      configureHappyPath();

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      await POST(request, { params: createTestParams({ id: SUBJECT_ID }) });

      const updateCalls = mockSupabase._chain.update.mock.calls;
      // First (and only) update call payload
      expect(updateCalls[0][0]).toEqual({ dedup_status: 'confirmed_unique' });
      // Crucially: no archived_at, archived_by, archive_reason
      expect(updateCalls[0][0]).not.toHaveProperty('archived_at');
      expect(updateCalls[0][0]).not.toHaveProperty('archived_by');
      expect(updateCalls[0][0]).not.toHaveProperty('archive_reason');
    });

    it('inserts content_history with change_reason="dedup_admin_review_confirmed_unique"', async () => {
      configureRole(mockSupabase, 'admin');
      configureHappyPath();

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      await POST(request, { params: createTestParams({ id: SUBJECT_ID }) });

      expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          content_item_id: SUBJECT_ID,
          version: 2, // 1 + 1
          change_type: 'metadata_change',
          change_reason: 'dedup_admin_review_confirmed_unique',
          created_by: 'admin-user-id',
        }),
      );
    });
  });

  describe('error handling', () => {
    it('returns 404 when subject not found', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'no rows' },
      });

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(404);
    });

    it('returns 409 when subject is no longer suspected_duplicate', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { ...SUBJECT_ROW, dedup_status: 'superseded' },
        error: null,
      });

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-unique`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(409);
    });

    it('returns 400 when note > 500 chars', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-unique`,
        { method: 'POST', body: { note: 'x'.repeat(501) } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(400);
    });
  });
});

/**
 * POST /api/admin/content-dedup/[id]/confirm-duplicate
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

import { POST } from '@/app/api/admin/content-dedup/[id]/confirm-duplicate/route';

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
  title: 'Cloud security policy v3',
  suggested_title: null,
  content: 'subject body',
  brief: null,
  detail: null,
  reference: null,
  metadata: { suspected_duplicate_of: 'a4d8e1f2-3b6c-4d7e-9f8a-1b2c3d4e5f60' },
  dedup_status: 'suspected_duplicate',
  archived_at: null,
  superseded_by: null,
};

function configureHappyPath() {
  // 1) subject load .single()
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: SUBJECT_ROW,
    error: null,
  });
  // 2) update + return updated .single()
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: {
      id: SUBJECT_ID,
      dedup_status: 'confirmed_duplicate',
      archived_at: '2026-04-29T12:00:00Z',
    },
    error: null,
  });
  // 3) latest history version (chain await — uses .then)
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [{ version: 4 }], error: null, count: 1 }),
  );
}

describe('POST /api/admin/content-dedup/[id]/confirm-duplicate', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('authentication', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-duplicate`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(401);
    });

    it('returns 403 when user has editor role (admin only)', async () => {
      configureRole(mockSupabase, 'editor');
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-duplicate`,
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
        '/api/admin/content-dedup/not-a-uuid/confirm-duplicate',
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ id: 'not-a-uuid' }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('body validation', () => {
    it('returns 400 when note > 500 chars', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-duplicate`,
        { method: 'POST', body: { note: 'x'.repeat(501) } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(400);
    });

    it('accepts empty body (note is optional)', async () => {
      configureRole(mockSupabase, 'admin');
      configureHappyPath();
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-duplicate`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(200);
    });
  });

  describe('happy path', () => {
    it('returns 200 with id, dedup_status, archived_at', async () => {
      configureRole(mockSupabase, 'admin');
      configureHappyPath();

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-duplicate`,
        { method: 'POST', body: { note: 'true duplicate of v2' } },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe(SUBJECT_ID);
      expect(body.dedup_status).toBe('confirmed_duplicate');
      expect(body.archived_at).toBe('2026-04-29T12:00:00Z');
    });

    it('updates content_items with archive fields + dedup_status', async () => {
      configureRole(mockSupabase, 'admin');
      configureHappyPath();

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-duplicate`,
        { method: 'POST', body: {} },
      );
      await POST(request, { params: createTestParams({ id: SUBJECT_ID }) });

      expect(mockSupabase._chain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          archive_reason: 'dedup_admin_confirmed_duplicate',
          archived_by: 'admin-user-id',
          dedup_status: 'confirmed_duplicate',
        }),
      );
    });

    it('inserts content_history with change_reason="dedup_admin_review_confirmed_duplicate"', async () => {
      configureRole(mockSupabase, 'admin');
      configureHappyPath();

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-duplicate`,
        { method: 'POST', body: { note: 'matches existing canonical' } },
      );
      await POST(request, { params: createTestParams({ id: SUBJECT_ID }) });

      // history insert uses .insert(...) on content_history table
      expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          content_item_id: SUBJECT_ID,
          version: 5, // 4 + 1
          change_type: 'archive',
          change_reason: 'dedup_admin_review_confirmed_duplicate',
          created_by: 'admin-user-id',
        }),
      );
    });
  });

  describe('error handling', () => {
    it('returns 404 when subject not found (PGRST116)', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'no rows' },
      });

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-duplicate`,
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
        data: { ...SUBJECT_ROW, dedup_status: 'confirmed_unique' },
        error: null,
      });

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-duplicate`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.current_status).toBe('confirmed_unique');
    });

    it('returns 500 when update fails', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: SUBJECT_ROW,
        error: null,
      });
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: '42P01', message: 'relation does not exist' },
      });

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-duplicate`,
        { method: 'POST', body: {} },
      );
      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(500);
    });

    it('returns 400 on invalid JSON body', async () => {
      configureRole(mockSupabase, 'admin');

      const url = new URL(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-duplicate`,
        'http://localhost:3000',
      );
      const request = new (await import('next/server')).NextRequest(url, {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      });

      const response = await POST(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(400);
    });
  });
});

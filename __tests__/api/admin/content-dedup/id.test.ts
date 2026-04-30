/**
 * GET /api/admin/content-dedup/[id]
 *
 * §1.7 Admin Cross-System Dedup Review (S211B).
 * Spec: docs/specs/§1.7-admin-dedup-review-spec.md §5.1, §3.5
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

import { GET } from '@/app/api/admin/content-dedup/[id]/route';

const SUBJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const CANONICAL_ID = 'a4d8e1f2-3b6c-4d7e-9f8a-1b2c3d4e5f60';

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
  content: 'subject body',
  dedup_status: 'suspected_duplicate',
  created_at: '2026-04-28T10:00:00Z',
  primary_domain: 'tech-it',
  content_owner_id: null,
  ingest_source: 'url_import',
  superseded_by: null,
  metadata: { suspected_duplicate_of: CANONICAL_ID },
  publication_status: 'in_review',
  archived_at: null,
  content_text_hash: 'deadbeef'.repeat(4),
};

const CANONICAL_ROW = {
  ...SUBJECT_ROW,
  id: CANONICAL_ID,
  title: 'Cloud security policy',
  dedup_status: 'clean',
  created_at: '2026-03-14T10:00:00Z',
  metadata: null,
};

describe('GET /api/admin/content-dedup/[id]', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('authentication', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(401);
    });

    it('returns 403 for editor role', async () => {
      configureRole(mockSupabase, 'editor');
      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(403);
    });
  });

  describe('UUID validation', () => {
    it('returns 400 for invalid UUID', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest('/api/admin/content-dedup/not-a-uuid');
      const response = await GET(request, {
        params: createTestParams({ id: 'not-a-uuid' }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('happy path — metadata stamp', () => {
    it('returns subject + canonical + similarity 1.0 when metadata.suspected_duplicate_of present', async () => {
      configureRole(mockSupabase, 'admin');
      // 1st .single() = subject, 2nd .maybeSingle() = canonical
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: SUBJECT_ROW,
        error: null,
      });
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: CANONICAL_ROW,
        error: null,
      });

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.subject.id).toBe(SUBJECT_ID);
      expect(body.canonical.id).toBe(CANONICAL_ID);
      expect(body.similarity).toBe(1.0);
      // Should NOT have called RPC because metadata stamp resolved canonical
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe('happy path — RPC fallback', () => {
    it('falls back to find_exact_duplicates RPC when metadata stamp absent', async () => {
      configureRole(mockSupabase, 'admin');
      const subjectWithoutStamp = { ...SUBJECT_ROW, metadata: null };
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: subjectWithoutStamp,
        error: null,
      });
      mockSupabase.rpc.mockResolvedValueOnce({
        data: [{ id: CANONICAL_ID, title: 'Cloud security policy' }],
        error: null,
      });
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: CANONICAL_ROW,
        error: null,
      });

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });

      expect(response.status).toBe(200);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('find_exact_duplicates', {
        p_content_hash: SUBJECT_ROW.content_text_hash,
        p_exclude_id: SUBJECT_ID,
      });
      const body = await response.json();
      expect(body.canonical.id).toBe(CANONICAL_ID);
    });

    it('returns canonical=null when no canonical can be located', async () => {
      configureRole(mockSupabase, 'admin');
      const subjectWithoutStamp = {
        ...SUBJECT_ROW,
        metadata: null,
        content_text_hash: null,
      };
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: subjectWithoutStamp,
        error: null,
      });

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.canonical).toBeNull();
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
        `/api/admin/content-dedup/${SUBJECT_ID}`,
      );
      const response = await GET(request, {
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
        `/api/admin/content-dedup/${SUBJECT_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.current_status).toBe('confirmed_unique');
    });

    it('returns 500 when subject load returns unexpected error', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: '42P01', message: 'relation does not exist' },
      });

      const request = createTestRequest(
        `/api/admin/content-dedup/${SUBJECT_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ id: SUBJECT_ID }),
      });
      expect(response.status).toBe(500);
    });
  });
});

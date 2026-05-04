/**
 * PATCH /api/items/:id supersession branch (S186 WP-B.5).
 *
 * Spec: docs/specs/supersession-model-spec.md §5.1
 * Plan: docs/plans/supersession-model-plan.md §B.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies, mockSetSupersession } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockSetSupersession: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
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

// Keep the embedding helper mocked so the route doesn't try to hit OpenAI
// on code paths that never actually fire during the supersession branch.
vi.mock('@/lib/ai/embed', () => ({
  MAX_EMBEDDING_CHARS: 24_000,
  getEmbeddingModel: vi.fn(() => 'text-embedding-3-large'),
  getEmbeddingDimensions: vi.fn(() => 1024),

  generateEmbedding: vi.fn(),
}));

import { PATCH } from '@/app/api/items/[id]/route';
import { SupersessionError } from '@/lib/supersession/set';
import { SupabaseError } from '@/lib/supabase/safe';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const HAPPY_PATH_RESULT = {
  oldItem: {
    id: OLD_ID,
    title: 'Old revision',
    superseded_by: NEW_ID,
    dedup_status: 'superseded',
  },
  newItem: {
    id: NEW_ID,
    title: 'New revision',
    superseded_by: null,
    dedup_status: 'clean',
  },
};

function makePatchRequest(body: unknown) {
  return createTestRequest(`/api/items/${OLD_ID}`, {
    method: 'PATCH',
    body,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/items/[id] — superseded_by branch (S186 WP-B.5)', () => {
  const params = createTestParams({ id: OLD_ID });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetSupersession.mockReset();
    mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });
  });

  it('returns 401 when unauthenticated (before hitting the branch)', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await PATCH(
      makePatchRequest({ field: 'superseded_by', value: NEW_ID }),
      { params },
    );
    expect(res.status).toBe(401);
    expect(mockSetSupersession).not.toHaveBeenCalled();
  });

  it('returns 403 for editor role (admin-only branch)', async () => {
    // First the route auth check succeeds (editor is in ['admin','editor']).
    configureRole(mockSupabase, 'editor');
    // Then the branch's additional role fetch finds role='editor'.
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: 'editor' },
      error: null,
    });

    const res = await PATCH(
      makePatchRequest({ field: 'superseded_by', value: NEW_ID }),
      { params },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/admin-only/i);
    expect(mockSetSupersession).not.toHaveBeenCalled();
  });

  it('returns 403 for viewer role (router-level gate)', async () => {
    configureRole(mockSupabase, 'viewer');

    const res = await PATCH(
      makePatchRequest({ field: 'superseded_by', value: NEW_ID }),
      { params },
    );
    expect(res.status).toBe(403);
    expect(mockSetSupersession).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid UUID in value', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: 'admin' },
      error: null,
    });

    const res = await PATCH(
      makePatchRequest({ field: 'superseded_by', value: 'not-a-uuid' }),
      { params },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('admin + valid UUID → calls setSupersession and returns 200 with snapshots', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: 'admin' },
      error: null,
    });
    mockSetSupersession.mockResolvedValue(HAPPY_PATH_RESULT);

    const res = await PATCH(
      makePatchRequest({ field: 'superseded_by', value: NEW_ID }),
      { params },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.old_item).toEqual(HAPPY_PATH_RESULT.oldItem);
    expect(body.new_item).toEqual(HAPPY_PATH_RESULT.newItem);

    expect(mockSetSupersession).toHaveBeenCalledTimes(1);
    expect(mockSetSupersession).toHaveBeenCalledWith(
      expect.objectContaining({
        oldId: OLD_ID,
        newId: NEW_ID,
      }),
      expect.anything(),
    );
  });

  it('admin + value=null → clears pointer, resets dedup_status=suspected_duplicate', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: 'admin' },
      error: null,
    });
    // Make the post-clear update resolve cleanly
    mockSupabase._chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null, count: 0 }),
    );

    const res = await PATCH(
      makePatchRequest({ field: 'superseded_by', value: null }),
      { params },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.superseded_by).toBeNull();
    expect(body.dedup_status).toBe('suspected_duplicate');
    expect(mockSetSupersession).not.toHaveBeenCalled();
  });

  it('admin + SupersessionError(OLD_NOT_FOUND) → 404', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: 'admin' },
      error: null,
    });
    mockSetSupersession.mockRejectedValue(
      new SupersessionError('OLD_NOT_FOUND', `Old item not found: ${OLD_ID}`, {
        oldId: OLD_ID,
      }),
    );

    const res = await PATCH(
      makePatchRequest({ field: 'superseded_by', value: NEW_ID }),
      { params },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('OLD_NOT_FOUND');
  });

  it('admin + SupersessionError(NEW_ALREADY_SUPERSEDED) → 409 conflict', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: 'admin' },
      error: null,
    });
    mockSetSupersession.mockRejectedValue(
      new SupersessionError(
        'NEW_ALREADY_SUPERSEDED',
        `New item ${NEW_ID} is already superseded; cannot form a chain`,
        { newId: NEW_ID, existingSupersededBy: OLD_ID },
      ),
    );

    const res = await PATCH(
      makePatchRequest({ field: 'superseded_by', value: NEW_ID }),
      { params },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('NEW_ALREADY_SUPERSEDED');
  });

  it('admin + SupersessionError(SAME_ID) → 409 conflict', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: 'admin' },
      error: null,
    });
    mockSetSupersession.mockRejectedValue(
      new SupersessionError('SAME_ID', 'Cannot supersede an item with itself', {
        oldId: OLD_ID,
        newId: OLD_ID,
      }),
    );

    const res = await PATCH(
      makePatchRequest({ field: 'superseded_by', value: OLD_ID }),
      { params },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('SAME_ID');
  });

  it('admin + SupabaseError → 500', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: 'admin' },
      error: null,
    });
    mockSetSupersession.mockRejectedValue(
      new SupabaseError(
        {
          message: 'permission denied',
          code: '42501',
          details: '',
          hint: '',
          name: 'PostgrestError',
        } as unknown as import('@supabase/supabase-js').PostgrestError,
        'supersession.update_old',
      ),
    );

    const res = await PATCH(
      makePatchRequest({ field: 'superseded_by', value: NEW_ID }),
      { params },
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Supersession failed');
  });
});

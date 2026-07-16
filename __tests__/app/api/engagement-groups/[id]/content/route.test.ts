/**
 * API route test for POST /api/engagement-groups/[id]/content — ID-145
 * {145.35} group-side batch assign (BI-33 owner ruling, S479).
 *
 * Migration `20260716130000_id145_35_engagement_group_content.sql` is
 * authored-only (not pushed to staging in this worktree) — this suite
 * covers the route's LOGIC against the shared mock Supabase client. The
 * true end-to-end/integration assertion (a real DB round-trip through the
 * new table) is DEFERRED to post-migration-push per the {145.35} dispatch
 * brief's testStrategy.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '@/__tests__/helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '@/__tests__/helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

import { POST as assignContent } from '@/app/api/engagement-groups/[id]/content/route';

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const PAIR_A = '22222222-2222-4222-8222-222222222222';
const PAIR_B = '33333333-3333-4333-8333-333333333333';

function resetMocks() {
  vi.clearAllMocks();

  const chainableMethods = [
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
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReset();
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.then.mockReset();

  mockSupabase.auth.getUser.mockReset();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  // Default: the engagement group exists.
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: { id: GROUP_ID },
    error: null,
  });
  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
  });
  // Default: the upsert resolves via the thenable chain (no .select() chained).
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: null, error: null }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockReset();
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

describe('POST /api/engagement-groups/[id]/content', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/engagement-groups/${GROUP_ID}/content`,
      { method: 'POST', body: { q_a_pair_ids: [PAIR_A] } },
    );
    const res = await assignContent(req, {
      params: createTestParams({ id: GROUP_ID }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/engagement-groups/${GROUP_ID}/content`,
      { method: 'POST', body: { q_a_pair_ids: [PAIR_A] } },
    );
    const res = await assignContent(req, {
      params: createTestParams({ id: GROUP_ID }),
    });

    expect(res.status).toBe(403);
  });

  it('returns 400 when q_a_pair_ids is empty', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/engagement-groups/${GROUP_ID}/content`,
      { method: 'POST', body: { q_a_pair_ids: [] } },
    );
    const res = await assignContent(req, {
      params: createTestParams({ id: GROUP_ID }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when q_a_pair_ids contains a non-UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/engagement-groups/${GROUP_ID}/content`,
      { method: 'POST', body: { q_a_pair_ids: ['not-a-uuid'] } },
    );
    const res = await assignContent(req, {
      params: createTestParams({ id: GROUP_ID }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 404 when the engagement group does not exist', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest(
      `/api/engagement-groups/${GROUP_ID}/content`,
      { method: 'POST', body: { q_a_pair_ids: [PAIR_A] } },
    );
    const res = await assignContent(req, {
      params: createTestParams({ id: GROUP_ID }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it('links the batch idempotently via upsert with onConflict + ignoreDuplicates', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/engagement-groups/${GROUP_ID}/content`,
      { method: 'POST', body: { q_a_pair_ids: [PAIR_A, PAIR_B] } },
    );
    const res = await assignContent(req, {
      params: createTestParams({ id: GROUP_ID }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true, linked: 2 });

    expect(mockSupabase.from).toHaveBeenCalledWith('engagement_group_content');
    expect(mockSupabase._chain.upsert).toHaveBeenCalledWith(
      [
        { engagement_group_id: GROUP_ID, q_a_pair_id: PAIR_A },
        { engagement_group_id: GROUP_ID, q_a_pair_id: PAIR_B },
      ],
      { onConflict: 'engagement_group_id,q_a_pair_id', ignoreDuplicates: true },
    );
  });

  it('returns 404 when a selected q_a_pair no longer exists (FK violation, 23503)', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { code: '23503', message: 'FK violation' },
        }),
    );

    const req = createTestRequest(
      `/api/engagement-groups/${GROUP_ID}/content`,
      { method: 'POST', body: { q_a_pair_ids: [PAIR_A] } },
    );
    const res = await assignContent(req, {
      params: createTestParams({ id: GROUP_ID }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/no longer exist/i);
  });

  it('returns 500 on a generic Supabase write failure', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { code: 'XX000', message: 'connection reset' },
        }),
    );

    const req = createTestRequest(
      `/api/engagement-groups/${GROUP_ID}/content`,
      { method: 'POST', body: { q_a_pair_ids: [PAIR_A] } },
    );
    const res = await assignContent(req, {
      params: createTestParams({ id: GROUP_ID }),
    });

    expect(res.status).toBe(500);
  });
});

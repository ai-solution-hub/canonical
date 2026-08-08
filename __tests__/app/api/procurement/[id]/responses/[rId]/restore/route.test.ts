/**
 * Procurement response-restore route tests.
 *
 *   - POST /api/procurement/:id/responses/:rId/restore — roll a response back
 *     to an earlier version from its history
 *
 * Covers auth enforcement, UUID validation, the response and bid-ownership
 * lookups, the missing-version case and the audited restore (which stamps a
 * `change_reason` session variable for the history trigger).
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

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Import route handlers AFTER mocks
const { POST: restorePost } =
  await import('@/app/api/procurement/[id]/responses/[rId]/restore/route');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const INVALID_UUID = 'not-a-uuid';

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Re-wire next/headers mock
  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  // Re-wire Supabase client mocks
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  // Chainable methods return the chain
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

  // Terminal methods
  mockSupabase._chain.single
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then
    .mockReset()
    .mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );
});

describe('POST /api/procurement/:id/responses/:rId/restore', () => {
  const params = createTestParams({ id: VALID_UUID, rId: VALID_UUID_2 });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 1 } },
    );

    const res = await restorePost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 1 } },
    );

    const res = await restorePost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 when either UUID is invalid', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/procurement/${INVALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 1 } },
    );

    const res = await restorePost(req, {
      params: createTestParams({ id: INVALID_UUID, rId: VALID_UUID_2 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when response does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 1 } },
    );

    const res = await restorePost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Response not found');
  });

  it('returns 404 when response does not belong to this bid', async () => {
    configureRole(mockSupabase, 'editor');

    // Response exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, question_id: 'q-id' },
      error: null,
    });

    // Question lookup returns no row (maybeSingle)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 1 } },
    );

    const res = await restorePost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Response not found in this bid');
  });

  it('returns 404 when requested version does not exist in history', async () => {
    configureRole(mockSupabase, 'editor');

    // Response exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, question_id: 'q-id' },
      error: null,
    });

    // Question belongs to bid (maybeSingle)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'q-id' },
      error: null,
    });

    // History version not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 99 } },
    );

    const res = await restorePost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain('Version 99 not found');
  });

  it('restores a previous version and sets change_reason session config', async () => {
    configureRole(mockSupabase, 'editor');

    // Response exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, question_id: 'q-id' },
      error: null,
    });

    // Question belongs to bid (maybeSingle)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'q-id' },
      error: null,
    });

    // History version found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        response_text: 'Old version text',
        response_text_advanced: null,
        metadata: {},
        source_record_ids: [],
      },
      error: null,
    });

    // Update response
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_2,
        question_id: 'q-id',
        response_text: 'Old version text',
        review_status: 'edited',
        version: 3,
        last_edited_by: 'test-user-id',
        updated_at: '2026-03-14T00:00:00Z',
      },
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 2 } },
    );

    const res = await restorePost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.response_text).toBe('Old version text');
    expect(body.review_status).toBe('edited');

    // Verify set_config was called with change_reason
    expect(mockSupabase.rpc).toHaveBeenCalledWith('set_config', {
      setting: 'app.change_reason',
      value: 'Restored from version 2',
      is_local: true,
    });
  });
});

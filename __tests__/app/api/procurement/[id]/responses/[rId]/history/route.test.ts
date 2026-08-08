/**
 * Procurement response-history route tests.
 *
 *   - GET /api/procurement/:id/responses/:rId/history — list the response's
 *     earlier versions
 *
 * Covers auth enforcement, UUID validation, the response and bid-ownership
 * lookups, and the version-list projection (including the empty case).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
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
const { GET: historyGet } =
  await import('@/app/api/procurement/[id]/responses/[rId]/history/route');

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

describe('GET /api/procurement/:id/responses/:rId/history', () => {
  const params = createTestParams({ id: VALID_UUID, rId: VALID_UUID_2 });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
    );

    const res = await historyGet(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 400 when either UUID is invalid', async () => {
    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${INVALID_UUID}/history`,
    );

    const res = await historyGet(req, {
      params: createTestParams({ id: VALID_UUID, rId: INVALID_UUID }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('Invalid ID');
  });

  it('returns 404 when response does not exist', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
    );

    const res = await historyGet(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Response not found');
  });

  it('returns 404 when question does not belong to this bid', async () => {
    // Response exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, version: 3, question_id: 'q-id' },
      error: null,
    });

    // Question lookup returns no row (maybeSingle)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
    );

    const res = await historyGet(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Response not found in this bid');
  });

  it('returns 200 with version history on success', async () => {
    // Response exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, version: 3, question_id: 'q-id' },
      error: null,
    });

    // Question belongs to bid (maybeSingle)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'q-id' },
      error: null,
    });

    // History entries
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'h2',
              version: 2,
              response_text: 'Version 2 text',
              created_at: '2026-03-13',
            },
            {
              id: 'h1',
              version: 1,
              response_text: 'Version 1 text',
              created_at: '2026-03-12',
            },
          ],
          error: null,
        }),
    );

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
    );

    const res = await historyGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.current_version).toBe(3);
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0].version).toBe(2);
  });

  it('returns empty versions array when no history exists', async () => {
    // Response exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, version: 1, question_id: 'q-id' },
      error: null,
    });

    // Question belongs to bid (maybeSingle)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'q-id' },
      error: null,
    });

    // No history entries
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
    );

    const res = await historyGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.current_version).toBe(1);
    expect(body.versions).toHaveLength(0);
  });
});

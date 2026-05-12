import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Import handler under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/items/batch-review/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID_1 = '00000000-0000-4000-8000-000000000001';
const VALID_UUID_2 = '00000000-0000-4000-8000-000000000002';
const VALID_UUID_3 = '00000000-0000-4000-8000-000000000003';

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

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
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

// ===========================================================================
// POST /api/items/batch-review
// ===========================================================================

describe('POST /api/items/batch-review', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/items/batch-review', {
      method: 'POST',
      body: { item_ids: [VALID_UUID_1], status: 'pending' },
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/items/batch-review', {
      method: 'POST',
      body: { item_ids: [VALID_UUID_1], status: 'pending' },
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Forbidden');
  });

  it('returns 400 for empty item_ids array', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/items/batch-review', {
      method: 'POST',
      body: { item_ids: [], status: 'pending' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'item_ids' })]),
    );
  });

  it('returns 400 for missing item_ids', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/items/batch-review', {
      method: 'POST',
      body: { status: 'pending' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 400 for invalid UUID in item_ids', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/items/batch-review', {
      method: 'POST',
      body: { item_ids: ['not-a-uuid'], status: 'pending' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 400 for invalid status value', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/items/batch-review', {
      method: 'POST',
      body: { item_ids: [VALID_UUID_1], status: 'approved' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'status' })]),
    );
  });

  it('updates items and returns count for editor', async () => {
    configureRole(mockSupabase, 'editor');

    // update().in().select() resolves with matched rows
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ id: VALID_UUID_1 }, { id: VALID_UUID_2 }],
          error: null,
        }),
    );

    const req = createTestRequest('/api/items/batch-review', {
      method: 'POST',
      body: { item_ids: [VALID_UUID_1, VALID_UUID_2], status: 'pending' },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(2);

    // Content-of-write is observable: the recorded update payload must
    // set the governance review status to the requested value.
    const updateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateArg).toEqual({ governance_review_status: 'pending' });
  });

  it('updates items and returns count for admin', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { id: VALID_UUID_1 },
            { id: VALID_UUID_2 },
            { id: VALID_UUID_3 },
          ],
          error: null,
        }),
    );

    const req = createTestRequest('/api/items/batch-review', {
      method: 'POST',
      body: {
        item_ids: [VALID_UUID_1, VALID_UUID_2, VALID_UUID_3],
        status: 'pending',
      },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(3);
  });

  it('returns 500 when Supabase update fails', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'DB error' } }),
    );

    const req = createTestRequest('/api/items/batch-review', {
      method: 'POST',
      body: { item_ids: [VALID_UUID_1], status: 'pending' },
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to update governance review status');
  });

  it('returns 0 updated when no items match the IDs', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/items/batch-review', {
      method: 'POST',
      body: { item_ids: [VALID_UUID_1], status: 'pending' },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(0);
  });
});

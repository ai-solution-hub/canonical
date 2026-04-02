import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies, mockCreateServiceClient } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockCreateServiceClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: mockCreateServiceClient,
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Import routes AFTER mocks are registered
const { PATCH: ownerPatch } = await import('@/app/api/items/[id]/owner/route');
const { POST: bulkAssignPost } =
  await import('@/app/api/content-owners/bulk-assign/route');
const { GET: statsGet } = await import('@/app/api/content-owners/stats/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const OWNER_UUID = 'c3d4e5f6-a7b8-4012-8def-123456789012';

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

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

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.csv.mockReset();
  mockSupabase._chain.csv.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  // Default service client mock for stats route
  mockCreateServiceClient.mockReturnValue({
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    },
  });
});

// =====================================================================
// PATCH /api/items/[id]/owner — Assign/Unassign Owner
// =====================================================================

describe('PATCH /api/items/[id]/owner', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/items/${VALID_UUID}/owner`, {
      method: 'PATCH',
      body: { owner_id: OWNER_UUID },
    });

    const res = await ownerPatch(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/items/${VALID_UUID}/owner`, {
      method: 'PATCH',
      body: { owner_id: OWNER_UUID },
    });

    const res = await ownerPatch(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid owner_id', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/items/${VALID_UUID}/owner`, {
      method: 'PATCH',
      body: { owner_id: 'not-a-uuid' },
    });

    const res = await ownerPatch(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeDefined();
  });

  it('returns 404 when item not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Fetch current owner returns not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows found', code: 'PGRST116' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/owner`, {
      method: 'PATCH',
      body: { owner_id: OWNER_UUID },
    });

    const res = await ownerPatch(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Item not found');
  });

  it('assigns owner successfully and returns 200', async () => {
    configureRole(mockSupabase, 'editor');

    // Fetch current owner
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { content_owner_id: null },
      error: null,
    });

    // Update content item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    // History insert (awaited chain)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    // Notification insert (awaited chain)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest(`/api/items/${VALID_UUID}/owner`, {
      method: 'PATCH',
      body: { owner_id: OWNER_UUID },
    });

    const res = await ownerPatch(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.owner_id).toBe(OWNER_UUID);
  });

  it('unassigns owner with null owner_id', async () => {
    configureRole(mockSupabase, 'editor');

    // Fetch current owner
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { content_owner_id: OWNER_UUID },
      error: null,
    });

    // Update content item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    // History insert (awaited chain)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest(`/api/items/${VALID_UUID}/owner`, {
      method: 'PATCH',
      body: { owner_id: null },
    });

    const res = await ownerPatch(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.owner_id).toBeNull();
  });

  it('returns 500 when update fails', async () => {
    configureRole(mockSupabase, 'editor');

    // Fetch current owner
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { content_owner_id: null },
      error: null,
    });

    // Update fails
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB error', code: '50000' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/owner`, {
      method: 'PATCH',
      body: { owner_id: OWNER_UUID },
    });

    const res = await ownerPatch(req, { params });
    expect(res.status).toBe(500);
  });
});

// =====================================================================
// POST /api/content-owners/bulk-assign — Bulk Assign
// =====================================================================

describe('POST /api/content-owners/bulk-assign', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/content-owners/bulk-assign', {
      method: 'POST',
      body: { item_ids: [VALID_UUID], owner_id: OWNER_UUID },
    });

    const res = await bulkAssignPost(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for editor role (admin-only)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/content-owners/bulk-assign', {
      method: 'POST',
      body: { item_ids: [VALID_UUID], owner_id: OWNER_UUID },
    });

    const res = await bulkAssignPost(req);
    expect(res.status).toBe(403);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/content-owners/bulk-assign', {
      method: 'POST',
      body: { item_ids: [VALID_UUID], owner_id: OWNER_UUID },
    });

    const res = await bulkAssignPost(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 when neither item_ids nor filter provided', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/content-owners/bulk-assign', {
      method: 'POST',
      body: { owner_id: OWNER_UUID },
    });

    const res = await bulkAssignPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid owner_id', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/content-owners/bulk-assign', {
      method: 'POST',
      body: { item_ids: [VALID_UUID], owner_id: 'not-a-uuid' },
    });

    const res = await bulkAssignPost(req);
    expect(res.status).toBe(400);
  });

  it('bulk assigns by item_ids successfully', async () => {
    configureRole(mockSupabase, 'admin');

    // RPC returns count
    mockSupabase.rpc.mockResolvedValueOnce({
      data: 2,
      error: null,
    });

    // Notification insert (awaited chain)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/content-owners/bulk-assign', {
      method: 'POST',
      body: {
        item_ids: [VALID_UUID, VALID_UUID_2],
        owner_id: OWNER_UUID,
      },
    });

    const res = await bulkAssignPost(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.items_updated).toBe(2);

    // Verify RPC was called correctly
    expect(mockSupabase.rpc).toHaveBeenCalledWith('bulk_assign_content_owner', {
      p_item_ids: [VALID_UUID, VALID_UUID_2],
      p_owner_id: OWNER_UUID,
      p_assigned_by: 'test-user-id',
    });
  });

  it('bulk assigns by filter successfully', async () => {
    configureRole(mockSupabase, 'admin');

    // Filter query returns items (awaited chain via .then)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ id: VALID_UUID }, { id: VALID_UUID_2 }],
          error: null,
        }),
    );

    // RPC returns count
    mockSupabase.rpc.mockResolvedValueOnce({
      data: 2,
      error: null,
    });

    // Notification insert (awaited chain)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/content-owners/bulk-assign', {
      method: 'POST',
      body: {
        filter: { domain: 'Engineering', unowned_only: true },
        owner_id: OWNER_UUID,
      },
    });

    const res = await bulkAssignPost(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.items_updated).toBe(2);
  });

  it('returns success with 0 items when filter matches nothing', async () => {
    configureRole(mockSupabase, 'admin');

    // Filter query returns empty
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/content-owners/bulk-assign', {
      method: 'POST',
      body: {
        filter: { domain: 'NonExistent' },
        owner_id: OWNER_UUID,
      },
    });

    const res = await bulkAssignPost(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.items_updated).toBe(0);
  });

  it('returns 500 when RPC fails', async () => {
    configureRole(mockSupabase, 'admin');

    // RPC fails
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC error' },
    });

    const req = createTestRequest('/api/content-owners/bulk-assign', {
      method: 'POST',
      body: {
        item_ids: [VALID_UUID],
        owner_id: OWNER_UUID,
      },
    });

    const res = await bulkAssignPost(req);
    expect(res.status).toBe(500);
  });
});

// =====================================================================
// GET /api/content-owners/stats — Owner Stats
// =====================================================================

describe('GET /api/content-owners/stats', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/content-owners/stats');

    const res = await statsGet(req);
    expect(res.status).toBe(401);
  });

  it('returns empty array when no stats', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const req = createTestRequest('/api/content-owners/stats');

    const res = await statsGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('returns enriched stats with display names', async () => {
    const statsData = [
      {
        owner_id: OWNER_UUID,
        total_items: 10,
        fresh_count: 5,
        aging_count: 3,
        stale_count: 1,
        expired_count: 1,
        unverified_count: 2,
      },
    ];

    mockSupabase.rpc.mockResolvedValueOnce({
      data: statsData,
      error: null,
    });

    // Service client mock for display name resolution
    const mockServiceClient = {
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: OWNER_UUID,
                email: 'owner@example.com',
                user_metadata: { display_name: 'Test Owner' },
              },
            },
            error: null,
          }),
        },
      },
    };
    mockCreateServiceClient.mockReturnValue(mockServiceClient);

    const req = createTestRequest('/api/content-owners/stats');

    const res = await statsGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].owner_id).toBe(OWNER_UUID);
    expect(body[0].total_items).toBe(10);
    expect(body[0].display_name).toBe('Test Owner');
  });

  it('returns stats with null display_name when user lookup fails', async () => {
    const statsData = [
      {
        owner_id: OWNER_UUID,
        total_items: 5,
        fresh_count: 2,
        aging_count: 1,
        stale_count: 1,
        expired_count: 1,
        unverified_count: 0,
      },
    ];

    mockSupabase.rpc.mockResolvedValueOnce({
      data: statsData,
      error: null,
    });

    // Service client returns no user
    const mockServiceClient = {
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: null },
            error: null,
          }),
        },
      },
    };
    mockCreateServiceClient.mockReturnValue(mockServiceClient);

    const req = createTestRequest('/api/content-owners/stats');

    const res = await statsGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].display_name).toBeNull();
  });

  it('returns 500 when RPC fails', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC error' },
    });

    const req = createTestRequest('/api/content-owners/stats');

    const res = await statsGet(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toMatch(/Failed to fetch content owner stats/);
  });

  it('is accessible to viewer role (all authenticated)', async () => {
    // getAuthenticatedClient doesn't check roles — just auth
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const req = createTestRequest('/api/content-owners/stats');

    const res = await statsGet(req);
    expect(res.status).toBe(200);
  });
});

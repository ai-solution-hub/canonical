import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();
// Separate service-role client mock — id-369 F1 moved the cross-user owner
// notification insert off the actor's client onto the service client, so
// the two must be distinguishable in tests.
const mockServiceSupabase = createMockSupabaseClient();

const { mockCookies, mockCreateServiceClient, mockLogBestEffortWarn } =
  vi.hoisted(() => ({
    mockCookies: vi.fn(),
    mockCreateServiceClient: vi.fn(),
    mockLogBestEffortWarn: vi.fn(),
  }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: mockCreateServiceClient,
}));

vi.mock('@/lib/supabase/telemetry', () => ({
  logBestEffortWarn: mockLogBestEffortWarn,
  logSwallowedError: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Import routes AFTER mocks are registered
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

  // Service client: re-chain + default success (notification insert in the
  // bulk-assign route awaits the chain directly).
  for (const m of chainable) {
    mockServiceSupabase._chain[m].mockReturnValue(mockServiceSupabase._chain);
  }
  mockServiceSupabase._chain.then.mockReset();
  mockServiceSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
  );
  mockServiceSupabase.from.mockReturnValue(mockServiceSupabase._chain);

  // Default service client mock — `from` for the bulk-assign notification
  // insert, `auth.admin` for the stats route's display-name resolution.
  mockCreateServiceClient.mockReturnValue({
    from: mockServiceSupabase.from,
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

    // Resolution query: source_documents.id existence check (awaited chain).
    // ID-131 {131.19}: item_ids ARE source_documents ids directly now
    // (content_items was already 1:1 with its backing source_document) — the
    // resolution query just confirms which of them still exist and echoes
    // the same ids back, rather than remapping to a different id space.
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

    // Notification insert goes through the service client (id-369 F1) —
    // covered by its own tests below; default service mock resolves success.

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

    // Verify RPC was called with the resolved source_documents ids (ID-131
    // {131.13} G-GOV-FACET-B — bulk_assign_content_owner now matches
    // record_lifecycle.owner_id, keyed on source_documents.id).
    expect(mockSupabase.rpc).toHaveBeenCalledWith('bulk_assign_content_owner', {
      p_item_ids: [VALID_UUID, VALID_UUID_2],
      p_owner_id: OWNER_UUID,
      p_assigned_by: 'test-user-id',
    });
  });

  it('bulk assigns by filter successfully', async () => {
    configureRole(mockSupabase, 'admin');

    // Filter query returns source_documents rows directly (awaited chain via
    // .then). ID-131 {131.19}: the unowned_only branch joins
    // record_lifecycle!inner(content_owner_id) to filter, but the selected
    // shape is just `id` — itemIds and ownerIds collapse onto the same set.
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

    // Notification insert goes through the service client (id-369 F1) —
    // covered by its own tests below; default service mock resolves success.

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

    expect(mockSupabase.rpc).toHaveBeenCalledWith('bulk_assign_content_owner', {
      p_item_ids: [VALID_UUID, VALID_UUID_2],
      p_owner_id: OWNER_UUID,
      p_assigned_by: 'test-user-id',
    });
  });

  // Replaces the pre-ID-131 "filter matches items with no backing source
  // document" test — content_items.source_document_id nullability is gone
  // now that filter queries hit source_documents directly. The equivalent
  // "resolves to nothing" gap is item_ids that don't resolve to an existing
  // source_documents row (e.g. stale/removed ids) — covered below.
  // id-369 F1: the owner-assignment notification is a cross-user row — the
  // `notifications_insert` RLS policy (user_id = auth.uid()) denies the
  // acting admin's client, so the route must write it with the service-role
  // client and surface the in-band `{ error }` PostgREST returns.
  it('notifies the new owner of the assignment via the service-role client', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: VALID_UUID }], error: null }),
    );
    mockSupabase.rpc.mockResolvedValueOnce({ data: 1, error: null });

    const req = createTestRequest('/api/content-owners/bulk-assign', {
      method: 'POST',
      body: { item_ids: [VALID_UUID], owner_id: OWNER_UUID },
    });
    const res = await bulkAssignPost(req);
    expect(res.status).toBe(200);

    // The cross-user row lands through the service-role client…
    expect(mockServiceSupabase.from).toHaveBeenCalledWith('notifications');
    expect(mockServiceSupabase._chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: OWNER_UUID,
        type: 'owner_assignment',
        entity_id: VALID_UUID,
      }),
    );
    // …and never through the actor's RLS-scoped client.
    expect(mockSupabase.from).not.toHaveBeenCalledWith('notifications');
  });

  it('reports the assignment as successful but records telemetry when the notification insert is denied', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: VALID_UUID }], error: null }),
    );
    mockSupabase.rpc.mockResolvedValueOnce({ data: 1, error: null });

    // PostgREST returns DB-level rejections in-band as `{ error }` — the
    // insert resolves (never throws), so only an explicit check can see it.
    mockServiceSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { message: 'insert violates row-level security policy' },
        }),
    );

    const req = createTestRequest('/api/content-owners/bulk-assign', {
      method: 'POST',
      body: { item_ids: [VALID_UUID], owner_id: OWNER_UUID },
    });
    const res = await bulkAssignPost(req);

    // Notification dispatch is best-effort: the assignment succeeded.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockLogBestEffortWarn).toHaveBeenCalledWith(
      'content.owner.notify',
      expect.any(String),
      expect.objectContaining({
        owner_id: OWNER_UUID,
        error: 'insert violates row-level security policy',
      }),
    );
  });

  it('returns success with 0 items when none of the requested item_ids resolve to an existing source document', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/content-owners/bulk-assign', {
      method: 'POST',
      body: {
        item_ids: [VALID_UUID],
        owner_id: OWNER_UUID,
      },
    });

    const res = await bulkAssignPost(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.items_updated).toBe(0);
    expect(mockSupabase.rpc).not.toHaveBeenCalledWith(
      'bulk_assign_content_owner',
      expect.anything(),
    );
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

    // Resolution query: source_documents.id existence check (awaited chain)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ id: VALID_UUID }],
          error: null,
        }),
    );

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

  it('returns 500 when the source_documents resolution query fails', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'DB error' } }),
    );

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

    const res = await statsGet();
    expect(res.status).toBe(401);
  });

  it('returns empty array when no stats', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const res = await statsGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual([]);
  });

  // NOTE: happy-path enrichment with real display names is covered by
  // the real-DB integration test at
  // `__tests__/integration/display-name-routes.integration.test.ts`.
  // Mocking the RPC response here would produce a tautology — the route
  // now delegates to `resolveUserDisplayNames` and the mock would only
  // verify "what I told the mock to return, the route returned". The
  // tests in THIS describe block cover auth, empty-result handling, and
  // the null-fallback path that don't need a real DB.

  it('returns stats with null display_name when the display-name RPC returns nothing', async () => {
    // S156 WP-2: the route now calls two RPCs in sequence —
    // `get_content_owner_stats` and `get_user_display_names`. When the
    // second RPC returns an empty result (e.g. the owner UUID points at
    // a deleted row), the wrapper yields an empty Map and the route
    // falls through to `display_name: null`. This matches the old
    // behaviour of the pre-S156 route when `auth.admin.getUserById`
    // returned `{ user: null }`.
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

    mockSupabase.rpc
      .mockResolvedValueOnce({ data: statsData, error: null })
      // get_user_display_names with empty result — wrapper yields an
      // empty Map; route falls through to `display_name: null`.
      .mockResolvedValueOnce({ data: [], error: null });

    const res = await statsGet();
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

    const res = await statsGet();
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

    const res = await statsGet();
    expect(res.status).toBe(200);
  });
});

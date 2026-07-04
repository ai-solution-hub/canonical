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

const { mockCookies, mockClassifyContent, mockCheckRateLimit } = vi.hoisted(
  () => ({
    mockCookies: vi.fn(),
    mockClassifyContent: vi.fn(),
    mockCheckRateLimit: vi.fn(),
  }),
);

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/ai/classify', () => ({
  classifyContent: mockClassifyContent,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock('@/lib/validation/layer-schemas', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/validation/layer-schemas')
  >('@/lib/validation/layer-schemas');
  return {
    ...actual,
    fetchActiveLayerKeys: vi.fn(() =>
      Promise.resolve([
        'sales_brief',
        'bid_detail',
        'company_reference',
        'research',
      ]),
    ),
  };
});

// Import routes AFTER mocks are registered
const { POST: classifyPost } =
  await import('@/app/api/items/[id]/classify/route');
const { PATCH: metadataPatch } =
  await import('@/app/api/items/[id]/metadata/route');
const { GET: workspacesGet, POST: workspacesPost } =
  await import('@/app/api/items/[id]/workspaces/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

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

  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  mockClassifyContent.mockResolvedValue({
    primary_domain: 'Engineering',
    primary_subtopic: 'Software',
  });
});

// =====================================================================
// POST /api/items/[id]/classify
// Uses getAuthorisedClient(['admin', 'editor']) — role lookup via .single()
// =====================================================================

describe('POST /api/items/[id]/classify', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/items/${VALID_UUID}/classify`, {
      method: 'POST',
      body: { force: false },
    });

    const res = await classifyPost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/items/${VALID_UUID}/classify`, {
      method: 'POST',
      body: { force: false },
    });

    const res = await classifyPost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 429 when rate limited', async () => {
    configureRole(mockSupabase, 'editor');
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const req = createTestRequest(`/api/items/${VALID_UUID}/classify`, {
      method: 'POST',
      body: { force: false },
    });

    const res = await classifyPost(req, { params });
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');
    const badParams = createTestParams({ id: 'not-a-uuid' });

    const req = createTestRequest('/api/items/not-a-uuid/classify', {
      method: 'POST',
      body: { force: false },
    });

    const res = await classifyPost(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid item ID/);
  });

  it('returns 200 with classification result on success', async () => {
    configureRole(mockSupabase, 'editor');
    const classifyResult = {
      primary_domain: 'Engineering',
      primary_subtopic: 'Software',
    };
    mockClassifyContent.mockResolvedValue(classifyResult);

    const req = createTestRequest(`/api/items/${VALID_UUID}/classify`, {
      method: 'POST',
      body: { force: true },
    });

    const res = await classifyPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.primary_domain).toBe('Engineering');

    expect(mockClassifyContent).toHaveBeenCalledWith({
      supabase: mockSupabase,
      itemId: VALID_UUID,
      force: true,
      userId: 'test-user-id',
    });
  });

  it('returns 500 when classifyContent throws a generic error', async () => {
    configureRole(mockSupabase, 'editor');
    mockClassifyContent.mockRejectedValue(new Error('AI failed'));

    const req = createTestRequest(`/api/items/${VALID_UUID}/classify`, {
      method: 'POST',
      body: { force: false },
    });

    const res = await classifyPost(req, { params });
    expect(res.status).toBe(500);
  });
});

// =====================================================================
// PATCH /api/items/[id]/metadata
// Uses getAuthorisedClient(['admin', 'editor'])
// =====================================================================

describe('PATCH /api/items/[id]/metadata', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/items/${VALID_UUID}/metadata`, {
      method: 'PATCH',
      body: { layer: 'sales_brief' },
    });

    const res = await metadataPatch(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/items/${VALID_UUID}/metadata`, {
      method: 'PATCH',
      body: { layer: 'sales_brief' },
    });

    const res = await metadataPatch(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 503 when layer vocabulary is unavailable', async () => {
    configureRole(mockSupabase, 'editor');

    const { fetchActiveLayerKeys } =
      await import('@/lib/validation/layer-schemas');
    vi.mocked(fetchActiveLayerKeys).mockRejectedValueOnce(
      new Error('Layer vocabulary fetch failed: connection refused'),
    );

    const req = createTestRequest(`/api/items/${VALID_UUID}/metadata`, {
      method: 'PATCH',
      body: { layer: 'sales_brief' },
    });

    const res = await metadataPatch(req, { params });
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.error).toBe('Layer vocabulary unavailable');
  });

  it('returns 400 for empty body', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/items/${VALID_UUID}/metadata`, {
      method: 'PATCH',
      body: {},
    });

    const res = await metadataPatch(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeDefined();
  });

  it('returns 400 for invalid layer value', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/items/${VALID_UUID}/metadata`, {
      method: 'PATCH',
      body: { layer: 'nonexistent_layer' },
    });

    const res = await metadataPatch(req, { params });
    expect(res.status).toBe(400);
  });

  it('returns 200 with updated metadata on success', async () => {
    configureRole(mockSupabase, 'editor');

    // layer goes to column update, topic_id goes to JSONB merge
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    // Route fetches updated metadata via .single()
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { metadata: { topic_id: 'test-topic' }, layer: 'sales_brief' },
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/metadata`, {
      method: 'PATCH',
      body: { layer: 'sales_brief', topic_id: 'test-topic' },
    });

    const res = await metadataPatch(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.layer).toBe('sales_brief');

    // layer should NOT be in the RPC call (promoted to column)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('merge_item_metadata', {
      p_item_id: VALID_UUID,
      p_new_data: { topic_id: 'test-topic' },
    });
  });

  it('returns 200 when only layer is sent (no RPC call needed)', async () => {
    configureRole(mockSupabase, 'editor');

    // Only column update, no JSONB merge
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { metadata: {}, layer: 'bid_detail' },
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/metadata`, {
      method: 'PATCH',
      body: { layer: 'bid_detail' },
    });

    const res = await metadataPatch(req, { params });
    expect(res.status).toBe(200);

    // RPC should NOT be called — only column update
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('returns 404 when RPC indicates item not found', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Item not found', code: 'PGRST116' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/metadata`, {
      method: 'PATCH',
      body: { topic_id: 'some-topic' },
    });

    const res = await metadataPatch(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Item not found');
  });

  it('returns 500 when RPC fails with generic error', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB failure', code: '50000' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/metadata`, {
      method: 'PATCH',
      body: { topic_id: 'my-topic' },
    });

    const res = await metadataPatch(req, { params });
    expect(res.status).toBe(500);
  });
});

// =====================================================================
// GET /api/items/[id]/workspaces
// Uses getAuthenticatedClient() — NO role lookup
// =====================================================================

describe('GET /api/items/[id]/workspaces', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/items/${VALID_UUID}/workspaces`);

    const res = await workspacesGet(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid UUID', async () => {
    const badParams = createTestParams({ id: 'bad' });

    const req = createTestRequest('/api/items/bad/workspaces');

    const res = await workspacesGet(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid item ID/);
  });

  it('returns workspace list on success', async () => {
    const workspaceData = [
      { id: VALID_UUID_2, name: 'Procurement A', color: '#6366f1' },
    ];
    mockSupabase.rpc.mockResolvedValueOnce({
      data: workspaceData,
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/workspaces`);

    const res = await workspacesGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Procurement A');
  });

  it('returns 500 when RPC fails', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC error' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/workspaces`);

    const res = await workspacesGet(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to fetch item workspaces');
  });
});

// =====================================================================
// POST /api/items/[id]/workspaces
// Uses getAuthorisedClient(['admin', 'editor'])
// =====================================================================

describe('POST /api/items/[id]/workspaces', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/items/${VALID_UUID}/workspaces`, {
      method: 'POST',
      body: { workspace_id: VALID_UUID_2, action: 'assign' },
    });

    const res = await workspacesPost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/items/${VALID_UUID}/workspaces`, {
      method: 'POST',
      body: { workspace_id: VALID_UUID_2, action: 'assign' },
    });

    const res = await workspacesPost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');
    const badParams = createTestParams({ id: 'bad' });

    const req = createTestRequest('/api/items/bad/workspaces', {
      method: 'POST',
      body: { workspace_id: VALID_UUID_2, action: 'assign' },
    });

    const res = await workspacesPost(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid item ID/);
  });

  it('assigns a workspace successfully', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest(`/api/items/${VALID_UUID}/workspaces`, {
      method: 'POST',
      body: { workspace_id: VALID_UUID_2, action: 'assign' },
    });

    const res = await workspacesPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 409 when workspace already assigned', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'Duplicate', code: '23505' } }),
    );

    const req = createTestRequest(`/api/items/${VALID_UUID}/workspaces`, {
      method: 'POST',
      body: { workspace_id: VALID_UUID_2, action: 'assign' },
    });

    const res = await workspacesPost(req, { params });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toMatch(/already assigned/);
  });

  it('unassigns a workspace successfully', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest(`/api/items/${VALID_UUID}/workspaces`, {
      method: 'POST',
      body: { workspace_id: VALID_UUID_2, action: 'unassign' },
    });

    const res = await workspacesPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('creates and assigns a new workspace via create path', async () => {
    configureRole(mockSupabase, 'editor');

    // Post-T2: route resolves application_type FK via maybeSingle() before
    // the workspace insert. Mock the lookup so the procurement seed resolves.
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'aaaaaaaa-0000-4000-8000-000000000001' },
      error: null,
    });

    // Workspace creation (insert().select().single())
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, name: 'New Workspace', color: '#6366f1' },
      error: null,
    });

    // Assignment insert (awaited chain, not .single())
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest(`/api/items/${VALID_UUID}/workspaces`, {
      method: 'POST',
      body: { create: true, name: 'New Workspace', type: 'procurement' },
    });

    const res = await workspacesPost(req, { params });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.name).toBe('New Workspace');
  });

  it('returns 409 when create workspace name already exists', async () => {
    configureRole(mockSupabase, 'editor');

    // Application_type lookup must succeed before the duplicate-name error
    // surfaces on the workspace insert.
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'aaaaaaaa-0000-4000-8000-000000000001' },
      error: null,
    });

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Unique violation', code: '23505' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/workspaces`, {
      method: 'POST',
      body: { create: true, name: 'Existing Workspace', type: 'procurement' },
    });

    const res = await workspacesPost(req, { params });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toMatch(/already exists/);
  });
});

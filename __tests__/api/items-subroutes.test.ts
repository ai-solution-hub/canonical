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

// Import routes AFTER mocks are registered
const { POST: classifyPost } = await import(
  '@/app/api/items/[id]/classify/route'
);
const { GET: historyGet } = await import(
  '@/app/api/items/[id]/history/route'
);
const { GET: historyVersionGet } = await import(
  '@/app/api/items/[id]/history/[versionId]/route'
);
const { POST: rollbackPost } = await import(
  '@/app/api/items/[id]/rollback/route'
);
const { PATCH: priorityPatch } = await import(
  '@/app/api/items/[id]/priority/route'
);
const { PATCH: metadataPatch } = await import(
  '@/app/api/items/[id]/metadata/route'
);
const { GET: layersGet } = await import(
  '@/app/api/items/[id]/layers/route'
);
const { GET: workspacesGet, POST: workspacesPost } = await import(
  '@/app/api/items/[id]/workspaces/route'
);
const { PATCH: ownerPatch } = await import(
  '@/app/api/items/[id]/owner/route'
);

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
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.maybeSingle.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.csv.mockReset();
  mockSupabase._chain.csv.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
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
// GET /api/items/[id]/history
// Uses getAuthorisedClient(['admin', 'editor', 'viewer'])
// =====================================================================

describe('GET /api/items/[id]/history', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/items/${VALID_UUID}/history`);

    const res = await historyGet(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'viewer');

    const badParams = createTestParams({ id: 'bad-id' });
    const req = createTestRequest('/api/items/bad-id/history');

    const res = await historyGet(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid item ID/);
  });

  it('returns paginated history on success', async () => {
    configureRole(mockSupabase, 'viewer');

    const versions = [
      { id: VALID_UUID_2, version: 2, change_summary: 'Updated title' },
      { id: VALID_UUID, version: 1, change_summary: 'Initial version' },
    ];

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: versions, error: null, count: 2 }),
    );

    const req = createTestRequest(`/api/items/${VALID_UUID}/history`, {
      searchParams: { limit: '10', offset: '0' },
    });

    const res = await historyGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.versions).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
  });

  it('clamps limit to maximum 100', async () => {
    configureRole(mockSupabase, 'viewer');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const req = createTestRequest(`/api/items/${VALID_UUID}/history`, {
      searchParams: { limit: '999' },
    });

    const res = await historyGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.limit).toBe(100);
  });

  it('returns 500 when Supabase query fails', async () => {
    configureRole(mockSupabase, 'viewer');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'DB error' }, count: 0 }),
    );

    const req = createTestRequest(`/api/items/${VALID_UUID}/history`);

    const res = await historyGet(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to fetch version history');
  });
});

// =====================================================================
// GET /api/items/[id]/history/[versionId]
// Uses getAuthorisedClient(['admin', 'editor', 'viewer'])
// =====================================================================

describe('GET /api/items/[id]/history/[versionId]', () => {
  const params = createTestParams({ id: VALID_UUID, versionId: VALID_UUID_2 });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/items/${VALID_UUID}/history/${VALID_UUID_2}`,
    );

    const res = await historyVersionGet(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 400 when item ID is invalid', async () => {
    configureRole(mockSupabase, 'viewer');

    const badParams = createTestParams({ id: 'bad', versionId: VALID_UUID_2 });
    const req = createTestRequest(`/api/items/bad/history/${VALID_UUID_2}`);

    const res = await historyVersionGet(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid ID/);
  });

  it('returns 400 when versionId is invalid', async () => {
    configureRole(mockSupabase, 'viewer');

    const badParams = createTestParams({ id: VALID_UUID, versionId: 'bad' });
    const req = createTestRequest(`/api/items/${VALID_UUID}/history/bad`);

    const res = await historyVersionGet(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid ID/);
  });

  it('returns 404 when version not found', async () => {
    configureRole(mockSupabase, 'viewer');

    // Route does .single() to fetch the version — return not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows found', code: 'PGRST116' },
    });

    const req = createTestRequest(
      `/api/items/${VALID_UUID}/history/${VALID_UUID_2}`,
    );

    const res = await historyVersionGet(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Version not found');
  });

  it('returns 200 with version data on success', async () => {
    configureRole(mockSupabase, 'viewer');

    const versionData = {
      id: VALID_UUID_2,
      content_item_id: VALID_UUID,
      version: 3,
      title: 'Version 3 Title',
      content: '<p>Version 3 content</p>',
      change_summary: 'Updated content',
    };

    // Route does .single() to fetch the version — return data
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: versionData,
      error: null,
    });

    const req = createTestRequest(
      `/api/items/${VALID_UUID}/history/${VALID_UUID_2}`,
    );

    const res = await historyVersionGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(VALID_UUID_2);
    expect(body.version).toBe(3);
    expect(body.title).toBe('Version 3 Title');
  });
});

// =====================================================================
// POST /api/items/[id]/rollback
// Uses getAuthorisedClient(['admin', 'editor'])
// Multi-step: role lookup .single() + target version .single() +
//   current item .single() + max version .single() + snapshot insert +
//   update .single()
// =====================================================================

describe('POST /api/items/[id]/rollback', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/items/${VALID_UUID}/rollback`, {
      method: 'POST',
      body: { version_id: VALID_UUID_2 },
    });

    const res = await rollbackPost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/items/${VALID_UUID}/rollback`, {
      method: 'POST',
      body: { version_id: VALID_UUID_2 },
    });

    const res = await rollbackPost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');
    const badParams = createTestParams({ id: 'not-uuid' });

    const req = createTestRequest('/api/items/not-uuid/rollback', {
      method: 'POST',
      body: { version_id: VALID_UUID_2 },
    });

    const res = await rollbackPost(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid item ID/);
  });

  it('returns 400 for invalid version_id in body', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/items/${VALID_UUID}/rollback`, {
      method: 'POST',
      body: { version_id: 'not-a-uuid' },
    });

    const res = await rollbackPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 404 when target version not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Target version lookup returns not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows found', code: 'PGRST116' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/rollback`, {
      method: 'POST',
      body: { version_id: VALID_UUID_2 },
    });

    const res = await rollbackPost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Version not found');
  });

  it('returns 404 when content item not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Target version found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_2,
        content_item_id: VALID_UUID,
        version: 2,
        title: 'Old Title',
        content: '<p>Old</p>',
        brief: null,
        detail: null,
        reference: null,
        metadata: null,
      },
      error: null,
    });

    // Current item lookup fails
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows found', code: 'PGRST116' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/rollback`, {
      method: 'POST',
      body: { version_id: VALID_UUID_2 },
    });

    const res = await rollbackPost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Item not found');
  });

  it('returns 200 with rollback details on success', async () => {
    configureRole(mockSupabase, 'editor');

    // Target version found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_2,
        content_item_id: VALID_UUID,
        version: 2,
        title: 'Old Title',
        content: '<p>Old</p>',
        brief: null,
        detail: null,
        reference: null,
        metadata: null,
      },
      error: null,
    });

    // Current item found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        title: 'Current Title',
        content: '<p>Current</p>',
        brief: null,
        detail: null,
        reference: null,
        metadata: null,
      },
      error: null,
    });

    // Max version lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { version: 3 },
      error: null,
    });

    // Snapshot insert (awaited chain, not .single())
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null }),
    );

    // Update content item (uses .select().single())
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/rollback`, {
      method: 'POST',
      body: { version_id: VALID_UUID_2 },
    });

    const res = await rollbackPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.rolled_back_to_version).toBe(2);
    expect(body.new_version).toBe(4);
  });

  it('returns 500 when snapshot insert fails', async () => {
    configureRole(mockSupabase, 'editor');

    // Target version found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_2,
        content_item_id: VALID_UUID,
        version: 2,
        title: 'Old',
        content: '<p>Old</p>',
        brief: null,
        detail: null,
        reference: null,
        metadata: null,
      },
      error: null,
    });

    // Current item found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        title: 'Current',
        content: '<p>Current</p>',
        brief: null,
        detail: null,
        reference: null,
        metadata: null,
      },
      error: null,
    });

    // Max version lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { version: 3 },
      error: null,
    });

    // Snapshot insert fails
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'Insert failed' } }),
    );

    const req = createTestRequest(`/api/items/${VALID_UUID}/rollback`, {
      method: 'POST',
      body: { version_id: VALID_UUID_2 },
    });

    const res = await rollbackPost(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toMatch(/snapshot/i);
  });
});

// =====================================================================
// PATCH /api/items/[id]/priority
// Uses getAuthorisedClient(['admin', 'editor'])
// =====================================================================

describe('PATCH /api/items/[id]/priority', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/items/${VALID_UUID}/priority`, {
      method: 'PATCH',
      body: { priority: 'high' },
    });

    const res = await priorityPatch(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/items/${VALID_UUID}/priority`, {
      method: 'PATCH',
      body: { priority: 'high' },
    });

    const res = await priorityPatch(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');
    const badParams = createTestParams({ id: 'bad' });

    const req = createTestRequest('/api/items/bad/priority', {
      method: 'PATCH',
      body: { priority: 'high' },
    });

    const res = await priorityPatch(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid item ID/);
  });

  it('returns 400 for invalid priority value', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/items/${VALID_UUID}/priority`, {
      method: 'PATCH',
      body: { priority: 'invalid_priority' },
    });

    const res = await priorityPatch(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 200 on successful priority update', async () => {
    configureRole(mockSupabase, 'editor');

    // Update returns the item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/priority`, {
      method: 'PATCH',
      body: { priority: 'high' },
    });

    const res = await priorityPatch(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.priority).toBe('high');
  });

  it('returns 404 when item not found (no data, no error)', async () => {
    configureRole(mockSupabase, 'editor');

    // Update returns null data with no error
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/priority`, {
      method: 'PATCH',
      body: { priority: 'low' },
    });

    const res = await priorityPatch(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Item not found');
  });

  it('returns 500 when Supabase update fails', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB error', code: '50000' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/priority`, {
      method: 'PATCH',
      body: { priority: 'high' },
    });

    const res = await priorityPatch(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to update priority');
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

  it('returns 400 for empty body', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/items/${VALID_UUID}/metadata`, {
      method: 'PATCH',
      body: {},
    });

    const res = await metadataPatch(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/At least one metadata field required/);
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
// GET /api/items/[id]/layers
// Uses getAuthenticatedClient() — NO role lookup, no .single() for role
// =====================================================================

describe('GET /api/items/[id]/layers', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/items/${VALID_UUID}/layers`);

    const res = await layersGet(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns empty layers when item has no topic_id', async () => {
    // Item found but no topic_id in metadata
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { metadata: {} },
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/layers`);

    const res = await layersGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.layers).toEqual([]);
  });

  it('returns 404 when item not found', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows found', code: 'PGRST116' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/layers`);

    const res = await layersGet(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Item not found');
  });

  it('returns layers from RPC when topic_id exists', async () => {
    // Item found with topic_id
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { metadata: { topic_id: 'my-topic' } },
      error: null,
    });

    const layerData = [
      { id: VALID_UUID, layer: 'sales_brief', title: 'Brief' },
      { id: VALID_UUID_2, layer: 'bid_detail', title: 'Detail' },
    ];
    mockSupabase.rpc.mockResolvedValueOnce({ data: layerData, error: null });

    const req = createTestRequest(`/api/items/${VALID_UUID}/layers`);

    const res = await layersGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.layers).toHaveLength(2);
    expect(body.topic_id).toBe('my-topic');

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_topic_layers', {
      p_topic_id: 'my-topic',
    });
  });

  it('returns 500 when RPC fails', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { metadata: { topic_id: 'my-topic' } },
      error: null,
    });

    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC error' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/layers`);

    const res = await layersGet(req, { params });
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
      { id: VALID_UUID_2, name: 'Bid A', color: '#6366f1' },
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
    expect(body[0].name).toBe('Bid A');
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
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null }),
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
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null }),
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

    // Workspace creation (insert().select().single())
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, name: 'New Workspace', color: '#6366f1' },
      error: null,
    });

    // Assignment insert (awaited chain, not .single())
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null }),
    );

    const req = createTestRequest(`/api/items/${VALID_UUID}/workspaces`, {
      method: 'POST',
      body: { create: true, name: 'New Workspace' },
    });

    const res = await workspacesPost(req, { params });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.name).toBe('New Workspace');
  });

  it('returns 409 when create workspace name already exists', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Unique violation', code: '23505' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/workspaces`, {
      method: 'POST',
      body: { create: true, name: 'Existing Workspace' },
    });

    const res = await workspacesPost(req, { params });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toMatch(/already exists/);
  });
});

// =====================================================================
// PATCH /api/items/[id]/owner
// Uses getAuthorisedClient(['admin', 'editor'])
// =====================================================================

describe('PATCH /api/items/[id]/owner', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/items/${VALID_UUID}/owner`, {
      method: 'PATCH',
      body: { owner_id: VALID_UUID_2 },
    });

    const res = await ownerPatch(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/items/${VALID_UUID}/owner`, {
      method: 'PATCH',
      body: { owner_id: VALID_UUID_2 },
    });

    const res = await ownerPatch(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid item UUID', async () => {
    configureRole(mockSupabase, 'editor');
    const badParams = createTestParams({ id: 'bad' });

    const req = createTestRequest('/api/items/bad/owner', {
      method: 'PATCH',
      body: { owner_id: VALID_UUID_2 },
    });

    const res = await ownerPatch(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid item ID/);
  });

  it('returns 400 for invalid owner_id UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/items/${VALID_UUID}/owner`, {
      method: 'PATCH',
      body: { owner_id: 'not-a-uuid' },
    });

    const res = await ownerPatch(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/uuid|Invalid/i);
  });

  it('returns 200 on successful owner assignment', async () => {
    configureRole(mockSupabase, 'editor');

    // First .single() = fetch current item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, title: 'Test', content: 'body', content_owner_id: null },
      error: null,
    });
    // Second .single() = update
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/owner`, {
      method: 'PATCH',
      body: { owner_id: VALID_UUID_2 },
    });

    const res = await ownerPatch(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.owner_id).toBe(VALID_UUID_2);
  });

  it('returns 200 when clearing owner (null)', async () => {
    configureRole(mockSupabase, 'editor');

    // First .single() = fetch current item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, title: 'Test', content: 'body', content_owner_id: VALID_UUID_2 },
      error: null,
    });
    // Second .single() = update
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

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

  it('returns 404 when item not found', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/owner`, {
      method: 'PATCH',
      body: { owner_id: VALID_UUID_2 },
    });

    const res = await ownerPatch(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Item not found');
  });

  it('returns 500 on database error', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB error', code: '50000' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}/owner`, {
      method: 'PATCH',
      body: { owner_id: VALID_UUID_2 },
    });

    const res = await ownerPatch(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to update content owner');
  });
});

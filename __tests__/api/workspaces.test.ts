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

// Suppress console.error noise from the route's error handling
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handlers under test (AFTER mocks are registered)
// ---------------------------------------------------------------------------

import { GET as listWorkspaces, POST as createWorkspace } from '@/app/api/workspaces/route';
import { PATCH as updateWorkspace, DELETE as deleteWorkspace } from '@/app/api/workspaces/[id]/route';
import { GET as getWorkspaceItems } from '@/app/api/workspaces/[id]/items/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';

/** Reset mock state and restore default authenticated user. */
function resetMocks() {
  vi.clearAllMocks();

  // Reset single/maybeSingle/then to clear any leaked mockResolvedValueOnce queues
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.then.mockReset();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainableMethods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null, count: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({ data: null, error: null, count: null });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

// ===========================================================================
// GET /api/workspaces
// ===========================================================================

describe('GET /api/workspaces', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/workspaces');
    const res = await listWorkspaces(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 200 with workspace list on success', async () => {
    const mockWorkspaces = [
      { id: VALID_UUID, name: 'Project Alpha', description: null, type: 'project', is_archived: false },
      { id: '00000000-0000-4000-8000-000000000002', name: 'Bid Beta', description: 'A bid', type: 'bid', is_archived: false },
    ];

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: mockWorkspaces, error: null }),
    );

    const req = createTestRequest('/api/workspaces');
    const res = await listWorkspaces(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(2);
    expect(json[0].name).toBe('Project Alpha');
    expect(json[1].name).toBe('Bid Beta');

    // Should filter out archived by default
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('is_archived', false);
  });

  it('includes archived workspaces when include_archived=true', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/workspaces', {
      searchParams: { include_archived: 'true' },
    });
    const res = await listWorkspaces(req);

    expect(res.status).toBe(200);
    const eqCalls = mockSupabase._chain.eq.mock.calls;
    const archivedFilter = eqCalls.find(
      (call: unknown[]) => call[0] === 'is_archived',
    );
    expect(archivedFilter).toBeUndefined();
  });

  it('returns 500 when Supabase query fails', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'Connection failed' } }),
    );

    const req = createTestRequest('/api/workspaces');
    const res = await listWorkspaces(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch workspaces');
  });
});

// ===========================================================================
// POST /api/workspaces
// ===========================================================================

describe('POST /api/workspaces', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/workspaces', {
      method: 'POST',
      body: { name: 'Test Workspace' },
    });
    const res = await createWorkspace(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/workspaces', {
      method: 'POST',
      body: { name: 'Test Workspace' },
    });
    const res = await createWorkspace(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 for missing name', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/workspaces', {
      method: 'POST',
      body: {},
    });
    const res = await createWorkspace(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 400 for invalid colour hex', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/workspaces', {
      method: 'POST',
      body: { name: 'Test', color: 'not-a-hex' },
    });
    const res = await createWorkspace(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 201 on successful creation', async () => {
    configureRole(mockSupabase, 'editor');

    const mockCreated = {
      id: VALID_UUID,
      name: 'New Workspace',
      description: null,
      color: '#6366f1',
      icon: 'folder',
      type: 'project',
      is_archived: false,
      created_by: 'test-user-id',
    };

    // configureRole already set up the first single() for the role check.
    // The second single() call is the route's insert().select().single().
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: mockCreated,
      error: null,
    });

    const req = createTestRequest('/api/workspaces', {
      method: 'POST',
      body: { name: 'New Workspace' },
    });
    const res = await createWorkspace(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.name).toBe('New Workspace');
    expect(json.id).toBe(VALID_UUID);

    expect(mockSupabase.from).toHaveBeenCalledWith('workspaces');
    expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Workspace',
        created_by: 'test-user-id',
      }),
    );
  });

  it('returns 409 for duplicate workspace name', async () => {
    configureRole(mockSupabase, 'editor');

    // The route's insert().select().single() returns a duplicate key error.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });

    const req = createTestRequest('/api/workspaces', {
      method: 'POST',
      body: { name: 'Existing Workspace' },
    });
    const res = await createWorkspace(req);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('already exists');
  });
});

// ===========================================================================
// PATCH /api/workspaces/[id]
// ===========================================================================

describe('PATCH /api/workspaces/[id]', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/workspaces/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated Name' },
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await updateWorkspace(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/workspaces/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await updateWorkspace(req, { params });

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/workspaces/not-a-uuid', {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const params = createTestParams({ id: 'not-a-uuid' });
    const res = await updateWorkspace(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid workspace ID');
  });

  it('returns 200 on successful update', async () => {
    configureRole(mockSupabase, 'editor');

    const mockUpdated = {
      id: VALID_UUID,
      name: 'Updated Workspace',
      description: 'New description',
    };

    // configureRole set up the role check. The route's update().eq().select().single():
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: mockUpdated,
      error: null,
    });

    const req = createTestRequest(`/api/workspaces/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated Workspace', description: 'New description' },
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await updateWorkspace(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe('Updated Workspace');
  });

  it('returns 409 for duplicate name on update', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });

    const req = createTestRequest(`/api/workspaces/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Existing Name' },
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await updateWorkspace(req, { params });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('already exists');
  });
});

// ===========================================================================
// DELETE /api/workspaces/[id]
// ===========================================================================

describe('DELETE /api/workspaces/[id]', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/workspaces/${VALID_UUID}`, {
      method: 'DELETE',
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await deleteWorkspace(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for editor role (admin-only)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/workspaces/${VALID_UUID}`, {
      method: 'DELETE',
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await deleteWorkspace(req, { params });

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/workspaces/not-a-uuid', {
      method: 'DELETE',
    });
    const params = createTestParams({ id: 'not-a-uuid' });
    const res = await deleteWorkspace(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid workspace ID');
  });

  it('archives workspace by default (soft delete)', async () => {
    configureRole(mockSupabase, 'admin');

    // The route's update().eq().select('id').single() for archiving:
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    const req = createTestRequest(`/api/workspaces/${VALID_UUID}`, {
      method: 'DELETE',
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await deleteWorkspace(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_archived: true }),
    );
  });

  it('permanently deletes when permanent=true and no assigned items', async () => {
    configureRole(mockSupabase, 'admin');

    // The count query for content_item_workspaces uses await with chain (no .single),
    // so it resolves via .then. Return count: 0 for the first call (count check),
    // then the delete also resolves via .then.
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) => {
      thenCallCount++;
      if (thenCallCount === 1) {
        // Count of assigned items
        return resolve({ data: null, error: null, count: 0 });
      }
      // Hard delete result
      return resolve({ data: null, error: null });
    });

    const req = createTestRequest(`/api/workspaces/${VALID_UUID}`, {
      method: 'DELETE',
      searchParams: { permanent: 'true' },
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await deleteWorkspace(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    expect(mockSupabase.from).toHaveBeenCalledWith('content_item_workspaces');
    expect(mockSupabase._chain.delete).toHaveBeenCalled();
  });

  it('returns 409 for permanent delete with assigned items', async () => {
    configureRole(mockSupabase, 'admin');

    // Count of assigned items returns > 0
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null, count: 5 }),
    );

    const req = createTestRequest(`/api/workspaces/${VALID_UUID}`, {
      method: 'DELETE',
      searchParams: { permanent: 'true' },
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await deleteWorkspace(req, { params });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('Cannot delete a workspace with assigned items');
  });
});

// ===========================================================================
// GET /api/workspaces/[id]/items
// ===========================================================================

describe('GET /api/workspaces/[id]/items', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/workspaces/${VALID_UUID}/items`);
    const params = createTestParams({ id: VALID_UUID });
    const res = await getWorkspaceItems(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 400 for invalid UUID', async () => {
    const req = createTestRequest('/api/workspaces/bad-id/items');
    const params = createTestParams({ id: 'bad-id' });
    const res = await getWorkspaceItems(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid workspace ID');
  });

  it('returns 200 with flattened items on success', async () => {
    const mockRows = [
      {
        assigned_at: '2026-01-15T10:00:00Z',
        content_items: {
          id: VALID_UUID,
          suggested_title: 'Test Article',
          content_type: 'article',
          captured_date: '2026-01-10',
        },
      },
    ];

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: mockRows, error: null }),
    );

    const req = createTestRequest(`/api/workspaces/${VALID_UUID}/items`);
    const params = createTestParams({ id: VALID_UUID });
    const res = await getWorkspaceItems(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].id).toBe(VALID_UUID);
    expect(json[0].suggested_title).toBe('Test Article');
    expect(json[0].assigned_at).toBe('2026-01-15T10:00:00Z');
  });

  it('returns 500 when Supabase query fails', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'Query failed' } }),
    );

    const req = createTestRequest(`/api/workspaces/${VALID_UUID}/items`);
    const params = createTestParams({ id: VALID_UUID });
    const res = await getWorkspaceItems(req, { params });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch workspace items');
  });
});

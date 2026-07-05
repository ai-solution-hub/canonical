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

import {
  GET as listWorkspaces,
  POST as createWorkspace,
} from '@/app/api/workspaces/route';
import {
  PATCH as updateWorkspace,
  DELETE as deleteWorkspace,
} from '@/app/api/workspaces/[id]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';

// Application-type seed UUIDs. The POST /api/workspaces route now resolves a
// FK via `application_types.select('id').eq('key',...).maybeSingle()` before
// the workspace insert. Tests mock that lookup with these canonical fixtures.
const PROCUREMENT_APP_TYPE_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const INTELLIGENCE_APP_TYPE_ID = 'aaaaaaaa-0000-4000-8000-000000000003';

/** Reset mock state and restore default authenticated user. */
function resetMocks() {
  // NB: `vi.clearAllMocks()` clears `mock.calls` but does NOT drain the
  // `mockResolvedValueOnce` queue. We `mockReset()` every mock to drop
  // both call history AND once-queues so prior tests can't leak.
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

  // Reset single/maybeSingle/then to clear any leaked mockResolvedValueOnce queues
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.then.mockReset();

  mockSupabase.auth.getUser.mockReset();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

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
  mockSupabase.rpc.mockReset();
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

/**
 * Configure the `application_types` lookup that the POST route does via
 * `maybeSingle()`. Post-T2 the route resolves an application_type id (FK)
 * by `key` before inserting the workspace.
 */
function configureAppTypeLookup(id: string) {
  mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
    data: { id },
    error: null,
  });
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
      {
        id: VALID_UUID,
        name: 'Project Alpha',
        description: null,
        type: 'project',
        is_archived: false,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Procurement Beta',
        description: 'A bid',
        type: 'bid',
        is_archived: false,
      },
    ];

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: mockWorkspaces, error: null }),
    );

    const req = createTestRequest('/api/workspaces');
    const res = await listWorkspaces(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(2);
    expect(json[0].name).toBe('Project Alpha');
    expect(json[1].name).toBe('Procurement Beta');

    // Archived rows must not surface in the default response.
    expect(json.every((w: { is_archived: boolean }) => !w.is_archived)).toBe(
      true,
    );
  });

  it('includes archived workspaces when include_archived=true', async () => {
    const mixed = [
      {
        id: VALID_UUID,
        name: 'Active',
        type: 'project',
        is_archived: false,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Stashed',
        type: 'project',
        is_archived: true,
      },
    ];
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: mixed, error: null }),
    );

    const req = createTestRequest('/api/workspaces', {
      searchParams: { include_archived: 'true' },
    });
    const res = await listWorkspaces(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    // With include_archived=true the response must contain archived rows
    // alongside active ones (the route no longer constrains is_archived).
    expect(json).toHaveLength(2);
    expect(json.some((w: { is_archived: boolean }) => w.is_archived)).toBe(
      true,
    );
  });

  it('returns 500 when Supabase query fails', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
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
    // Post-T2: type is REQUIRED and routes resolve the app_type FK first.
    configureAppTypeLookup(INTELLIGENCE_APP_TYPE_ID);

    const mockCreated = {
      id: VALID_UUID,
      name: 'New Workspace',
      description: null,
      color: '#6366f1',
      icon: 'folder',
      application_type_id: INTELLIGENCE_APP_TYPE_ID,
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
      body: { name: 'New Workspace', type: 'intelligence' },
    });
    const res = await createWorkspace(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.name).toBe('New Workspace');
    expect(json.id).toBe(VALID_UUID);

    // Content-of-write is observable: the new workspace must carry the
    // caller's name + stamp the actor onto created_by. Post-T2 the
    // discriminator is `application_type_id` (UUID), not the dropped
    // `type` text column.
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg).toMatchObject({
      name: 'New Workspace',
      application_type_id: INTELLIGENCE_APP_TYPE_ID,
      created_by: 'test-user-id',
    });
    expect(insertArg).not.toHaveProperty('type');
  });

  it('returns 409 for duplicate workspace name', async () => {
    configureRole(mockSupabase, 'editor');
    configureAppTypeLookup(INTELLIGENCE_APP_TYPE_ID);

    // The route's insert().select().single() returns a duplicate key error.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });

    const req = createTestRequest('/api/workspaces', {
      method: 'POST',
      body: { name: 'Existing Workspace', type: 'intelligence' },
    });
    const res = await createWorkspace(req);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('already exists');
  });

  it('rejects requests with no type (post-T2 type is required)', async () => {
    // Post-T2 the `workspaces.type` text column is dropped. The route now
    // rejects `null`/`'kb_section'` outright — there is no replacement
    // application_type for the legacy 'kb_section' default, so silently
    // dropping the request is safer than inserting a NULL FK.
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/workspaces', {
      method: 'POST',
      body: { name: 'KB Section' },
    });
    const res = await createWorkspace(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Workspace `type` is required');
  });

  it('passes type through to application_types FK lookup', async () => {
    // Q-OQR1-02: `procurement` workspaces (formerly 'bid' pre-T2) resolve
    // via the application_types FK. The route looks up the FK by `key`.
    configureRole(mockSupabase, 'editor');
    configureAppTypeLookup(PROCUREMENT_APP_TYPE_ID);

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        name: 'My Procurement',
        application_type_id: PROCUREMENT_APP_TYPE_ID,
      },
      error: null,
    });

    const req = createTestRequest('/api/workspaces', {
      method: 'POST',
      body: { name: 'My Procurement', type: 'procurement' },
    });
    const res = await createWorkspace(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe(VALID_UUID);

    // Content-of-write: the supplied procurement key maps to its FK row.
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg).toMatchObject({
      name: 'My Procurement',
      application_type_id: PROCUREMENT_APP_TYPE_ID,
    });
    expect(insertArg).not.toHaveProperty('type');
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

    // Content-of-write: soft delete is implemented as `is_archived = true`
    // — the recorded update payload must carry that flag.
    const updateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateArg).toMatchObject({ is_archived: true });
  });

  // ID-131.19 (M6, S450 GO tail): the "assigned items" pre-delete guard
  // (content_item_workspaces count check) was RETIRED — the junction table
  // was dropped; the S440 owner ruling accepted this breakage and the
  // rebind is owned by {135.22}. Permanent delete now goes straight to the
  // hard delete — a single `.then()` resolution, no count-check leg.
  it('permanently deletes when permanent=true (assigned-items guard retired)', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest(`/api/workspaces/${VALID_UUID}`, {
      method: 'DELETE',
      searchParams: { permanent: 'true' },
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await deleteWorkspace(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('never queries content_item_workspaces on permanent delete (ID-131.19 trim)', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest(`/api/workspaces/${VALID_UUID}`, {
      method: 'DELETE',
      searchParams: { permanent: 'true' },
    });
    const params = createTestParams({ id: VALID_UUID });
    await deleteWorkspace(req, { params });

    expect(mockSupabase.from).not.toHaveBeenCalledWith(
      'content_item_workspaces',
    );
  });
});

// GET /api/workspaces/[id]/items RETIRED (ID-131.19, M6, S450 GO tail) — its
// sole mechanism, the content_item_workspaces junction table, was dropped at
// M6. No production caller existed (grepped clean); honest deletion beats a
// broken retention. The S440 owner ruling accepted this breakage and the
// rebind to the new workspace-membership model is owned by {135.22}.

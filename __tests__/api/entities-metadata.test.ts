import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Import route AFTER mocks are registered
const { PATCH } =
  await import('@/app/api/entities/[canonical_name]/metadata/route');

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/entities/[canonical_name]/metadata', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/entities/ISO%2027001/metadata', {
      method: 'PATCH',
      body: { version: '2022' },
    });
    const params = createTestParams({ canonical_name: 'ISO%2027001' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/entities/ISO%2027001/metadata', {
      method: 'PATCH',
      body: { version: '2022' },
    });
    const params = createTestParams({ canonical_name: 'ISO%2027001' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for empty canonical_name', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/entities/%20/metadata', {
      method: 'PATCH',
      body: { version: '2022' },
    });
    const params = createTestParams({ canonical_name: '%20' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('canonical_name is required');
  });

  it('returns 404 when entity not found', async () => {
    configureRole(mockSupabase, 'admin');

    // single() returns null for the find query
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found', code: 'PGRST116' },
    });

    const req = createTestRequest('/api/entities/Unknown%20Entity/metadata', {
      method: 'PATCH',
      body: { version: '2022' },
    });
    const params = createTestParams({ canonical_name: 'Unknown%20Entity' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Entity not found');
  });

  it('updates metadata successfully for admin', async () => {
    configureRole(mockSupabase, 'admin');

    // First single() — role lookup is handled by configureRole
    // Second single() — find existing entity mention
    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: { id: 'mention-1', metadata: {} },
        error: null,
      })
      // Third single() — update result
      .mockResolvedValueOnce({
        data: {
          id: 'mention-1',
          canonical_name: 'ISO 27001',
          entity_type: 'certification',
          metadata: { version: '2022', issuing_body: 'BSI' },
        },
        error: null,
      });

    const req = createTestRequest('/api/entities/ISO%2027001/metadata', {
      method: 'PATCH',
      body: { version: '2022', issuing_body: 'BSI' },
    });
    const params = createTestParams({ canonical_name: 'ISO%2027001' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.canonical_name).toBe('ISO 27001');
    expect(body.metadata.version).toBe('2022');
    expect(body.metadata.issuing_body).toBe('BSI');
  });

  it('updates metadata successfully for editor', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: { id: 'mention-2', metadata: { holder: 'self' } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'mention-2',
          canonical_name: 'Cyber Essentials Plus',
          entity_type: 'certification',
          metadata: { holder: 'self', expiry_date: '2027-01-15' },
        },
        error: null,
      });

    const req = createTestRequest(
      '/api/entities/Cyber%20Essentials%20Plus/metadata',
      {
        method: 'PATCH',
        body: { expiry_date: '2027-01-15' },
      },
    );
    const params = createTestParams({
      canonical_name: 'Cyber%20Essentials%20Plus',
    });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.metadata.holder).toBe('self');
    expect(body.metadata.expiry_date).toBe('2027-01-15');
  });

  it('merges new metadata with existing metadata', async () => {
    configureRole(mockSupabase, 'admin');

    // Existing metadata has version; we are adding issuing_body
    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: { id: 'mention-1', metadata: { version: '2022' } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'mention-1',
          canonical_name: 'ISO 27001',
          entity_type: 'certification',
          metadata: { version: '2022', issuing_body: 'BSI' },
        },
        error: null,
      });

    const req = createTestRequest('/api/entities/ISO%2027001/metadata', {
      method: 'PATCH',
      body: { issuing_body: 'BSI' },
    });
    const params = createTestParams({ canonical_name: 'ISO%2027001' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    // The merged metadata is observable in the response — the prior version
    // value must survive alongside the new issuing_body.
    expect(body.metadata).toEqual({ version: '2022', issuing_body: 'BSI' });

    // Content-of-write: the recorded update payload carries the merged shape.
    const updateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateArg).toEqual({
      metadata: { version: '2022', issuing_body: 'BSI' },
    });
  });

  it('returns 500 when update query fails', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: { id: 'mention-1', metadata: {} },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'DB error', code: '50000' },
      });

    const req = createTestRequest('/api/entities/ISO%2027001/metadata', {
      method: 'PATCH',
      body: { version: '2022' },
    });
    const params = createTestParams({ canonical_name: 'ISO%2027001' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(500);
  });

  it('URL-decodes the canonical_name param', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: { id: 'mention-1', metadata: {} },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'mention-1',
          canonical_name: 'G Cloud 14',
          entity_type: 'framework',
          metadata: { round: '14' },
        },
        error: null,
      });

    const encoded = encodeURIComponent('G Cloud 14');
    const req = createTestRequest(`/api/entities/${encoded}/metadata`, {
      method: 'PATCH',
      body: { round: '14' },
    });
    const params = createTestParams({ canonical_name: encoded });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);

    // Decoded form is observable through the response payload — if the
    // route had passed the raw encoded string through, the lookup would
    // have returned 404 and the success body would not match.
    const body = await res.json();
    expect(body.canonical_name).toBe('G Cloud 14');
  });
});

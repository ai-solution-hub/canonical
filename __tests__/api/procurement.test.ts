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

// Import AFTER mocks
import { GET, POST } from '@/app/api/procurement/route';
import { GET as getBid, PATCH, DELETE } from '@/app/api/procurement/[id]/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const INVALID_UUID = 'not-a-uuid';

const MOCK_BID = {
  id: VALID_UUID,
  name: 'Test Procurement',
  description: 'A test bid',
  domain_metadata: {
    buyer: 'Acme Corp',
    status: 'draft',
    deadline: null,
    reference_number: null,
    estimated_value: null,
    tender_source: null,
    tender_document_ids: [],
    submission_date: null,
    outcome: null,
    outcome_notes: null,
    notes: null,
  },
  is_archived: false,
  created_by: 'test-user-id',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  updated_by: null,
};

const VALID_CREATE_BODY = {
  name: 'New Procurement',
  buyer: 'Test Buyer',
  description: 'A new bid',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Application-type seed UUID. The POST/INSERT path now does a separate
// `application_types.select('id').eq('key', 'procurement').maybeSingle()`
// lookup (T2 schema migration) before the workspace insert. Tests mock that
// lookup with this canonical fixture id.
const PROCUREMENT_APP_TYPE_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

function resetMocks() {
  // NB: `vi.clearAllMocks()` clears `mock.calls` but does NOT drain the
  // `mockResolvedValueOnce` queue. Unconsumed once-mocks from a prior test
  // would otherwise leak into the next test's first `.single()` call. We
  // therefore `mockReset()` the terminal methods (`single`, `maybeSingle`,
  // `then`) explicitly to drop their once-queues, then re-establish the
  // baseline defaults.
  vi.clearAllMocks();

  const chain = mockSupabase._chain;
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
    chain[method].mockReset();
    chain[method].mockReturnValue(chain);
  }
  chain.single.mockReset();
  chain.maybeSingle.mockReset();
  chain.then.mockReset();
  chain.single.mockResolvedValue({ data: null, error: null, count: null });
  chain.maybeSingle.mockResolvedValue({ data: null, error: null, count: null });
  chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.auth.getUser.mockReset();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.from.mockReturnValue(chain);
  mockSupabase.rpc.mockReset();
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  const storageBucket = {
    upload: vi
      .fn()
      .mockResolvedValue({ data: { path: 'test-path' }, error: null }),
    download: vi.fn().mockResolvedValue({ data: new Blob(), error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
    getPublicUrl: vi
      .fn()
      .mockReturnValue({ data: { publicUrl: 'https://example.com/file' } }),
  };
  mockSupabase.storage.from.mockReturnValue(storageBucket);
}

/**
 * Configure the `application_types` lookup that POST /api/bids and the bid
 * sub-routes perform via `maybeSingle()`. Post-T2 the route resolves the
 * procurement application_type id (FK) before inserting/joining workspaces.
 */
function configureProcurementAppType() {
  mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
    data: { id: PROCUREMENT_APP_TYPE_ID },
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/bids', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest('/api/procurement');
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 200 with bids array on success', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [MOCK_BID], error: null, count: 1 }),
    );

    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ workspace_id: VALID_UUID, total: 5, answered: 3 }],
      error: null,
    });

    const req = createTestRequest('/api/procurement');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bids).toHaveLength(1);
    expect(body.bids[0].id).toBe(VALID_UUID);
    expect(body.bids[0].question_stats).toEqual({
      workspace_id: VALID_UUID,
      total: 5,
      answered: 3,
    });
    expect(body.total).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    // Happy path: failed_bid_ids is absent (matches H13 sibling-when-non-empty
    // convention).
    expect(body).not.toHaveProperty('failed_bid_ids');
  });

  it('surfaces failed_bid_ids[] when fallback per-bid stats fail (WP5)', async () => {
    // Two bids in the list. The batch RPC errors (forcing the per-bid
    // fallback path), then one of the per-bid RPCs errors and the other
    // succeeds. The response must surface only the failing bid id under
    // `failed_bid_ids` while the successful bid still gets question_stats.
    const SECOND_UUID = 'b2c3d4e5-f6a7-8901-bcde-f23456789012';
    const SECOND_BID = { ...MOCK_BID, id: SECOND_UUID, name: 'Second Procurement' };

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [MOCK_BID, SECOND_BID], error: null, count: 2 }),
    );

    // Batch RPC fails -> triggers fallback path.
    mockSupabase.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: '42883', message: 'function does not exist' },
      })
      // First per-bid call fails (this is the bid id we expect in failed_bid_ids).
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST500', message: 'stats lookup failed' },
      })
      // Second per-bid call succeeds.
      .mockResolvedValueOnce({
        data: [{ workspace_id: SECOND_UUID, total: 4, answered: 2 }],
        error: null,
      });

    const req = createTestRequest('/api/procurement');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.bids).toHaveLength(2);
    expect(body.failed_bid_ids).toEqual([VALID_UUID]);

    const successful = body.bids.find(
      (b: { id: string }) => b.id === SECOND_UUID,
    );
    expect(successful?.question_stats).toEqual({
      workspace_id: SECOND_UUID,
      total: 4,
      answered: 2,
    });

    const failed = body.bids.find((b: { id: string }) => b.id === VALID_UUID);
    expect(failed?.question_stats).toBeNull();
  });
});

describe('POST /api/bids', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest('/api/procurement', {
      method: 'POST',
      body: VALID_CREATE_BODY,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');
    const req = createTestRequest('/api/procurement', {
      method: 'POST',
      body: VALID_CREATE_BODY,
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
  });

  it('returns 400 for missing name', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest('/api/procurement', {
      method: 'POST',
      body: { buyer: 'Test Buyer' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
    );
  });

  it('returns 400 for missing buyer', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest('/api/procurement', {
      method: 'POST',
      body: { name: 'Test Procurement' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'buyer' })]),
    );
  });

  it('returns 201 on successful creation', async () => {
    configureRole(mockSupabase, 'editor');
    // Post-T2: route resolves procurement app_type FK before workspace insert.
    configureProcurementAppType();

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_BID,
      error: null,
    });

    const req = createTestRequest('/api/procurement', {
      method: 'POST',
      body: VALID_CREATE_BODY,
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(VALID_UUID);
    expect(body.name).toBe('Test Procurement');

    // Content-of-write: the new bid row carries the caller-supplied name +
    // buyer, points at the procurement application_type FK, defaults the
    // status to draft, and stamps the actor. Post-T2 the discriminator is
    // `application_type_id` (UUID), not `type` ('bid').
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg).toMatchObject({
      name: 'New Procurement',
      application_type_id: PROCUREMENT_APP_TYPE_ID,
      created_by: 'test-user-id',
      domain_metadata: expect.objectContaining({
        buyer: 'Test Buyer',
        status: 'draft',
      }),
    });
    expect(insertArg).not.toHaveProperty('type');
  });

  it('returns 409 on duplicate name (Postgres 23505)', async () => {
    configureRole(mockSupabase, 'editor');
    configureProcurementAppType();

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    });

    const req = createTestRequest('/api/procurement', {
      method: 'POST',
      body: VALID_CREATE_BODY,
    });
    const res = await POST(req);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already exists');
  });
});

describe('GET /api/bids/[id]', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest(`/api/procurement/${VALID_UUID}`);
    const res = await getBid(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid UUID', async () => {
    const req = createTestRequest(`/api/procurement/${INVALID_UUID}`);
    const res = await getBid(req, {
      params: createTestParams({ id: INVALID_UUID }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid bid ID');
  });

  it('returns 404 for non-existent bid', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`);
    const res = await getBid(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Procurement not found');
  });

  it('returns 200 with bid data, question stats, and tender documents', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_BID,
      error: null,
    });

    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ total: 10, answered: 7, approved: 3 }],
      error: null,
    });

    const storageBucket = {
      list: vi.fn().mockResolvedValue({
        data: [
          {
            name: 'tender.pdf',
            metadata: { size: 1024, mimetype: 'application/pdf' },
            created_at: '2026-01-15T00:00:00Z',
          },
        ],
        error: null,
      }),
      upload: vi.fn(),
      download: vi.fn(),
      remove: vi.fn(),
      getPublicUrl: vi.fn(),
    };
    mockSupabase.storage.from.mockReturnValue(storageBucket);

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`);
    const res = await getBid(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(VALID_UUID);
    expect(body.name).toBe('Test Procurement');
    expect(body.question_stats).toEqual({
      total: 10,
      answered: 7,
      approved: 3,
    });
    expect(body.tender_documents).toHaveLength(1);
    expect(body.tender_documents[0].filename).toBe('tender.pdf');
    expect(body.tender_documents[0].path).toBe(`${VALID_UUID}/tender.pdf`);
    // No warnings on the happy path — sibling field is omitted when empty.
    expect(body.warnings).toBeUndefined();
  });

  it('returns 200 with warnings[] when stats RPC fails (partial response)', async () => {
    // S152A WP4: H2 was flipped from fail-fast to partial-response. Procurement
    // detail is a composite view (overview, questions, drafting, outcome,
    // documents tabs) and a transient stats glitch must not 500 the page.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_BID,
      error: null,
    });

    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'stats rpc unavailable', code: 'XX000' },
    });

    const storageBucket = {
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      upload: vi.fn(),
      download: vi.fn(),
      remove: vi.fn(),
      getPublicUrl: vi.fn(),
    };
    mockSupabase.storage.from.mockReturnValue(storageBucket);

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`);
    const res = await getBid(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(VALID_UUID);
    expect(body.question_stats).toBeNull();
    expect(body.tender_documents).toEqual([]);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toMatch(/Question stats could not be loaded/);
  });

  it('returns 200 with warnings[] when storage list fails (partial response)', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_BID,
      error: null,
    });

    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ total: 10, answered: 7, approved: 3 }],
      error: null,
    });

    const storageBucket = {
      list: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'storage unavailable' },
      }),
      upload: vi.fn(),
      download: vi.fn(),
      remove: vi.fn(),
      getPublicUrl: vi.fn(),
    };
    mockSupabase.storage.from.mockReturnValue(storageBucket);

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`);
    const res = await getBid(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.question_stats).toEqual({
      total: 10,
      answered: 7,
      approved: 3,
    });
    expect(body.tender_documents).toEqual([]);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toMatch(/Tender documents could not be listed/);
  });
});

describe('PATCH /api/bids/[id]', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const res = await PATCH(req, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');
    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const res = await PATCH(req, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest(`/api/procurement/${INVALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const res = await PATCH(req, {
      params: createTestParams({ id: INVALID_UUID }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid bid ID');
  });

  it('returns 404 when bid does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const res = await PATCH(req, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful metadata update', async () => {
    configureRole(mockSupabase, 'editor');

    const updatedBid = {
      ...MOCK_BID,
      name: 'Updated Procurement',
      domain_metadata: { ...MOCK_BID.domain_metadata, buyer: 'Updated Buyer' },
    };

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_BID,
      error: null,
    });

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: updatedBid,
      error: null,
    });

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated Procurement', buyer: 'Updated Buyer' },
    });
    const res = await PATCH(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Procurement');
    expect(body.domain_metadata.buyer).toBe('Updated Buyer');

    // Content-of-write: the patch must merge the new buyer into
    // domain_metadata, preserve the prior status, and stamp updated_by.
    const updateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateArg).toMatchObject({
      domain_metadata: expect.objectContaining({
        buyer: 'Updated Buyer',
        status: 'draft',
      }),
      updated_by: 'test-user-id',
    });
  });

  it('returns 400 for invalid state transition', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_BID,
      error: null,
    });

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'submitted' },
    });
    const res = await PATCH(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Cannot transition');
    expect(body.current_status).toBe('draft');
    expect(body.requested_status).toBe('submitted');
  });

  it('returns 200 for valid state transition (draft -> questions_extracted)', async () => {
    configureRole(mockSupabase, 'editor');

    const transitionedBid = {
      ...MOCK_BID,
      domain_metadata: {
        ...MOCK_BID.domain_metadata,
        status: 'questions_extracted',
      },
    };

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_BID,
      error: null,
    });

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: transitionedBid,
      error: null,
    });

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'questions_extracted' },
    });
    const res = await PATCH(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain_metadata.status).toBe('questions_extracted');
  });
});

describe('DELETE /api/bids/[id]', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for editor role (admin only)', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 for viewer role (admin only)', async () => {
    configureRole(mockSupabase, 'viewer');
    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'admin');
    const req = createTestRequest(`/api/procurement/${INVALID_UUID}`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, {
      params: createTestParams({ id: INVALID_UUID }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when bid does not exist', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 204 on successful deletion', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, domain_metadata: MOCK_BID.domain_metadata },
      error: null,
    });

    const storageBucket = {
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      upload: vi.fn(),
      download: vi.fn(),
      getPublicUrl: vi.fn(),
    };
    mockSupabase.storage.from.mockReturnValue(storageBucket);

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(204);
  });
});

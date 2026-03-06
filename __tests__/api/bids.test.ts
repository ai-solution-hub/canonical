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
import { GET, POST } from '@/app/api/bids/route';
import {
  GET as getBid,
  PATCH,
  DELETE,
} from '@/app/api/bids/[id]/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const INVALID_UUID = 'not-a-uuid';

const MOCK_BID = {
  id: VALID_UUID,
  name: 'Test Bid',
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
  name: 'New Bid',
  buyer: 'Test Buyer',
  description: 'A new bid',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.clearAllMocks();

  const chain = mockSupabase._chain;
  const chainableMethods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;
  for (const method of chainableMethods) {
    chain[method].mockReturnValue(chain);
  }
  chain.single.mockResolvedValue({ data: null, error: null, count: null });
  chain.maybeSingle.mockResolvedValue({ data: null, error: null, count: null });
  chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.from.mockReturnValue(chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  const storageBucket = {
    upload: vi.fn().mockResolvedValue({ data: { path: 'test-path' }, error: null }),
    download: vi.fn().mockResolvedValue({ data: new Blob(), error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
    getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/file' } }),
  };
  mockSupabase.storage.from.mockReturnValue(storageBucket);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/bids', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest('/api/bids');
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 200 with bids array on success', async () => {
    mockSupabase._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: [MOCK_BID], error: null, count: 1 }),
    );

    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ project_id: VALID_UUID, total: 5, answered: 3 }],
      error: null,
    });

    const req = createTestRequest('/api/bids');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bids).toHaveLength(1);
    expect(body.bids[0].id).toBe(VALID_UUID);
    expect(body.bids[0].question_stats).toEqual({ project_id: VALID_UUID, total: 5, answered: 3 });
    expect(body.total).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });
});

describe('POST /api/bids', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest('/api/bids', {
      method: 'POST',
      body: VALID_CREATE_BODY,
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');
    const req = createTestRequest('/api/bids', {
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
    const req = createTestRequest('/api/bids', {
      method: 'POST',
      body: { buyer: 'Test Buyer' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'name' }),
      ]),
    );
  });

  it('returns 400 for missing buyer', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest('/api/bids', {
      method: 'POST',
      body: { name: 'Test Bid' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'buyer' }),
      ]),
    );
  });

  it('returns 201 on successful creation', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_BID,
      error: null,
    });

    const req = createTestRequest('/api/bids', {
      method: 'POST',
      body: VALID_CREATE_BODY,
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(VALID_UUID);
    expect(body.name).toBe('Test Bid');

    expect(mockSupabase.from).toHaveBeenCalledWith('workspaces');
    expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Bid',
        type: 'bid',
        created_by: 'test-user-id',
        domain_metadata: expect.objectContaining({
          buyer: 'Test Buyer',
          status: 'draft',
        }),
      }),
    );
  });

  it('returns 409 on duplicate name (Postgres 23505)', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    });

    const req = createTestRequest('/api/bids', {
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
    const req = createTestRequest(`/api/bids/${VALID_UUID}`);
    const res = await getBid(req, { params: createTestParams({ id: VALID_UUID }) });

    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid UUID', async () => {
    const req = createTestRequest(`/api/bids/${INVALID_UUID}`);
    const res = await getBid(req, { params: createTestParams({ id: INVALID_UUID }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid bid ID');
  });

  it('returns 404 for non-existent bid', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(`/api/bids/${VALID_UUID}`);
    const res = await getBid(req, { params: createTestParams({ id: VALID_UUID }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Bid not found');
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

    const req = createTestRequest(`/api/bids/${VALID_UUID}`);
    const res = await getBid(req, { params: createTestParams({ id: VALID_UUID }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(VALID_UUID);
    expect(body.name).toBe('Test Bid');
    expect(body.question_stats).toEqual({ total: 10, answered: 7, approved: 3 });
    expect(body.tender_documents).toHaveLength(1);
    expect(body.tender_documents[0].filename).toBe('tender.pdf');
    expect(body.tender_documents[0].path).toBe(`${VALID_UUID}/tender.pdf`);
  });
});

describe('PATCH /api/bids/[id]', () => {
  beforeEach(resetMocks);

  it('returns 403 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const res = await PATCH(req, { params: createTestParams({ id: VALID_UUID }) });
    expect(res.status).toBe(403);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');
    const req = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const res = await PATCH(req, { params: createTestParams({ id: VALID_UUID }) });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest(`/api/bids/${INVALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const res = await PATCH(req, { params: createTestParams({ id: INVALID_UUID }) });

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

    const req = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const res = await PATCH(req, { params: createTestParams({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful metadata update', async () => {
    configureRole(mockSupabase, 'editor');

    const updatedBid = {
      ...MOCK_BID,
      name: 'Updated Bid',
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

    const req = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated Bid', buyer: 'Updated Buyer' },
    });
    const res = await PATCH(req, { params: createTestParams({ id: VALID_UUID }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Bid');

    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        domain_metadata: expect.objectContaining({
          buyer: 'Updated Buyer',
          status: 'draft',
        }),
        updated_by: 'test-user-id',
      }),
    );
  });

  it('returns 400 for invalid state transition', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_BID,
      error: null,
    });

    const req = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'submitted' },
    });
    const res = await PATCH(req, { params: createTestParams({ id: VALID_UUID }) });

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
      domain_metadata: { ...MOCK_BID.domain_metadata, status: 'questions_extracted' },
    };

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_BID,
      error: null,
    });

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: transitionedBid,
      error: null,
    });

    const req = createTestRequest(`/api/bids/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'questions_extracted' },
    });
    const res = await PATCH(req, { params: createTestParams({ id: VALID_UUID }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain_metadata.status).toBe('questions_extracted');
  });
});

describe('DELETE /api/bids/[id]', () => {
  beforeEach(resetMocks);

  it('returns 403 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest(`/api/bids/${VALID_UUID}`, { method: 'DELETE' });
    const res = await DELETE(req, { params: createTestParams({ id: VALID_UUID }) });
    expect(res.status).toBe(403);
  });

  it('returns 403 for editor role (admin only)', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest(`/api/bids/${VALID_UUID}`, { method: 'DELETE' });
    const res = await DELETE(req, { params: createTestParams({ id: VALID_UUID }) });
    expect(res.status).toBe(403);
  });

  it('returns 403 for viewer role (admin only)', async () => {
    configureRole(mockSupabase, 'viewer');
    const req = createTestRequest(`/api/bids/${VALID_UUID}`, { method: 'DELETE' });
    const res = await DELETE(req, { params: createTestParams({ id: VALID_UUID }) });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'admin');
    const req = createTestRequest(`/api/bids/${INVALID_UUID}`, { method: 'DELETE' });
    const res = await DELETE(req, { params: createTestParams({ id: INVALID_UUID }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 when bid does not exist', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(`/api/bids/${VALID_UUID}`, { method: 'DELETE' });
    const res = await DELETE(req, { params: createTestParams({ id: VALID_UUID }) });
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

    mockSupabase._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    mockSupabase._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    const req = createTestRequest(`/api/bids/${VALID_UUID}`, { method: 'DELETE' });
    const res = await DELETE(req, { params: createTestParams({ id: VALID_UUID }) });

    expect(res.status).toBe(204);

    expect(mockSupabase.from).toHaveBeenCalledWith('workspaces');
    expect(mockSupabase._chain.delete).toHaveBeenCalled();
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('id', VALID_UUID);
  });
});

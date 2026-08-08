/**
 * Procurement collection route tests.
 *
 *   - GET  /api/procurement — list procurements with their per-item stats
 *   - POST /api/procurement — create one, minting a `form_instances` row
 *
 * Covers auth enforcement, the create-body validation, the partial-response
 * contract when the per-item stats fallback fails, and the field mapping the
 * create path applies (currency parsing, notes folded into description).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '@/__tests__/helpers/mock-supabase';
import { createTestRequest } from '@/__tests__/helpers/mock-next';

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

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
  form_type: 'itt',
};

// ID-145 {145.8} — form-first create: POST mints a `form_instances` row
// directly (BI-7), never a bare `workspaces` row. This fixture mirrors the
// real `.select()` projection off the newly-minted row.
const MOCK_FORM_INSTANCE = {
  id: VALID_UUID,
  name: 'New Procurement',
  description: 'A new bid',
  form_type: 'itt',
  processing_status: 'uploaded',
  workflow_state: 'draft',
  deadline: null,
  issuing_organisation: 'Test Buyer',
  reference_number: null,
  estimated_value: null,
  created_by: 'test-user-id',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/procurement', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest('/api/procurement');
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 200 with procurements array on success', async () => {
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
    expect(body.procurements).toHaveLength(1);
    expect(body.procurements[0].id).toBe(VALID_UUID);
    expect(body.procurements[0].question_stats).toEqual({
      workspace_id: VALID_UUID,
      total: 5,
      answered: 3,
    });
    expect(body.total).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    // Happy path: failed_procurement_ids is absent (matches H13
    // sibling-when-non-empty convention).
    expect(body).not.toHaveProperty('failed_procurement_ids');
  });

  it('surfaces failed_procurement_ids[] when fallback per-bid stats fail (WP5)', async () => {
    // Two bids in the list. The batch RPC errors (forcing the per-bid
    // fallback path), then one of the per-bid RPCs errors and the other
    // succeeds. The response must surface only the failing bid id under
    // `failed_procurement_ids` while the successful bid still gets question_stats.
    const SECOND_UUID = 'b2c3d4e5-f6a7-8901-bcde-f23456789012';
    const SECOND_BID = {
      ...MOCK_BID,
      id: SECOND_UUID,
      name: 'Second Procurement',
    };

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
      // First per-bid call fails (this is the bid id we expect in failed_procurement_ids).
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

    expect(body.procurements).toHaveLength(2);
    expect(body.failed_procurement_ids).toEqual([VALID_UUID]);

    const successful = body.procurements.find(
      (b: { id: string }) => b.id === SECOND_UUID,
    );
    expect(successful?.question_stats).toEqual({
      workspace_id: SECOND_UUID,
      total: 4,
      answered: 2,
    });

    const failed = body.procurements.find(
      (b: { id: string }) => b.id === VALID_UUID,
    );
    expect(failed?.question_stats).toBeNull();
  });
});

describe('POST /api/procurement', () => {
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
      body: { name: 'Test Procurement', form_type: 'itt' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'buyer' })]),
    );
  });

  // ID-145 {145.8} (BI-7/8): the create action always mints a form (with a
  // `form_type`) — the FormTypePicker's confirmed choice is required, never
  // silently defaulted (B-14 precedent).
  it('returns 400 for missing form_type', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest('/api/procurement', {
      method: 'POST',
      body: { name: 'Test Procurement', buyer: 'Test Buyer' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'form_type' })]),
    );
  });

  it('returns 201 on successful creation, minting a form_instances row directly (never a bare workspace)', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_FORM_INSTANCE,
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
    expect(body.name).toBe('New Procurement');
    expect(body.form_type).toBe('itt');

    // BI-7: the item IS the form — the route mints `form_instances` directly,
    // never a `workspaces` row (the born-formless root cause this Subtask
    // fixes).
    expect(mockSupabase.from).toHaveBeenCalledWith('form_instances');
    expect(mockSupabase.from).not.toHaveBeenCalledWith('workspaces');
    expect(mockSupabase.from).not.toHaveBeenCalledWith('application_types');

    // Content-of-write: buyer re-anchors to `issuing_organisation` (the
    // native column, BI-5/BI-1 — no more nested `domain_metadata`); the
    // confirmed `form_type` is authoritative (B-14); the row is minted
    // docless (`ingest_source='minted'`, the re-cut CHECK's reserved value
    // for exactly this case, TECH.md §2 M3) and stamped with the actor.
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg).toMatchObject({
      name: 'New Procurement',
      issuing_organisation: 'Test Buyer',
      form_type: 'itt',
      ingest_source: 'minted',
      created_by: 'test-user-id',
    });
    expect(insertArg).not.toHaveProperty('domain_metadata');
    expect(insertArg).not.toHaveProperty('workspace_id');
    expect(insertArg).not.toHaveProperty('application_type_id');
  });

  it('parses a currency-formatted estimated_value into a numeric column value', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { ...MOCK_FORM_INSTANCE, estimated_value: 50000 },
      error: null,
    });

    const req = createTestRequest('/api/procurement', {
      method: 'POST',
      body: { ...VALID_CREATE_BODY, estimated_value: '£50,000' },
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg.estimated_value).toBe(50000);
  });

  it('folds notes into description (the surviving free-text column) rather than dropping it', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_FORM_INSTANCE,
      error: null,
    });

    const req = createTestRequest('/api/procurement', {
      method: 'POST',
      body: {
        name: 'New Procurement',
        buyer: 'Test Buyer',
        form_type: 'itt',
        notes: 'Follow up next week.',
      },
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg.description).toBe('Follow up next week.');
  });
});

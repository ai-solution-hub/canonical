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

// ID-130 T-B1 / T-B8: the umbrella GET reads workspace identity + the roll-up +
// the child-form list (NOT domain_metadata); PATCH transitions the single-v1
// form's workflow_state. These fixtures mirror the real `.select()` projections.
const FORM_ID = '00000000-0000-4000-8000-0000000000aa';

const MOCK_WORKSPACE = {
  id: VALID_UUID,
  name: 'Test Procurement',
  description: 'A test bid',
  is_archived: false,
  created_by: 'test-user-id',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  updated_by: null,
};

const MOCK_ROLLUP = {
  nearest_deadline: '2026-03-01T00:00:00Z',
  overall_outcome: 'in_progress',
  counts_toward_win_rate: false,
  rollup_updated_at: '2026-01-02T00:00:00Z',
};

const MOCK_FORM = {
  id: FORM_ID,
  form_type: 'bid',
  name: 'Tender response',
  workflow_state: 'draft',
  outcome: null,
  outcome_notes: null,
  deadline: '2026-03-01T00:00:00Z',
  submission_date: null,
  issuing_organisation: 'Acme Corp',
  outcome_recorded_at: null,
  outcome_recorded_by: null,
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

describe('GET /api/procurement/[id]', () => {
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

  it('returns 200 with the roll-up, child-form list, stats, and documents (not domain_metadata)', async () => {
    // Workspace identity (single) -> roll-up (rpc, ID-130 {130.29} — the
    // api-exposed get_procurement_rollup RPC, NOT a `.from('procurement_workspaces')`
    // select, which has no api.* view and 404s) -> forms (awaited list -> .then)
    // -> stats (rpc) -> storage. Both roll-up and stats resolve through the SAME
    // `mockSupabase.rpc` mock, so the two `mockResolvedValueOnce` calls below are
    // consumed IN CALL ORDER: roll-up first, stats second.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_WORKSPACE,
      error: null,
    });
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [MOCK_ROLLUP],
      error: null,
    });
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [MOCK_FORM], error: null }),
    );

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

    // The umbrella read surface no longer leaks the deprecated domain_metadata.
    expect(body).not.toHaveProperty('domain_metadata');

    // Roll-up read via the sanctioned api-exposed RPC (ID-130 {130.29}) — NOT a
    // bare `.from('procurement_workspaces')` select, which has no api.* view and
    // 404s through the api-schema-routed client.
    expect(body.rollup).toEqual(MOCK_ROLLUP);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_procurement_rollup', {
      p_workspace_id: VALID_UUID,
    });
    expect(mockSupabase.from).not.toHaveBeenCalledWith(
      'procurement_workspaces',
    );

    // Child-form list read off form_templates.
    expect(body.forms).toHaveLength(1);
    expect(body.forms[0].id).toBe(FORM_ID);
    expect(body.forms[0].workflow_state).toBe('draft');
    expect(body.forms[0].form_type).toBe('bid');

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

  it('surfaces residual reference_number/estimated_value/notes off domain_metadata (no form home, {130.21})', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        ...MOCK_WORKSPACE,
        domain_metadata: {
          reference_number: 'REF-123',
          estimated_value: '£50,000',
          notes: 'Follow up with the buyer next week.',
          // Deprecated engagement keys must NOT leak through even if still
          // present on a legacy row.
          status: 'draft',
          deadline: '2020-01-01T00:00:00Z',
        },
      },
      error: null,
    });
    // No roll-up row / no forms yet -> defaults.

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`);
    const res = await getBid(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reference_number).toBe('REF-123');
    expect(body.estimated_value).toBe('£50,000');
    expect(body.notes).toBe('Follow up with the buyer next week.');
    // Still no nested domain_metadata leak — the deprecated engagement keys
    // stay hidden (split-brain guard).
    expect(body).not.toHaveProperty('domain_metadata');
    expect(body.status).toBeUndefined();
  });

  it('returns null residual fields when domain_metadata is absent', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_WORKSPACE,
      error: null,
    });

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`);
    const res = await getBid(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reference_number).toBeNull();
    expect(body.estimated_value).toBeNull();
    expect(body.notes).toBeNull();
  });

  it('returns a null roll-up + empty forms for a brand-new umbrella', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_WORKSPACE,
      error: null,
    });
    // No roll-up row yet -> the RPC (RETURNS TABLE) resolves an empty row set,
    // not an error (ID-130 {130.29}: the read path is now `.rpc()`, not `.maybeSingle()`).
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [],
      error: null,
    });
    // No forms yet -> empty list (default .then).

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`);
    const res = await getBid(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rollup).toBeNull();
    expect(body.forms).toEqual([]);
    // A missing roll-up is an expected state, not a failure — no warning.
    expect(body.warnings).toBeUndefined();
  });

  it('surfaces a warning (never a silent null) when the rollup read errors — the class of regression {130.29} fixes', async () => {
    // ID-130 {130.29}: before this fix, the rollup was read via a bare
    // `.from('procurement_workspaces').select(...)` through the api-schema-routed
    // client — that table has NO api.* view (INTERNAL_ONLY by design), so the
    // request 404d on EVERY call. The prior mocked-client unit test suite could
    // never catch this because it mocked the client wholesale and always resolved
    // MOCK_ROLLUP, regardless of what the route actually called. This test asserts
    // TWO things a 404 regression would break: (a) the route reads the roll-up via
    // the sanctioned `get_procurement_rollup` RPC, never a direct
    // `.from('procurement_workspaces')` select; (b) an errored read (simulating the
    // real PostgREST "relation/function not found in schema cache" shape) surfaces
    // through the warnings[] envelope instead of silently rendering rollup: null
    // with no signal.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_WORKSPACE,
      error: null,
    });
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message:
          'Could not find the function public.get_procurement_rollup(p_workspace_id) in the schema cache',
        code: 'PGRST202',
      },
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

    // Partial-response envelope (H2/H1) — a rollup-read failure must not 500 the
    // whole detail page.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rollup).toBeNull();
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(
      body.warnings.some((w: string) => /Roll-up could not be loaded/.test(w)),
    ).toBe(true);

    // Schema-level guard: the read path targets the api-exposed RPC surface, not a
    // base-table select with no api.* view (the exact 404 this Subtask fixes).
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_procurement_rollup', {
      p_workspace_id: VALID_UUID,
    });
    expect(mockSupabase.from).not.toHaveBeenCalledWith(
      'procurement_workspaces',
    );
  });

  it('returns 200 with warnings[] when stats RPC fails (partial response)', async () => {
    // S152A WP4: H2 was flipped from fail-fast to partial-response. Procurement
    // detail is a composite view (overview, questions, drafting, outcome,
    // documents tabs) and a transient stats glitch must not 500 the page.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_WORKSPACE,
      error: null,
    });

    // Roll-up (rpc call #1) succeeds — this test isolates the STATS rpc failure.
    // Both calls share `mockSupabase.rpc`, so ordering is load-bearing.
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
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
    expect(
      body.warnings.some((w: string) =>
        /Question stats could not be loaded/.test(w),
      ),
    ).toBe(true);
  });

  it('returns 200 with warnings[] when storage list fails (partial response)', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_WORKSPACE,
      error: null,
    });

    // Roll-up (rpc call #1) succeeds; stats (rpc call #2) succeeds — this test
    // isolates the STORAGE failure. Both rpc calls share `mockSupabase.rpc`.
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
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
    expect(
      body.warnings.some((w: string) =>
        /Tender documents could not be listed/.test(w),
      ),
    ).toBe(true);
  });
});

describe('PATCH /api/procurement/[id]', () => {
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

  it('re-anchors metadata: buyer -> form, name -> workspace, no domain_metadata writer', async () => {
    configureRole(mockSupabase, 'editor');

    // Workspace verify (single, includes domain_metadata for residual merge).
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { ...MOCK_WORKSPACE, domain_metadata: { buyer: 'Acme Corp' } },
      error: null,
    });
    // .then sequence: 1 = form fetch, 2 = form UPDATE, 3 = workspace UPDATE.
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          return resolve({ data: [MOCK_FORM], error: null });
        }
        if (thenCallCount === 2) {
          return resolve({
            data: [{ ...MOCK_FORM, issuing_organisation: 'Updated Buyer' }],
            error: null,
          });
        }
        if (thenCallCount === 3) {
          return resolve({
            data: [
              {
                id: VALID_UUID,
                name: 'Updated Procurement',
                description: 'A test bid',
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    );

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
    expect(body).not.toHaveProperty('domain_metadata');

    // Content-of-write: buyer re-anchors to the FORM's issuing_organisation
    // (call 0 = form UPDATE); name lands on the workspace (call 1 = workspace
    // UPDATE). NEITHER update writes a deprecated domain_metadata engagement key.
    const formUpdateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(formUpdateArg).toMatchObject({
      issuing_organisation: 'Updated Buyer',
    });
    expect(formUpdateArg).not.toHaveProperty('domain_metadata');
    expect(formUpdateArg).not.toHaveProperty('status');

    const workspaceUpdateArg = mockSupabase._chain.update.mock.calls[1][0];
    expect(workspaceUpdateArg).toMatchObject({
      name: 'Updated Procurement',
      updated_by: 'test-user-id',
    });
    // No residual metadata fields were sent, so no domain_metadata write at all.
    expect(workspaceUpdateArg).not.toHaveProperty('domain_metadata');
  });

  it('returns 400 for invalid state transition (validated against the form)', async () => {
    configureRole(mockSupabase, 'editor');

    // Workspace verify, then the form fetch returns a draft-state form.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { ...MOCK_WORKSPACE, domain_metadata: {} },
      error: null,
    });
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ id: FORM_ID, form_type: 'bid', workflow_state: 'draft' }],
          error: null,
        }),
    );

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

  it('returns 200 for a valid form transition (draft -> questions_extracted)', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { ...MOCK_WORKSPACE, domain_metadata: {} },
      error: null,
    });
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          // form fetch (current state draft)
          return resolve({
            data: [{ id: FORM_ID, form_type: 'bid', workflow_state: 'draft' }],
            error: null,
          });
        }
        if (thenCallCount === 2) {
          // form UPDATE returns the written row
          return resolve({
            data: [{ ...MOCK_FORM, workflow_state: 'questions_extracted' }],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    );

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'questions_extracted' },
    });
    const res = await PATCH(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workflow_state).toBe('questions_extracted');

    // The transition writes the FORM's workflow_state, not a domain_metadata key.
    const formUpdateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(formUpdateArg).toMatchObject({
      workflow_state: 'questions_extracted',
    });
    expect(formUpdateArg).not.toHaveProperty('domain_metadata');
    expect(formUpdateArg).not.toHaveProperty('status');
  });

  it('honours a caller-supplied submission_date on the submitted transition instead of the server clock (T-B9, {130.21})', async () => {
    configureRole(mockSupabase, 'editor');

    const CALLER_SUBMISSION_DATE = '2026-05-01T09:30:00.000Z';

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { ...MOCK_WORKSPACE, domain_metadata: {} },
      error: null,
    });
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          // form fetch (current state ready_for_export -> submitted is valid)
          return resolve({
            data: [
              {
                id: FORM_ID,
                form_type: 'bid',
                workflow_state: 'ready_for_export',
              },
            ],
            error: null,
          });
        }
        if (thenCallCount === 2) {
          return resolve({
            data: [
              {
                ...MOCK_FORM,
                workflow_state: 'submitted',
                submission_date: CALLER_SUBMISSION_DATE,
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    );

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'submitted', submission_date: CALLER_SUBMISSION_DATE },
    });
    const res = await PATCH(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workflow_state).toBe('submitted');

    // The form UPDATE carries the CALLER's submission_date, not a
    // server-stamped `now()` value.
    const formUpdateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(formUpdateArg.submission_date).toBe(CALLER_SUBMISSION_DATE);
  });
});

describe('DELETE /api/procurement/[id]', () => {
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

    // ID-131.19 (M6): the content_item_workspaces pre-delete cleanup was
    // RETIRED (dropped table) — only the workspaces DELETE itself resolves
    // via `.then()` now.
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

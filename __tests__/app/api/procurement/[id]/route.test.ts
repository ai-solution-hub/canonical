/**
 * Procurement item route tests.
 *
 *   - GET    /api/procurement/:id — the flat form_instances detail, with its
 *            stats, documents, role-split attachments and engagement siblings
 *   - PATCH  /api/procurement/:id — field updates and workflow transitions
 *   - DELETE /api/procurement/:id — admin-only delete plus storage cleanup
 *
 * ID-145 {145.19} groups A+C (DR-075 §6, ratified S474): [id] IS the
 * `form_instances` PK — no workspace umbrella, no roll-up, no child-forms
 * list. The state-machine block at the end walks the transition matrix
 * through PATCH: valid transitions succeed, invalid ones 400, and terminal
 * states block further transitions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '@/__tests__/helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '@/__tests__/helpers/mock-next';

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
import { GET as getBid, PATCH, DELETE } from '@/app/api/procurement/[id]/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const INVALID_UUID = 'not-a-uuid';
// ID-145 {145.42} — engagement-grouped GET fold fixtures (§A3/§A5/§A6).
const ENGAGEMENT_GROUP_UUID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const SIBLING_FORM_UUID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';

// ID-145 {145.19} groups A+C (DR-075 §6, ratified S474): [id] IS the
// `form_instances` PK now — no workspace umbrella, no roll-up, no
// child-forms list. This fixture mirrors the real flat GET `.select()`
// projection (FORM_DETAIL_COLUMNS in the route).
const MOCK_FORM_DETAIL = {
  id: VALID_UUID,
  name: 'Test Procurement',
  description: 'A test bid',
  form_type: 'bid',
  processing_status: 'uploaded',
  workflow_state: 'draft',
  deadline: '2026-03-01T00:00:00Z',
  submission_date: null,
  issuing_organisation: 'Acme Corp',
  outcome: null,
  outcome_notes: null,
  outcome_recorded_at: null,
  outcome_recorded_by: null,
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

// ID-145 {145.19} groups A+C (DR-075 §6): [id] IS the form_instances PK now —
// a status PATCH reads + writes the SAME row directly. `configureBidFetch`
// queues the ONE existence+live-workflow_state `.single()` read (no more
// workspace verify + separate single-v1-form-list fetch).
function configureBidFetch(status: string) {
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: {
      id: VALID_UUID,
      name: 'Test Procurement',
      description: null,
      form_type: 'bid',
      workflow_state: status,
    },
    error: null,
  });
}

function configureUpdateSuccess(status: string) {
  // UPDATE returns the written row (row-count verify) — awaited via `.then()`.
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({
        data: [{ id: VALID_UUID, workflow_state: status }],
        error: null,
      }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

  it('returns 200 with the flat form_instances detail, stats, and documents (no roll-up, no forms[])', async () => {
    // ID-145 {145.19} groups A+C: [id] IS the form now — ONE `.single()` read
    // off `form_instances` (no workspace identity lookup, no
    // get_procurement_rollup RPC, no child-forms list) -> stats (rpc) ->
    // storage.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_FORM_DETAIL,
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

    // Flat form_instances fields at the top level (BI-1) — no nested
    // container shape.
    expect(body.workflow_state).toBe('draft');
    expect(body.form_type).toBe('bid');
    expect(body.processing_status).toBe('uploaded');
    expect(body.issuing_organisation).toBe('Acme Corp');
    expect(body.deadline).toBe('2026-03-01T00:00:00Z');

    // The retired roll-up + child-forms container is gone entirely (S470: NO
    // stored/derived roll-up).
    expect(body).not.toHaveProperty('rollup');
    expect(body).not.toHaveProperty('forms');
    expect(body).not.toHaveProperty('domain_metadata');
    expect(mockSupabase.rpc).not.toHaveBeenCalledWith(
      'get_procurement_rollup',
      expect.anything(),
    );
    expect(mockSupabase.from).not.toHaveBeenCalledWith(
      'procurement_workspaces',
    );
    expect(mockSupabase.from).not.toHaveBeenCalledWith('workspaces');
    expect(mockSupabase.from).not.toHaveBeenCalledWith('form_templates');
    expect(mockSupabase.from).toHaveBeenCalledWith('form_instances');

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

  it('surfaces the first-class reference_number/estimated_value columns directly (no domain_metadata indirection)', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        ...MOCK_FORM_DETAIL,
        reference_number: 'REF-123',
        estimated_value: 50000,
      },
      error: null,
    });

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`);
    const res = await getBid(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reference_number).toBe('REF-123');
    expect(body.estimated_value).toBe(50000);
    expect(body).not.toHaveProperty('domain_metadata');
  });

  it('returns null residual fields when unset on the row', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_FORM_DETAIL,
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
  });

  it('returns 200 with warnings[] when stats RPC fails (partial response)', async () => {
    // S152A WP4: H2 was flipped from fail-fast to partial-response. Procurement
    // detail is a composite view (overview, questions, drafting, outcome,
    // documents tabs) and a transient stats glitch must not 500 the page.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_FORM_DETAIL,
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
    expect(
      body.warnings.some((w: string) =>
        /Question stats could not be loaded/.test(w),
      ),
    ).toBe(true);
  });

  it('returns 200 with warnings[] when storage list fails (partial response)', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_FORM_DETAIL,
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
    expect(
      body.warnings.some((w: string) =>
        /Tender documents could not be listed/.test(w),
      ),
    ).toBe(true);
  });

  // ID-145 {145.42} — TECH §6 group-A GET ADD: fold `form_attachments`
  // (§A5/§A6) + the engagement sibling-rail read (§A3) into the detail GET.
  it('folds form_attachments into the response split by role, ungrouped (§A5)', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_FORM_DETAIL,
      error: null,
    });
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });
    mockSupabase.storage.from.mockReturnValue({
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      upload: vi.fn(),
      download: vi.fn(),
      remove: vi.fn(),
      getPublicUrl: vi.fn(),
    });

    // The ONLY awaited non-.single() query for an ungrouped form is the
    // form_attachments fold (form-scoped only — no siblings query runs).
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'att-1',
              filename: 'tender.pdf',
              storage_path: `${VALID_UUID}/attachments/att-1-tender.pdf`,
              mime_type: 'application/pdf',
              file_size: 10,
              role: 'form_source',
              form_instance_id: VALID_UUID,
              engagement_group_id: null,
              created_at: '2026-01-01T00:00:00Z',
            },
            {
              id: 'att-2',
              filename: 'cv.pdf',
              storage_path: `${VALID_UUID}/attachments/att-2-cv.pdf`,
              mime_type: 'application/pdf',
              file_size: 20,
              role: 'reference_evidence',
              form_instance_id: VALID_UUID,
              engagement_group_id: null,
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
          error: null,
        }),
    );

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`);
    const res = await getBid(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockSupabase.from).toHaveBeenCalledWith('form_attachments');
    expect(body.attachments.form_source).toHaveLength(1);
    expect(body.attachments.form_source[0].id).toBe('att-1');
    expect(body.attachments.reference_evidence).toHaveLength(1);
    expect(body.attachments.reference_evidence[0].id).toBe('att-2');
    // Ungrouped — no sibling-rail read, empty lineage (§A3 gate).
    expect(body.engagement_siblings).toEqual([]);
  });

  it('reads engagement-scoped attachments + sibling forms when engagement_group_id is set (§A3/§A6)', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { ...MOCK_FORM_DETAIL, engagement_group_id: ENGAGEMENT_GROUP_UUID },
      error: null,
    });
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });
    mockSupabase.storage.from.mockReturnValue({
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      upload: vi.fn(),
      download: vi.fn(),
      remove: vi.fn(),
      getPublicUrl: vi.fn(),
    });

    mockSupabase._chain.then
      // 1st awaited non-.single() query: the form_attachments fold (form OR
      // engagement scoped, since the form is grouped).
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'att-3',
              filename: 'engagement-cv.pdf',
              storage_path: `engagement/${ENGAGEMENT_GROUP_UUID}/att-3-cv.pdf`,
              mime_type: 'application/pdf',
              file_size: 30,
              role: 'reference_evidence',
              form_instance_id: null,
              engagement_group_id: ENGAGEMENT_GROUP_UUID,
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
          error: null,
        }),
      )
      // 2nd: the engagement sibling-rail read (§A3).
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: SIBLING_FORM_UUID,
              name: 'ITT',
              form_type: 'itt',
              workflow_state: 'drafting',
              reference_number: null,
            },
          ],
          error: null,
        }),
      );

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`);
    const res = await getBid(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.engagement_group_id).toBe(ENGAGEMENT_GROUP_UUID);
    expect(body.attachments.reference_evidence).toHaveLength(1);
    expect(body.attachments.reference_evidence[0].id).toBe('att-3');
    expect(body.engagement_siblings).toHaveLength(1);
    expect(body.engagement_siblings[0].id).toBe(SIBLING_FORM_UUID);
    expect(body.engagement_siblings[0].name).toBe('ITT');
  });

  // ID-145 {145.51} (S481 curator promotion) — the {145.42} sibling-rail read
  // had no explicit ORDER BY, so API order silently matched whatever
  // Supabase/Postgres returned. This asserts the BI-28/29 lineage order
  // (PSQ -> ITT -> tender) is now deterministic regardless of fetch order.
  it('orders engagement_siblings by BI-28/29 lineage (PSQ -> ITT -> tender) regardless of fetch order, unranked types last, created_at tiebreak within a rank', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { ...MOCK_FORM_DETAIL, engagement_group_id: ENGAGEMENT_GROUP_UUID },
      error: null,
    });
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });
    mockSupabase.storage.from.mockReturnValue({
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      upload: vi.fn(),
      download: vi.fn(),
      remove: vi.fn(),
      getPublicUrl: vi.fn(),
    });

    mockSupabase._chain.then
      // 1st awaited non-.single() query: the form_attachments fold.
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      )
      // 2nd: the engagement sibling-rail read — deliberately fetched OUT of
      // lineage order (tender, then an unranked type, then two ITTs, then
      // PSQ) to prove the route re-orders it rather than relying on
      // Supabase/Postgres row order.
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'sibling-tender',
              name: 'Tender',
              form_type: 'tender',
              workflow_state: 'drafting',
              reference_number: null,
              created_at: '2026-01-05T00:00:00Z',
            },
            {
              id: 'sibling-questionnaire',
              name: 'Extra Questionnaire',
              form_type: 'questionnaire',
              workflow_state: 'draft',
              reference_number: null,
              created_at: '2026-01-01T00:00:00Z',
            },
            {
              id: 'sibling-itt-b',
              name: 'ITT (later)',
              form_type: 'itt',
              workflow_state: 'drafting',
              reference_number: null,
              created_at: '2026-01-04T00:00:00Z',
            },
            {
              id: 'sibling-psq',
              name: 'PSQ',
              form_type: 'psq',
              workflow_state: 'submitted',
              reference_number: null,
              created_at: '2026-01-02T00:00:00Z',
            },
            {
              id: 'sibling-itt-a',
              name: 'ITT (earlier)',
              form_type: 'itt',
              workflow_state: 'drafting',
              reference_number: null,
              created_at: '2026-01-03T00:00:00Z',
            },
          ],
          error: null,
        }),
      );

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`);
    const res = await getBid(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // PSQ -> ITT (earlier first, created_at tiebreak) -> ITT (later) ->
    // tender -> unranked questionnaire last.
    expect(body.engagement_siblings.map((s: { id: string }) => s.id)).toEqual([
      'sibling-psq',
      'sibling-itt-a',
      'sibling-itt-b',
      'sibling-tender',
      'sibling-questionnaire',
    ]);
    // The `created_at` tiebreaker is fetched server-side only — it must
    // never leak into the API response shape ItemGroupingRail consumes.
    expect(body.engagement_siblings[0]).not.toHaveProperty('created_at');
  });

  it('returns 200 with warnings[] when the attachments fold fails (partial response)', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_FORM_DETAIL,
      error: null,
    });
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });
    mockSupabase.storage.from.mockReturnValue({
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      upload: vi.fn(),
      download: vi.fn(),
      remove: vi.fn(),
      getPublicUrl: vi.fn(),
    });

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { message: 'attachments unavailable', code: 'XX000' },
        }),
    );

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`);
    const res = await getBid(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attachments).toEqual({
      form_source: [],
      reference_evidence: [],
    });
    expect(
      body.warnings.some((w: string) =>
        /Attachments could not be loaded/.test(w),
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

  it('writes name/buyer/reference_number/estimated_value in a SINGLE form_instances UPDATE (no workspace indirection, no domain_metadata)', async () => {
    configureRole(mockSupabase, 'editor');

    // ID-145 {145.19}: [id] IS the form now — ONE existence read (`.single()`)
    // + ONE UPDATE (awaited list -> `.then()`). No more "locate the
    // workspace's single v1 form" + separate workspace UPDATE.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: MOCK_FORM_DETAIL,
      error: null,
    });
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              ...MOCK_FORM_DETAIL,
              name: 'Updated Procurement',
              issuing_organisation: 'Updated Buyer',
            },
          ],
          error: null,
        }),
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

    // Exactly ONE update call, directly on form_instances — buyer re-anchors
    // to issuing_organisation, name lands on the same row. No workspace
    // UPDATE, no domain_metadata writer.
    expect(mockSupabase._chain.update).toHaveBeenCalledTimes(1);
    const updateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateArg).toMatchObject({
      name: 'Updated Procurement',
      issuing_organisation: 'Updated Buyer',
    });
    expect(updateArg).not.toHaveProperty('domain_metadata');
    expect(updateArg).not.toHaveProperty('status');
    expect(mockSupabase.from).not.toHaveBeenCalledWith('workspaces');
    expect(mockSupabase.from).toHaveBeenCalledWith('form_instances');
  });

  // ID-145 {145.19} gate-groups-ac note (S474 adjudication): a PATCH body may
  // set BOTH `status` and the legacy `outcome` field —
  // ProcurementUpdateBodySchema permits them as independent optionals.
  // `computeWorkflowTransition` validates the STATUS-DERIVED outcome
  // (stage-appropriateness against `form_type`) BEFORE the handler ever
  // reaches the legacy `outcome` override below it — a psq (shortlist) form
  // transitioning to `won` derives outcome='won', which is not stage-
  // appropriate for psq, so the request 400s on that derived value alone; the
  // `outcome: 'lost'` in the body is never read or applied. This is a
  // deliberate fail-fast (ratified INTENTIONAL/safer than the pre-change
  // ordering, which overrode outcome first and validated the combined
  // result) — this test pins the CURRENT observed behaviour, not a
  // preference.
  it('fails fast on combined status+outcome when the status-derived outcome is stage-mismatched — the legacy outcome override is never reached (ratified-intentional, gate-groups-ac)', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        ...MOCK_FORM_DETAIL,
        form_type: 'psq',
        workflow_state: 'submitted',
      },
      error: null,
    });

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'won', outcome: 'lost' },
    });
    const res = await PATCH(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Outcome "won" is not valid for a "psq" form');
    // Fail-fast: the legacy `outcome: 'lost'` override never gets a chance to
    // run, and no write (partial or otherwise) is attempted.
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  it('honours a caller-supplied submission_date on the submitted transition instead of the server clock (T-B9, {130.21})', async () => {
    configureRole(mockSupabase, 'editor');

    const CALLER_SUBMISSION_DATE = '2026-05-01T09:30:00.000Z';

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { ...MOCK_FORM_DETAIL, workflow_state: 'ready_for_export' },
      error: null,
    });
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              ...MOCK_FORM_DETAIL,
              workflow_state: 'submitted',
              submission_date: CALLER_SUBMISSION_DATE,
            },
          ],
          error: null,
        }),
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

    // The UPDATE carries the CALLER's submission_date, not a server-stamped
    // `now()` value (the caller-supplied override applied after the shared
    // transition writer's own auto-stamp).
    const updateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateArg.submission_date).toBe(CALLER_SUBMISSION_DATE);
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

  it('returns 204 on successful deletion, cleaning up this item’s own storage (no workspace, no child-form list)', async () => {
    configureRole(mockSupabase, 'admin');

    // ID-145 {145.19}: [id] IS the form now — the existence read carries its
    // OWN storage_path/structure_path directly (no more "list every child
    // form under this workspace").
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, storage_path: null, structure_path: null },
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

    // The {145.42} form_attachments select, the template_completions select
    // (re-keyed to form_instance_id, empty), and the final form_instances
    // DELETE all resolve via the default `.then()` mock (`{ data: [], error:
    // null }`) — no attachments, so no attachment remove() call either.

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(204);
    expect(mockSupabase.from).toHaveBeenCalledWith('form_instances');
    expect(mockSupabase.from).not.toHaveBeenCalledWith('workspaces');
  });

  it('best-effort removes this form’s own form-scoped attachment storage objects (TECH §2 FK CASCADE gap, {145.42})', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, storage_path: null, structure_path: null },
      error: null,
    });

    const removeMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const storageBucket = {
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      remove: removeMock,
      upload: vi.fn(),
      download: vi.fn(),
      getPublicUrl: vi.fn(),
    };
    mockSupabase.storage.from.mockReturnValue(storageBucket);

    const attachmentPath = `${VALID_UUID}/attachments/att-1-cv.pdf`;
    mockSupabase._chain.then
      // 1st: form_attachments select (this form's own form-scoped rows).
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [{ storage_path: attachmentPath }], error: null }),
      )
      // 2nd: template_completions select (empty).
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      )
      // 3rd: the final form_instances delete.
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      );

    const req = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(204);
    expect(mockSupabase.from).toHaveBeenCalledWith('form_attachments');
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock).toHaveBeenCalledWith([attachmentPath]);
  });
});

describe('Procurement state machine via PATCH /api/procurement/[id]', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── Valid transitions ──

  it('allows draft → questions_extracted', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('draft');
    configureUpdateSuccess('questions_extracted');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'questions_extracted' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.workflow_state).toBe('questions_extracted');

    // The transition writes workflow_state directly, not a domain_metadata key.
    const updateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateArg).toMatchObject({
      workflow_state: 'questions_extracted',
    });
    expect(updateArg).not.toHaveProperty('domain_metadata');
    expect(updateArg).not.toHaveProperty('status');
  });

  it('allows questions_extracted → matching', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('questions_extracted');
    configureUpdateSuccess('matching');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'matching' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows matching → drafting', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('matching');
    configureUpdateSuccess('drafting');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'drafting' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows drafting → in_review', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('drafting');
    configureUpdateSuccess('in_review');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'in_review' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows in_review → ready_for_export', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('in_review');
    configureUpdateSuccess('ready_for_export');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'ready_for_export' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows ready_for_export → submitted', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('ready_for_export');
    configureUpdateSuccess('submitted');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'submitted' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows submitted → won', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('submitted');
    configureUpdateSuccess('won');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'won' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows submitted → lost', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('submitted');
    configureUpdateSuccess('lost');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'lost' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows any active state → withdrawn', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('drafting');
    configureUpdateSuccess('withdrawn');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'withdrawn' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  // ── Invalid transitions ──

  it('rejects draft → submitted (skipping states)', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('draft');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'submitted' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.current_status).toBe('draft');
    expect(body.requested_status).toBe('submitted');
    expect(body.error).toContain('Cannot transition');
    // The invalid-transition guard refuses BEFORE any write is attempted.
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  it('rejects draft → in_review (non-adjacent)', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('draft');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'in_review' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.current_status).toBe('draft');
    expect(body.requested_status).toBe('in_review');
  });

  // ── Terminal state enforcement ──

  it('blocks transitions from won (terminal state)', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('won');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'draft' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.current_status).toBe('won');
    expect(body.error).toContain('Cannot transition');
  });

  it('blocks transitions from lost (terminal state)', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('lost');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'in_review' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.current_status).toBe('lost');
  });

  it('blocks transitions from withdrawn (terminal state)', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('withdrawn');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'draft' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.current_status).toBe('withdrawn');
  });

  // ── Backward transition validation ──

  it('allows in_review → drafting (backward allowed)', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('in_review');
    configureUpdateSuccess('drafting');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'drafting' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });

  it('allows submitted → in_review (backward allowed)', async () => {
    configureRole(mockSupabase, 'editor');
    configureBidFetch('submitted');
    configureUpdateSuccess('in_review');

    const request = createTestRequest(`/api/procurement/${VALID_UUID}`, {
      method: 'PATCH',
      body: { status: 'in_review' },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });
    expect(response.status).toBe(200);
  });
});

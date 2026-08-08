/**
 * Procurement per-question drafting route tests.
 *
 *   - POST /api/procurement/:id/responses/draft — draft answers for the
 *     supplied questions (or every eligible one)
 *
 * Covers auth enforcement, UUID validation, rate limiting, the draftable-state
 * gate, the already-drafted skip and the per-question result shape.
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
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies, mockCheckRateLimit, mockRunDraftingPipeline } = vi.hoisted(
  () => ({
    mockCookies: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockRunDraftingPipeline: vi.fn(),
  }),
);

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

// The route drafts via `draftSingleQuestion`, which delegates to
// `runDraftingPipeline` — stubbed here so no model call is made.
vi.mock('@/lib/domains/procurement/ai/draft', () => ({
  runDraftingPipeline: mockRunDraftingPipeline,
}));

// Import route handlers AFTER mocks
const { POST: draftPost } =
  await import('@/app/api/procurement/[id]/responses/draft/route');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const INVALID_UUID = 'not-a-uuid';

const MOCK_DRAFT_RESULT = {
  response_text: 'Drafted response text',
  source_record_ids: [VALID_UUID_2],
  citations: [{ source_id: VALID_UUID_2, text: 'cited text' }],
  metadata: {
    quality_data: { overall_score: 85 },
    ai_metadata: { model: 'claude-sonnet-4-6', cost_estimate: 0.01 },
  },
  total_cost: 0.01,
  total_tokens: 500,
};

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Re-wire next/headers mock
  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  // Re-wire Supabase client mocks
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  // Chainable methods return the chain
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

  // Terminal methods
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

  // Default dependency mocks
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  mockRunDraftingPipeline.mockResolvedValue(MOCK_DRAFT_RESULT);
});

describe('POST /api/procurement/:id/responses/draft', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft`,
      {
        method: 'POST',
        body: { question_ids: [VALID_UUID_2] },
      },
    );

    const res = await draftPost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft`,
      {
        method: 'POST',
        body: { question_ids: [VALID_UUID_2] },
      },
    );

    const res = await draftPost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/procurement/${INVALID_UUID}/responses/draft`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftPost(req, {
      params: createTestParams({ id: INVALID_UUID }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('Invalid bid ID');
  });

  it('returns 429 when rate limited', async () => {
    configureRole(mockSupabase, 'editor');
    mockCheckRateLimit.mockReturnValue({ allowed: false });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftPost(req, { params });
    expect(res.status).toBe(429);
  });

  it('returns 404 when bid does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    // Role lookup succeeds, bid lookup fails
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftPost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Procurement not found');
  });

  it('returns 400 when bid is in draft state (not draftable)', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, workflow_state: 'draft' },
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('"draft" state');
    expect(body.current_status).toBe('draft');
  });

  it('returns 200 with no questions to draft when query returns empty', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement lookup: draftable state
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, workflow_state: 'drafting' },
      error: null,
    });

    // Questions query returns empty
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.drafted).toBe(0);
    expect(body.message).toBe('No questions to draft');
  });

  it('skips already-drafted questions when force is false', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, workflow_state: 'drafting' },
      error: null,
    });

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: VALID_UUID_2,
              question_text: 'Test question',
              word_limit: 200,
              section_name: 'Section 1',
              matched_record_ids: [],
            },
          ],
          error: null,
        }),
    );

    // Existing response check
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'existing-response-id' },
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft`,
      {
        method: 'POST',
        body: { force: false },
      },
    );

    const res = await draftPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.skipped).toBe(1);
    expect(body.results[0].reason).toBe('already_drafted');
    expect(mockRunDraftingPipeline).not.toHaveBeenCalled();
  });

  it('drafts eligible questions and returns results', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, workflow_state: 'drafting' },
      error: null,
    });

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: VALID_UUID_2,
              question_text: 'Test question',
              word_limit: 200,
              section_name: 'Section 1',
              matched_record_ids: [],
            },
          ],
          error: null,
        }),
    );

    // No existing response
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    // Upsert response
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: 'new-response-id' },
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.drafted).toBe(1);
    expect(body.results[0].status).toBe('drafted');
    expect(mockRunDraftingPipeline).toHaveBeenCalledOnce();
  });

  it('reports a question as failed when the status update fails after upsert', async () => {
    configureRole(mockSupabase, 'editor');

    // Workspace lookup.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, workflow_state: 'drafting' },
      error: null,
    });

    // Questions query.
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: VALID_UUID_2,
              question_text: 'Test question',
              word_limit: 200,
              section_name: 'Section 1',
              matched_record_ids: [],
            },
          ],
          error: null,
        }),
    );

    // No existing response.
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    // Upsert response succeeds.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: 'new-response-id' },
      error: null,
    });

    // form_questions status update fails — the response is saved but the
    // question is left stranded. The route must report 'failed', not 'drafted'.
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { code: 'XX000', message: 'status update failed' },
        }),
    );

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.drafted).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.results[0].status).toBe('failed');
    expect(body.results[0].error).toBe('Failed to update question status');
    // The response WAS saved, so its id is still surfaced for diagnostics.
    expect(body.results[0].response_id).toBe('new-response-id');
  });
});

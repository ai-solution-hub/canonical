/**
 * Procurement response-regenerate route tests.
 *
 *   - POST /api/procurement/:id/responses/:rId/regenerate — redraft one
 *     response, optionally steered by free-text instructions
 *
 * Covers auth enforcement, UUID validation, rate limiting, the response and
 * bid-ownership lookups, the successful regeneration, and the terminal catch
 * block's observability contract.
 *
 * WHY THE OBSERVABILITY BLOCK EXISTS
 * The route answers a failed regeneration with
 * `{ error: safeErrorMessage(err, 'Failed to regenerate response') }` + 500.
 * `safeErrorMessage` deliberately collapses any non-allowlisted error to that
 * generic fallback, so the CLIENT can never see the cause — which is correct.
 * What was wrong is that the SERVER could not either: the catch returned
 * without logging, so an upstream Anthropic 401, a pgvector failure and a real
 * logic regression were byte-identical from the outside AND left no trace in
 * the logs.
 *
 * That is not hypothetical. e2e-nightly run 30244345218 went red on
 * `bid-draft-stream.spec.ts` with exactly this 500, and attributing it needed
 * a full Playwright-trace archaeology pass plus a locally instrumented build,
 * because nothing anywhere recorded the underlying error. Those tests pin the
 * fix: the cause is logged, and the client contract is unchanged.
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

const {
  mockCookies,
  mockCheckRateLimit,
  mockRunDraftingPipeline,
  mockFetchMatchedContentForDrafting,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockRunDraftingPipeline: vi.fn(),
  mockFetchMatchedContentForDrafting: vi.fn(),
  mockLoggerError: vi.fn(),
}));

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

vi.mock('@/lib/domains/procurement/ai/draft', () => ({
  runDraftingPipeline: mockRunDraftingPipeline,
}));

vi.mock('@/lib/domains/procurement/draft-response', () => ({
  fetchMatchedContentForDrafting: mockFetchMatchedContentForDrafting,
}));

// Mocked so the terminal-catch tests can assert on what reached the log.
vi.mock('@/lib/logger', () => ({
  logger: {
    error: mockLoggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import route handlers AFTER mocks
const { POST: regeneratePost } =
  await import('@/app/api/procurement/[id]/responses/[rId]/regenerate/route');

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
  mockFetchMatchedContentForDrafting.mockResolvedValue([]);
});

describe('POST /api/procurement/:id/responses/:rId/regenerate', () => {
  const params = createTestParams({ id: VALID_UUID, rId: VALID_UUID_2 });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/regenerate`,
      { method: 'POST', body: { instructions: 'Make it shorter' } },
    );

    const res = await regeneratePost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/regenerate`,
      { method: 'POST', body: { instructions: 'Make it shorter' } },
    );

    const res = await regeneratePost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 when either UUID is invalid', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${INVALID_UUID}/regenerate`,
      { method: 'POST', body: { instructions: 'Make it shorter' } },
    );

    const res = await regeneratePost(req, {
      params: createTestParams({ id: VALID_UUID, rId: INVALID_UUID }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('Invalid ID');
  });

  it('returns 429 when rate limited', async () => {
    configureRole(mockSupabase, 'editor');
    mockCheckRateLimit.mockReturnValue({ allowed: false });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/regenerate`,
      { method: 'POST', body: { instructions: 'Make it shorter' } },
    );

    const res = await regeneratePost(req, { params });
    expect(res.status).toBe(429);
  });

  it('returns 404 when response does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    // Response lookup fails
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/regenerate`,
      { method: 'POST', body: { instructions: 'Make it shorter' } },
    );

    const res = await regeneratePost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Response not found');
  });

  it('returns 404 when response does not belong to this bid', async () => {
    configureRole(mockSupabase, 'editor');

    // Response exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, question_id: 'q-id', source_record_ids: [] },
      error: null,
    });

    // Question lookup fails (not in this bid)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/regenerate`,
      { method: 'POST', body: { instructions: 'Make it shorter' } },
    );

    const res = await regeneratePost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Response not found in this bid');
  });

  it('regenerates response and returns result', async () => {
    configureRole(mockSupabase, 'editor');

    // Response exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, question_id: 'q-id', source_record_ids: [] },
      error: null,
    });

    // Question lookup succeeds
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'q-id',
        question_text: 'Test question',
        word_limit: 200,
        section_name: 'Section 1',
      },
      error: null,
    });

    // Update response succeeds
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/regenerate`,
      { method: 'POST', body: { instructions: 'Make it shorter' } },
    );

    const res = await regeneratePost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.question_id).toBe('q-id');
    expect(body.response.response_text).toBe('Drafted response text');
    expect(mockRunDraftingPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'q-id' }),
      expect.any(Array),
      expect.anything(),
      'Make it shorter',
    );
  });
});

// ---------------------------------------------------------------------------
// Terminal catch — the cause must reach the log without widening the client
// contract.
// ---------------------------------------------------------------------------

describe('POST /api/procurement/:id/responses/:rId/regenerate — terminal catch observability', () => {
  const params = createTestParams({ id: VALID_UUID, rId: VALID_UUID_2 });

  function callRoute() {
    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/regenerate`,
      { method: 'POST', body: { instructions: 'Make it more concise.' } },
    );
    return regeneratePost(req, { params });
  }

  /**
   * Drive the route down to the `runDraftingPipeline` call: an authorised
   * editor, an existing response row, and its owning question.
   */
  function arrangeHappyPathUpToPipeline() {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: {
          id: VALID_UUID_2,
          question_id: 'q-id',
          source_record_ids: [],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'q-id',
          question_text: 'Describe your approach.',
          word_limit: 500,
          section_name: 'Technical',
        },
        error: null,
      });
  }

  it('logs the underlying error when the drafting pipeline throws', async () => {
    arrangeHappyPathUpToPipeline();
    // Shaped like the real failure: an Anthropic SDK 401, whose message
    // `safeErrorMessage` will NOT pass through to the client.
    const upstream = Object.assign(
      new Error('401 {"type":"error","error":{"type":"authentication_error"}}'),
      { status: 401 },
    );
    mockRunDraftingPipeline.mockRejectedValue(upstream);

    const response = await callRoute();

    expect(response.status).toBe(500);
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    const [context, message] = mockLoggerError.mock.calls[0];
    // The ERROR ITSELF must reach the log — not a re-wrapped summary of it.
    expect(context).toMatchObject({ err: upstream, op: 'response_regenerate' });
    expect(message).toBe('Regenerate failed');
  });

  it('still returns the generic client-safe body (contract unchanged)', async () => {
    arrangeHappyPathUpToPipeline();
    mockRunDraftingPipeline.mockRejectedValue(
      new Error('postgres connection terminated unexpectedly'),
    );

    const response = await callRoute();
    const body = await response.json();

    expect(response.status).toBe(500);
    // Logging must not have widened what the client learns.
    expect(body).toEqual({ error: 'Failed to regenerate response' });
    expect(JSON.stringify(body)).not.toContain('postgres');
  });

  it('does not log on the success path', async () => {
    arrangeHappyPathUpToPipeline();
    // The post-pipeline UPDATE ... .select('id').single()
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    const response = await callRoute();

    expect(response.status).toBe(200);
    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});

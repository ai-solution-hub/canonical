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

// Extra mocks that need hoisting for vi.mock() factory references
const {
  mockCookies,
  mockCheckRateLimit,
  mockRunDraftingPipeline,
  mockEstimateBatchCost,
  mockEstimateTokens,
  mockCheckResponseQuality,
  mockIsEncryptedDocx,
  mockAnalyseQuestion,
  mockDraftResponseStreaming,
  mockGetModelForTier,
  mockCanTransition,
  mockEnqueueQueueJob,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockRunDraftingPipeline: vi.fn(),
  mockEstimateBatchCost: vi.fn(),
  mockEstimateTokens: vi.fn(),
  mockCheckResponseQuality: vi.fn(),
  mockIsEncryptedDocx: vi.fn(),
  mockAnalyseQuestion: vi.fn(),
  mockDraftResponseStreaming: vi.fn(),
  mockGetModelForTier: vi.fn(),
  mockCanTransition: vi.fn(),
  mockEnqueueQueueJob: vi.fn(),
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

vi.mock('@/lib/ai/draft', () => ({
  runDraftingPipeline: mockRunDraftingPipeline,
  analyseQuestion: mockAnalyseQuestion,
  draftResponseStreaming: mockDraftResponseStreaming,
}));

vi.mock('@/lib/coverage/cost-estimation', () => ({
  estimateBatchCost: mockEstimateBatchCost,
  estimateTokens: mockEstimateTokens,
}));

vi.mock('@/lib/ai/quality-check', () => ({
  checkResponseQuality: mockCheckResponseQuality,
}));

vi.mock('@/lib/docx-utils', () => ({
  isEncryptedDocx: mockIsEncryptedDocx,
}));

vi.mock('@/lib/anthropic', () => ({
  getModelForTier: mockGetModelForTier,
}));

vi.mock('@/lib/bid/bid-state-machine', () => ({
  canTransition: mockCanTransition,
}));

// Mock the queue enqueue chokepoint helper for the draft-all route's
// post-S224 §5.4.1 producer pattern. The route POSTs → enqueueQueueJob →
// returns { jobId, deduplicated }. We simulate both fresh-enqueue and
// dedup-hit responses per AC-1 / AC-3 / AC-4. The route also imports
// `buildIdempotencyKey` from @/lib/queue/envelope — we keep that real
// (it's a pure helper) so the produced key shape can be observed in
// assertions if needed.
vi.mock('@/lib/queue/enqueue', () => ({
  enqueueQueueJob: mockEnqueueQueueJob,
}));

// Import route handlers AFTER mocks
const { POST: draftPost } =
  await import('@/app/api/bids/[id]/responses/draft/route');
const { POST: draftStreamPost } =
  await import('@/app/api/bids/[id]/responses/draft-stream/route');
const { POST: draftAllPost } =
  await import('@/app/api/bids/[id]/responses/draft-all/route');
const { POST: estimatePost } =
  await import('@/app/api/bids/[id]/responses/estimate/route');
const { POST: regeneratePost } =
  await import('@/app/api/bids/[id]/responses/[rId]/regenerate/route');
const { POST: restorePost } =
  await import('@/app/api/bids/[id]/responses/[rId]/restore/route');
const { PATCH: questionPatch, DELETE: questionDelete } =
  await import('@/app/api/bids/[id]/questions/[qId]/route');
const { POST: tenderPost } = await import('@/app/api/bids/[id]/tender/route');
const { GET: historyGet } =
  await import('@/app/api/bids/[id]/responses/[rId]/history/route');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const INVALID_UUID = 'not-a-uuid';

const MOCK_DRAFT_RESULT = {
  response_text: 'Drafted response text',
  source_content_ids: [VALID_UUID_2],
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
  mockSupabase._chain.csv
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then
    .mockReset()
    .mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );

  // Storage mocks
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

  // Default dependency mocks
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  mockRunDraftingPipeline.mockResolvedValue(MOCK_DRAFT_RESULT);
  mockEstimateBatchCost.mockReturnValue({
    eligibleQuestions: 2,
    estimatedCostMin: 0.05,
    estimatedCostMax: 0.15,
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    breakdown: [],
  });
  mockEstimateTokens.mockReturnValue(100);
  mockIsEncryptedDocx.mockReturnValue(false);
  mockCanTransition.mockReturnValue(true);
  mockGetModelForTier.mockReturnValue('claude-sonnet-4-6');
  // Default enqueue: fresh job (deduplicated:false). Tests override with
  // mockResolvedValueOnce for dedup-hit scenarios.
  mockEnqueueQueueJob.mockResolvedValue({
    jobId: 'c0c0c0c0-0000-4000-8000-000000000001',
    deduplicated: false,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bids/:id/responses/draft
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/bids/:id/responses/draft', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/bids/${VALID_UUID}/responses/draft`, {
      method: 'POST',
      body: { question_ids: [VALID_UUID_2] },
    });

    const res = await draftPost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/bids/${VALID_UUID}/responses/draft`, {
      method: 'POST',
      body: { question_ids: [VALID_UUID_2] },
    });

    const res = await draftPost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/bids/${INVALID_UUID}/responses/draft`, {
      method: 'POST',
      body: {},
    });

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

    const req = createTestRequest(`/api/bids/${VALID_UUID}/responses/draft`, {
      method: 'POST',
      body: {},
    });

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

    const req = createTestRequest(`/api/bids/${VALID_UUID}/responses/draft`, {
      method: 'POST',
      body: {},
    });

    const res = await draftPost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Bid not found');
  });

  it('returns 400 when bid is in draft state (not draftable)', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, status: 'draft', domain_metadata: {} },
      error: null,
    });

    const req = createTestRequest(`/api/bids/${VALID_UUID}/responses/draft`, {
      method: 'POST',
      body: {},
    });

    const res = await draftPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('"draft" state');
    expect(body.current_status).toBe('draft');
  });

  it('returns 200 with no questions to draft when query returns empty', async () => {
    configureRole(mockSupabase, 'editor');

    // Bid lookup: draftable state
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, status: 'drafting', domain_metadata: {} },
      error: null,
    });

    // Questions query returns empty
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest(`/api/bids/${VALID_UUID}/responses/draft`, {
      method: 'POST',
      body: {},
    });

    const res = await draftPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.drafted).toBe(0);
    expect(body.message).toBe('No questions to draft');
  });

  it('skips no_content questions unless force is true', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, status: 'drafting', domain_metadata: {} },
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
              confidence_posture: 'no_content',
              matched_content_ids: [],
            },
          ],
          error: null,
        }),
    );

    const req = createTestRequest(`/api/bids/${VALID_UUID}/responses/draft`, {
      method: 'POST',
      body: { force: false },
    });

    const res = await draftPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.skipped).toBe(1);
    expect(body.results[0].reason).toBe('no_content');
    expect(mockRunDraftingPipeline).not.toHaveBeenCalled();
  });

  it('skips already-drafted questions when force is false', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, status: 'drafting', domain_metadata: {} },
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
              confidence_posture: 'strong',
              matched_content_ids: [],
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

    const req = createTestRequest(`/api/bids/${VALID_UUID}/responses/draft`, {
      method: 'POST',
      body: { force: false },
    });

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
      data: { id: VALID_UUID, status: 'drafting', domain_metadata: {} },
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
              confidence_posture: 'strong',
              matched_content_ids: [],
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

    const req = createTestRequest(`/api/bids/${VALID_UUID}/responses/draft`, {
      method: 'POST',
      body: {},
    });

    const res = await draftPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.drafted).toBe(1);
    expect(body.results[0].status).toBe('drafted');
    expect(mockRunDraftingPipeline).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bids/:id/responses/draft-stream
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/bids/:id/responses/draft-stream', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/draft-stream`,
      {
        method: 'POST',
        body: { question_id: VALID_UUID_2 },
      },
    );

    const res = await draftStreamPost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/draft-stream`,
      {
        method: 'POST',
        body: { question_id: VALID_UUID_2 },
      },
    );

    const res = await draftStreamPost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid bid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/bids/${INVALID_UUID}/responses/draft-stream`,
      {
        method: 'POST',
        body: { question_id: VALID_UUID_2 },
      },
    );

    const res = await draftStreamPost(req, {
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
      `/api/bids/${VALID_UUID}/responses/draft-stream`,
      {
        method: 'POST',
        body: { question_id: VALID_UUID_2 },
      },
    );

    const res = await draftStreamPost(req, { params });
    expect(res.status).toBe(429);
  });

  it('returns 404 when bid does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/draft-stream`,
      {
        method: 'POST',
        body: { question_id: VALID_UUID_2 },
      },
    );

    const res = await draftStreamPost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Bid not found');
  });

  it('returns 400 when bid is not in a draftable state', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        status: 'questions_extracted',
        domain_metadata: {},
      },
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/draft-stream`,
      {
        method: 'POST',
        body: { question_id: VALID_UUID_2 },
      },
    );

    const res = await draftStreamPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('"questions_extracted" state');
  });

  it('returns 404 when question not found in the bid', async () => {
    configureRole(mockSupabase, 'editor');

    // Bid lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, status: 'drafting', domain_metadata: {} },
      error: null,
    });

    // Question lookup fails
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/draft-stream`,
      {
        method: 'POST',
        body: { question_id: VALID_UUID_2 },
      },
    );

    const res = await draftStreamPost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Question not found in this bid');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bids/:id/responses/draft-all
// ═══════════════════════════════════════════════════════════════════════════

// Post-S224 §5.4.1: route now ENQUEUES (HTTP 202 + envelope) instead of
// running the synchronous loop. Tests below assert the producer pattern
// (route → pre-conditions → pipeline_runs INSERT → enqueueQueueJob → 202
// response). The handler-side behaviour (per-question loop, no_content /
// already_drafted skip logic) is covered by the unit tests at
// __tests__/lib/queue/handlers/bid-draft-all.test.ts and the integration
// tests at __tests__/integration/queue/bid-draft-all.integration.test.ts.

describe('POST /api/bids/:id/responses/draft-all (post-S224 §5.4.1 queued)', () => {
  const params = createTestParams({ id: VALID_UUID });
  const ENQUEUED_JOB_ID = 'c0c0c0c0-0000-4000-8000-000000000001';

  // Helper: configure the mock chain to walk the route's HTTP-level
  // pre-conditions through to the enqueue point. Sequence:
  //   1. role lookup (.single) — configureRole
  //   2. workspaces.select.eq.eq.single() — bid existence
  //   3. pipeline_runs.insert(...) — awaited via .then (default empty impl)
  //   4. user_roles.select.eq.maybeSingle() — envelope role lookup
  function configureRouteToEnqueuePoint(opts: {
    role?: 'admin' | 'editor' | 'viewer';
    bid?: { status: string } | null;
    bidError?: { code: string; message: string } | null;
    envelopeRole?: 'admin' | 'editor' | 'viewer';
  } = {}) {
    const role = opts.role ?? 'editor';
    configureRole(mockSupabase, role);
    if (opts.bid !== null) {
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: opts.bid ?? {
          id: VALID_UUID,
          status: 'drafting',
          domain_metadata: {},
        },
        error: null,
      });
    } else {
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: opts.bidError ?? { code: 'PGRST116', message: 'No rows found' },
      });
    }
    // Envelope role lookup via maybeSingle().
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: opts.envelopeRole ?? role },
      error: null,
    });
  }

  // ───── HTTP-level pre-conditions (preserved from pre-S224 contract) ─────

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(401);
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(403);
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/bids/${INVALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, {
      params: createTestParams({ id: INVALID_UUID }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('Invalid bid ID');
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });

  it('returns 404 when bid does not exist', async () => {
    configureRouteToEnqueuePoint({ bid: null });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(404);
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });

  it('returns 400 when bid is not in a draftable state', async () => {
    configureRouteToEnqueuePoint({ bid: { status: 'draft' } });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.current_status).toBe('draft');
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });

  // ───── AC-1 — Route enqueues + returns 202 (queued envelope) ─────
  // Spec §8 AC-1 lines 868-874.

  it('AC-1: returns 202 + {job_id, pipeline_run_id, status:"queued", deduplicated:false} on first POST (editor)', async () => {
    configureRouteToEnqueuePoint({ role: 'editor', bid: { status: 'drafting' } });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.job_id).toBe(ENQUEUED_JOB_ID);
    expect(body.status).toBe('queued');
    expect(body.deduplicated).toBe(false);
    expect(body.pipeline_run_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // Enqueue called with the right contract.
    expect(mockEnqueueQueueJob).toHaveBeenCalledTimes(1);
    const call = mockEnqueueQueueJob.mock.calls[0][0];
    expect(call.jobType).toBe('bid_draft_all');
    expect(call.body).toEqual({
      bid_id: VALID_UUID,
      model_tier: 'drafting', // schema default
      skip_existing: true, // schema default
    });
    expect(call.authContext).toMatchObject({
      role: 'editor',
      workspace_id: VALID_UUID,
    });
    // Idempotency key formula per spec §3.2:
    // bid_draft_all:<bidId>:<YYYY-MM-DD>:<requestHash>
    expect(call.idempotencyKey).toMatch(
      new RegExp(`^bid_draft_all:${VALID_UUID}:\\d{4}-\\d{2}-\\d{2}:[0-9a-f]{16}$`),
    );
    expect(call.pipelineRunId).toBe(body.pipeline_run_id);
    expect(call.maxAttempts).toBe(3);
  });

  it('AC-1: returns 202 with admin auth (editor-required role gate satisfied via ROLE_RANK)', async () => {
    configureRouteToEnqueuePoint({ role: 'admin', bid: { status: 'drafting' } });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: { model_tier: 'analysis', skip_existing: false },
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.status).toBe('queued');
    const call = mockEnqueueQueueJob.mock.calls[0][0];
    expect(call.body).toEqual({
      bid_id: VALID_UUID,
      model_tier: 'analysis',
      skip_existing: false,
    });
    expect(call.authContext.role).toBe('admin');
  });

  // ───── AC-3 — Same-day re-enqueue dedup ─────
  // Spec §8 AC-3 lines 887-894.

  it('AC-3: same-day second POST → 202 + same job_id + deduplicated:true', async () => {
    configureRouteToEnqueuePoint({ role: 'editor', bid: { status: 'drafting' } });

    // Override the default mock to return deduplicated:true.
    mockEnqueueQueueJob.mockResolvedValueOnce({
      jobId: ENQUEUED_JOB_ID,
      deduplicated: true,
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.job_id).toBe(ENQUEUED_JOB_ID);
    expect(body.status).toBe('queued');
    expect(body.deduplicated).toBe(true);
  });

  // ───── 500 fallback when enqueue throws ─────

  it('returns 500 when enqueueQueueJob throws (e.g. RLS violation)', async () => {
    configureRouteToEnqueuePoint({ role: 'editor', bid: { status: 'drafting' } });

    mockEnqueueQueueJob.mockRejectedValueOnce(
      new Error('permission denied for table processing_queue'),
    );

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bids/:id/responses/estimate
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/bids/:id/responses/estimate', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/estimate`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await estimatePost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/estimate`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await estimatePost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/bids/${INVALID_UUID}/responses/estimate`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await estimatePost(req, {
      params: createTestParams({ id: INVALID_UUID }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when bid does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/estimate`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await estimatePost(req, { params });
    expect(res.status).toBe(404);
  });

  it('returns 400 when bid is not in a draftable state', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, status: 'submitted', domain_metadata: {} },
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/estimate`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await estimatePost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.current_status).toBe('submitted');
  });

  it('returns zero estimate when no questions exist', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, status: 'drafting', domain_metadata: {} },
      error: null,
    });

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/estimate`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await estimatePost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total_questions).toBe(0);
    expect(body.eligible_questions).toBe(0);
  });

  it('returns cost estimate for eligible questions', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, status: 'drafting', domain_metadata: {} },
      error: null,
    });

    // Questions query
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: VALID_UUID_2,
              question_text: 'Test question',
              confidence_posture: 'strong',
              matched_content_ids: [],
            },
          ],
          error: null,
        }),
    );

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/estimate`,
      {
        method: 'POST',
        body: { skip_existing: false },
      },
    );

    const res = await estimatePost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.eligible_questions).toBe(2);
    expect(mockEstimateBatchCost).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bids/:id/responses/:rId/regenerate
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/bids/:id/responses/:rId/regenerate', () => {
  const params = createTestParams({ id: VALID_UUID, rId: VALID_UUID_2 });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/regenerate`,
      { method: 'POST', body: { instructions: 'Make it shorter' } },
    );

    const res = await regeneratePost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/regenerate`,
      { method: 'POST', body: { instructions: 'Make it shorter' } },
    );

    const res = await regeneratePost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 when either UUID is invalid', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${INVALID_UUID}/regenerate`,
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
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/regenerate`,
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
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/regenerate`,
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
      data: { id: VALID_UUID_2, question_id: 'q-id', source_content_ids: [] },
      error: null,
    });

    // Question lookup fails (not in this bid)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/regenerate`,
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
      data: { id: VALID_UUID_2, question_id: 'q-id', source_content_ids: [] },
      error: null,
    });

    // Question lookup succeeds
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'q-id',
        question_text: 'Test question',
        word_limit: 200,
        section_name: 'Section 1',
        confidence_posture: 'strong',
      },
      error: null,
    });

    // Update response succeeds
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/regenerate`,
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

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bids/:id/responses/:rId/restore
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/bids/:id/responses/:rId/restore', () => {
  const params = createTestParams({ id: VALID_UUID, rId: VALID_UUID_2 });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 1 } },
    );

    const res = await restorePost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 1 } },
    );

    const res = await restorePost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 when either UUID is invalid', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/bids/${INVALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 1 } },
    );

    const res = await restorePost(req, {
      params: createTestParams({ id: INVALID_UUID, rId: VALID_UUID_2 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when response does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 1 } },
    );

    const res = await restorePost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Response not found');
  });

  it('returns 404 when response does not belong to this bid', async () => {
    configureRole(mockSupabase, 'editor');

    // Response exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, question_id: 'q-id' },
      error: null,
    });

    // Question lookup returns no row (maybeSingle)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 1 } },
    );

    const res = await restorePost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Response not found in this bid');
  });

  it('returns 404 when requested version does not exist in history', async () => {
    configureRole(mockSupabase, 'editor');

    // Response exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, question_id: 'q-id' },
      error: null,
    });

    // Question belongs to bid (maybeSingle)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'q-id' },
      error: null,
    });

    // History version not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 99 } },
    );

    const res = await restorePost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain('Version 99 not found');
  });

  it('restores a previous version and sets change_reason session config', async () => {
    configureRole(mockSupabase, 'editor');

    // Response exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, question_id: 'q-id' },
      error: null,
    });

    // Question belongs to bid (maybeSingle)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'q-id' },
      error: null,
    });

    // History version found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        response_text: 'Old version text',
        response_text_advanced: null,
        metadata: {},
        source_content_ids: [],
      },
      error: null,
    });

    // Update response
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_2,
        question_id: 'q-id',
        response_text: 'Old version text',
        review_status: 'edited',
        version: 3,
        last_edited_by: 'test-user-id',
        updated_at: '2026-03-14T00:00:00Z',
      },
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 2 } },
    );

    const res = await restorePost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.response_text).toBe('Old version text');
    expect(body.review_status).toBe('edited');

    // Verify set_config was called with change_reason
    expect(mockSupabase.rpc).toHaveBeenCalledWith('set_config', {
      setting: 'app.change_reason',
      value: 'Restored from version 2',
      is_local: true,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/bids/:id/questions/:qId
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH /api/bids/:id/questions/:qId', () => {
  const params = createTestParams({ id: VALID_UUID, qId: VALID_UUID_2 });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'PATCH', body: { question_text: 'Updated question' } },
    );

    const res = await questionPatch(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'PATCH', body: { question_text: 'Updated question' } },
    );

    const res = await questionPatch(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid bid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/bids/${INVALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'PATCH', body: { question_text: 'Updated question' } },
    );

    const res = await questionPatch(req, {
      params: createTestParams({ id: INVALID_UUID, qId: VALID_UUID_2 }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('Invalid bid ID');
  });

  it('returns 400 for invalid question UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/questions/${INVALID_UUID}`,
      { method: 'PATCH', body: { question_text: 'Updated question' } },
    );

    const res = await questionPatch(req, {
      params: createTestParams({ id: VALID_UUID, qId: INVALID_UUID }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('Invalid question ID');
  });

  it('returns 400 when no fields provided to update', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'PATCH', body: {} },
    );

    const res = await questionPatch(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('No fields to update');
  });

  it('returns 404 when question not found for this bid', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'PATCH', body: { question_text: 'Updated question' } },
    );

    const res = await questionPatch(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Question not found for this bid');
  });

  it('returns 200 with updated question data on success', async () => {
    configureRole(mockSupabase, 'editor');

    const updatedQuestion = {
      id: VALID_UUID_2,
      project_id: VALID_UUID,
      section_name: 'Section 1',
      question_text: 'Updated question text',
      word_limit: 300,
    };

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: updatedQuestion,
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'PATCH', body: { question_text: 'Updated question text' } },
    );

    const res = await questionPatch(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.question_text).toBe('Updated question text');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/bids/:id/questions/:qId
// ═══════════════════════════════════════════════════════════════════════════

describe('DELETE /api/bids/:id/questions/:qId', () => {
  const params = createTestParams({ id: VALID_UUID, qId: VALID_UUID_2 });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'DELETE' },
    );

    const res = await questionDelete(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'DELETE' },
    );

    const res = await questionDelete(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid bid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/bids/${INVALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'DELETE' },
    );

    const res = await questionDelete(req, {
      params: createTestParams({ id: INVALID_UUID, qId: VALID_UUID_2 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid question UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/questions/${INVALID_UUID}`,
      { method: 'DELETE' },
    );

    const res = await questionDelete(req, {
      params: createTestParams({ id: VALID_UUID, qId: INVALID_UUID }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 204 on successful deletion', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'DELETE' },
    );

    const res = await questionDelete(req, { params });
    expect(res.status).toBe(204);
  });

  it('returns 500 when delete fails', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { message: 'FK violation', code: '23503' },
        }),
    );

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'DELETE' },
    );

    const res = await questionDelete(req, { params });
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bids/:id/tender
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/bids/:id/tender', () => {
  const params = createTestParams({ id: VALID_UUID });

  // PDF magic bytes: %PDF
  const PDF_MAGIC = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x00, 0x00, 0x00, 0x00,
  ]);
  // ZIP/DOCX magic bytes: PK\x03\x04
  const DOCX_MAGIC = new Uint8Array([
    0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00,
  ]);

  /**
   * Create a mock File that works in jsdom. The route checks
   * `file instanceof File` which fails cross-realm. We create a plain
   * object with all the File properties the route uses.
   */
  function createMockFile(
    bytes: Uint8Array,
    name: string,
    mimeType: string,
  ): File {
    const blob = new Blob([bytes as BlobPart], { type: mimeType });
    // Construct an object that satisfies both the instanceof check and
    // the route's property accesses. Object.create(File.prototype) makes
    // instanceof File pass in the same realm.
    const file = Object.create(File.prototype, {
      name: { value: name, writable: false },
      type: { value: mimeType, writable: false },
      size: { value: bytes.length, writable: false },
      arrayBuffer: { value: () => blob.arrayBuffer(), writable: false },
    });
    return file;
  }

  // Helper to create a NextRequest whose formData() returns a controlled FormData
  function createTenderRequest(
    mockFile: File | null,
    bidId: string = VALID_UUID,
  ): import('next/server').NextRequest {
    const req = createTestRequest(`/api/bids/${bidId}/tender`, {
      method: 'POST',
      body: {}, // placeholder — we override formData()
    });

    // Override formData() to return our controlled data
    const formData = new FormData();
    if (mockFile) {
      // Use defineProperty to put the object as a regular value
      formData.get = vi.fn((key: string) => {
        if (key === 'file') return mockFile;
        return null;
      });
    }

    (req as unknown as { formData: () => Promise<FormData> }).formData = vi
      .fn()
      .mockResolvedValue(formData);

    return req;
  }

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const file = createMockFile(PDF_MAGIC, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const file = createMockFile(PDF_MAGIC, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const file = createMockFile(PDF_MAGIC, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file, INVALID_UUID);

    const res = await tenderPost(req, {
      params: createTestParams({ id: INVALID_UUID }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when no file is provided', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTenderRequest(null);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('No file provided');
  });

  it('returns 400 for empty file', async () => {
    configureRole(mockSupabase, 'editor');

    const emptyBytes = new Uint8Array(0);
    const file = createMockFile(emptyBytes, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('empty');
  });

  it('returns 400 for unsupported MIME type', async () => {
    configureRole(mockSupabase, 'editor');

    const textBytes = new TextEncoder().encode('test content');
    const file = createMockFile(
      new Uint8Array(textBytes),
      'test.txt',
      'text/plain',
    );
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('Unsupported file type');
  });

  it('returns 404 when bid does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const file = createMockFile(PDF_MAGIC, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(404);
  });

  it('returns 415 when magic bytes do not match declared MIME type', async () => {
    configureRole(mockSupabase, 'editor');

    // Bid exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, domain_metadata: { tender_document_ids: [] } },
      error: null,
    });

    // Create a "PDF" file with wrong magic bytes (DOCX magic)
    const file = createMockFile(DOCX_MAGIC, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(415);

    const body = await res.json();
    expect(body.error).toContain('does not match');
  });

  it('returns 400 when docx is encrypted', async () => {
    configureRole(mockSupabase, 'editor');

    mockIsEncryptedDocx.mockReturnValue(true);

    // Bid exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, domain_metadata: { tender_document_ids: [] } },
      error: null,
    });

    const docxType =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const file = createMockFile(DOCX_MAGIC, 'test.docx', docxType);
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('password-protected');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/bids/:id/responses/:rId/history
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/bids/:id/responses/:rId/history', () => {
  const params = createTestParams({ id: VALID_UUID, rId: VALID_UUID_2 });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
    );

    const res = await historyGet(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 400 when either UUID is invalid', async () => {
    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${INVALID_UUID}/history`,
    );

    const res = await historyGet(req, {
      params: createTestParams({ id: VALID_UUID, rId: INVALID_UUID }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('Invalid ID');
  });

  it('returns 404 when response does not exist', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
    );

    const res = await historyGet(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Response not found');
  });

  it('returns 404 when question does not belong to this bid', async () => {
    // Response exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, version: 3, question_id: 'q-id' },
      error: null,
    });

    // Question lookup returns no row (maybeSingle)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
    );

    const res = await historyGet(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Response not found in this bid');
  });

  it('returns 200 with version history on success', async () => {
    // Response exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, version: 3, question_id: 'q-id' },
      error: null,
    });

    // Question belongs to bid (maybeSingle)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'q-id' },
      error: null,
    });

    // History entries
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'h2',
              version: 2,
              response_text: 'Version 2 text',
              created_at: '2026-03-13',
            },
            {
              id: 'h1',
              version: 1,
              response_text: 'Version 1 text',
              created_at: '2026-03-12',
            },
          ],
          error: null,
        }),
    );

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
    );

    const res = await historyGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.current_version).toBe(3);
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0].version).toBe(2);
  });

  it('returns empty versions array when no history exists', async () => {
    // Response exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, version: 1, question_id: 'q-id' },
      error: null,
    });

    // Question belongs to bid (maybeSingle)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'q-id' },
      error: null,
    });

    // No history entries
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest(
      `/api/bids/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
    );

    const res = await historyGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.current_version).toBe(1);
    expect(body.versions).toHaveLength(0);
  });
});

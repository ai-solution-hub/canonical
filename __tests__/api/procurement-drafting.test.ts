import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';
import {
  createMockFile,
  createMockUploadRequest,
} from '../helpers/factories/file-upload';

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

vi.mock('@/lib/domains/procurement/ai/draft', () => ({
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

vi.mock('@/lib/domains/procurement/procurement-workflow', () => ({
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
  await import('@/app/api/procurement/[id]/responses/draft/route');
const { POST: draftStreamPost } =
  await import('@/app/api/procurement/[id]/responses/draft-stream/route');
const { POST: draftAllPost } =
  await import('@/app/api/procurement/[id]/responses/draft-all/route');
const { POST: estimatePost } =
  await import('@/app/api/procurement/[id]/responses/estimate/route');
const { POST: regeneratePost } =
  await import('@/app/api/procurement/[id]/responses/[rId]/regenerate/route');
const { POST: restorePost } =
  await import('@/app/api/procurement/[id]/responses/[rId]/restore/route');
const { PATCH: questionPatch, DELETE: questionDelete } =
  await import('@/app/api/procurement/[id]/questions/[qId]/route');
const { POST: tenderPost } =
  await import('@/app/api/procurement/[id]/tender/route');
const { GET: historyGet } =
  await import('@/app/api/procurement/[id]/responses/[rId]/history/route');

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
      data: { id: VALID_UUID, status: 'draft', domain_metadata: {} },
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
      data: { id: VALID_UUID, status: 'drafting', domain_metadata: {} },
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
              matched_record_ids: [],
            },
          ],
          error: null,
        }),
    );

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
      data: { id: VALID_UUID, status: 'drafting', domain_metadata: {} },
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
              confidence_posture: 'strong',
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

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bids/:id/responses/draft-stream
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/bids/:id/responses/draft-stream', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-stream`,
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
      `/api/procurement/${VALID_UUID}/responses/draft-stream`,
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
      `/api/procurement/${INVALID_UUID}/responses/draft-stream`,
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
      `/api/procurement/${VALID_UUID}/responses/draft-stream`,
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
      `/api/procurement/${VALID_UUID}/responses/draft-stream`,
      {
        method: 'POST',
        body: { question_id: VALID_UUID_2 },
      },
    );

    const res = await draftStreamPost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Procurement not found');
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
      `/api/procurement/${VALID_UUID}/responses/draft-stream`,
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

    // Procurement lookup
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
      `/api/procurement/${VALID_UUID}/responses/draft-stream`,
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

  // ID-58 {58.6}: the writer now targets the polymorphic `public.citations`
  // table. This drives the full happy path and asserts the resolved insert
  // payload: one row per distinct matched item, citation_type='reference',
  // cited_version = MAX(content_history.version), and spans overlaid from the
  // Anthropic CitationEntry list.
  it('writes per-CitationEntry rows to `citations` with spans + version', async () => {
    const ITEM_CITED = 'c1111111-1111-4111-8111-111111111111';
    const ITEM_UNCITED = 'c2222222-2222-4222-8222-222222222222';
    const RESPONSE_ID = 'd3333333-3333-4333-8333-333333333333';

    configureRole(mockSupabase, 'editor');

    // (1) Procurement lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, status: 'drafting', domain_metadata: {} },
      error: null,
    });
    // (2) Question lookup — two matched items
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_2,
        question_text: 'Describe your approach.',
        word_limit: 500,
        section_name: 'Method',
        confidence_posture: 'balanced',
        matched_record_ids: [ITEM_CITED, ITEM_UNCITED],
      },
      error: null,
    });

    // Post-{131.16} BI-29: matched content is resolved via
    // fetchMatchedContentForDrafting (q_a_pairs `.in()` then reference_items
    // `.in()`, both awaited via the chain `then`), then the cited_version
    // lookup queries q_a_pair_history `.in()`. Queue all three result sets in
    // order; both matched items resolve as q_a_pairs here.
    mockSupabase._chain.then
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: ITEM_CITED,
              question_text: 'Cited item',
              answer_standard: 'cited body',
              answer_advanced: null,
            },
            {
              id: ITEM_UNCITED,
              question_text: 'Uncited item',
              answer_standard: 'uncited body',
              answer_advanced: null,
            },
          ],
          error: null,
          count: 2,
        }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { q_a_pair_id: ITEM_CITED, version: 1 },
            { q_a_pair_id: ITEM_CITED, version: 4 },
            { q_a_pair_id: ITEM_UNCITED, version: 2 },
          ],
          error: null,
          count: 3,
        }),
      );

    // Pipeline mocks
    mockGetModelForTier.mockReturnValue('claude-sonnet-4-6');
    mockAnalyseQuestion.mockResolvedValue({
      analysis: { coverage: 'ok' },
      tokensUsed: 1,
      inputTokens: 1,
      outputTokens: 1,
      cost: 0,
    });
    mockDraftResponseStreaming.mockResolvedValue({
      textStream: (async function* () {
        yield 'Draft ';
        yield 'text.';
      })(),
      finalise: vi.fn().mockResolvedValue({
        responseText: 'Draft text.',
        model: 'claude-sonnet-4-6',
        // Two CitationEntry rows resolve to the SAME content item (index 0);
        // first-span-wins keeps cardinality at one row for that item.
        citations: [
          {
            cited_text: 'first span',
            source_index: 0,
            source_id: ITEM_CITED,
            source_title: 'Cited item',
            source_url: '',
            start_block_index: 3,
            end_block_index: 7,
          },
          {
            cited_text: 'second span (dropped at row level)',
            source_index: 0,
            source_id: ITEM_CITED,
            source_title: 'Cited item',
            source_url: '',
            start_block_index: 10,
            end_block_index: 12,
          },
        ],
        tokensUsed: 2,
        inputTokens: 1,
        outputTokens: 1,
        cost: 0,
      }),
    });
    mockCheckResponseQuality.mockResolvedValue({
      qualityData: { overall_score: 80 },
      tokensUsed: 1,
      inputTokens: 1,
      outputTokens: 1,
      cost: 0,
    });

    // (5) form_responses upsert → returns the new response id
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: RESPONSE_ID },
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-stream`,
      { method: 'POST', body: { question_id: VALID_UUID_2 } },
    );

    const res = await draftStreamPost(req, { params });
    expect(res.status).toBe(200);
    // Drain the SSE stream so the writer (which runs after pass3) executes.
    await res.text();

    // Assert the citations writer targeted the new table and deleted-by
    // citing_form_response_id (re-draft idempotency).
    expect(mockSupabase.from).toHaveBeenCalledWith('citations');
    expect(mockSupabase._chain.delete).toHaveBeenCalled();
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
      'citing_form_response_id',
      RESPONSE_ID,
    );

    // Inspect the inserted rows.
    const insertCalls = mockSupabase._chain.insert.mock.calls;
    expect(insertCalls.length).toBeGreaterThan(0);
    const rows = insertCalls[insertCalls.length - 1][0] as Array<
      Record<string, unknown>
    >;
    // One row per DISTINCT matched item (not per CitationEntry).
    expect(rows).toHaveLength(2);

    const cited = rows.find((r) => r.cited_q_a_pair_id === ITEM_CITED);
    const uncited = rows.find((r) => r.cited_q_a_pair_id === ITEM_UNCITED);

    // Cited row: span overlaid from the FIRST CitationEntry; version = MAX(4).
    expect(cited).toMatchObject({
      citing_kind: 'form_response',
      citing_form_response_id: RESPONSE_ID,
      cited_kind: 'q_a_pair',
      citation_type: 'reference',
      cited_location_kind: 'block',
      cited_text: 'first span',
      cited_start: 3,
      cited_end: 7,
      cited_version: 4,
    });

    // Uncited-but-matched row: reference with NULL span, version = MAX(2).
    expect(uncited).toMatchObject({
      citation_type: 'reference',
      cited_location_kind: null,
      cited_text: null,
      cited_start: null,
      cited_end: null,
      cited_version: 2,
    });
  });

  // ID-58 {58.6} Checker nit: the writer de-silenced the citations-write
  // failure path. A `citations` delete/insert error is now non-fatal but
  // OBSERVABLE — it logs AND emits a `citation_warning` SSE frame, while the
  // already-saved response still streams `done`. This drives the failure
  // branch and asserts the observable surface (the warning frame + completion),
  // not the internal throw.
  it('emits a non-fatal `citation_warning` SSE frame when the citations write fails, then still completes', async () => {
    const ITEM_CITED = 'c4444444-4444-4444-8444-444444444444';
    const RESPONSE_ID = 'd5555555-5555-4555-8555-555555555555';

    configureRole(mockSupabase, 'editor');

    // (1) Procurement lookup — draftable
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, status: 'drafting', domain_metadata: {} },
      error: null,
    });
    // (2) Question lookup — one matched item (enough to drive the writer)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_2,
        question_text: 'Describe your approach.',
        word_limit: 500,
        section_name: 'Method',
        confidence_posture: 'balanced',
        matched_record_ids: [ITEM_CITED],
      },
      error: null,
    });

    // Post-{131.16} BI-29: matched content via fetchMatchedContentForDrafting
    // (q_a_pairs `.in()` then reference_items `.in()`), then the cited_version
    // lookup queries q_a_pair_history `.in()`. All succeed so the writer
    // reaches the delete/insert.
    mockSupabase._chain.then
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: ITEM_CITED,
              question_text: 'Cited item',
              answer_standard: 'cited body',
              answer_advanced: null,
            },
          ],
          error: null,
          count: 1,
        }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [{ q_a_pair_id: ITEM_CITED, version: 2 }],
          error: null,
          count: 1,
        }),
      )
      // citations `.delete().eq()` — awaited via the chain `then`. Return a
      // non-null Supabase error so `deleteError` is truthy and the writer
      // throws into its non-fatal catch (logger.error + citation_warning).
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { code: '23503', message: 'citations delete failed' },
          count: null,
        }),
      );

    // Pipeline mocks
    mockGetModelForTier.mockReturnValue('claude-sonnet-4-6');
    mockAnalyseQuestion.mockResolvedValue({
      analysis: { coverage: 'ok' },
      tokensUsed: 1,
      inputTokens: 1,
      outputTokens: 1,
      cost: 0,
    });
    mockDraftResponseStreaming.mockResolvedValue({
      textStream: (async function* () {
        yield 'Draft ';
        yield 'text.';
      })(),
      finalise: vi.fn().mockResolvedValue({
        responseText: 'Draft text.',
        model: 'claude-sonnet-4-6',
        citations: [
          {
            cited_text: 'first span',
            source_index: 0,
            source_id: ITEM_CITED,
            source_title: 'Cited item',
            source_url: '',
            start_block_index: 3,
            end_block_index: 7,
          },
        ],
        tokensUsed: 2,
        inputTokens: 1,
        outputTokens: 1,
        cost: 0,
      }),
    });
    mockCheckResponseQuality.mockResolvedValue({
      qualityData: { overall_score: 80 },
      tokensUsed: 1,
      inputTokens: 1,
      outputTokens: 1,
      cost: 0,
    });

    // (5) form_responses upsert → returns the new response id (response is
    // saved BEFORE the citations write, so the failure must remain non-fatal).
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: RESPONSE_ID },
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-stream`,
      { method: 'POST', body: { question_id: VALID_UUID_2 } },
    );

    const res = await draftStreamPost(req, { params });
    expect(res.status).toBe(200);

    // Drain the SSE stream so the writer (which runs after pass3) executes.
    const sseText = await res.text();

    // Observable de-silenced surface: the non-fatal warning frame is emitted.
    expect(sseText).toContain('event: citation_warning');
    expect(sseText).toContain('Citations were not recorded for this response');

    // Non-fatal: the saved response still completes (NOT aborted via `error`).
    expect(sseText).toContain('event: done');
    expect(sseText).toContain(RESPONSE_ID);
    expect(sseText).not.toContain('event: error');
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
  function configureRouteToEnqueuePoint(
    opts: {
      role?: 'admin' | 'editor' | 'viewer';
      bid?: { status: string } | null;
      procurementError?: { code: string; message: string } | null;
      envelopeRole?: 'admin' | 'editor' | 'viewer';
    } = {},
  ) {
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
        error: opts.procurementError ?? {
          code: 'PGRST116',
          message: 'No rows found',
        },
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
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
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
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
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
      `/api/procurement/${INVALID_UUID}/responses/draft-all`,
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
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
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
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
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
    configureRouteToEnqueuePoint({
      role: 'editor',
      bid: { status: 'drafting' },
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
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
    expect(call.jobType).toBe('form_draft_all');
    expect(call.body).toEqual({
      form_id: VALID_UUID,
      model_tier: 'drafting', // schema default
      skip_existing: true, // schema default
    });
    expect(call.authContext).toMatchObject({
      role: 'editor',
      workspace_id: VALID_UUID,
    });
    // Idempotency key formula per spec §3.2:
    // form_draft_all:<procurementId>:<YYYY-MM-DD>:<requestHash>
    expect(call.idempotencyKey).toMatch(
      new RegExp(
        `^form_draft_all:${VALID_UUID}:\\d{4}-\\d{2}-\\d{2}:[0-9a-f]{16}$`,
      ),
    );
    expect(call.pipelineRunId).toBe(body.pipeline_run_id);
    expect(call.maxAttempts).toBe(3);
  });

  it('AC-1: returns 202 with admin auth (editor-required role gate satisfied via ROLE_RANK)', async () => {
    configureRouteToEnqueuePoint({
      role: 'admin',
      bid: { status: 'drafting' },
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
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
      form_id: VALID_UUID,
      model_tier: 'analysis',
      skip_existing: false,
    });
    expect(call.authContext.role).toBe('admin');
  });

  // ───── AC-3 — Same-day re-enqueue dedup ─────
  // Spec §8 AC-3 lines 887-894.

  it('AC-3: same-day second POST → 202 + same job_id + deduplicated:true', async () => {
    configureRouteToEnqueuePoint({
      role: 'editor',
      bid: { status: 'drafting' },
    });

    // Override the default mock to return deduplicated:true.
    mockEnqueueQueueJob.mockResolvedValueOnce({
      jobId: ENQUEUED_JOB_ID,
      deduplicated: true,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
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
    configureRouteToEnqueuePoint({
      role: 'editor',
      bid: { status: 'drafting' },
    });

    mockEnqueueQueueJob.mockRejectedValueOnce(
      new Error('permission denied for table processing_queue'),
    );

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
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
      `/api/procurement/${VALID_UUID}/responses/estimate`,
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
      `/api/procurement/${VALID_UUID}/responses/estimate`,
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
      `/api/procurement/${INVALID_UUID}/responses/estimate`,
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
      `/api/procurement/${VALID_UUID}/responses/estimate`,
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
      `/api/procurement/${VALID_UUID}/responses/estimate`,
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
      `/api/procurement/${VALID_UUID}/responses/estimate`,
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
              matched_record_ids: [],
            },
          ],
          error: null,
        }),
    );

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/estimate`,
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

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bids/:id/responses/:rId/restore
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/bids/:id/responses/:rId/restore', () => {
  const params = createTestParams({ id: VALID_UUID, rId: VALID_UUID_2 });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 1 } },
    );

    const res = await restorePost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
      { method: 'POST', body: { version: 1 } },
    );

    const res = await restorePost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 when either UUID is invalid', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/procurement/${INVALID_UUID}/responses/${VALID_UUID_2}/restore`,
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
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
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
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
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
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
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
        source_record_ids: [],
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
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/restore`,
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
      `/api/procurement/${VALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'PATCH', body: { question_text: 'Updated question' } },
    );

    const res = await questionPatch(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'PATCH', body: { question_text: 'Updated question' } },
    );

    const res = await questionPatch(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid bid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/procurement/${INVALID_UUID}/questions/${VALID_UUID_2}`,
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
      `/api/procurement/${VALID_UUID}/questions/${INVALID_UUID}`,
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
      `/api/procurement/${VALID_UUID}/questions/${VALID_UUID_2}`,
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
      `/api/procurement/${VALID_UUID}/questions/${VALID_UUID_2}`,
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
      workspace_id: VALID_UUID,
      section_name: 'Section 1',
      question_text: 'Updated question text',
      word_limit: 300,
    };

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: updatedQuestion,
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/questions/${VALID_UUID_2}`,
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
      `/api/procurement/${VALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'DELETE' },
    );

    const res = await questionDelete(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/questions/${VALID_UUID_2}`,
      { method: 'DELETE' },
    );

    const res = await questionDelete(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid bid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/procurement/${INVALID_UUID}/questions/${VALID_UUID_2}`,
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
      `/api/procurement/${VALID_UUID}/questions/${INVALID_UUID}`,
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
      `/api/procurement/${VALID_UUID}/questions/${VALID_UUID_2}`,
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
      `/api/procurement/${VALID_UUID}/questions/${VALID_UUID_2}`,
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
   * Adapter to match the (bytes, name, mimeType) signature used by the
   * tender-upload describe block below. Delegates to the canonical
   * factory which spoofs `instanceof File` via Object.create(File.prototype)
   * — the same strategy the inline original used to satisfy the route's
   * cross-realm instanceof check.
   */
  function makeMockFile(
    bytes: Uint8Array,
    name: string,
    mimeType: string,
  ): File {
    return createMockFile({ name, content: bytes, type: mimeType });
  }

  /**
   * Adapter wrapping the canonical upload-request factory. Forwards
   * `null` as a no-file body so the route exercises its "no file"
   * validation branch.
   */
  function createTenderRequest(
    mockFile: File | null,
    procurementId: string = VALID_UUID,
  ): import('next/server').NextRequest {
    if (mockFile) {
      return createMockUploadRequest({
        path: `/api/procurement/${procurementId}/tender`,
        file: mockFile,
      });
    }

    // The "no file" path — the original helper built an empty FormData
    // whose .get always returns null. createMockUploadRequest requires a
    // File, so for this single branch fall back to the lower-level
    // request builder plus a manual empty FormData override.
    const req = createTestRequest(`/api/procurement/${procurementId}/tender`, {
      method: 'POST',
      body: {},
    });
    const formData = new FormData();
    (req as unknown as { formData: () => Promise<FormData> }).formData = vi
      .fn()
      .mockResolvedValue(formData);
    return req;
  }

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const file = makeMockFile(PDF_MAGIC, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const file = makeMockFile(PDF_MAGIC, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const file = makeMockFile(PDF_MAGIC, 'test.pdf', 'application/pdf');
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
    const file = makeMockFile(emptyBytes, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('empty');
  });

  it('returns 400 for unsupported MIME type', async () => {
    configureRole(mockSupabase, 'editor');

    const textBytes = new TextEncoder().encode('test content');
    const file = makeMockFile(
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

    const file = makeMockFile(PDF_MAGIC, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(404);
  });

  it('returns 415 when magic bytes do not match declared MIME type', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, domain_metadata: { tender_document_ids: [] } },
      error: null,
    });

    // Create a "PDF" file with wrong magic bytes (DOCX magic)
    const file = makeMockFile(DOCX_MAGIC, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(415);

    const body = await res.json();
    expect(body.error).toContain('does not match');
  });

  it('returns 400 when docx is encrypted', async () => {
    configureRole(mockSupabase, 'editor');

    mockIsEncryptedDocx.mockReturnValue(true);

    // Procurement exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, domain_metadata: { tender_document_ids: [] } },
      error: null,
    });

    const docxType =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const file = makeMockFile(DOCX_MAGIC, 'test.docx', docxType);
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
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
    );

    const res = await historyGet(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 400 when either UUID is invalid', async () => {
    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/${INVALID_UUID}/history`,
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
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
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
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
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
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
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
      `/api/procurement/${VALID_UUID}/responses/${VALID_UUID_2}/history`,
    );

    const res = await historyGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.current_version).toBe(1);
    expect(body.versions).toHaveLength(0);
  });
});

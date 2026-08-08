/**
 * Procurement streaming-draft route tests.
 *
 *   - POST /api/procurement/:id/responses/draft-stream — draft one question's
 *     answer, streaming progress and the result as SSE frames
 *
 * Covers auth enforcement, UUID validation, rate limiting, the draftable-state
 * gate, the per-CitationEntry `citations` write and the two degrade paths
 * (citations-write failure, question_match_search RPC failure) that must warn
 * without blocking the stream.
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
// Real (unmocked) singleton — spied on directly in the {145.21} BI-37
// degrade-path test below rather than a file-wide `vi.mock('@/lib/logger'...)`,
// since no such mock scaffold exists elsewhere in this suite.
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const {
  mockCookies,
  mockCheckRateLimit,
  mockCheckResponseQuality,
  mockAnalyseQuestion,
  mockDraftResponseStreaming,
  mockGetModelForTier,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockCheckResponseQuality: vi.fn(),
  mockAnalyseQuestion: vi.fn(),
  mockDraftResponseStreaming: vi.fn(),
  mockGetModelForTier: vi.fn(),
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
  analyseQuestion: mockAnalyseQuestion,
  draftResponseStreaming: mockDraftResponseStreaming,
}));

vi.mock('@/lib/ai/quality-check', () => ({
  checkResponseQuality: mockCheckResponseQuality,
}));

vi.mock('@/lib/anthropic', () => ({
  getModelForTier: mockGetModelForTier,
}));

// Import route handlers AFTER mocks
const { POST: draftStreamPost } =
  await import('@/app/api/procurement/[id]/responses/draft-stream/route');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const INVALID_UUID = 'not-a-uuid';

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
  mockGetModelForTier.mockReturnValue('claude-sonnet-4-6');
});

describe('POST /api/procurement/:id/responses/draft-stream', () => {
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
        workflow_state: 'questions_extracted',
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
      data: { id: VALID_UUID, workflow_state: 'drafting' },
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
    expect(body.error).toBe('Question not found in this form');
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
      data: { id: VALID_UUID, workflow_state: 'drafting' },
      error: null,
    });
    // (2) Question lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_2,
        question_text: 'Describe your approach.',
        word_limit: 500,
        section_name: 'Method',
      },
      error: null,
    });

    // ID-145 {145.21} BI-37: matched ids now come from question_match_search
    // (the R7 substrate) rather than the dropped matched_record_ids column —
    // two matched q_a_pair candidates.
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ q_a_pair_id: ITEM_CITED }, { q_a_pair_id: ITEM_UNCITED }],
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
      data: { id: VALID_UUID, workflow_state: 'drafting' },
      error: null,
    });
    // (2) Question lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_2,
        question_text: 'Describe your approach.',
        word_limit: 500,
        section_name: 'Method',
      },
      error: null,
    });

    // ID-145 {145.21} BI-37: one matched item (enough to drive the writer)
    // sourced from question_match_search.
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ q_a_pair_id: ITEM_CITED }],
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

  // ID-145 {145.21} BI-37 Checker gap: when `question_match_search` itself
  // errors (RPC failure — e.g. the R7 substrate unavailable), the route
  // degrades to "no matched content" rather than blocking the draft (see the
  // route's inline comment ahead of the `.rpc('question_match_search', ...)`
  // call). This drives that degrade path end-to-end: the request still
  // succeeds, no content is injected into the drafting pipeline, and the
  // failure is observable via `logger.warn`.
  it('degrades to no matched content (without blocking) when question_match_search RPC errors', async () => {
    const RESPONSE_ID = 'd6666666-6666-4666-8666-666666666666';
    const RPC_ERROR = {
      code: 'XX000',
      message: 'question_match_search unavailable',
    };

    configureRole(mockSupabase, 'editor');

    // (1) Procurement lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, workflow_state: 'drafting' },
      error: null,
    });
    // (2) Question lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_2,
        question_text: 'Describe your approach.',
        word_limit: 500,
        section_name: 'Method',
      },
      error: null,
    });

    // ID-145 {145.21} BI-37: question_match_search RPC errors — matchedIds
    // resolves to [] and the fetchMatchedContentForDrafting lookup (and the
    // q_a_pair_history version lookup, and the citations writer, all gated on
    // matchedIds/matchedContent being non-empty) are never reached.
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: RPC_ERROR });

    const warnSpy = vi
      .spyOn(logger, 'warn')
      .mockImplementation(() => undefined);

    // Pipeline mocks — matchedContent is asserted to be [] via the call args
    // below, so these can be minimal (no citations, so the citations writer
    // stays un-exercised).
    mockGetModelForTier.mockReturnValue('claude-sonnet-4-6');
    mockAnalyseQuestion.mockResolvedValue({
      analysis: { coverage: 'none' },
      tokensUsed: 1,
      inputTokens: 1,
      outputTokens: 1,
      cost: 0,
    });
    mockDraftResponseStreaming.mockResolvedValue({
      textStream: (async function* () {
        yield 'Draft text with no source material.';
      })(),
      finalise: vi.fn().mockResolvedValue({
        responseText: 'Draft text with no source material.',
        model: 'claude-sonnet-4-6',
        citations: [],
        tokensUsed: 1,
        inputTokens: 1,
        outputTokens: 1,
        cost: 0,
      }),
    });
    mockCheckResponseQuality.mockResolvedValue({
      qualityData: { overall_score: 60 },
      tokensUsed: 1,
      inputTokens: 1,
      outputTokens: 1,
      cost: 0,
    });

    // (3) form_responses upsert → returns the new response id
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: RESPONSE_ID },
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-stream`,
      { method: 'POST', body: { question_id: VALID_UUID_2 } },
    );

    const res = await draftStreamPost(req, { params });
    // (a) The request still succeeds — the RPC error does NOT block drafting.
    expect(res.status).toBe(200);

    const sseText = await res.text();
    expect(sseText).not.toContain('event: error');
    expect(sseText).toContain('event: done');
    expect(sseText).toContain(RESPONSE_ID);

    // (b) The draft proceeds with NO matched content: both pipeline calls
    // received an empty matchedContent array, and the saved response has no
    // source_record_ids.
    expect(mockAnalyseQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ id: VALID_UUID_2 }),
      [],
    );
    expect(mockDraftResponseStreaming).toHaveBeenCalledWith(
      expect.objectContaining({ id: VALID_UUID_2 }),
      [],
      expect.anything(),
      'drafting',
    );
    const upsertCalls = mockSupabase._chain.upsert.mock.calls;
    expect(upsertCalls.length).toBeGreaterThan(0);
    const upsertedRow = upsertCalls[upsertCalls.length - 1][0] as Record<
      string,
      unknown
    >;
    expect(upsertedRow.source_record_ids).toEqual([]);

    // (c) The RPC error is logged (non-fatal, observable degrade).
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: RPC_ERROR }),
      expect.stringContaining('Failed to read question_matches'),
    );

    warnSpy.mockRestore();
  });
});

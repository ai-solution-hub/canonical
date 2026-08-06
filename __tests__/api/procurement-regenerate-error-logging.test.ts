/**
 * Regression coverage for the regenerate route's terminal catch block.
 *
 * WHY THIS EXISTS
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
 * because nothing anywhere recorded the underlying error. These tests pin the
 * fix: the cause is logged, and the client contract is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

const mockGetAuthorisedClient = vi.fn();
const mockAuthFailureResponse = vi.fn();
const mockRateLimitResponse = vi.fn();

vi.mock('@/lib/auth/client', () => ({
  getAuthorisedClient: (...args: unknown[]) => mockGetAuthorisedClient(...args),
  authFailureResponse: (...args: unknown[]) => mockAuthFailureResponse(...args),
  rateLimitResponse: (...args: unknown[]) => mockRateLimitResponse(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, resetAt: 0 })),
}));

const mockRunDraftingPipeline = vi.fn();
vi.mock('@/lib/domains/procurement/ai/draft', () => ({
  runDraftingPipeline: (...args: unknown[]) => mockRunDraftingPipeline(...args),
}));

vi.mock('@/lib/domains/procurement/draft-response', () => ({
  fetchMatchedContentForDrafting: vi.fn().mockResolvedValue([]),
}));

const mockLoggerError = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { POST } from '@/app/api/procurement/[id]/responses/[rId]/regenerate/route';

const FORM_ID = '550e8400-e29b-41d4-a716-446655440001';
const RESPONSE_ID = '550e8400-e29b-41d4-a716-446655440002';
const QUESTION_ID = '550e8400-e29b-41d4-a716-446655440003';

function callRoute() {
  const request = createTestRequest(
    `/api/procurement/${FORM_ID}/responses/${RESPONSE_ID}/regenerate`,
    { method: 'POST', body: { instructions: 'Make it more concise.' } },
  );
  return POST(request, {
    params: Promise.resolve({ id: FORM_ID, rId: RESPONSE_ID }),
  });
}

/**
 * Drive the route down to the `runDraftingPipeline` call: an authorised
 * admin, an existing response row, and its owning question.
 */
function arrangeHappyPathUpToPipeline() {
  mockGetAuthorisedClient.mockResolvedValue({
    success: true,
    user: { id: 'user-1' },
    supabase: mockSupabase,
  });
  mockSupabase._chain.single
    .mockResolvedValueOnce({
      data: {
        id: RESPONSE_ID,
        question_id: QUESTION_ID,
        source_record_ids: [],
      },
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        id: QUESTION_ID,
        question_text: 'Describe your approach.',
        word_limit: 500,
        section_name: 'Technical',
      },
      error: null,
    });
}

describe('POST regenerate — terminal catch observability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase._chain.single.mockReset();
  });

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
    mockRunDraftingPipeline.mockResolvedValue({
      response_text: 'A regenerated answer.',
      citations: [],
      source_record_ids: [],
      total_tokens: 10,
      total_cost: 0.01,
      metadata: { quality_data: { overall_score: 80 }, ai_metadata: {} },
    });
    // The post-pipeline UPDATE ... .select('id').single()
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: RESPONSE_ID },
      error: null,
    });

    const response = await callRoute();

    expect(response.status).toBe(200);
    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});

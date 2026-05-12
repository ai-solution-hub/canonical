/**
 * API route tests for POST /api/intelligence/workspaces/:id/prompts/preview
 *
 * Covers: auth (401/403), validation (400 on invalid body / too-short prompt /
 * oversized sample), happy path, empty-sample path, and partial-failure
 * semantics where one scoreRelevance call throws. scoreRelevance is mocked —
 * the real Claude API is never hit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../../helpers/mock-next';

// ---------------------------------------------------------------------------
// Mock scoreRelevance BEFORE importing the route. vi.hoisted keeps the mock
// reference available after hoisting.
// ---------------------------------------------------------------------------

const { mockScoreRelevance } = vi.hoisted(() => ({
  mockScoreRelevance: vi.fn(),
}));

vi.mock('@/lib/intelligence/relevance-scorer', () => ({
  scoreRelevance: mockScoreRelevance,
}));

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

// Import the route AFTER mocks so the mocked modules are used.
import { POST as previewPOST } from '@/app/api/intelligence/workspaces/[id]/prompts/preview/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PROFILE_UUID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

const MOCK_WORKSPACE = {
  id: WORKSPACE_UUID,
  domain_metadata: { company_profile_id: PROFILE_UUID },
};

const MOCK_PROFILE = {
  name: 'Acme Cyber Ltd',
  sectors: ['cyber security'],
  services: ['SOC as a service'],
  key_topics: ['NCSC guidance', 'Cyber Essentials'],
  target_customers: 'UK SMBs',
  value_proposition: 'Affordable managed SOC',
};

function mockArticles(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}d4e5f6-a7b8-4c9d-9e1f-2a3b4c5d6e7f`.slice(0, 36),
    title: `Article ${i + 1}`,
    raw_content: `Body content for article ${i + 1}. `.repeat(20),
    relevance_score: 0.5,
    relevance_reasoning: `Prior reasoning ${i + 1}`,
  }));
}

const VALID_BODY = {
  prompt_text: 'Focus on ransomware and supply-chain attacks for UK SMBs.',
  sample_size: 5,
};

/**
 * Configure the mock supabase chain for a successful preview request.
 *
 * The route performs these queries in order after auth:
 *   1. workspaces ... .maybeSingle()             → workspace row
 *   2. company_profiles ... .maybeSingle()        → profile row
 *   3. feed_articles ... .limit(sampleSize)       → resolves via chain.then
 */
function configureSuccessfulPreviewChain(
  articles: ReturnType<typeof mockArticles>,
) {
  // 1) workspace lookup (maybeSingle)
  mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
    data: MOCK_WORKSPACE,
    error: null,
  });
  // 2) company profile lookup (maybeSingle)
  mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
    data: MOCK_PROFILE,
    error: null,
  });
  // 3) feed_articles query — terminal await resolves via chain.then
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({ data: articles, error: null, count: articles.length }),
  );
}

function resetMocks() {
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
  mockScoreRelevance.mockReset();
}

function previewRequest(body: unknown) {
  return createTestRequest(
    `/api/intelligence/workspaces/${WORKSPACE_UUID}/prompts/preview`,
    { method: 'POST', body },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/intelligence/workspaces/:id/prompts/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const response = await previewPOST(previewRequest(VALID_BODY), {
      params: createTestParams({ id: WORKSPACE_UUID }),
    });

    expect(response.status).toBe(401);
    expect(mockScoreRelevance).not.toHaveBeenCalled();
  });

  it('returns 403 when user is a viewer', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await previewPOST(previewRequest(VALID_BODY), {
      params: createTestParams({ id: WORKSPACE_UUID }),
    });

    expect(response.status).toBe(403);
    expect(mockScoreRelevance).not.toHaveBeenCalled();
  });

  it('returns 400 when prompt_text is missing', async () => {
    configureRole(mockSupabase, 'editor');

    const response = await previewPOST(previewRequest({ sample_size: 5 }), {
      params: createTestParams({ id: WORKSPACE_UUID }),
    });

    expect(response.status).toBe(400);
    expect(mockScoreRelevance).not.toHaveBeenCalled();
  });

  it('returns 400 when sample_size exceeds the 20-article cap', async () => {
    configureRole(mockSupabase, 'editor');

    const response = await previewPOST(
      previewRequest({ ...VALID_BODY, sample_size: 50 }),
      { params: createTestParams({ id: WORKSPACE_UUID }) },
    );

    expect(response.status).toBe(400);
    expect(mockScoreRelevance).not.toHaveBeenCalled();
  });

  it('returns 400 when prompt_text is shorter than the minimum', async () => {
    configureRole(mockSupabase, 'editor');

    const response = await previewPOST(
      previewRequest({ prompt_text: 'too short', sample_size: 5 }),
      { params: createTestParams({ id: WORKSPACE_UUID }) },
    );

    expect(response.status).toBe(400);
    expect(mockScoreRelevance).not.toHaveBeenCalled();
  });

  it('returns 200 with per-article deltas on the happy path (N=5)', async () => {
    configureRole(mockSupabase, 'admin');
    const articles = mockArticles(5);
    configureSuccessfulPreviewChain(articles);

    // Predictable candidate scores: 0.9, 0.8, 0.7, 0.6, 0.5 (existing is 0.5).
    const candidateScores = [0.9, 0.8, 0.7, 0.6, 0.5];
    mockScoreRelevance.mockImplementation(
      async (_title: string, _content: string, _company, _thr, _prompt) => ({
        score: candidateScores.shift() ?? 0,
        category: 'high' as const,
        reasoning: 'mock reasoning',
        matchedCategories: [],
        passed: true,
      }),
    );

    const response = await previewPOST(previewRequest(VALID_BODY), {
      params: createTestParams({ id: WORKSPACE_UUID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.samples).toBe(5);
    expect(body.results).toHaveLength(5);
    expect(body.improved).toBe(4); // 0.9,0.8,0.7,0.6 are all > 0.5
    expect(body.regressed).toBe(0);
    // mean delta ≈ ((0.4 + 0.3 + 0.2 + 0.1 + 0.0) / 5) = 0.2
    expect(body.mean_delta).toBeCloseTo(0.2, 3);
    // warnings must be absent when there are no failures
    expect(body.warnings).toBeUndefined();

    expect(mockScoreRelevance).toHaveBeenCalledTimes(5);
  });

  it('returns 200 with samples=0 and no results when no articles exist', async () => {
    configureRole(mockSupabase, 'admin');
    // workspace + profile found, but feed_articles returns []
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: MOCK_WORKSPACE,
      error: null,
    });
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: MOCK_PROFILE,
      error: null,
    });
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const response = await previewPOST(previewRequest(VALID_BODY), {
      params: createTestParams({ id: WORKSPACE_UUID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.samples).toBe(0);
    expect(body.results).toEqual([]);
    expect(body.improved).toBe(0);
    expect(body.regressed).toBe(0);
    expect(body.mean_delta).toBe(0);
    expect(mockScoreRelevance).not.toHaveBeenCalled();
  });

  it('returns 200 with partial results and a warning when one article throws', async () => {
    configureRole(mockSupabase, 'admin');
    const articles = mockArticles(3);
    configureSuccessfulPreviewChain(articles);

    // First two succeed, third throws. Concurrency is capped at 3 but the
    // specific ordering does not matter for assertions: we only require
    // that the request returns partially and surfaces a warning.
    const impls: Array<() => Promise<unknown>> = [
      async () => ({
        score: 0.8,
        category: 'high',
        reasoning: 'ok',
        matchedCategories: [],
        passed: true,
      }),
      async () => ({
        score: 0.7,
        category: 'high',
        reasoning: 'ok',
        matchedCategories: [],
        passed: true,
      }),
      async () => {
        throw new Error('boom: scoring failed');
      },
    ];
    mockScoreRelevance.mockImplementation(() => {
      const next = impls.shift();
      return next ? next() : Promise.reject(new Error('unexpected call'));
    });

    const response = await previewPOST(previewRequest(VALID_BODY), {
      params: createTestParams({ id: WORKSPACE_UUID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.samples).toBe(2); // one failure omitted
    expect(body.results).toHaveLength(2);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.warnings.some((w: string) => /boom/.test(w))).toBe(true);
  });

  it('scores articles against the candidate prompt rather than the saved one', async () => {
    configureRole(mockSupabase, 'admin');
    const articles = mockArticles(1);
    configureSuccessfulPreviewChain(articles);

    mockScoreRelevance.mockResolvedValue({
      score: 0.9,
      category: 'high',
      reasoning: 'ok',
      matchedCategories: [],
      passed: true,
    });

    const CUSTOM_PROMPT =
      'Prefer guidance specific to UK further education providers.';
    const response = await previewPOST(
      previewRequest({ prompt_text: CUSTOM_PROMPT, sample_size: 1 }),
      { params: createTestParams({ id: WORKSPACE_UUID }) },
    );

    expect(response.status).toBe(200);
    expect(mockScoreRelevance).toHaveBeenCalledTimes(1);
    // signature: (title, content, company, threshold, customPromptText)
    const callArgs = mockScoreRelevance.mock.calls[0];
    expect(callArgs[4]).toBe(CUSTOM_PROMPT);
    // guard against caching a default instead of passing through
    expect(callArgs[4]).not.toBe(VALID_BODY.prompt_text);
  });
});

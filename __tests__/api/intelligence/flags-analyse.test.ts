/**
 * API route tests for POST /api/intelligence/workspaces/:id/flags/analyse
 *
 * Covers the full matrix: auth (unauth, viewer, editor-no-access), body
 * validation (missing both shapes), happy paths for both `flag_ids` and
 * `filter`, the zero-flags edge case, and the structured 500 when the
 * analyser throws.
 *
 * Spec: docs/specs/si-prompt-refinement-skill-spec.md §4 Task 3
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestParams } from '../../helpers/mock-next';
import { createMockApiRequest } from '../../helpers/factories/api-request';

// ---------------------------------------------------------------------------
// Mocks
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

// Mock the analyser itself — the route's job is orchestration, not analysis.
const analyseFeedFlagsMock = vi.fn();
vi.mock('@/lib/intelligence/flag-analyser', () => ({
  analyseFeedFlags: (...args: unknown[]) => analyseFeedFlagsMock(...args),
}));

// Silence the best-effort warn helper so test output stays clean.
vi.mock('@/lib/supabase/telemetry', () => ({
  logBestEffortWarn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { POST as analysePOST } from '@/app/api/intelligence/workspaces/[id]/flags/analyse/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PROFILE_UUID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const FLAG_UUID_1 = 'c3d4e5f6-a7b8-4c9d-9e1f-2a3b4c5d6e7f';
const FLAG_UUID_2 = 'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f8a';

const WORKSPACE_ROW = {
  id: WORKSPACE_UUID,
  domain_metadata: { company_profile_id: PROFILE_UUID },
};

const PROMPT_ROW = {
  prompt_text: 'Score articles relevant to UK cybersecurity SMBs.',
};

const PROFILE_ROW = {
  name: 'Acme Security Ltd',
  sectors: ['Cybersecurity'],
  services: ['Penetration testing'],
  key_topics: ['zero trust'],
  target_customers: 'UK SMBs',
  value_proposition: 'Affordable enterprise-grade security',
};

const FLAG_JOIN_ROW = {
  id: FLAG_UUID_1,
  flag_type: 'false_positive',
  notes: 'Not our sector',
  created_at: '2026-03-15T12:00:00Z',
  feed_articles: {
    workspace_id: WORKSPACE_UUID,
    title: 'New cyber regulations',
    external_url: 'https://www.gov.uk/cyber',
    relevance_score: 0.82,
    relevance_reasoning: 'Mentions cyber compliance',
    relevance_category: 'high',
    feed_sources: { name: 'Gov.uk' },
  },
};

const ANALYSIS_RESULT = {
  summary: 'Two false positives clustered around regulatory updates.',
  falsePositivePatterns: [
    {
      pattern: 'Regulatory updates flagged as relevant',
      articleCount: 1,
      articles: ['New cyber regulations'],
      rootCause: 'Prompt is too broad on "compliance"',
    },
  ],
  falseNegativePatterns: [],
  recommendations: [
    {
      type: 'reword' as const,
      section: 'Scoring criteria',
      currentText: 'any cyber compliance news',
      proposedText: 'cyber compliance news affecting UK SMBs',
      reasoning: 'Narrows the scope to target customers',
      affectedFlags: 1,
    },
  ],
  proposedPromptText:
    'Score articles relevant to UK cybersecurity SMBs (refined).',
  confidenceNotes: 'Only 1 flag analysed — low confidence.',
  analysedFlagCount: 1,
  truncated: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  analyseFeedFlagsMock.mockReset();
}

/**
 * Configure the DB mock for a "fully wired, happy" request:
 *   role → workspace (exists) → prompt → profile → flags (1 row)
 *
 * Call order inside the route:
 *   1. role lookup         → .single()
 *   2. workspace           → .maybeSingle()
 *   3. prompt (parallel)   → .maybeSingle()
 *   4. profile (parallel)  → .maybeSingle()
 *   5. flags               → awaited chain (then)
 */
function configureHappyChain(role: 'admin' | 'editor' = 'editor') {
  configureRole(mockSupabase, role);
  // Workspace lookup
  mockSupabase._chain.maybeSingle
    .mockResolvedValueOnce({ data: WORKSPACE_ROW, error: null })
    // Prompt lookup
    .mockResolvedValueOnce({ data: PROMPT_ROW, error: null })
    // Company profile lookup
    .mockResolvedValueOnce({ data: PROFILE_ROW, error: null });
  // Flags
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [FLAG_JOIN_ROW], error: null, count: 1 }),
  );
}

function buildRequest(body: unknown) {
  return createMockApiRequest({
    path: `/api/intelligence/workspaces/${WORKSPACE_UUID}/flags/analyse`,
    body: body as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/intelligence/workspaces/:id/flags/analyse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const request = buildRequest({ flag_ids: [FLAG_UUID_1] });
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await analysePOST(request, { params });

    expect(response.status).toBe(401);
    expect(analyseFeedFlagsMock).not.toHaveBeenCalled();
  });

  it('returns 403 when user is viewer', async () => {
    configureRole(mockSupabase, 'viewer');

    const request = buildRequest({ flag_ids: [FLAG_UUID_1] });
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await analysePOST(request, { params });

    expect(response.status).toBe(403);
    expect(analyseFeedFlagsMock).not.toHaveBeenCalled();
  });

  it('returns 403 when editor cannot access the workspace', async () => {
    configureRole(mockSupabase, 'editor');
    // Workspace lookup returns null → forbidden.
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const request = buildRequest({ flag_ids: [FLAG_UUID_1] });
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await analysePOST(request, { params });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/not found|access/i);
    expect(analyseFeedFlagsMock).not.toHaveBeenCalled();
  });

  it('returns 400 when body omits both flag_ids and filter', async () => {
    configureRole(mockSupabase, 'admin');

    const request = buildRequest({});
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await analysePOST(request, { params });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(analyseFeedFlagsMock).not.toHaveBeenCalled();
  });

  it('returns 200 with the analysis on the flag_ids happy path', async () => {
    configureHappyChain('editor');
    analyseFeedFlagsMock.mockResolvedValueOnce(ANALYSIS_RESULT);

    const request = buildRequest({ flag_ids: [FLAG_UUID_1, FLAG_UUID_2] });
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await analysePOST(request, { params });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary).toBe(ANALYSIS_RESULT.summary);
    expect(body.analysedFlagCount).toBe(1);

    // Analyser received mapped flags + company context + current prompt.
    expect(analyseFeedFlagsMock).toHaveBeenCalledTimes(1);
    const [input] = analyseFeedFlagsMock.mock.calls[0];
    expect(input.currentPromptText).toBe(PROMPT_ROW.prompt_text);
    expect(input.companyContext.name).toBe(PROFILE_ROW.name);
    expect(input.flags).toHaveLength(1);
    expect(input.flags[0].articleTitle).toBe('New cyber regulations');
    expect(input.flags[0].sourceName).toBe('Gov.uk');

    // The `.in('id', ...)` filter should have been applied.
    const inCalls = (mockSupabase._chain.in.mock.calls as unknown[][]).map(
      (c) => [c[0], c[1]],
    );
    const idCall = inCalls.find(([col]) => col === 'id');
    expect(idCall?.[1]).toEqual([FLAG_UUID_1, FLAG_UUID_2]);
  });

  it('returns 200 with the analysis on the filter happy path', async () => {
    configureHappyChain('admin');
    analyseFeedFlagsMock.mockResolvedValueOnce(ANALYSIS_RESULT);

    const request = buildRequest({
      filter: { resolved: false, flag_type: 'false_positive' },
    });
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await analysePOST(request, { params });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary).toBe(ANALYSIS_RESULT.summary);

    // Filter should have been translated into .eq() calls.
    const eqCalls = (mockSupabase._chain.eq.mock.calls as unknown[][]).map(
      (c) => [c[0], c[1]],
    );
    expect(eqCalls).toEqual(
      expect.arrayContaining([
        ['feed_articles.workspace_id', WORKSPACE_UUID],
        ['resolved', false],
        ['flag_type', 'false_positive'],
      ]),
    );
  });

  it('returns 200 with the zero-flags analyser result', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.maybeSingle
      .mockResolvedValueOnce({ data: WORKSPACE_ROW, error: null })
      .mockResolvedValueOnce({ data: PROMPT_ROW, error: null })
      .mockResolvedValueOnce({ data: PROFILE_ROW, error: null });
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const emptyResult = {
      ...ANALYSIS_RESULT,
      summary: 'No unresolved flags to analyse.',
      falsePositivePatterns: [],
      recommendations: [],
      analysedFlagCount: 0,
      truncated: false,
    };
    analyseFeedFlagsMock.mockResolvedValueOnce(emptyResult);

    const request = buildRequest({ filter: { resolved: false } });
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await analysePOST(request, { params });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.analysedFlagCount).toBe(0);
    expect(body.falsePositivePatterns).toEqual([]);

    const [input] = analyseFeedFlagsMock.mock.calls[0];
    expect(input.flags).toEqual([]);
  });

  it('returns a structured 500 when analyseFeedFlags throws', async () => {
    configureHappyChain('admin');
    analyseFeedFlagsMock.mockRejectedValueOnce(
      new Error('Claude API exploded — do not leak this string'),
    );

    const request = buildRequest({ flag_ids: [FLAG_UUID_1] });
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await analysePOST(request, { params });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: expect.any(String) });
    // Raw error text must NOT leak to the client.
    expect(body.error).not.toMatch(/exploded/i);
    expect(body.error).not.toMatch(/do not leak/i);
  });
});

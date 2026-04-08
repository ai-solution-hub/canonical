/**
 * API route tests for GET /api/intelligence/workspaces/:id/flags
 *
 * Covers: auth (unauth, editor, admin), empty result, filtered by flag_type,
 * joined fields present in the response shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../../../helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '../../../../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
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

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks
// ---------------------------------------------------------------------------

import { GET as flagsGET } from '@/app/api/intelligence/workspaces/[id]/flags/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const MOCK_FLAG_ROW = {
  id: 'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f8a',
  feed_article_id: 'c3d4e5f6-a7b8-4c9d-9e1f-2a3b4c5d6e7f',
  flag_type: 'false_positive',
  flagged_by: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  notes: 'Not relevant to our sector',
  resolved: false,
  resolved_at: null,
  resolved_by: null,
  resolved_notes: null,
  resolution_type: null,
  prompt_version_id: null,
  created_at: '2026-03-15T12:00:00Z',
  feed_articles: {
    workspace_id: WORKSPACE_UUID,
    title: 'New cybersecurity regulations announced',
    external_url: 'https://www.gov.uk/guidance/cyber-2026',
    relevance_score: 0.85,
    relevance_reasoning: 'Directly relevant to security compliance domain',
    relevance_category: 'high',
    passed: true,
    feed_sources: { name: 'Gov.uk Security' },
  },
};

const MOCK_FN_FLAG_ROW = {
  ...MOCK_FLAG_ROW,
  id: 'e5f6a7b8-c9d0-4e1f-9a3b-4c5d6e7f8a9b',
  flag_type: 'false_negative',
  notes: 'This should have passed the filter',
  feed_articles: {
    ...MOCK_FLAG_ROW.feed_articles,
    title: 'KCSIE update for academies',
    relevance_score: 0.42,
    relevance_category: 'low',
    passed: false,
  },
};

function resetMocks() {
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/intelligence/workspaces/:id/flags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/flags`,
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await flagsGET(request, { params });

    expect(response.status).toBe(401);
  });

  it('returns 403 when user is viewer', async () => {
    configureRole(mockSupabase, 'viewer');

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/flags`,
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await flagsGET(request, { params });

    expect(response.status).toBe(403);
  });

  it('returns flags with flattened joined fields for admin', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [MOCK_FLAG_ROW], error: null, count: 1 }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/flags`,
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await flagsGET(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: MOCK_FLAG_ROW.id,
      feed_article_id: MOCK_FLAG_ROW.feed_article_id,
      flag_type: 'false_positive',
      article_title: 'New cybersecurity regulations announced',
      article_external_url: 'https://www.gov.uk/guidance/cyber-2026',
      article_relevance_score: 0.85,
      article_relevance_category: 'high',
      article_passed: true,
      source_name: 'Gov.uk Security',
    });
    // The nested feed_articles object should NOT leak to the response
    expect(body[0].feed_articles).toBeUndefined();
  });

  it('returns flags for editor role too', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [MOCK_FLAG_ROW], error: null, count: 1 }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/flags`,
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await flagsGET(request, { params });

    expect(response.status).toBe(200);
  });

  it('returns empty array (200) when no flags exist', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/flags`,
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await flagsGET(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([]);
  });

  it('defaults to resolved=false when no query param supplied', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [MOCK_FLAG_ROW], error: null, count: 1 }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/flags`,
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    await flagsGET(request, { params });

    // The .eq('resolved', ...) call should have been made with false
    const eqCalls = (mockSupabase._chain.eq.mock.calls as unknown[][]).map(
      (c) => [c[0], c[1]],
    );
    const resolvedCall = eqCalls.find(([col]) => col === 'resolved');
    expect(resolvedCall?.[1]).toBe(false);
  });

  it('honours ?resolved=true query param', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/flags`,
      { searchParams: { resolved: 'true' } },
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await flagsGET(request, { params });

    expect(response.status).toBe(200);
    const eqCalls = (mockSupabase._chain.eq.mock.calls as unknown[][]).map(
      (c) => [c[0], c[1]],
    );
    const resolvedCall = eqCalls.find(([col]) => col === 'resolved');
    expect(resolvedCall?.[1]).toBe(true);
  });

  it('filters by flag_type when supplied', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [MOCK_FN_FLAG_ROW], error: null, count: 1 }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/flags`,
      { searchParams: { flag_type: 'false_negative' } },
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await flagsGET(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].flag_type).toBe('false_negative');

    const eqCalls = (mockSupabase._chain.eq.mock.calls as unknown[][]).map(
      (c) => [c[0], c[1]],
    );
    const flagTypeCall = eqCalls.find(([col]) => col === 'flag_type');
    expect(flagTypeCall?.[1]).toBe('false_negative');
  });

  it('returns 400 when flag_type is invalid', async () => {
    configureRole(mockSupabase, 'admin');

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/flags`,
      { searchParams: { flag_type: 'bogus' } },
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await flagsGET(request, { params });

    expect(response.status).toBe(400);
  });

  it('returns 500 when the Supabase query errors', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { message: 'DB down', code: 'PGRST000' },
          count: null,
        }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/flags`,
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await flagsGET(request, { params });

    expect(response.status).toBe(500);
  });
});

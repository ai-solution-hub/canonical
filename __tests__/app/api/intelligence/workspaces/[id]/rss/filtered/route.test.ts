/**
 * API route tests for the filtered (near-miss) RSS feed.
 *
 * Route tested:
 *   GET /api/intelligence/workspaces/:id/rss/filtered — near-miss articles feed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '@/__tests__/helpers/mock-next';

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
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { GET as filteredGET } from '@/app/api/intelligence/workspaces/[id]/rss/filtered/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const MOCK_WORKSPACE = {
  id: WORKSPACE_ID,
  name: 'Education Watch',
  description: 'Monitoring education sector intelligence',
  type: 'intelligence',
};

const MOCK_ARTICLE = {
  id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  title: 'New KCSIE Guidance 2025',
  external_url: 'https://www.gov.uk/kcsie-2025',
  ai_summary: 'Updated safeguarding guidance for schools.',
  relevance_reasoning: 'Directly relevant to safeguarding sector.',
  relevance_score: 0.92,
  matched_categories: ['safeguarding', 'education'],
  published_at: '2025-04-01T10:00:00Z',
  ingested_at: '2025-04-01T12:00:00Z',
  feed_sources: { name: 'GOV.UK' },
};

const MOCK_FILTERED_ARTICLE = {
  ...MOCK_ARTICLE,
  id: 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f',
  title: 'General Education News',
  relevance_score: 0.45,
  ai_summary: null,
  relevance_reasoning: 'Marginally relevant — general sector news.',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function configureWorkspaceFound() {
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: MOCK_WORKSPACE,
    error: null,
  });
}

function configureWorkspaceNotFound() {
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: null,
    error: { message: 'Not found', code: 'PGRST116' },
  });
}

function configureArticles(articles: unknown[]) {
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({ data: articles, error: null, count: articles.length }),
  );
}

// ---------------------------------------------------------------------------
// Tests: Filtered (near-miss) articles feed
// ---------------------------------------------------------------------------

describe('GET /api/intelligence/workspaces/:id/rss/filtered', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );
  });

  it('returns 200 with application/rss+xml Content-Type', async () => {
    configureWorkspaceFound();
    configureArticles([MOCK_FILTERED_ARTICLE]);

    const req = createTestRequest(
      '/api/intelligence/workspaces/' + WORKSPACE_ID + '/rss/filtered',
    );
    const res = await filteredGET(req, {
      params: createTestParams({ id: WORKSPACE_ID }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/rss+xml; charset=utf-8',
    );
  });

  it('includes "Near Misses" in channel title', async () => {
    configureWorkspaceFound();
    configureArticles([]);

    const req = createTestRequest(
      '/api/intelligence/workspaces/' + WORKSPACE_ID + '/rss/filtered',
    );
    const res = await filteredGET(req, {
      params: createTestParams({ id: WORKSPACE_ID }),
    });
    const body = await res.text();

    expect(body).toContain('Filtered Articles (Near Misses)');
  });

  it('describes feed purpose in channel description', async () => {
    configureWorkspaceFound();
    configureArticles([]);

    const req = createTestRequest(
      '/api/intelligence/workspaces/' + WORKSPACE_ID + '/rss/filtered',
    );
    const res = await filteredGET(req, {
      params: createTestParams({ id: WORKSPACE_ID }),
    });
    const body = await res.text();

    expect(body).toContain('false negatives');
  });

  // NOTE — passed=false filter + relevance_score DESC ordering + default
  // 20-row limit for near-misses are route-handler invariants migrated to
  // W-RD' integration coverage. See remediation-plan.md §3.5.

  it('returns 404 for non-existent workspace', async () => {
    configureWorkspaceNotFound();

    const req = createTestRequest(
      '/api/intelligence/workspaces/nonexistent/rss/filtered',
    );
    const res = await filteredGET(req, {
      params: createTestParams({ id: 'nonexistent' }),
    });

    expect(res.status).toBe(404);
  });

  it('caches the feed for 15 minutes via Cache-Control headers', async () => {
    configureWorkspaceFound();
    configureArticles([]);

    const req = createTestRequest(
      '/api/intelligence/workspaces/' + WORKSPACE_ID + '/rss/filtered',
    );
    const res = await filteredGET(req, {
      params: createTestParams({ id: WORKSPACE_ID }),
    });

    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=900, s-maxage=900',
    );
  });
});

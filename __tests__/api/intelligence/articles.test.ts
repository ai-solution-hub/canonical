/**
 * API route tests for intelligence article list and flagging endpoints.
 *
 * Routes tested:
 *   GET    /api/intelligence/workspaces/:id/articles                    — list articles
 *   POST   /api/intelligence/workspaces/:id/articles/:articleId/flag    — create flag
 *   GET    /api/intelligence/workspaces/:id/articles/:articleId/flag    — list flags
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../../helpers/mock-next';

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

import { GET as listGET } from '@/app/api/intelligence/workspaces/[id]/articles/route';
import {
  POST as flagPOST,
  GET as flagGET,
} from '@/app/api/intelligence/workspaces/[id]/articles/[articleId]/flag/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const ARTICLE_UUID = 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f';
const FLAG_UUID = 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a';

const MOCK_ARTICLE = {
  id: ARTICLE_UUID,
  title: 'New cybersecurity regulations announced',
  external_url: 'https://www.gov.uk/guidance/cyber-2026',
  relevance_score: 0.85,
  relevance_category: 'high',
  relevance_reasoning: 'Directly relevant to security compliance domain',
  ai_summary: 'The government has announced new cybersecurity regulations.',
  ingested_at: '2026-03-15T10:00:00Z',
  published_at: '2026-03-14T09:00:00Z',
  content_item_id: null,
  passed: true,
  feed_sources: { name: 'Gov.uk Security' },
  feed_flags: [],
};

const MOCK_FILTERED_ARTICLE = {
  ...MOCK_ARTICLE,
  id: 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b',
  relevance_score: 0.45,
  relevance_category: 'low',
  passed: false,
};

const MOCK_FLAG = {
  id: FLAG_UUID,
  feed_article_id: ARTICLE_UUID,
  flag_type: 'false_positive',
  flagged_by: 'test-user-id',
  notes: 'Not relevant to our sector',
  resolved: false,
  resolved_at: null,
  resolved_by: null,
  resolved_notes: null,
  resolution_type: null,
  prompt_version_id: null,
  created_at: '2026-03-15T12:00:00Z',
};

function resetMocks() {
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Intelligence Articles API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  // ─── GET /api/intelligence/workspaces/:id/articles ───

  describe('GET /api/intelligence/workspaces/:id/articles', () => {
    it('returns paginated articles for passed tab', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [MOCK_ARTICLE], error: null, count: 1 }),
      );

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/articles`,
        { searchParams: { tab: 'passed' } },
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listGET(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.articles).toHaveLength(1);
      expect(body.articles[0].title).toBe('New cybersecurity regulations announced');
      expect(body.articles[0].source_name).toBe('Gov.uk Security');
      expect(body.articles[0].flag_count).toBe(0);
      expect(body.total).toBe(1);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(20);
    });

    it('returns articles for filtered tab ordered by relevance_score DESC', async () => {
      configureRole(mockSupabase, 'editor');
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [MOCK_FILTERED_ARTICLE], error: null, count: 1 }),
      );

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/articles`,
        { searchParams: { tab: 'filtered' } },
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listGET(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.articles).toHaveLength(1);
      expect(body.articles[0].passed).toBe(false);
      // Verify the order method was called with relevance_score descending
      expect(mockSupabase._chain.order).toHaveBeenCalledWith(
        'relevance_score',
        { ascending: false },
      );
    });

    it('respects source_id filter', async () => {
      configureRole(mockSupabase, 'admin');
      const sourceId = 'f6a7b8c9-d0e1-4f2a-ab4c-5d6e7f8a9b0c';
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null, count: 0 }),
      );

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/articles`,
        { searchParams: { tab: 'passed', source_id: sourceId } },
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      await listGET(request, { params });

      // Should have called eq with feed_source_id filter (among other eq calls)
      const eqCalls = mockSupabase._chain.eq.mock.calls;
      const hasSourceFilter = eqCalls.some(
        (call: unknown[]) => call[0] === 'feed_source_id' && call[1] === sourceId,
      );
      expect(hasSourceFilter).toBe(true);
    });

    it('returns 400 for invalid tab parameter', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/articles`,
        { searchParams: { tab: 'invalid' } },
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listGET(request, { params });

      expect(response.status).toBe(400);
    });

    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/articles`,
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listGET(request, { params });

      expect(response.status).toBe(401);
    });

    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/articles`,
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listGET(request, { params });

      expect(response.status).toBe(403);
    });

    it('defaults to page 1, limit 20', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null, count: 0 }),
      );

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/articles`,
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listGET(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(20);
      // range should be called with (0, 19) for first page of 20
      expect(mockSupabase._chain.range).toHaveBeenCalledWith(0, 19);
    });
  });

  // ─── POST /api/intelligence/workspaces/:id/articles/:articleId/flag ───

  describe('POST /api/intelligence/workspaces/:id/articles/:articleId/flag', () => {
    it('creates a flag for an article', async () => {
      configureRole(mockSupabase, 'admin');
      // Article lookup
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: ARTICLE_UUID, prompt_version_id: null },
        error: null,
      });
      // Flag insert
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_FLAG,
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/articles/${ARTICLE_UUID}/flag`,
        {
          method: 'POST',
          body: { flag_type: 'false_positive', notes: 'Not relevant to our sector' },
        },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        articleId: ARTICLE_UUID,
      });
      const response = await flagPOST(request, { params });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.flag_type).toBe('false_positive');
      expect(body.notes).toBe('Not relevant to our sector');
    });

    it('validates flag_type enum', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/articles/${ARTICLE_UUID}/flag`,
        {
          method: 'POST',
          body: { flag_type: 'invalid_type' },
        },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        articleId: ARTICLE_UUID,
      });
      const response = await flagPOST(request, { params });

      expect(response.status).toBe(400);
    });

    it('returns 404 when article not found', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'not found' },
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/articles/${ARTICLE_UUID}/flag`,
        {
          method: 'POST',
          body: { flag_type: 'false_positive' },
        },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        articleId: ARTICLE_UUID,
      });
      const response = await flagPOST(request, { params });

      expect(response.status).toBe(404);
    });

    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/articles/${ARTICLE_UUID}/flag`,
        {
          method: 'POST',
          body: { flag_type: 'false_positive' },
        },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        articleId: ARTICLE_UUID,
      });
      const response = await flagPOST(request, { params });

      expect(response.status).toBe(401);
    });

    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/articles/${ARTICLE_UUID}/flag`,
        {
          method: 'POST',
          body: { flag_type: 'false_positive' },
        },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        articleId: ARTICLE_UUID,
      });
      const response = await flagPOST(request, { params });

      expect(response.status).toBe(403);
    });
  });

  // ─── GET /api/intelligence/workspaces/:id/articles/:articleId/flag ───

  describe('GET /api/intelligence/workspaces/:id/articles/:articleId/flag', () => {
    it('returns flags for an article', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [MOCK_FLAG], error: null }),
      );

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/articles/${ARTICLE_UUID}/flag`,
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        articleId: ARTICLE_UUID,
      });
      const response = await flagGET(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].flag_type).toBe('false_positive');
    });

    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/articles/${ARTICLE_UUID}/flag`,
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        articleId: ARTICLE_UUID,
      });
      const response = await flagGET(request, { params });

      expect(response.status).toBe(401);
    });
  });
});

/**
 * API route tests for intelligence feed source CRUD endpoints.
 *
 * Routes tested:
 *   GET    /api/intelligence/workspaces/:id/sources              — list sources
 *   POST   /api/intelligence/workspaces/:id/sources              — create source
 *   GET    /api/intelligence/workspaces/:id/sources/:sourceId    — get single source
 *   PATCH  /api/intelligence/workspaces/:id/sources/:sourceId    — update source
 *   DELETE /api/intelligence/workspaces/:id/sources/:sourceId    — soft/hard delete
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

vi.mock('@/lib/intelligence/feed-poller', () => ({
  validateFeedUrl: vi
    .fn()
    .mockResolvedValue({ valid: true, title: 'Test Feed', articleCount: 10 }),
}));

// S222 W3-A §2.3.4 D-4: FeedSourceCreateSchema now `.superRefine`s on
// `source_type='web'` rows by calling `validateWebUrl` (HEAD pre-flight).
// Stub it to a no-op resolve so the schema's async refinement passes
// without making a real network call in jsdom.
vi.mock('@/lib/intelligence/url-validation', () => ({
  validateWebUrl: vi.fn().mockResolvedValue(undefined),
  USER_AGENT: 'KnowledgeHub/1.0',
  HTML_CONTENT_TYPES: ['text/html', 'application/xhtml+xml'],
}));

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks
// ---------------------------------------------------------------------------

import {
  GET as listGET,
  POST as listPOST,
} from '@/app/api/intelligence/workspaces/[id]/sources/route';
import {
  GET as detailGET,
  PATCH as detailPATCH,
  DELETE as detailDELETE,
} from '@/app/api/intelligence/workspaces/[id]/sources/[sourceId]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const SOURCE_UUID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

const MOCK_SOURCE = {
  id: SOURCE_UUID,
  workspace_id: WORKSPACE_UUID,
  name: 'Gov.uk Education Feed',
  url: 'https://www.gov.uk/search/news-and-communications.atom',
  source_type: 'rss',
  polling_interval_minutes: 30,
  is_active: true,
  last_polled_at: null,
  last_polled_status: null,
  consecutive_failures: 0,
  etag: null,
  last_modified: null,
  created_by: 'test-user-id',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const VALID_SOURCE_INPUT = {
  name: 'Gov.uk Education Feed',
  url: 'https://www.gov.uk/search/news-and-communications.atom',
  source_type: 'rss',
  polling_interval_minutes: 30,
};

const MOCK_WORKSPACE = {
  id: WORKSPACE_UUID,
  type: 'intelligence',
  is_archived: false,
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
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Intelligence Feed Sources API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  // ─── GET /api/intelligence/workspaces/:id/sources ───

  describe('GET /api/intelligence/workspaces/:id/sources', () => {
    it('returns sources list for admin', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [MOCK_SOURCE], error: null }),
      );

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listGET(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Gov.uk Education Feed');
    });

    it('returns empty array when no sources', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      );

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listGET(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual([]);
    });

    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listGET(request, { params });

      expect(response.status).toBe(401);
    });

    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listGET(request, { params });

      expect(response.status).toBe(403);
    });
  });

  // ─── POST /api/intelligence/workspaces/:id/sources ───

  describe('POST /api/intelligence/workspaces/:id/sources', () => {
    it('creates source with valid data', async () => {
      configureRole(mockSupabase, 'admin');
      // Workspace verification
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_WORKSPACE,
        error: null,
      });
      // Source insert
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_SOURCE,
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
        { method: 'POST', body: VALID_SOURCE_INPUT },
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listPOST(request, { params });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.name).toBe('Gov.uk Education Feed');
    });

    it('rejects missing required fields', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
        { method: 'POST', body: { name: 'Test' } },
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listPOST(request, { params });

      expect(response.status).toBe(400);
    });

    it('rejects invalid URL', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
        { method: 'POST', body: { ...VALID_SOURCE_INPUT, url: 'not-a-url' } },
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listPOST(request, { params });

      expect(response.status).toBe(400);
    });

    it('returns 404 when workspace not found', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'not found' },
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
        { method: 'POST', body: VALID_SOURCE_INPUT },
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listPOST(request, { params });

      expect(response.status).toBe(404);
    });

    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
        { method: 'POST', body: VALID_SOURCE_INPUT },
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listPOST(request, { params });

      expect(response.status).toBe(401);
    });
  });

  // ─── POST web source 360-min default (P0-WEB / WP3C) ───

  describe('POST web source polling interval default (WP3C)', () => {
    it('defaults web sources to a 360-minute polling interval when none is supplied (T15)', async () => {
      configureRole(mockSupabase, 'admin');
      // Workspace verification
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_WORKSPACE,
        error: null,
      });
      // Source insert
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          ...MOCK_SOURCE,
          source_type: 'web',
          polling_interval_minutes: 360,
        },
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
        {
          method: 'POST',
          body: {
            name: 'Company Website',
            url: 'https://example.com/page',
            source_type: 'web',
            // polling_interval_minutes intentionally omitted
          },
        },
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listPOST(request, { params });

      expect(response.status).toBe(201);

      // Verify the insert call included polling_interval_minutes: 360
      const insertCall = mockSupabase._chain.insert.mock.calls.find(
        (call: unknown[]) => {
          const arg = call[0] as Record<string, unknown>;
          return arg.source_type === 'web';
        },
      );
      expect(insertCall).toBeDefined();
      expect(
        (insertCall![0] as Record<string, unknown>).polling_interval_minutes,
      ).toBe(360);
    });

    it('respects explicit polling_interval_minutes for web source (T16)', async () => {
      configureRole(mockSupabase, 'admin');
      // Workspace verification
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_WORKSPACE,
        error: null,
      });
      // Source insert
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          ...MOCK_SOURCE,
          source_type: 'web',
          polling_interval_minutes: 120,
        },
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
        {
          method: 'POST',
          body: {
            name: 'Company Website',
            url: 'https://example.com/page',
            source_type: 'web',
            polling_interval_minutes: 120,
          },
        },
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listPOST(request, { params });

      expect(response.status).toBe(201);

      // Verify the insert call used the explicit 120, NOT the 360 default
      const insertCall = mockSupabase._chain.insert.mock.calls.find(
        (call: unknown[]) => {
          const arg = call[0] as Record<string, unknown>;
          return arg.source_type === 'web';
        },
      );
      expect(insertCall).toBeDefined();
      // The 360 default only applies when raw body omits polling_interval_minutes.
      // With explicit 120, the route handler preserves it (Zod schema + raw check).
      expect(
        (insertCall![0] as Record<string, unknown>).polling_interval_minutes,
      ).toBe(120);
    });

    it('does NOT apply 360-min default for RSS source (T17)', async () => {
      configureRole(mockSupabase, 'admin');
      // Workspace verification
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_WORKSPACE,
        error: null,
      });
      // Source insert
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_SOURCE,
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
        {
          method: 'POST',
          body: {
            name: 'Gov.uk Education Feed',
            url: 'https://www.gov.uk/search/news-and-communications.atom',
            source_type: 'rss',
            // No polling_interval_minutes — RSS uses Zod default (30)
          },
        },
      );
      const params = createTestParams({ id: WORKSPACE_UUID });
      const response = await listPOST(request, { params });

      expect(response.status).toBe(201);

      // For RSS, the insert should NOT contain polling_interval_minutes: 360
      // It takes the RSS code path (validateFeedUrl) which passes parsed.data through
      const insertCall = mockSupabase._chain.insert.mock.calls.find(
        (call: unknown[]) => {
          const arg = call[0] as Record<string, unknown>;
          return arg.source_type === 'rss' || !arg.source_type;
        },
      );
      expect(insertCall).toBeDefined();
      const insertPayload = insertCall![0] as Record<string, unknown>;
      // RSS path uses parsed.data.polling_interval_minutes (Zod default: 30)
      expect(insertPayload.polling_interval_minutes).not.toBe(360);
    });
  });

  // ─── GET /api/intelligence/workspaces/:id/sources/:sourceId ───

  describe('GET /api/intelligence/workspaces/:id/sources/:sourceId', () => {
    it('returns a single source', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_SOURCE,
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}`,
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        sourceId: SOURCE_UUID,
      });
      const response = await detailGET(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.name).toBe('Gov.uk Education Feed');
    });

    it('returns 404 for non-existent source', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'not found' },
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}`,
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        sourceId: SOURCE_UUID,
      });
      const response = await detailGET(request, { params });

      expect(response.status).toBe(404);
    });
  });

  // ─── PATCH /api/intelligence/workspaces/:id/sources/:sourceId ───

  describe('PATCH /api/intelligence/workspaces/:id/sources/:sourceId', () => {
    it('updates source with valid data', async () => {
      configureRole(mockSupabase, 'editor');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { ...MOCK_SOURCE, name: 'Updated Feed' },
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}`,
        { method: 'PATCH', body: { name: 'Updated Feed' } },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        sourceId: SOURCE_UUID,
      });
      const response = await detailPATCH(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.name).toBe('Updated Feed');
    });

    it('returns 404 for non-existent source', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}`,
        { method: 'PATCH', body: { name: 'Updated' } },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        sourceId: SOURCE_UUID,
      });
      const response = await detailPATCH(request, { params });

      expect(response.status).toBe(404);
    });
  });

  // ─── PATCH consecutive_failures reset (P0-WEB / WP3C) ───

  describe('PATCH consecutive_failures reset on re-enable (WP3C)', () => {
    it('resets consecutive_failures to 0 when re-enabling a disabled source (T18)', async () => {
      configureRole(mockSupabase, 'admin');
      // Lookup: source is currently inactive
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { is_active: false },
        error: null,
      });
      // Update result
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { ...MOCK_SOURCE, is_active: true, consecutive_failures: 0 },
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}`,
        { method: 'PATCH', body: { is_active: true } },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        sourceId: SOURCE_UUID,
      });
      const response = await detailPATCH(request, { params });
      expect(response.status).toBe(200);

      // Verify the update payload included consecutive_failures: 0
      const updateCall = mockSupabase._chain.update.mock.calls;
      expect(updateCall.length).toBeGreaterThan(0);
      const lastUpdatePayload = updateCall[updateCall.length - 1][0] as Record<
        string,
        unknown
      >;
      expect(lastUpdatePayload.consecutive_failures).toBe(0);
    });

    it('does NOT reset consecutive_failures when source is already active (T19)', async () => {
      configureRole(mockSupabase, 'admin');
      // Lookup: source is currently ACTIVE (no transition)
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { is_active: true },
        error: null,
      });
      // Update result
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { ...MOCK_SOURCE, is_active: true },
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}`,
        { method: 'PATCH', body: { is_active: true } },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        sourceId: SOURCE_UUID,
      });
      const response = await detailPATCH(request, { params });
      expect(response.status).toBe(200);

      // The update payload should NOT include consecutive_failures
      const updateCall = mockSupabase._chain.update.mock.calls;
      const lastUpdatePayload = updateCall[updateCall.length - 1][0] as Record<
        string,
        unknown
      >;
      expect(lastUpdatePayload).not.toHaveProperty('consecutive_failures');
    });

    it('does NOT reset consecutive_failures when deactivating a source (T20)', async () => {
      configureRole(mockSupabase, 'admin');
      // No lookup happens because raw.is_active is false, not true
      // Update result
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { ...MOCK_SOURCE, is_active: false },
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}`,
        { method: 'PATCH', body: { is_active: false } },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        sourceId: SOURCE_UUID,
      });
      const response = await detailPATCH(request, { params });
      expect(response.status).toBe(200);

      // The update payload should NOT include consecutive_failures
      const updateCall = mockSupabase._chain.update.mock.calls;
      const lastUpdatePayload = updateCall[updateCall.length - 1][0] as Record<
        string,
        unknown
      >;
      expect(lastUpdatePayload).not.toHaveProperty('consecutive_failures');
    });
  });

  // ─── DELETE /api/intelligence/workspaces/:id/sources/:sourceId ───

  describe('DELETE /api/intelligence/workspaces/:id/sources/:sourceId', () => {
    it('soft-deletes source for admin', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { ...MOCK_SOURCE, is_active: false },
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}`,
        { method: 'DELETE' },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        sourceId: SOURCE_UUID,
      });
      const response = await detailDELETE(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.action).toBe('archived');
    });

    it('hard-deletes source with confirm param', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      );

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}`,
        { method: 'DELETE', searchParams: { confirm: 'hard_delete' } },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        sourceId: SOURCE_UUID,
      });
      const response = await detailDELETE(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.action).toBe('hard_delete');
    });

    it('returns 403 for editor role (admin only)', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}`,
        { method: 'DELETE' },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        sourceId: SOURCE_UUID,
      });
      const response = await detailDELETE(request, { params });

      expect(response.status).toBe(403);
    });

    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}`,
        { method: 'DELETE' },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        sourceId: SOURCE_UUID,
      });
      const response = await detailDELETE(request, { params });

      expect(response.status).toBe(401);
    });

    it('returns 404 for non-existent source on soft delete', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}`,
        { method: 'DELETE' },
      );
      const params = createTestParams({
        id: WORKSPACE_UUID,
        sourceId: SOURCE_UUID,
      });
      const response = await detailDELETE(request, { params });

      expect(response.status).toBe(404);
    });
  });
});

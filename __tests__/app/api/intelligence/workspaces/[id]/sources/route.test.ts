/**
 * API route tests for the intelligence feed-source collection endpoint.
 *
 * Route: GET  /api/intelligence/workspaces/:id/sources — list sources
 *        POST /api/intelligence/workspaces/:id/sources — create source
 *
 * Covers list/create CRUD, the WP3C web-source polling-interval default, and
 * the S222 W3-A §2.3.4 AC-11 pre-insert `validateWebUrl` refinement (D-4).
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

// The collection route calls `validateFeedUrl` on the RSS path only. Use
// vi.hoisted per CLAUDE.md gotcha — vi.mock is hoisted, but plain const
// declarations are not, so the factory closure reads `undefined` for the
// mock fns at module-evaluation time.
const { mockValidateFeedUrl } = vi.hoisted(() => ({
  mockValidateFeedUrl: vi.fn(),
}));
vi.mock('@/lib/intelligence/feed-poller', () => ({
  validateFeedUrl: (...args: unknown[]) => mockValidateFeedUrl(...args),
}));

// S222 W3-A §2.3.4 D-4: FeedSourceCreateSchema `.superRefine`s on
// `source_type='web'` rows by calling `validateWebUrl` (HEAD pre-flight).
// Mock it so the schema's async refinement is controllable per-test:
// resolving = valid URL, rejecting = invalid, and no real network call is
// made in jsdom.
const { mockValidateWebUrl } = vi.hoisted(() => ({
  mockValidateWebUrl: vi.fn(),
}));
vi.mock('@/lib/intelligence/url-validation', () => ({
  validateWebUrl: (...args: unknown[]) => mockValidateWebUrl(...args),
  USER_AGENT: 'KnowledgeHub/1.0',
  HTML_CONTENT_TYPES: ['text/html', 'application/xhtml+xml'],
}));

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks
// ---------------------------------------------------------------------------

import {
  GET,
  POST,
} from '@/app/api/intelligence/workspaces/[id]/sources/route';

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
  // `vi.clearAllMocks()` only resets recorded calls — `mockResolvedValueOnce`
  // queues survive across tests and leak (the AC-11 rejection case queues a
  // workspace row that its own request never consumes, because the schema
  // refinement rejects before the workspace lookup runs). Targeted
  // `mockReset` on the mocks we queue against drains their per-test queues
  // without nuking the chainable infrastructure (which `vi.resetAllMocks()`
  // would, since chainable methods rely on their `.mockReturnValue(chain)`
  // setup).
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.then.mockReset();
  mockSupabase.auth.getUser.mockReset();
  mockValidateFeedUrl.mockReset();
  mockValidateWebUrl.mockReset();

  // Restore default behaviours after the targeted reset.
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
  mockValidateFeedUrl.mockResolvedValue({
    valid: true,
    title: 'Test Feed',
    articleCount: 10,
  });
  mockValidateWebUrl.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetMocks();
});

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
    const response = await GET(request, { params });
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
    const response = await GET(request, { params });
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
    const response = await GET(request, { params });

    expect(response.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await GET(request, { params });

    expect(response.status).toBe(403);
  });
});

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
    const response = await POST(request, { params });
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
    const response = await POST(request, { params });

    expect(response.status).toBe(400);
  });

  it('rejects invalid URL', async () => {
    configureRole(mockSupabase, 'admin');

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
      { method: 'POST', body: { ...VALID_SOURCE_INPUT, url: 'not-a-url' } },
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await POST(request, { params });

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
    const response = await POST(request, { params });

    expect(response.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
      { method: 'POST', body: VALID_SOURCE_INPUT },
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await POST(request, { params });

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
    const response = await POST(request, { params });

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
    const response = await POST(request, { params });

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
    const response = await POST(request, { params });

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

// ─────────────────────────────────────────────────────────────────────────────
// AC-11: sources POST with malformed web URL → 400 from validateWebUrl
// pre-insert refinement (D-4 ratified)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-11 sources POST with source_type=web + malformed URL → 400 from pre-insert validateWebUrl', () => {
  it('returns 400 with field-level error when validateWebUrl rejects (e.g. 404 / non-HTML)', async () => {
    configureRole(mockSupabase, 'admin');
    // Workspace lookup succeeds (intelligence type)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: WORKSPACE_UUID, type: 'intelligence' },
      error: null,
    });

    // validateWebUrl rejects — simulates a 404 / non-HTML response.
    mockValidateWebUrl.mockRejectedValueOnce(
      new Error(
        'Web URL validation failed for https://malformed.example.com/missing: HTTP 404',
      ),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
      {
        method: 'POST',
        body: {
          name: 'Bad Source',
          url: 'https://malformed.example.com/missing',
          source_type: 'web',
        },
      },
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await POST(request, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: 'Validation failed',
    });
    // Field-level error attached to the `url` field per the schema
    // refinement's `path: ['url']`.
    const urlIssue = (body.details ?? []).find(
      (d: { field: string }) => d.field === 'url',
    );
    expect(urlIssue).toBeDefined();
    expect(urlIssue.message).toContain('HTTP 404');

    // No feed_sources insert happened (validation rejected pre-insert).
    expect(mockSupabase._chain.insert).not.toHaveBeenCalled();
  });

  it('creates a web source when validateWebUrl resolves successfully', async () => {
    configureRole(mockSupabase, 'admin');

    // Workspace lookup succeeds
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: WORKSPACE_UUID, type: 'intelligence' },
      error: null,
    });
    // validateWebUrl resolves (valid URL).
    mockValidateWebUrl.mockResolvedValueOnce(undefined);

    // Insert returns the new row.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: SOURCE_UUID,
        workspace_id: WORKSPACE_UUID,
        name: 'Good Source',
        url: 'https://good.example.com/page',
        source_type: 'web',
        polling_interval_minutes: 360,
        is_active: true,
        last_polled_at: null,
        last_polled_status: null,
        consecutive_failures: 0,
        etag: null,
        last_modified: null,
        created_by: 'test-user-id',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
      error: null,
    });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
      {
        method: 'POST',
        body: {
          name: 'Good Source',
          url: 'https://good.example.com/page',
          source_type: 'web',
        },
      },
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await POST(request, { params });

    expect(response.status).toBe(201);
    expect(mockValidateWebUrl).toHaveBeenCalledWith(
      'https://good.example.com/page',
    );
  });

  it('does NOT call validateWebUrl when source_type=rss (validateFeedUrl path is used instead)', async () => {
    configureRole(mockSupabase, 'admin');

    // Workspace lookup succeeds
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: WORKSPACE_UUID, type: 'intelligence' },
      error: null,
    });
    // validateFeedUrl returns valid (RSS path).
    mockValidateFeedUrl.mockResolvedValueOnce({
      valid: true,
      title: 'RSS Feed',
      articleCount: 5,
    });
    // Insert returns the new row.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: SOURCE_UUID,
        workspace_id: WORKSPACE_UUID,
        name: 'RSS Feed',
        url: 'https://example.com/feed.xml',
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
      },
      error: null,
    });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources`,
      {
        method: 'POST',
        body: {
          name: 'RSS Feed',
          url: 'https://example.com/feed.xml',
          source_type: 'rss',
        },
      },
    );
    const params = createTestParams({ id: WORKSPACE_UUID });
    const response = await POST(request, { params });

    expect(response.status).toBe(201);
    expect(mockValidateWebUrl).not.toHaveBeenCalled();
    expect(mockValidateFeedUrl).toHaveBeenCalled();
  });
});

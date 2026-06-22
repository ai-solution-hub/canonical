// __tests__/api/intelligence/sources-test-poll-web.test.ts
/**
 * S222 W3-A §2.3.4 — IMPL tests for AC-10 + AC-11 (route-layer surfaces).
 *
 * AC-10 (route): POST /api/intelligence/workspaces/:id/sources/:sourceId/test
 *   for `source_type='web'` returns
 *   `{ success, itemCount, sampleTitles, headPreflightStatus, firecrawlCreditsExpected, error? }`.
 *   Test endpoint must NOT increment `consecutive_failures` (admin-initiated).
 *
 * AC-11 (sources route): POST /api/intelligence/workspaces/:id/sources
 *   with `source_type='web'` + malformed URL → 400 from `validateWebUrl`
 *   pre-insert refinement (D-4 ratified).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../../helpers/mock-next';

// ─────────────────────────────────────────────────────────────────────────────
// Shared mocks
// ─────────────────────────────────────────────────────────────────────────────

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

// Mock feed-poller — pollWebSource needs to return a `WebPollResult` shape
// with `headPreflightStatus` + `firecrawlCalled` so the route's response
// shape can be asserted. Use vi.hoisted per CLAUDE.md gotcha — vi.mock is
// hoisted, but plain const declarations are not, so the factory closure
// reads `undefined` for the mock fns at module-evaluation time.
const { mockPollFeed, mockPollWebSource, mockValidateFeedUrl } = vi.hoisted(
  () => ({
    mockPollFeed: vi.fn(),
    mockPollWebSource: vi.fn(),
    mockValidateFeedUrl: vi.fn(),
  }),
);
vi.mock('@/lib/intelligence/feed-poller', () => ({
  pollFeed: (...args: unknown[]) => mockPollFeed(...args),
  pollWebSource: (...args: unknown[]) => mockPollWebSource(...args),
  validateFeedUrl: (...args: unknown[]) => mockValidateFeedUrl(...args),
}));

// Mock url-validation so the schema's `.superRefine` can be controlled
// per-test. Returning a resolved promise = valid URL; throwing = invalid.
const { mockValidateWebUrl } = vi.hoisted(() => ({
  mockValidateWebUrl: vi.fn(),
}));
vi.mock('@/lib/intelligence/url-validation', () => ({
  validateWebUrl: (...args: unknown[]) => mockValidateWebUrl(...args),
  USER_AGENT: 'KnowledgeHub/1.0',
  HTML_CONTENT_TYPES: ['text/html', 'application/xhtml+xml'],
}));

// ─────────────────────────────────────────────────────────────────────────────
// Imports AFTER mocks
// ─────────────────────────────────────────────────────────────────────────────

import { POST as testPollPost } from '@/app/api/intelligence/workspaces/[id]/sources/[sourceId]/test/route';
import { POST as sourcesPost } from '@/app/api/intelligence/workspaces/[id]/sources/route';

const WORKSPACE_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const SOURCE_UUID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

function resetMocks() {
  // `vi.clearAllMocks()` only resets recorded calls — `mockResolvedValueOnce`
  // queues survive across tests and leak (an earlier test's queued
  // workspace-row mock would consume the later test's auth-role lookup).
  // Targeted `mockReset` on the chain methods we queue against drains
  // their per-test queues without nuking the chainable infrastructure
  // (which `vi.resetAllMocks()` would, since chainable methods rely on
  // their `.mockReturnValue(chain)` setup).
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.then.mockReset();
  mockSupabase.auth.getUser.mockReset();

  // Restore default behaviours after the targeted reset.
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-10: test endpoint surfaces headPreflightStatus + firecrawlCreditsExpected
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-10 test endpoint for source_type=web surfaces HEAD result + Firecrawl-credit prediction', () => {
  it('returns headPreflightStatus + firecrawlCreditsExpected=1 on success path (HEAD-200 + Firecrawl ran)', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: SOURCE_UUID,
        url: 'https://example.com/page',
        etag: null,
        last_modified: null,
        source_type: 'web',
      },
      error: null,
    });

    mockPollWebSource.mockResolvedValueOnce({
      feedSourceId: SOURCE_UUID,
      status: 'success',
      items: [
        {
          title: 'Example Page',
          url: 'https://example.com/page',
          guid: 'https://example.com/page',
          publishedAt: '2026-05-03T11:00:00Z',
          summary: null,
          contentEncoded: '<p>x</p>',
          categories: [],
        },
      ],
      etag: '"new-etag"',
      lastModified: 'Sat, 03 May 2026 11:00:00 GMT',
      headPreflightStatus: 200,
      firecrawlCalled: true,
    });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}/test`,
      { method: 'POST' },
    );
    const params = createTestParams({
      id: WORKSPACE_UUID,
      sourceId: SOURCE_UUID,
    });
    const response = await testPollPost(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      itemCount: 1,
      sampleTitles: ['Example Page'],
      headPreflightStatus: 200,
      firecrawlCreditsExpected: 1,
    });

    // Test endpoint passed dryRun:true to pollWebSource per AC-10.
    expect(mockPollWebSource).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ dryRun: true }),
    );

    // Crucially, the test endpoint does NOT update feed_sources at all
    // (no updateSourceAfterPoll call) — so consecutive_failures is
    // untouched. The route's only DB op is a `.select(...).single()`
    // lookup on `feed_sources`; no `.update()` on `feed_sources` is
    // wired up in the test endpoint, so the chain `.update` mock has
    // zero calls.
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  it('returns headPreflightStatus=304 + firecrawlCreditsExpected=0 on HEAD-304 short-circuit', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: SOURCE_UUID,
        url: 'https://example.com/page',
        etag: '"existing"',
        last_modified: 'Fri, 02 May 2026 10:00:00 GMT',
        source_type: 'web',
      },
      error: null,
    });

    mockPollWebSource.mockResolvedValueOnce({
      feedSourceId: SOURCE_UUID,
      status: 'not_modified',
      items: [],
      etag: '"existing"',
      lastModified: 'Fri, 02 May 2026 10:00:00 GMT',
      headPreflightStatus: 304,
      firecrawlCalled: false,
    });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}/test`,
      { method: 'POST' },
    );
    const params = createTestParams({
      id: WORKSPACE_UUID,
      sourceId: SOURCE_UUID,
    });
    const response = await testPollPost(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      itemCount: 0,
      sampleTitles: [],
      headPreflightStatus: 304,
      firecrawlCreditsExpected: 0,
    });
  });

  it('returns headPreflightStatus=null + firecrawlCreditsExpected=0 on validateWebUrl failure', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: SOURCE_UUID,
        url: 'https://broken.example.com/missing',
        etag: null,
        last_modified: null,
        source_type: 'web',
      },
      error: null,
    });

    mockPollWebSource.mockResolvedValueOnce({
      feedSourceId: SOURCE_UUID,
      status: 'error',
      error:
        'Web URL validation failed for https://broken.example.com/missing: HTTP 404',
      items: [],
      etag: null,
      lastModified: null,
      headPreflightStatus: null,
      firecrawlCalled: false,
    });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}/test`,
      { method: 'POST' },
    );
    const params = createTestParams({
      id: WORKSPACE_UUID,
      sourceId: SOURCE_UUID,
    });
    const response = await testPollPost(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200); // route returns 200 with success:false envelope
    expect(body).toMatchObject({
      success: false,
      itemCount: 0,
      sampleTitles: [],
      headPreflightStatus: null,
      firecrawlCreditsExpected: 0,
    });
    expect(body.error).toContain('HTTP 404');
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
    const response = await sourcesPost(request, { params });
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
        last_status: null,
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
    const response = await sourcesPost(request, { params });

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
        last_status: null,
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
    const response = await sourcesPost(request, { params });

    expect(response.status).toBe(201);
    expect(mockValidateWebUrl).not.toHaveBeenCalled();
    expect(mockValidateFeedUrl).toHaveBeenCalled();
  });
});

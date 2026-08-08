/**
 * API route tests for the test-poll endpoint (P0-WEB / WP3C branching).
 *
 * Route: POST /api/intelligence/workspaces/:id/sources/:sourceId/test
 *
 * Tests verify source_type branching (web -> pollWebSource, rss -> pollFeed,
 * api -> 501 structured error) and, per S222 W3-A §2.3.4 AC-10, the
 * `headPreflightStatus` + `firecrawlCreditsExpected` response surface for
 * web sources — including that an admin-initiated test never touches
 * `consecutive_failures`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
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

// Mock feed-poller functions
const mockPollFeed = vi.fn();
const mockPollWebSource = vi.fn();
vi.mock('@/lib/intelligence/feed-poller', () => ({
  pollFeed: (...args: unknown[]) => mockPollFeed(...args),
  pollWebSource: (...args: unknown[]) => mockPollWebSource(...args),
}));

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/intelligence/workspaces/[id]/sources/[sourceId]/test/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const SOURCE_UUID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

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

beforeEach(() => {
  vi.clearAllMocks();
  resetMocks();
});

describe('Test-poll route branching (WP3C)', () => {
  // T21: web source -> pollWebSource
  it('calls pollWebSource for source_type "web" (T21)', async () => {
    configureRole(mockSupabase, 'admin');
    // Source lookup returns a web source
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
      items: [{ title: 'Web Page Title', url: 'https://example.com/page' }],
      etag: null,
      lastModified: null,
    });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}/test`,
      { method: 'POST' },
    );
    const params = createTestParams({
      id: WORKSPACE_UUID,
      sourceId: SOURCE_UUID,
    });
    const response = await POST(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.itemCount).toBe(1);
    expect(body.sampleTitles).toContain('Web Page Title');

    // Verify correct function was called.
    // S222 W3-A §2.3.4 AC-10: test endpoint passes `{ dryRun: true }` so
    // future side-effect bookkeeping is suppressed for admin-initiated
    // tests.
    expect(mockPollWebSource).toHaveBeenCalledWith(
      expect.objectContaining({
        id: SOURCE_UUID,
        url: 'https://example.com/page',
        source_type: 'web',
      }),
      expect.objectContaining({ dryRun: true }),
    );
    expect(mockPollFeed).not.toHaveBeenCalled();
  });

  // T22: rss source -> pollFeed
  it('calls pollFeed for source_type "rss" (T22)', async () => {
    configureRole(mockSupabase, 'admin');
    // Source lookup returns an RSS source
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: SOURCE_UUID,
        url: 'https://example.com/feed.atom',
        etag: '"abc"',
        last_modified: 'Tue, 01 Apr 2026 10:00:00 GMT',
        source_type: 'rss',
      },
      error: null,
    });

    mockPollFeed.mockResolvedValueOnce({
      feedSourceId: SOURCE_UUID,
      status: 'success',
      items: [
        { title: 'RSS Article 1' },
        { title: 'RSS Article 2' },
        { title: 'RSS Article 3' },
      ],
      etag: '"abc"',
      lastModified: 'Tue, 01 Apr 2026 10:00:00 GMT',
    });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}/test`,
      { method: 'POST' },
    );
    const params = createTestParams({
      id: WORKSPACE_UUID,
      sourceId: SOURCE_UUID,
    });
    const response = await POST(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.itemCount).toBe(3);

    // Verify correct function was called
    expect(mockPollFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: SOURCE_UUID,
        url: 'https://example.com/feed.atom',
        source_type: 'rss',
      }),
    );
    expect(mockPollWebSource).not.toHaveBeenCalled();
  });

  // T23: api source -> 501 structured error
  it('returns 501 for source_type "api" (T23)', async () => {
    configureRole(mockSupabase, 'admin');
    // Source lookup returns an API source
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: SOURCE_UUID,
        url: 'https://api.example.com/v1/data',
        etag: null,
        last_modified: null,
        source_type: 'api',
      },
      error: null,
    });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}/test`,
      { method: 'POST' },
    );
    const params = createTestParams({
      id: WORKSPACE_UUID,
      sourceId: SOURCE_UUID,
    });
    const response = await POST(request, { params });
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(body.error).toContain('not yet supported');
    expect(body.source_type).toBe('api');

    // Neither poller should have been called
    expect(mockPollFeed).not.toHaveBeenCalled();
    expect(mockPollWebSource).not.toHaveBeenCalled();
  });

  // T22b: source without source_type defaults to RSS behaviour
  it('defaults to pollFeed when source_type is null (legacy source)', async () => {
    configureRole(mockSupabase, 'admin');
    // Source lookup returns a source with no source_type
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: SOURCE_UUID,
        url: 'https://example.com/feed.xml',
        etag: null,
        last_modified: null,
        source_type: null,
      },
      error: null,
    });

    mockPollFeed.mockResolvedValueOnce({
      feedSourceId: SOURCE_UUID,
      status: 'success',
      items: [],
      etag: null,
      lastModified: null,
    });

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/sources/${SOURCE_UUID}/test`,
      { method: 'POST' },
    );
    const params = createTestParams({
      id: WORKSPACE_UUID,
      sourceId: SOURCE_UUID,
    });
    const response = await POST(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockPollFeed).toHaveBeenCalled();
    expect(mockPollWebSource).not.toHaveBeenCalled();
  });
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
    const response = await POST(request, { params });
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
    const response = await POST(request, { params });
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
    const response = await POST(request, { params });
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

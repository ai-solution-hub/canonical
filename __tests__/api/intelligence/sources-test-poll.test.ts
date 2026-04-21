/**
 * API route tests for the test-poll endpoint (P0-WEB / WP3C branching).
 *
 * Route: POST /api/intelligence/workspaces/:id/sources/:sourceId/test
 *
 * Tests verify source_type branching: web -> pollWebSource, rss -> pollFeed,
 * api -> 501 structured error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
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
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Test-poll route branching (WP3C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

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
      items: [
        { title: 'Web Page Title', url: 'https://example.com/page' },
      ],
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

    // Verify correct function was called
    expect(mockPollWebSource).toHaveBeenCalledWith(
      expect.objectContaining({
        id: SOURCE_UUID,
        url: 'https://example.com/page',
        source_type: 'web',
      }),
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

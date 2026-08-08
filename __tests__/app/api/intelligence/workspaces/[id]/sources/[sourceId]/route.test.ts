/**
 * API route tests for the single intelligence feed-source endpoint.
 *
 * Route: GET    /api/intelligence/workspaces/:id/sources/:sourceId — read
 *        PATCH  /api/intelligence/workspaces/:id/sources/:sourceId — update
 *        DELETE /api/intelligence/workspaces/:id/sources/:sourceId — soft/hard delete
 *
 * Covers read/update/delete CRUD plus the WP3C `consecutive_failures` reset
 * on re-enable (F-3 / D-4).
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

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks
// ---------------------------------------------------------------------------

import {
  GET,
  PATCH,
  DELETE,
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
    const response = await GET(request, { params });
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
    const response = await GET(request, { params });

    expect(response.status).toBe(404);
  });
});

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
    const response = await PATCH(request, { params });
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
    const response = await PATCH(request, { params });

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
    const response = await PATCH(request, { params });
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
    const response = await PATCH(request, { params });
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
    const response = await PATCH(request, { params });
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
    const response = await DELETE(request, { params });
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
    const response = await DELETE(request, { params });
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
    const response = await DELETE(request, { params });

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
    const response = await DELETE(request, { params });

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
    const response = await DELETE(request, { params });

    expect(response.status).toBe(404);
  });
});

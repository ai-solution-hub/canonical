/**
 * API route tests for GET /api/activity.
 *
 * Tests authentication enforcement, response shape, RPC parameter mapping,
 * cursor-based pagination, and limit clamping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { configureAuth } from '../helpers/mock-auth';
import { createTestRequest } from '../helpers/mock-next';

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

// Suppress console.error noise from safeErrorMessage
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/activity/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRpcRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1b2c3d4-0000-0000-0000-000000000001',
    type: 'edit',
    entity_type: 'content_item',
    entity_id: 'b1c2d3e4-0000-0000-0000-000000000001',
    summary: 'Updated title',
    user_id: 'u1000000-0000-0000-0000-000000000001',
    latest_at: '2026-03-08T10:00:00Z',
    earliest_at: '2026-03-08T10:00:00Z',
    event_count: 1,
    ...overrides,
  };
}

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  // Reset chain defaults
  const chainable = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;
  for (const method of chainable) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null, count: null });
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/activity', () => {
  beforeEach(() => {
    resetMocks();
  });

  // -- Auth checks --

  it('returns 401 for unauthenticated requests', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/activity');
    const response = await GET(req);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 403 for non-admin users (editor)', async () => {
    configureAuth(mockSupabase).asEditor();

    const req = createTestRequest('/api/activity');
    const response = await GET(req);
    expect(response.status).toBe(403);
  });

  it('returns 403 for non-admin users (viewer)', async () => {
    configureAuth(mockSupabase).asViewer();

    const req = createTestRequest('/api/activity');
    const response = await GET(req);
    expect(response.status).toBe(403);
  });

  it('returns 200 for admin users', async () => {
    configureAuth(mockSupabase).asAdmin();

    const req = createTestRequest('/api/activity');
    const response = await GET(req);
    expect(response.status).toBe(200);
  });

  // -- Default limit --

  it('uses default limit of 20', async () => {
    configureAuth(mockSupabase).asAdmin();

    const req = createTestRequest('/api/activity');
    await GET(req);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_grouped_activity_feed', {
      p_limit: 20,
      p_is_admin: true,
      p_before: undefined,
    });
  });

  // -- Custom limit --

  it('passes custom limit from query param', async () => {
    configureAuth(mockSupabase).asAdmin();

    const req = createTestRequest('/api/activity', {
      searchParams: { limit: '50' },
    });
    await GET(req);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_grouped_activity_feed', {
      p_limit: 50,
      p_is_admin: true,
      p_before: undefined,
    });
  });

  it('clamps limit to maximum of 100', async () => {
    configureAuth(mockSupabase).asAdmin();

    const req = createTestRequest('/api/activity', {
      searchParams: { limit: '500' },
    });
    await GET(req);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_grouped_activity_feed', {
      p_limit: 100,
      p_is_admin: true,
      p_before: undefined,
    });
  });

  it('clamps limit to minimum of 1', async () => {
    configureAuth(mockSupabase).asAdmin();

    const req = createTestRequest('/api/activity', {
      searchParams: { limit: '-5' },
    });
    await GET(req);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_grouped_activity_feed', {
      p_limit: 1,
      p_is_admin: true,
      p_before: undefined,
    });
  });

  // -- Cursor / before parameter --

  it('passes before cursor from query param', async () => {
    configureAuth(mockSupabase).asAdmin();

    const req = createTestRequest('/api/activity', {
      searchParams: { before: '2026-03-07T12:00:00Z' },
    });
    await GET(req);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_grouped_activity_feed', {
      p_limit: 20,
      p_is_admin: true,
      p_before: '2026-03-07T12:00:00Z',
    });
  });

  it('omits before when not provided', async () => {
    configureAuth(mockSupabase).asAdmin();

    const req = createTestRequest('/api/activity');
    await GET(req);

    const rpcArgs = mockSupabase.rpc.mock.calls[0][1];
    expect(rpcArgs.p_before).toBeUndefined();
  });

  // -- Response shape mapping --

  it('maps latest_at to created_at in response', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [makeRpcRow({ latest_at: '2026-03-08T10:00:00Z' })],
      error: null,
    });

    const req = createTestRequest('/api/activity');
    const response = await GET(req);
    const body = await response.json();

    expect(body.activities[0].created_at).toBe('2026-03-08T10:00:00Z');
    expect(body.activities[0].latest_at).toBe('2026-03-08T10:00:00Z');
  });

  it('includes earliest_at and event_count in response', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [makeRpcRow({
        earliest_at: '2026-03-08T08:00:00Z',
        event_count: 5,
      })],
      error: null,
    });

    const req = createTestRequest('/api/activity');
    const response = await GET(req);
    const body = await response.json();

    expect(body.activities[0].earliest_at).toBe('2026-03-08T08:00:00Z');
    expect(body.activities[0].event_count).toBe(5);
  });

  it('does not include metadata in response', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [makeRpcRow()],
      error: null,
    });

    const req = createTestRequest('/api/activity');
    const response = await GET(req);
    const body = await response.json();

    expect(body.activities[0]).not.toHaveProperty('metadata');
  });

  // -- has_more flag --

  it('sets has_more to true when results fill the limit', async () => {
    configureAuth(mockSupabase).asAdmin();
    // Return exactly 20 rows (the default limit)
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRpcRow({
        id: `a1b2c3d4-0000-0000-0000-${String(i).padStart(12, '0')}`,
      }),
    );
    mockSupabase.rpc.mockResolvedValueOnce({ data: rows, error: null });

    const req = createTestRequest('/api/activity');
    const response = await GET(req);
    const body = await response.json();

    expect(body.has_more).toBe(true);
  });

  it('sets has_more to false when results are fewer than the limit', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [makeRpcRow()],
      error: null,
    });

    const req = createTestRequest('/api/activity');
    const response = await GET(req);
    const body = await response.json();

    expect(body.has_more).toBe(false);
  });

  // -- RPC error handling --

  it('returns 500 when RPC returns an error', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'function not found' },
    });

    const req = createTestRequest('/api/activity');
    const response = await GET(req);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBe('Failed to fetch activity feed');
  });

  // -- Empty data --

  it('returns empty activities array when RPC returns null data', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });

    const req = createTestRequest('/api/activity');
    const response = await GET(req);
    const body = await response.json();

    expect(body.activities).toEqual([]);
    expect(body.has_more).toBe(false);
  });

  // -- Response envelope --

  it('returns correct response envelope shape', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [makeRpcRow()],
      error: null,
    });

    const req = createTestRequest('/api/activity');
    const response = await GET(req);
    const body = await response.json();

    expect(body).toHaveProperty('activities');
    expect(body).toHaveProperty('limit');
    expect(body).toHaveProperty('has_more');
    expect(body).not.toHaveProperty('offset');
    expect(Array.isArray(body.activities)).toBe(true);
    expect(typeof body.limit).toBe('number');
    expect(typeof body.has_more).toBe('boolean');
  });
});

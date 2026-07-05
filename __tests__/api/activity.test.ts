/**
 * API route tests for GET /api/activity.
 *
 * ID-131.19 (M6, S450 GO tail): get_grouped_activity_feed dropped (IMS
 * activity-feed feature, content_items-anchored). Mirrors the identical stub
 * in lib/dashboard.ts's unified aggregator (query 1) — the route no longer
 * calls any RPC and always returns an empty activity feed. Tests verify
 * authentication enforcement, limit clamping (still schema-validated), and
 * the always-empty response shape.
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

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  // Reset chain defaults
  const chainable = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'is',
    'not',
    'ilike',
    'contains',
    'gte',
    'lte',
    'gt',
    'lt',
    'or',
    'order',
    'limit',
    'range',
  ] as const;
  for (const method of chainable) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }
  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
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

  // -- Limit clamping (schema-validated independent of the retired RPC) --

  it('defaults limit to 20 when no limit is specified', async () => {
    configureAuth(mockSupabase).asAdmin();

    const req = createTestRequest('/api/activity');
    const response = await GET(req);
    const body = await response.json();

    expect(body.limit).toBe(20);
  });

  it('honours a custom limit supplied in the query string', async () => {
    configureAuth(mockSupabase).asAdmin();

    const req = createTestRequest('/api/activity', {
      searchParams: { limit: '50' },
    });
    const response = await GET(req);
    const body = await response.json();

    expect(body.limit).toBe(50);
  });

  it('clamps limit to maximum of 100', async () => {
    configureAuth(mockSupabase).asAdmin();

    const req = createTestRequest('/api/activity', {
      searchParams: { limit: '500' },
    });
    const response = await GET(req);
    const body = await response.json();

    expect(body.limit).toBe(100);
  });

  it('clamps limit to minimum of 1', async () => {
    configureAuth(mockSupabase).asAdmin();

    const req = createTestRequest('/api/activity', {
      searchParams: { limit: '-5' },
    });
    const response = await GET(req);
    const body = await response.json();

    expect(body.limit).toBe(1);
  });

  // -- Retired RPC (ID-131.19) --

  it('always returns an empty activities array and has_more=false (get_grouped_activity_feed retired)', async () => {
    configureAuth(mockSupabase).asAdmin();

    const req = createTestRequest('/api/activity');
    const response = await GET(req);
    const body = await response.json();

    expect(body.activities).toEqual([]);
    expect(body.has_more).toBe(false);
  });

  it('never calls the dropped get_grouped_activity_feed RPC (ID-131.19 trim)', async () => {
    configureAuth(mockSupabase).asAdmin();

    const req = createTestRequest('/api/activity', {
      searchParams: { before: '2026-03-07T12:00:00Z' },
    });
    await GET(req);

    expect(mockSupabase.rpc).not.toHaveBeenCalledWith(
      'get_grouped_activity_feed',
      expect.anything(),
    );
  });

  // -- Response envelope --

  it('returns correct response envelope shape', async () => {
    configureAuth(mockSupabase).asAdmin();

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

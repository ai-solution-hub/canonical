/**
 * API route tests for GET /api/reorient.
 *
 * Tests authentication enforcement, response shape, and cache headers.
 * The heavy lifting is in lib/reorient.ts (tested separately); this file
 * focuses on the thin route handler layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { configureAuth } from '../helpers/mock-auth';

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

// Mock fetchReorientData to return a known shape (avoid duplicating
// the full Supabase mock wiring tested in lib/reorient.test.ts)
const { mockFetchReorientData } = vi.hoisted(() => {
  return {
    mockFetchReorientData: vi.fn(),
  };
});

vi.mock('@/lib/reorient', () => ({
  fetchReorientData: mockFetchReorientData,
}));

// Suppress console.error noise from safeErrorMessage
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/reorient/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReorientResponse() {
  return {
    last_active_at: '2026-03-08T08:00:00Z',
    last_active_relative: '2 hours ago',
    urgent: [],
    team_changes: [],
    my_recent_work: [],
    bid_summary: [],
    counts: {
      unread_notifications: 0,
      pending_reviews: 0,
      stale_or_expired: 0,
      quality_flags: 0,
    },
    generated_at: '2026-03-08T10:00:00.000Z',
    user_display_name: 'Liam',
    has_display_name: true,
    errors: [],
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
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  mockFetchReorientData.mockResolvedValue(makeReorientResponse());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/reorient', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('returns 401 for unauthenticated requests', async () => {
    configureUnauthenticated(mockSupabase);

    const response = await GET();
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns valid ReorientData shape for authenticated admin', async () => {
    configureAuth(mockSupabase).asAdmin();

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('last_active_at');
    expect(body).toHaveProperty('last_active_relative');
    expect(body).toHaveProperty('urgent');
    expect(body).toHaveProperty('team_changes');
    expect(body).toHaveProperty('my_recent_work');
    expect(body).toHaveProperty('bid_summary');
    expect(body).toHaveProperty('counts');
    expect(body).toHaveProperty('generated_at');
    expect(body).toHaveProperty('user_display_name');
    expect(body).toHaveProperty('has_display_name');
    expect(body).toHaveProperty('errors');
    expect(Array.isArray(body.urgent)).toBe(true);
    expect(Array.isArray(body.team_changes)).toBe(true);
    expect(Array.isArray(body.my_recent_work)).toBe(true);
    expect(Array.isArray(body.bid_summary)).toBe(true);
  });

  it('includes Cache-Control: no-store header', async () => {
    configureAuth(mockSupabase).asEditor();

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns valid ReorientData shape for authenticated editor', async () => {
    configureAuth(mockSupabase).asEditor();

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.user_display_name).toBe('Liam');
    expect(body.counts.unread_notifications).toBe(0);
  });

  it('passes correct parameters to fetchReorientData', async () => {
    configureAuth(mockSupabase).asAdmin();

    await GET();

    expect(mockFetchReorientData).toHaveBeenCalledTimes(1);
    const args = mockFetchReorientData.mock.calls[0];
    expect(args[1]).toBe('test-user-id'); // userId
    expect(args[2]).toBe(true); // isAdmin
    expect(args[3]).toBe('admin'); // role
  });

  it('returns 500 when fetchReorientData throws', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockFetchReorientData.mockRejectedValueOnce(new Error('Database down'));

    const response = await GET();
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBeDefined();
  });
});

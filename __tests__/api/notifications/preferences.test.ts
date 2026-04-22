/**
 * Notification Preferences API route tests.
 *
 * Tests GET /api/notifications/preferences and PUT /api/notifications/preferences.
 *
 * Covers:
 *   - GET: auth enforcement, returns current prefs, defaults when no row exists
 *   - PUT: auth enforcement, body validation, upsert behaviour
 *   - Error handling for both methods
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestRequest } from '../../helpers/mock-next';

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

// Suppress console.error noise
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks
// ---------------------------------------------------------------------------

import { GET, PUT } from '@/app/api/notifications/preferences/route';

// ---------------------------------------------------------------------------
// Reset helper
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainableMethods = [
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
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

// ---------------------------------------------------------------------------
// GET tests
// ---------------------------------------------------------------------------

describe('GET /api/notifications/preferences', () => {
  beforeEach(resetMocks);

  it('returns 401 for unauthenticated users', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns current user preferences when row exists', async () => {
    configureRole(mockSupabase, 'viewer');

    const mockPrefs = {
      email_weekly_change_report: false,
      email_review_assigned: true,
      email_owned_content_flagged: false,
      updated_at: '2026-04-22T10:00:00Z',
    };

    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: mockPrefs,
      error: null,
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.preferences.email_weekly_change_report).toBe(false);
    expect(body.preferences.email_review_assigned).toBe(true);
    expect(body.preferences.email_owned_content_flagged).toBe(false);
  });

  it('returns all-true defaults when no row exists', async () => {
    configureRole(mockSupabase, 'viewer');

    // maybeSingle returns null data (no row) — this is the default after resetMocks
    // but the role lookup consumes the first maybeSingle/single call
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.preferences.email_weekly_change_report).toBe(true);
    expect(body.preferences.email_review_assigned).toBe(true);
    expect(body.preferences.email_owned_content_flagged).toBe(true);
  });

  it('returns 500 on database error', async () => {
    configureRole(mockSupabase, 'viewer');

    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB error', code: 'INTERNAL' },
    });

    const res = await GET();
    expect(res.status).toBe(500);
  });

  it('is accessible to all roles (admin, editor, viewer)', async () => {
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      resetMocks();
      configureRole(mockSupabase, role);

      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const res = await GET();
      expect(res.status).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------
// PUT tests
// ---------------------------------------------------------------------------

describe('PUT /api/notifications/preferences', () => {
  beforeEach(resetMocks);

  it('returns 401 for unauthenticated users', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/notifications/preferences', {
      method: 'PUT',
      body: { email_weekly_change_report: false },
    });

    const res = await PUT(req);
    expect(res.status).toBe(401);
  });

  it('upserts preferences for authenticated user', async () => {
    configureRole(mockSupabase, 'viewer');

    const updatedPrefs = {
      email_weekly_change_report: false,
      email_review_assigned: true,
      email_owned_content_flagged: true,
      updated_at: '2026-04-22T10:00:00Z',
    };

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: updatedPrefs,
      error: null,
    });

    const req = createTestRequest('/api/notifications/preferences', {
      method: 'PUT',
      body: { email_weekly_change_report: false },
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.preferences.email_weekly_change_report).toBe(false);
  });

  it('returns 400 for invalid body (non-boolean value)', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/notifications/preferences', {
      method: 'PUT',
      body: { email_weekly_change_report: 'not-a-boolean' },
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for unknown fields', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/notifications/preferences', {
      method: 'PUT',
      body: { email_weekly_change_report: true, unknown_field: true },
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty body', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/notifications/preferences', {
      method: 'PUT',
      body: {},
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when all fields are explicitly undefined', async () => {
    // Zod .optional() + .strict() strips undefined fields before .refine().
    // The refine must therefore reject the resulting empty object.
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/notifications/preferences', {
      method: 'PUT',
      body: {
        email_weekly_change_report: undefined,
        email_review_assigned: undefined,
        email_owned_content_flagged: undefined,
      },
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('accepts partial updates (only some fields)', async () => {
    configureRole(mockSupabase, 'viewer');

    const updatedPrefs = {
      email_weekly_change_report: true,
      email_review_assigned: false,
      email_owned_content_flagged: true,
      updated_at: '2026-04-22T10:00:00Z',
    };

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: updatedPrefs,
      error: null,
    });

    const req = createTestRequest('/api/notifications/preferences', {
      method: 'PUT',
      body: { email_review_assigned: false },
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.preferences.email_review_assigned).toBe(false);
  });

  it('returns 500 on database error during upsert', async () => {
    configureRole(mockSupabase, 'viewer');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Constraint violation', code: 'INTERNAL' },
    });

    const req = createTestRequest('/api/notifications/preferences', {
      method: 'PUT',
      body: { email_weekly_change_report: false },
    });

    const res = await PUT(req);
    expect(res.status).toBe(500);
  });

  it('is accessible to all roles (admin, editor, viewer)', async () => {
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      resetMocks();
      configureRole(mockSupabase, role);

      const updatedPrefs = {
        email_weekly_change_report: true,
        email_review_assigned: true,
        email_owned_content_flagged: true,
        updated_at: '2026-04-22T10:00:00Z',
      };

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: updatedPrefs,
        error: null,
      });

      const req = createTestRequest('/api/notifications/preferences', {
        method: 'PUT',
        body: { email_weekly_change_report: true },
      });

      const res = await PUT(req);
      expect(res.status).toBe(200);
    }
  });
});

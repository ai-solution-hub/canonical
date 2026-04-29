/**
 * Tests for GET /api/pipeline-runs/[id].
 *
 * S212 W2 Pattern E poller endpoint. Asserts:
 *   1. 401 when unauthenticated.
 *   2. 403 when forbidden (viewer tries to poll).
 *   3. 200 with the row when admin reads any row.
 *   4. 200 with the row when editor reads their OWN row.
 *   5. 404 when the row exists but belongs to another user (non-admin)
 *      — treated as 404 rather than 403 to avoid leaking row existence.
 *   6. 404 when the row genuinely does not exist (racy at-start window).
 *   7. 500 when the DB read fails.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';

// ────────────────────────────────────────────────────────────────────────
// Shared mock client
// ────────────────────────────────────────────────────────────────────────

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Import the route AFTER the mocks are registered.
import { GET } from '@/app/api/pipeline-runs/[id]/route';

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

const TEST_RUN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const SAMPLE_RUN = {
  id: TEST_RUN_ID,
  pipeline_name: 'upload_markdown_batch',
  status: 'running',
  progress: {
    step: 'importing',
    files_completed: 2,
    files_total: 5,
    detail: 'Processing foo.md…',
  },
  source_filename: null,
  items_created: ['item-1', 'item-2'],
  items_processed: null,
  workspace_id: null,
  error_message: null,
  started_at: '2026-04-29T22:00:00Z',
  completed_at: null,
  created_at: '2026-04-29T22:00:00Z',
  created_by: 'test-user-id',
  result: null,
};

function makeRequest() {
  return new Request(`http://test/api/pipeline-runs/${TEST_RUN_ID}`);
}

function makeContext() {
  return { params: Promise.resolve({ id: TEST_RUN_ID }) };
}

// ────────────────────────────────────────────────────────────────────────
// Lifecycle
// ────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  // Default chain wiring: every chain method returns the chain itself,
  // single/maybeSingle/then resolve to empty results.
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

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
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
});

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

describe('GET /api/pipeline-runs/[id]', () => {
  it('returns 401 for unauthenticated callers', async () => {
    configureUnauthenticated(mockSupabase);
    const res = await GET(makeRequest(), makeContext());
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewers (admin/editor only)', async () => {
    configureRole(mockSupabase, 'viewer');
    const res = await GET(makeRequest(), makeContext());
    expect(res.status).toBe(403);
  });

  it('returns 200 with the row for an admin caller', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle.mockResolvedValue({
      data: SAMPLE_RUN,
      error: null,
    });

    const res = await GET(makeRequest(), makeContext());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(TEST_RUN_ID);
    expect(body.progress.detail).toBe('Processing foo.md…');

    // Admin path — no created_by filter applied.
    const eqCalls = mockSupabase._chain.eq.mock.calls;
    const createdByCalls = eqCalls.filter(
      (call: unknown[]) => call[0] === 'created_by',
    );
    expect(createdByCalls).toHaveLength(0);
  });

  it('returns 200 with the row for an editor reading their OWN row', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.maybeSingle.mockResolvedValue({
      data: SAMPLE_RUN,
      error: null,
    });

    const res = await GET(makeRequest(), makeContext());
    expect(res.status).toBe(200);

    // Editor path — `created_by` filter applied (not just `id`).
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
      'created_by',
      'test-user-id',
    );
  });

  it('returns 404 when the row exists but belongs to another user (non-admin)', async () => {
    configureRole(mockSupabase, 'editor');
    // The DB returns null because the `created_by` filter excludes the row.
    mockSupabase._chain.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const res = await GET(makeRequest(), makeContext());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });

  it('returns 404 when the row genuinely does not exist (Pattern E racy at-start window)', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const res = await GET(makeRequest(), makeContext());
    expect(res.status).toBe(404);
  });

  it('returns 500 when the DB read fails', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'connection lost' },
    });

    const res = await GET(makeRequest(), makeContext());
    expect(res.status).toBe(500);
  });
});

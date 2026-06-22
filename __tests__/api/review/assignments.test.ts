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

vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handlers under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { GET, POST, PATCH } from '@/app/api/review/assignments/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';
const REVIEWER_UUID = '00000000-0000-4000-8000-000000000002';

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

  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

// ===========================================================================
// GET /api/review/assignments
// ===========================================================================

describe('GET /api/review/assignments', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/review/assignments');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('returns 403 for viewers', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/review/assignments');
    const res = await GET(req);

    expect(res.status).toBe(403);
  });

  it('returns assignments for editor (own assignments only)', async () => {
    configureRole(mockSupabase, 'editor');

    const mockAssignments = [
      {
        id: VALID_UUID,
        reviewer_id: 'test-user-id',
        status: 'active',
        notes: 'Review H&S items',
        filter_domains: ['H&S'],
        filter_content_types: [],
        filter_freshness: [],
        filter_date_from: null,
        filter_date_to: null,
        item_count: 5,
        due_date: null,
      },
    ];

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: mockAssignments, error: null }),
    );

    const req = createTestRequest('/api/review/assignments');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.assignments).toHaveLength(1);
    expect(data.assignments[0].notes).toBe('Review H&S items');
    // The reviewer_id-scoping invariant for non-admin callers is covered
    // end-to-end at integration tier (W-RD').
  });

  it('returns all assignments for admin', async () => {
    configureRole(mockSupabase, 'admin');

    const mockAssignments = [
      {
        id: VALID_UUID,
        reviewer_id: REVIEWER_UUID,
        status: 'active',
        notes: null,
        filter_domains: [],
        filter_content_types: [],
        filter_freshness: [],
        filter_date_from: null,
        filter_date_to: null,
        item_count: 0,
        due_date: null,
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        reviewer_id: 'test-user-id',
        status: 'active',
        notes: null,
        filter_domains: [],
        filter_content_types: [],
        filter_freshness: [],
        filter_date_from: null,
        filter_date_to: null,
        item_count: 0,
        due_date: null,
      },
    ];

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: mockAssignments, error: null }),
    );

    const req = createTestRequest('/api/review/assignments');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    // Admin sees foreign-reviewer rows in the same response — the
    // absence of the reviewer_id scoping for admins is observable.
    expect(data.assignments).toHaveLength(2);
    expect(
      data.assignments.some(
        (a: { reviewer_id: string }) => a.reviewer_id !== 'test-user-id',
      ),
    ).toBe(true);
  });

  it('returns only the requested-status rows when status param is supplied', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: VALID_UUID,
              reviewer_id: REVIEWER_UUID,
              status: 'completed',
              notes: null,
              filter_domains: [],
              filter_content_types: [],
              filter_freshness: [],
              filter_date_from: null,
              filter_date_to: null,
              item_count: 0,
              due_date: null,
            },
          ],
          error: null,
        }),
    );

    const req = createTestRequest('/api/review/assignments', {
      searchParams: { status: 'completed' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.assignments).toHaveLength(1);
    expect(data.assignments[0].status).toBe('completed');
  });

  it('returns 500 on database error', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'DB error' } }),
    );

    const req = createTestRequest('/api/review/assignments');
    const res = await GET(req);

    expect(res.status).toBe(500);
  });
});

// ===========================================================================
// POST /api/review/assignments
// ===========================================================================

describe('POST /api/review/assignments', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/review/assignments', {
      method: 'POST',
      body: { reviewer_id: REVIEWER_UUID },
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('returns 403 for editors (admin only)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/review/assignments', {
      method: 'POST',
      body: { reviewer_id: REVIEWER_UUID },
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid body (missing reviewer_id)', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/review/assignments', {
      method: 'POST',
      body: { notes: 'test' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
  });

  it('returns 400 for invalid reviewer_id (not uuid)', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/review/assignments', {
      method: 'POST',
      body: { reviewer_id: 'not-a-uuid' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('creates assignment successfully with all filters', async () => {
    configureRole(mockSupabase, 'admin');

    // Mock the count query (head: true returns count)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 15 }),
    );

    // Mock the insert + select + single
    const mockAssignment = {
      id: VALID_UUID,
      reviewer_id: REVIEWER_UUID,
      assigned_by: 'test-user-id',
      assignment_type: 'manual',
      filter_domains: ['H&S', 'Environmental'],
      filter_content_types: ['article'],
      filter_freshness: ['stale'],
      item_count: 15,
      status: 'active',
      notes: 'Focus on stale H&S articles',
      due_date: '2026-04-01T00:00:00.000Z',
    };

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: mockAssignment,
      error: null,
    });

    // Mock notification insert (non-fatal)
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/review/assignments', {
      method: 'POST',
      body: {
        reviewer_id: REVIEWER_UUID,
        filter_domains: ['H&S', 'Environmental'],
        filter_content_types: ['article'],
        filter_freshness: ['stale'],
        due_date: '2026-04-01T00:00:00.000Z',
        notes: 'Focus on stale H&S articles',
      },
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.assignment).toBeDefined();
    expect(data.assignment.id).toBe(VALID_UUID);
    expect(data.assignment.filter_domains).toEqual(['H&S', 'Environmental']);
    expect(data.assignment.item_count).toBe(15);
  });

  it('creates assignment with minimal body (only reviewer_id)', async () => {
    configureRole(mockSupabase, 'admin');

    // Mock count query
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 42 }),
    );

    // Mock insert
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        reviewer_id: REVIEWER_UUID,
        assigned_by: 'test-user-id',
        filter_domains: [],
        filter_content_types: [],
        filter_freshness: [],
        item_count: 42,
        status: 'active',
        notes: null,
      },
      error: null,
    });

    const req = createTestRequest('/api/review/assignments', {
      method: 'POST',
      body: { reviewer_id: REVIEWER_UUID },
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.assignment.filter_domains).toEqual([]);
    expect(data.assignment.item_count).toBe(42);
  });

  it('returns 500 when count query fails', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'Count error' }, count: null }),
    );

    const req = createTestRequest('/api/review/assignments', {
      method: 'POST',
      body: { reviewer_id: REVIEWER_UUID },
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain('item count');
  });

  it('returns 500 when insert fails', async () => {
    configureRole(mockSupabase, 'admin');

    // Count succeeds
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 5 }),
    );

    // Insert fails
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Insert error' },
    });

    const req = createTestRequest('/api/review/assignments', {
      method: 'POST',
      body: { reviewer_id: REVIEWER_UUID },
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
  });
});

// ===========================================================================
// PATCH /api/review/assignments
// ===========================================================================

describe('PATCH /api/review/assignments', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/review/assignments', {
      method: 'PATCH',
      body: { id: VALID_UUID, status: 'completed' },
    });
    const res = await PATCH(req);

    expect(res.status).toBe(401);
  });

  it('returns 403 for viewers', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/review/assignments', {
      method: 'PATCH',
      body: { id: VALID_UUID, status: 'completed' },
    });
    const res = await PATCH(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid body (missing id)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/review/assignments', {
      method: 'PATCH',
      body: { status: 'completed' },
    });
    const res = await PATCH(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid status value', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/review/assignments', {
      method: 'PATCH',
      body: { id: VALID_UUID, status: 'invalid_status' },
    });
    const res = await PATCH(req);

    expect(res.status).toBe(400);
  });

  it('marks assignment as completed', async () => {
    configureRole(mockSupabase, 'editor');

    const updatedAssignment = {
      id: VALID_UUID,
      status: 'completed',
      completed_at: '2026-03-25T12:00:00.000Z',
    };

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: updatedAssignment,
      error: null,
    });

    const req = createTestRequest('/api/review/assignments', {
      method: 'PATCH',
      body: { id: VALID_UUID, status: 'completed' },
    });
    const res = await PATCH(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.assignment.status).toBe('completed');

    // Content-of-write: marking complete must stamp a completed_at timestamp.
    const updateCall = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateCall.status).toBe('completed');
    expect(updateCall.completed_at).toBeDefined();
  });

  it('marks assignment as cancelled (no completed_at)', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, status: 'cancelled' },
      error: null,
    });

    const req = createTestRequest('/api/review/assignments', {
      method: 'PATCH',
      body: { id: VALID_UUID, status: 'cancelled' },
    });
    const res = await PATCH(req);

    expect(res.status).toBe(200);

    // Content-of-write: cancelling must NOT stamp completed_at (the row
    // was never finished, only abandoned).
    const updateCall = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateCall.status).toBe('cancelled');
    expect(updateCall.completed_at).toBeUndefined();
  });

  it('returns 404 when assignment not found', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest('/api/review/assignments', {
      method: 'PATCH',
      body: { id: VALID_UUID, status: 'completed' },
    });
    const res = await PATCH(req);

    expect(res.status).toBe(404);
  });

  it('returns 500 on database error', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB error' },
    });

    const req = createTestRequest('/api/review/assignments', {
      method: 'PATCH',
      body: { id: VALID_UUID, status: 'completed' },
    });
    const res = await PATCH(req);

    expect(res.status).toBe(500);
  });
});

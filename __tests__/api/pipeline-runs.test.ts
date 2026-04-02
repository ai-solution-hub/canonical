import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

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

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}));

// Import route AFTER mocks are registered
import { GET } from '@/app/api/pipeline-runs/route';

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

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
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
});

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_PIPELINE_RUNS = [
  {
    id: 'run-1',
    pipeline_name: 'file_upload',
    status: 'completed',
    progress: {
      step: 'complete',
      steps_completed: 5,
      steps_total: 5,
      detail: 'All processing steps completed successfully.',
    },
    source_filename: 'policy.pdf',
    items_created: ['item-1'],
    items_processed: 1,
    workspace_id: null,
    error_message: null,
    started_at: '2026-03-19T10:00:00Z',
    completed_at: '2026-03-19T10:01:00Z',
    created_at: '2026-03-19T10:00:00Z',
    created_by: 'test-user-id',
  },
  {
    id: 'run-2',
    pipeline_name: 'file_upload',
    status: 'running',
    progress: {
      step: 'classifying',
      steps_completed: 3,
      steps_total: 5,
      detail: 'Running AI classification...',
    },
    source_filename: 'capability.docx',
    items_created: ['item-2'],
    items_processed: null,
    workspace_id: 'workspace-1',
    error_message: null,
    started_at: '2026-03-19T10:05:00Z',
    completed_at: null,
    created_at: '2026-03-19T10:05:00Z',
    created_by: 'test-user-id',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/pipeline-runs', () => {
  it('returns 401 for unauthenticated users', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/pipeline-runs');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('returns 403 for viewers', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/pipeline-runs');
    const res = await GET(req);

    expect(res.status).toBe(403);
  });

  it('returns pipeline runs for editors', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: SAMPLE_PIPELINE_RUNS, error: null, count: 2 }),
    );

    const req = createTestRequest('/api/pipeline-runs');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].pipeline_name).toBe('file_upload');
    expect(body[0].progress.step).toBe('complete');
    // Verify it filtered by user ID (eq called with created_by)
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
      'created_by',
      'test-user-id',
    );
  });

  it('returns pipeline runs for admins', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: SAMPLE_PIPELINE_RUNS, error: null, count: 2 }),
    );

    const req = createTestRequest('/api/pipeline-runs');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    // Admin without ?all=true still filters by own user ID
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
      'created_by',
      'test-user-id',
    );
  });

  it('admin with ?all=true does not filter by created_by', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: SAMPLE_PIPELINE_RUNS, error: null, count: 2 }),
    );

    const req = createTestRequest('/api/pipeline-runs', {
      searchParams: { all: 'true' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    // Should NOT have called eq with 'created_by'
    const eqCalls = mockSupabase._chain.eq.mock.calls;
    const createdByCalls = eqCalls.filter(
      (call: unknown[]) => call[0] === 'created_by',
    );
    expect(createdByCalls).toHaveLength(0);
  });

  it('editor with ?all=true still filters by own user ID', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: SAMPLE_PIPELINE_RUNS, error: null, count: 2 }),
    );

    const req = createTestRequest('/api/pipeline-runs', {
      searchParams: { all: 'true' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    // Editor cannot bypass the created_by filter
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
      'created_by',
      'test-user-id',
    );
  });

  it('filters by pipeline_name query param', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [SAMPLE_PIPELINE_RUNS[0]], error: null, count: 1 }),
    );

    const req = createTestRequest('/api/pipeline-runs', {
      searchParams: { pipeline_name: 'file_upload' },
    });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
      'pipeline_name',
      'file_upload',
    );
  });

  it('filters by status query param', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [SAMPLE_PIPELINE_RUNS[1]], error: null, count: 1 }),
    );

    const req = createTestRequest('/api/pipeline-runs', {
      searchParams: { status: 'running' },
    });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('status', 'running');
  });

  it('respects custom limit param (capped at 100)', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const req = createTestRequest('/api/pipeline-runs', {
      searchParams: { limit: '200' },
    });
    await GET(req);

    // Limit should be capped at 100
    expect(mockSupabase._chain.limit).toHaveBeenCalledWith(100);
  });

  it('uses default limit of 20 when not specified', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const req = createTestRequest('/api/pipeline-runs');
    await GET(req);

    expect(mockSupabase._chain.limit).toHaveBeenCalledWith(20);
  });

  it('returns 500 on database error', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { message: 'DB error', code: '500' },
          count: 0,
        }),
    );

    const req = createTestRequest('/api/pipeline-runs');
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to fetch pipeline runs');
  });

  it('returns empty array when no runs exist', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const req = createTestRequest('/api/pipeline-runs');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

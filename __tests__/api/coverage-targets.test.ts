/**
 * Coverage Targets API route tests.
 *
 * Tests GET /api/coverage/targets and PUT /api/coverage/targets.
 *
 * Covers:
 *   - GET: auth enforcement, successful fetch, join flattening
 *   - PUT: admin-only enforcement, body validation, upsert behaviour
 *   - Error handling for both methods
 */
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

import { GET, PUT } from '@/app/api/coverage/targets/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOMAIN_UUID = '00000000-0000-4000-8000-000000000001';
const TARGET_UUID = '00000000-0000-4000-8000-000000000010';

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
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

// ---------------------------------------------------------------------------
// GET tests
// ---------------------------------------------------------------------------

describe('GET /api/coverage/targets', () => {
  beforeEach(resetMocks);

  it('returns 401 for unauthenticated users', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns targets with domain_name for authenticated users', async () => {
    configureRole(mockSupabase, 'viewer');

    const mockTargets = [
      {
        id: TARGET_UUID,
        domain_id: DOMAIN_UUID,
        metric_name: 'item_count',
        target_value: 10,
        taxonomy_domains: { name: 'Compliance' },
      },
    ];

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: mockTargets, error: null }),
    );

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.targets).toHaveLength(1);
    expect(body.targets[0].domain_name).toBe('Compliance');
    expect(body.targets[0].metric_name).toBe('item_count');
    expect(body.targets[0].target_value).toBe(10);
  });

  it('returns empty targets when none exist', async () => {
    configureRole(mockSupabase, 'viewer');

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.targets).toEqual([]);
  });

  it('returns 500 on database error', async () => {
    configureRole(mockSupabase, 'viewer');

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'DB error' } }),
    );

    const res = await GET();
    expect(res.status).toBe(500);
  });

  it('handles null taxonomy_domains relation gracefully', async () => {
    configureRole(mockSupabase, 'viewer');

    const mockTargets = [
      {
        id: TARGET_UUID,
        domain_id: DOMAIN_UUID,
        metric_name: 'fresh_pct',
        target_value: 80,
        taxonomy_domains: null,
      },
    ];

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: mockTargets, error: null }),
    );

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.targets[0].domain_name).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PUT tests
// ---------------------------------------------------------------------------

describe('PUT /api/coverage/targets', () => {
  beforeEach(resetMocks);

  it('returns 401 for unauthenticated users', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/coverage/targets', {
      method: 'PUT',
      body: { targets: [] },
    });

    const res = await PUT(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/coverage/targets', {
      method: 'PUT',
      body: {
        targets: [{
          domain_id: DOMAIN_UUID,
          metric_name: 'item_count',
          target_value: 10,
        }],
      },
    });

    const res = await PUT(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid body', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/coverage/targets', {
      method: 'PUT',
      body: { targets: [{ domain_id: 'not-a-uuid', metric_name: 'invalid', target_value: -1 }] },
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Invalid request body');
  });

  it('returns 400 for empty targets array', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/coverage/targets', {
      method: 'PUT',
      body: { targets: [] },
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('upserts targets successfully for admin', async () => {
    configureRole(mockSupabase, 'admin');

    // Mock upsert chain to succeed
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/coverage/targets', {
      method: 'PUT',
      body: {
        targets: [
          {
            domain_id: DOMAIN_UUID,
            metric_name: 'item_count',
            target_value: 15,
          },
          {
            domain_id: DOMAIN_UUID,
            metric_name: 'fresh_pct',
            target_value: 70,
          },
        ],
      },
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
  });

  it('validates metric_name enum', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/coverage/targets', {
      method: 'PUT',
      body: {
        targets: [{
          domain_id: DOMAIN_UUID,
          metric_name: 'unknown_metric',
          target_value: 10,
        }],
      },
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('validates target_value is non-negative', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/coverage/targets', {
      method: 'PUT',
      body: {
        targets: [{
          domain_id: DOMAIN_UUID,
          metric_name: 'item_count',
          target_value: -5,
        }],
      },
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('returns 500 on upsert error', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'Constraint violation' } }),
    );

    const req = createTestRequest('/api/coverage/targets', {
      method: 'PUT',
      body: {
        targets: [{
          domain_id: DOMAIN_UUID,
          metric_name: 'item_count',
          target_value: 10,
        }],
      },
    });

    const res = await PUT(req);
    expect(res.status).toBe(500);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
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
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Import route AFTER mocks are registered
const { GET } = await import('@/app/api/entities/co-occurrence/route');

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
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then
    .mockReset()
    .mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/entities/co-occurrence', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/entities/co-occurrence');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns empty pairs when RPC returns empty array', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const req = createTestRequest('/api/entities/co-occurrence');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pairs).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('returns co-occurring entity pairs from RPC', async () => {
    const rpcResult = [
      {
        entity_a: 'Acme Corp',
        type_a: 'organisation',
        entity_b: 'ISO 27001',
        type_b: 'certification',
        shared_count: 3,
      },
      {
        entity_a: 'Acme Corp',
        type_a: 'organisation',
        entity_b: 'GDPR',
        type_b: 'regulation',
        shared_count: 2,
      },
      {
        entity_a: 'GDPR',
        type_a: 'regulation',
        entity_b: 'ISO 27001',
        type_b: 'certification',
        shared_count: 2,
      },
    ];

    mockSupabase.rpc.mockResolvedValueOnce({ data: rpcResult, error: null });

    const req = createTestRequest('/api/entities/co-occurrence', {
      searchParams: { min: '2' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pairs.length).toBe(3);

    // First pair should be Acme Corp + ISO 27001 (shared_count = 3)
    expect(body.pairs[0].entity_a).toBe('Acme Corp');
    expect(body.pairs[0].entity_b).toBe('ISO 27001');
    expect(body.pairs[0].shared_count).toBe(3);
    expect(body.pairs[0].type_a).toBe('organisation');
    expect(body.pairs[0].type_b).toBe('certification');

    // Verify RPC was called with correct parameters
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_entity_co_occurrence', {
      p_limit: 20,
      p_min_count: 2,
      p_entity_type: undefined,
    });
  });

  it('passes entity type filter to RPC', async () => {
    const rpcResult = [
      {
        entity_a: 'ISO 27001',
        type_a: 'certification',
        entity_b: 'ISO 9001',
        type_b: 'certification',
        shared_count: 2,
      },
    ];

    mockSupabase.rpc.mockResolvedValueOnce({ data: rpcResult, error: null });

    const req = createTestRequest('/api/entities/co-occurrence', {
      searchParams: { type: 'certification', min: '2' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pairs).toHaveLength(1);
    expect(body.pairs[0].entity_a).toBe('ISO 27001');
    expect(body.pairs[0].entity_b).toBe('ISO 9001');
    expect(body.pairs[0].shared_count).toBe(2);

    // Verify the type filter was passed to the RPC
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_entity_co_occurrence', {
      p_limit: 20,
      p_min_count: 2,
      p_entity_type: 'certification',
    });
  });

  it('passes limit parameter to RPC', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          entity_a: 'Entity A',
          type_a: 'organisation',
          entity_b: 'Entity B',
          type_b: 'organisation',
          shared_count: 2,
        },
      ],
      error: null,
    });

    const req = createTestRequest('/api/entities/co-occurrence', {
      searchParams: { limit: '1', min: '2' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pairs).toHaveLength(1);

    // Verify limit was passed to RPC
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_entity_co_occurrence', {
      p_limit: 1,
      p_min_count: 2,
      p_entity_type: undefined,
    });
  });

  it('returns empty pairs when RPC returns no results above min count', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const req = createTestRequest('/api/entities/co-occurrence', {
      searchParams: { min: '2' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pairs).toEqual([]);
  });

  it('returns 500 when RPC fails', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB error', code: '50000' },
    });

    const req = createTestRequest('/api/entities/co-occurrence');
    const res = await GET(req);
    expect(res.status).toBe(500);
  });

  it('returns correct total matching pairs count', async () => {
    const rpcResult = [
      {
        entity_a: 'Acme Corp',
        type_a: 'organisation',
        entity_b: 'ISO 27001',
        type_b: 'certification',
        shared_count: 2,
      },
    ];

    mockSupabase.rpc.mockResolvedValueOnce({ data: rpcResult, error: null });

    const req = createTestRequest('/api/entities/co-occurrence', {
      searchParams: { min: '2' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pairs).toHaveLength(1);
    expect(body.total).toBe(1);
  });
});

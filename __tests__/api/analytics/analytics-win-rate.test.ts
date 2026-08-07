import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '@/__tests__/helpers/mock-supabase';

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

// ---------------------------------------------------------------------------
// Import handler under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/analytics/win-rate/route';

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/analytics/win-rate', () => {
  beforeEach(resetMocks);

  it('returns 401 for unauthenticated requests', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await GET();

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns aggregate stats for the overall scope (per-domain scope retired, id-417 / DR-130)', async () => {
    configureRole(mockSupabase, 'viewer');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          scope: 'overall',
          total_citations: '24',
          winning_citations: '10',
          losing_citations: '6',
          pending_citations: '8',
          win_rate: '0.63',
          unique_items_cited: '16',
          unique_procurements: '8',
        },
      ],
      error: null,
    });

    const res = await GET();

    expect(res.status).toBe(200);
    const json = await res.json();

    // Overall stats
    expect(json.overall.total_citations).toBe(24);
    expect(json.overall.winning_citations).toBe(10);
    expect(json.overall.win_rate).toBe(0.63);
    expect(json.overall.unique_procurements).toBe(8);

    // The per-domain breakdown retired with record_lifecycle.domain.
    expect(json.by_domain).toBeUndefined();
  });

  it('returns empty response (zero citations) gracefully', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          scope: 'overall',
          total_citations: '0',
          winning_citations: '0',
          losing_citations: '0',
          pending_citations: '0',
          win_rate: '0',
          unique_items_cited: '0',
          unique_procurements: '0',
        },
      ],
      error: null,
    });

    const res = await GET();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.overall.total_citations).toBe(0);
    expect(json.overall.win_rate).toBe(0);
  });

  it('win rate excludes pending/withdrawn bids from denominator', async () => {
    configureRole(mockSupabase, 'editor');

    // The RPC itself excludes pending/withdrawn from the denominator.
    // Here we verify the API correctly passes through the RPC values.
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          scope: 'overall',
          total_citations: '10',
          winning_citations: '3',
          losing_citations: '2',
          pending_citations: '5',
          win_rate: '0.60', // 3 / (3 + 2) = 0.60
          unique_items_cited: '7',
          unique_procurements: '5',
        },
      ],
      error: null,
    });

    const res = await GET();

    expect(res.status).toBe(200);
    const json = await res.json();
    // Win rate is 3/(3+2) = 0.60, not 3/10 = 0.30
    expect(json.overall.win_rate).toBe(0.6);
    expect(json.overall.pending_citations).toBe(5);
  });

  // (The domain-row sorting test retired with the per-domain scope —
  // id-417 / DR-130.)
});

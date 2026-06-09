import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

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

import { GET } from '@/app/api/items/[id]/effectiveness/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTENT_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000010';

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

describe('GET /api/items/[id]/effectiveness', () => {
  beforeEach(resetMocks);

  it('returns 401 for unauthenticated requests', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/items/${CONTENT_ID}/effectiveness`);
    const params = createTestParams({ id: CONTENT_ID });
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/items/not-a-uuid/effectiveness');
    const params = createTestParams({ id: 'not-a-uuid' });
    const res = await GET(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid item ID');
  });

  it('returns 404 when content item not found', async () => {
    configureRole(mockSupabase, 'viewer');

    // maybeSingle returns null for item lookup
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest(`/api/items/${CONTENT_ID}/effectiveness`);
    const params = createTestParams({ id: CONTENT_ID });
    const res = await GET(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Content item not found');
  });

  it('returns effectiveness data for a valid content item with zero citations', async () => {
    configureRole(mockSupabase, 'viewer');

    // Item exists
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: CONTENT_ID },
      error: null,
    });

    // RPC returns zero citations
    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        total_citations: 0,
        winning_citations: 0,
        losing_citations: 0,
        pending_citations: 0,
        win_rate: 0,
      },
      error: null,
    });

    // Citations query returns empty
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest(`/api/items/${CONTENT_ID}/effectiveness`);
    const params = createTestParams({ id: CONTENT_ID });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.content_item_id).toBe(CONTENT_ID);
    expect(json.total_citations).toBe(0);
    expect(json.winning_citations).toBe(0);
    expect(json.bids).toEqual([]);
  });

  it('correctly calculates win rate from mock RPC response', async () => {
    configureRole(mockSupabase, 'editor');

    // Item exists
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: CONTENT_ID },
      error: null,
    });

    // RPC returns win rate data (bigint as string from Supabase)
    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        total_citations: '12',
        winning_citations: '5',
        losing_citations: '3',
        pending_citations: '4',
        win_rate: '0.63',
      },
      error: null,
    });

    // Citations query returns empty (bid list tested separately)
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest(`/api/items/${CONTENT_ID}/effectiveness`);
    const params = createTestParams({ id: CONTENT_ID });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total_citations).toBe(12);
    expect(json.winning_citations).toBe(5);
    expect(json.losing_citations).toBe(3);
    expect(json.pending_citations).toBe(4);
    expect(json.win_rate).toBe(0.63);
  });

  it('returns bid list with workspace names and outcomes', async () => {
    configureRole(mockSupabase, 'admin');

    // Item exists
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: CONTENT_ID },
      error: null,
    });

    // RPC returns data
    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        total_citations: 2,
        winning_citations: 1,
        losing_citations: 1,
        pending_citations: 0,
        win_rate: 0.5,
      },
      error: null,
    });

    // Citations query returns bid data
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              created_at: '2026-01-15T10:00:00Z',
              form_responses: {
                id: 'resp-1',
                question: {
                  workspace_id: WORKSPACE_ID,
                  workspace: {
                    id: WORKSPACE_ID,
                    name: 'NHS Digital Redesign',
                    domain_metadata: { outcome: 'won', buyer: 'NHS England' },
                  },
                },
              },
            },
            {
              created_at: '2026-02-20T14:00:00Z',
              form_responses: {
                id: 'resp-2',
                question: {
                  workspace_id: '00000000-0000-4000-8000-000000000011',
                  workspace: {
                    id: '00000000-0000-4000-8000-000000000011',
                    name: 'Council Portal',
                    domain_metadata: { outcome: 'lost' },
                  },
                },
              },
            },
          ],
          error: null,
        }),
    );

    const req = createTestRequest(`/api/items/${CONTENT_ID}/effectiveness`);
    const params = createTestParams({ id: CONTENT_ID });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bids).toHaveLength(2);
    expect(json.bids[0].workspace_name).toBe('NHS Digital Redesign');
    expect(json.bids[0].outcome).toBe('won');
    expect(json.bids[0].buyer).toBe('NHS England');
    expect(json.bids[1].workspace_name).toBe('Council Portal');
    expect(json.bids[1].outcome).toBe('lost');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
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

// ---------------------------------------------------------------------------
// Import handler under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/items/batch-workspaces/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_1 = '00000000-0000-4000-8000-000000000001';
const UUID_2 = '00000000-0000-4000-8000-000000000002';
const UUID_3 = '00000000-0000-4000-8000-000000000003';
const WS_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const WS_B = 'bbbbbbbb-0000-4000-8000-000000000002';

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.then.mockReset();

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

  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null, count: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({ data: null, error: null, count: null });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

// ===========================================================================
// Tests
// ===========================================================================

describe('POST /api/items/batch-workspaces', () => {
  beforeEach(() => resetMocks());

  it('returns grouped assignments for valid item IDs', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          { content_item_id: UUID_1, workspace_id: WS_A },
          { content_item_id: UUID_1, workspace_id: WS_B },
          { content_item_id: UUID_3, workspace_id: WS_A },
        ],
        error: null,
      }),
    );

    const req = createTestRequest('/api/items/batch-workspaces', {
      method: 'POST',
      body: { item_ids: [UUID_1, UUID_2, UUID_3] },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.assignments).toBeDefined();
    expect(json.assignments[UUID_1]).toEqual([WS_A, WS_B]);
    expect(json.assignments[UUID_3]).toEqual([WS_A]);
    // UUID_2 has no assignments — should be omitted
    expect(json.assignments[UUID_2]).toBeUndefined();
  });

  it('returns empty assignments when no items are assigned', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/items/batch-workspaces', {
      method: 'POST',
      body: { item_ids: [UUID_1] },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.assignments).toEqual({});
  });

  it('returns 400 for invalid UUID in item_ids', async () => {
    const req = createTestRequest('/api/items/batch-workspaces', {
      method: 'POST',
      body: { item_ids: ['not-a-uuid'] },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty item_ids array', async () => {
    const req = createTestRequest('/api/items/batch-workspaces', {
      method: 'POST',
      body: { item_ids: [] },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when item_ids exceeds 100', async () => {
    const tooMany = Array.from({ length: 101 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );

    const req = createTestRequest('/api/items/batch-workspaces', {
      method: 'POST',
      body: { item_ids: tooMany },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 401 for unauthenticated requests', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/items/batch-workspaces', {
      method: 'POST',
      body: { item_ids: [UUID_1] },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 500 when Supabase query fails', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'DB error' } }),
    );

    const req = createTestRequest('/api/items/batch-workspaces', {
      method: 'POST',
      body: { item_ids: [UUID_1] },
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it('queries the content_item_workspaces table with the correct item IDs', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/items/batch-workspaces', {
      method: 'POST',
      body: { item_ids: [UUID_1, UUID_2] },
    });

    await POST(req);

    expect(mockSupabase.from).toHaveBeenCalledWith('content_item_workspaces');
    expect(mockSupabase._chain.select).toHaveBeenCalledWith('content_item_id, workspace_id');
    expect(mockSupabase._chain.in).toHaveBeenCalledWith('content_item_id', [UUID_1, UUID_2]);
  });
});

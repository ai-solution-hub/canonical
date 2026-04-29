import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies, loggerMocks } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  loggerMocks: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/logger', () => ({
  logger: loggerMocks,
}));

// Import route AFTER mocks
const { PATCH } =
  await import('@/app/api/entities/[canonical_name]/metadata/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Track separate call sequences for different tables.
 * The mock chain is shared, so we track .from() calls to determine context.
 */
let fromCalls: string[];
let updatePayloads: Record<string, unknown>[];

function setupEntityUpdate(entityType: string, contentIds: string[]) {
  // Role lookup
  configureRole(mockSupabase, 'admin');

  // Find entity_mentions row (first .single() after role)
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: {
      id: 'mention-1',
      metadata: { issuing_body: 'BSI' },
    },
    error: null,
  });

  // Update entity_mentions row — returns updated row
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: {
      id: 'mention-1',
      canonical_name: 'ISO 27001',
      entity_type: entityType,
      metadata: { issuing_body: 'BSI', expiry_date: '2027-12-31' },
    },
    error: null,
  });

  // Entity info lookup for bridge (returns entity_type + content_item_ids)
  mockSupabase._chain.then
    .mockReset()
    .mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: contentIds.map((cid) => ({
          entity_type: entityType,
          content_item_id: cid,
        })),
        error: null,
        count: contentIds.length,
      }),
    );

  // Track from() calls
  fromCalls = [];
  updatePayloads = [];
  mockSupabase.from.mockImplementation((table: string) => {
    fromCalls.push(table);
    return mockSupabase._chain;
  });
  mockSupabase._chain.update.mockImplementation(
    (payload: Record<string, unknown>) => {
      updatePayloads.push(payload);
      return mockSupabase._chain;
    },
  );
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  fromCalls = [];
  updatePayloads = [];

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

describe('PATCH /api/entities/[canonical_name]/metadata — reverse bridge', () => {
  it('propagates expiry_date to content_items for certification entities', async () => {
    setupEntityUpdate('certification', ['item-1', 'item-2']);

    const req = createTestRequest('/api/entities/ISO%2027001/metadata', {
      method: 'PATCH',
      body: { expiry_date: '2027-12-31' },
    });
    const params = createTestParams({ canonical_name: 'ISO%2027001' });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(200);

    // Verify content_items was called (bridge propagation)
    expect(fromCalls).toContain('content_items');

    // Verify the update payload includes expiry_date and lifecycle_type
    const contentUpdate = updatePayloads.find(
      (p) => p.expiry_date === '2027-12-31',
    );
    expect(contentUpdate).toBeDefined();
    expect(contentUpdate!.lifecycle_type).toBe('date_bound');
  });

  it('does NOT propagate for non-certification entity types', async () => {
    setupEntityUpdate('technology', ['item-1']);

    const req = createTestRequest('/api/entities/React/metadata', {
      method: 'PATCH',
      body: { expiry_date: '2027-12-31' },
    });
    const params = createTestParams({ canonical_name: 'React' });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(200);

    // content_items should NOT have been updated (no bridge for technology)
    const contentUpdate = updatePayloads.find(
      (p) => p.expiry_date === '2027-12-31',
    );
    expect(contentUpdate).toBeUndefined();
  });

  it('handles bridge propagation failure gracefully', async () => {
    // Role lookup
    configureRole(mockSupabase, 'admin');

    // Find + update entity
    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: { id: 'mention-1', metadata: {} },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'mention-1',
          canonical_name: 'ISO 27001',
          entity_type: 'certification',
          metadata: { expiry_date: '2027-12-31' },
        },
        error: null,
      });

    // Bridge query throws
    mockSupabase._chain.then.mockReset().mockImplementation(() => {
      throw new Error('DB connection failed');
    });

    loggerMocks.error.mockClear();

    const req = createTestRequest('/api/entities/ISO%2027001/metadata', {
      method: 'PATCH',
      body: { expiry_date: '2027-12-31' },
    });
    const params = createTestParams({ canonical_name: 'ISO%2027001' });
    const res = await PATCH(req, { params });

    // Should still return 200 — bridge failure is non-fatal
    expect(res.status).toBe(200);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Reverse bridge propagation failed',
    );
  });
});

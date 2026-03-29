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

const { mockCookies, mockCheckRateLimit } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

// Import routes AFTER mocks are registered
const { GET: entitiesGet } = await import('@/app/api/entities/route');
const { GET: entityDetailGet } = await import(
  '@/app/api/entities/[canonical_name]/route'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

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

  mockSupabase.rpc.mockReset();
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  const chainable = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockReset().mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockReset().mockImplementation(
    (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 }),
  );

  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
});


// ═══════════════════════════════════════════════════════════════════════════
// GET /api/entities — list with counts
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/entities', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/entities');
    const res = await entitiesGet(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/entities');
    const res = await entitiesGet(req);
    expect(res.status).toBe(403);
  });

  it('returns entity list with counts on success', async () => {
    configureRole(mockSupabase, 'admin');

    // The route now calls a single RPC: get_entity_list_aggregated
    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        entities: [
          {
            canonical_name: 'Acme Corp',
            entity_type: 'organisation',
            mention_count: 2,
            variant_count: 2,
            variant_names: ['Acme Corp', 'ACME'],
            relationship_count: 1,
            has_type_conflict: false,
            types_seen: ['organisation'],
          },
          {
            canonical_name: 'ISO 27001',
            entity_type: 'certification',
            mention_count: 1,
            variant_count: 1,
            variant_names: ['ISO 27001'],
            relationship_count: 1,
            has_type_conflict: false,
            types_seen: ['certification'],
          },
        ],
        total: 2,
      },
      error: null,
    });

    const req = createTestRequest('/api/entities');
    const res = await entitiesGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.entities).toHaveLength(2);
    expect(body.total).toBe(2);

    const acme = body.entities[0];
    expect(acme.canonical_name).toBe('Acme Corp');
    expect(acme.mention_count).toBe(2);
    expect(acme.variant_count).toBe(2);
    expect(acme.variant_names).toContain('ACME');
    expect(acme.relationship_count).toBe(1);

    // Verify RPC was called with correct parameters (default limit is 100 per schema)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_entity_list_aggregated', {
      p_type: undefined,
      p_search: undefined,
      p_variants_only: false,
      p_type_conflicts: false,
      p_limit: 100,
      p_offset: 0,
    });
  });

  it('filters by entity_type via RPC parameter', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        entities: [
          {
            canonical_name: 'ISO 27001',
            entity_type: 'certification',
            mention_count: 1,
            variant_count: 1,
            variant_names: ['ISO 27001'],
            relationship_count: 0,
            has_type_conflict: false,
            types_seen: ['certification'],
          },
        ],
        total: 1,
      },
      error: null,
    });

    const req = createTestRequest('/api/entities', {
      searchParams: { type: 'certification' },
    });
    const res = await entitiesGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.entities).toHaveLength(1);
    expect(body.entities[0].entity_type).toBe('certification');

    // Verify the type filter was passed to the RPC
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_entity_list_aggregated', expect.objectContaining({
      p_type: 'certification',
    }));
  });

  it('searches by entity name via RPC parameter', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        entities: [
          {
            canonical_name: 'Acme Corp',
            entity_type: 'organisation',
            mention_count: 1,
            variant_count: 1,
            variant_names: ['Acme Corp'],
            relationship_count: 0,
            has_type_conflict: false,
            types_seen: ['organisation'],
          },
        ],
        total: 1,
      },
      error: null,
    });

    const req = createTestRequest('/api/entities', {
      searchParams: { search: 'acme' },
    });
    const res = await entitiesGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.entities).toHaveLength(1);
    expect(body.entities[0].canonical_name).toBe('Acme Corp');

    // Verify search was passed to the RPC
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_entity_list_aggregated', expect.objectContaining({
      p_search: 'acme',
    }));
  });

  it('returns 500 when RPC fails', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB error', code: '50000' },
    });

    const req = createTestRequest('/api/entities');
    const res = await entitiesGet(req);
    expect(res.status).toBe(500);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// GET /api/entities/[canonical_name] — entity detail
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/entities/[canonical_name]', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/entities/Acme');
    const params = createTestParams({ canonical_name: 'Acme' });
    const res = await entityDetailGet(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for editor role (requires admin)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/entities/Acme');
    const params = createTestParams({ canonical_name: 'Acme' });
    const res = await entityDetailGet(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 404 when entity not found', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/entities/Unknown');
    const params = createTestParams({ canonical_name: 'Unknown' });
    const res = await entityDetailGet(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Entity not found');
  });

  it('returns full entity detail on success', async () => {
    configureRole(mockSupabase, 'admin');

    // First .then: entity_mentions
    mockSupabase._chain.then
      .mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [
              {
                entity_type: 'organisation',
                entity_type_override: null,
                entity_name: 'Acme Corp',
                content_item_id: VALID_UUID,
                confidence: 0.95,
                context_snippet: 'Acme Corp was founded...',
              },
              {
                entity_type: 'organisation',
                entity_type_override: null,
                entity_name: 'ACME',
                content_item_id: VALID_UUID_2,
                confidence: 0.8,
                context_snippet: 'ACME provides...',
              },
            ],
            error: null,
          }),
      )
      // Second .then: content_items
      .mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [
              { id: VALID_UUID, title: 'Health & Safety Policy', content_type: 'article' },
              { id: VALID_UUID_2, title: 'Company Overview', content_type: 'pdf' },
            ],
            error: null,
          }),
      )
      // Third .then: entity_relationships
      .mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [
              {
                source_entity: 'Acme Corp',
                relationship_type: 'holds',
                target_entity: 'ISO 27001',
                confidence: 0.9,
              },
            ],
            error: null,
          }),
      );

    const req = createTestRequest('/api/entities/Acme%20Corp');
    const params = createTestParams({ canonical_name: 'Acme%20Corp' });
    const res = await entityDetailGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.canonical_name).toBe('Acme Corp');
    expect(body.entity_type).toBe('organisation');
    expect(body.effective_type).toBe('organisation');
    expect(body.has_type_override).toBe(false);
    expect(body.mention_count).toBe(2);
    expect(body.variant_names).toContain('Acme Corp');
    expect(body.variant_names).toContain('ACME');
    expect(body.variant_count).toBe(2);
    expect(body.content_items).toHaveLength(2);
    expect(body.content_item_count).toBe(2);
    expect(body.relationships).toHaveLength(1);
    expect(body.relationships[0].relationship_type).toBe('holds');
    expect(body.relationship_count).toBe(1);
  });

  it('shows type override when present', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then
      .mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [
              {
                entity_type: 'person',
                entity_type_override: 'organisation',
                entity_name: 'AcmeTech',
                content_item_id: VALID_UUID,
                confidence: 0.95,
                context_snippet: null,
              },
            ],
            error: null,
          }),
      )
      .mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [{ id: VALID_UUID, title: 'Test Item', content_type: 'note' }],
            error: null,
          }),
      )
      .mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
      );

    const req = createTestRequest('/api/entities/AcmeTech');
    const params = createTestParams({ canonical_name: 'AcmeTech' });
    const res = await entityDetailGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.entity_type).toBe('person');
    expect(body.effective_type).toBe('organisation');
    expect(body.has_type_override).toBe(true);
    expect(body.has_type_conflict).toBe(true);
    expect(body.types_seen).toContain('person');
    expect(body.types_seen).toContain('organisation');
  });

  it('URL-decodes the canonical_name param', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then
      .mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [
              {
                entity_type: 'organisation',
                entity_type_override: null,
                entity_name: 'Acme Corp Ltd',
                content_item_id: VALID_UUID,
                confidence: 1,
                context_snippet: null,
              },
            ],
            error: null,
          }),
      )
      .mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [{ id: VALID_UUID, title: 'Test', content_type: 'note' }],
            error: null,
          }),
      )
      .mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
      );

    const encodedName = encodeURIComponent('Acme Corp Ltd');
    const req = createTestRequest(`/api/entities/${encodedName}`);
    const params = createTestParams({ canonical_name: encodedName });
    const res = await entityDetailGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.canonical_name).toBe('Acme Corp Ltd');
  });

  it('returns 500 when mentions query fails', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { message: 'DB error', code: '50000' },
        }),
    );

    const req = createTestRequest('/api/entities/Acme');
    const params = createTestParams({ canonical_name: 'Acme' });
    const res = await entityDetailGet(req, { params });
    expect(res.status).toBe(500);
  });

  it('returns 429 when rate limited', async () => {
    configureRole(mockSupabase, 'admin');
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const req = createTestRequest('/api/entities/Acme');
    const params = createTestParams({ canonical_name: 'Acme' });
    const res = await entityDetailGet(req, { params });
    expect(res.status).toBe(429);
  });
});

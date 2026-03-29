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

const {
  mockCookies,
  mockCheckRateLimit,
  mockGenerateEmbedding,
  mockExtractStructuredContent,
  mockGetUserById,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGenerateEmbedding: vi.fn(),
  mockExtractStructuredContent: vi.fn(),
  mockGetUserById: vi.fn(),
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

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: mockGenerateEmbedding,
  EMBEDDING_MODEL: 'text-embedding-3-large',
  EMBEDDING_DIMENSIONS: 1024,
}));

vi.mock('@/lib/ai/extract-content', () => ({
  extractStructuredContent: mockExtractStructuredContent,
}));

// Import routes AFTER mocks are registered
const { GET: entitiesGet } = await import('@/app/api/entities/route');
const { POST: entitiesMergePost } = await import('@/app/api/entities/merge/route');
const { POST: entitiesSplitPost } = await import('@/app/api/entities/split/route');
const { PATCH: entityTypePatch } = await import('@/app/api/entities/[canonical_name]/type/route');
const { POST: embedPost } = await import('@/app/api/embed/route');
const { POST: extractPost } = await import('@/app/api/extract/route');
const { GET: suggestionsGet } = await import('@/app/api/search/suggestions/route');
const { POST: displayNamesPost } = await import('@/app/api/users/display-names/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

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

  // Reset rpc before setting default to avoid leftover queued values
  mockSupabase.rpc.mockReset();
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  // Add getUserById to mock auth.admin (not in shared helper)
  (mockSupabase.auth.admin as Record<string, unknown>).getUserById = mockGetUserById;
  mockGetUserById.mockResolvedValue({
    data: { user: null },
    error: null,
  });

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
  mockGenerateEmbedding.mockResolvedValue(new Array(1024).fill(0));
  mockExtractStructuredContent.mockResolvedValue({ extracted: true });
});


// ═══════════════════════════════════════════════════════════════════════════
// GET /api/entities
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/entities', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/entities');
    const res = await entitiesGet(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role (requires admin)', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/entities');
    const res = await entitiesGet(req);
    expect(res.status).toBe(403);
  });

  it('returns 403 for editor role (requires admin)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/entities');
    const res = await entitiesGet(req);
    expect(res.status).toBe(403);
  });

  it('returns 200 with aggregated entities on success', async () => {
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

    // Acme Corp has 2 mentions, sorted first
    const acme = body.entities[0];
    expect(acme.canonical_name).toBe('Acme Corp');
    expect(acme.mention_count).toBe(2);
    expect(acme.variant_count).toBe(2);
    expect(acme.variant_names).toContain('ACME');
    expect(acme.relationship_count).toBe(1);
  });

  it('applies pagination via limit and offset', async () => {
    configureRole(mockSupabase, 'admin');

    // RPC returns paginated result (2 entities out of 5 total)
    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        entities: [
          {
            canonical_name: 'Entity 1',
            entity_type: 'organisation',
            mention_count: 1,
            variant_count: 1,
            variant_names: ['Entity 1'],
            relationship_count: 0,
            has_type_conflict: false,
            types_seen: ['organisation'],
          },
          {
            canonical_name: 'Entity 2',
            entity_type: 'organisation',
            mention_count: 1,
            variant_count: 1,
            variant_names: ['Entity 2'],
            relationship_count: 0,
            has_type_conflict: false,
            types_seen: ['organisation'],
          },
        ],
        total: 5,
      },
      error: null,
    });

    const req = createTestRequest('/api/entities', {
      searchParams: { limit: '2', offset: '1' },
    });
    const res = await entitiesGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.entities).toHaveLength(2);
    expect(body.total).toBe(5);

    // Verify pagination params passed to RPC
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_entity_list_aggregated', expect.objectContaining({
      p_limit: 2,
      p_offset: 1,
    }));
  });

  it('filters by type_conflicts showing only entities with multiple types', async () => {
    configureRole(mockSupabase, 'admin');

    // RPC returns only the conflicted entity (server-side filtering)
    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        entities: [
          {
            canonical_name: 'Conflicted',
            entity_type: 'person',
            mention_count: 1,
            variant_count: 1,
            variant_names: ['Conflicted'],
            relationship_count: 0,
            has_type_conflict: true,
            types_seen: ['organisation', 'person'],
          },
        ],
        total: 1,
      },
      error: null,
    });

    const req = createTestRequest('/api/entities', {
      searchParams: { type_conflicts: 'true' },
    });
    const res = await entitiesGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.entities).toHaveLength(1);
    expect(body.entities[0].canonical_name).toBe('Conflicted');
    expect(body.entities[0].has_type_conflict).toBe(true);

    // Verify type_conflicts filter passed to RPC
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_entity_list_aggregated', expect.objectContaining({
      p_type_conflicts: true,
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
// POST /api/entities/merge
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/entities/merge', () => {
  const validMergeBody = {
    sources: ['Acme', 'ACME Corp'],
    target: 'Acme Corporation',
    entity_type: 'organisation',
  };

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/entities/merge', { method: 'POST', body: validMergeBody });
    const res = await entitiesMergePost(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for editor role (requires admin)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/entities/merge', { method: 'POST', body: validMergeBody });
    const res = await entitiesMergePost(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid body (missing target)', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/entities/merge', {
      method: 'POST',
      body: { sources: ['A'], entity_type: 'organisation' },
    });
    const res = await entitiesMergePost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid entity_type', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/entities/merge', {
      method: 'POST',
      body: { sources: ['A'], target: 'B', entity_type: 'invalid_type' },
    });
    const res = await entitiesMergePost(req);
    expect(res.status).toBe(400);
  });

  it('returns 200 with merge result on success', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        merged: true,
        target: 'Acme Corporation',
        entity_type: 'organisation',
        mentions_updated: 5,
        relationship_sources_updated: 1,
        relationship_targets_updated: 0,
        duplicates_removed: 2,
      },
      error: null,
    });

    const req = createTestRequest('/api/entities/merge', { method: 'POST', body: validMergeBody });
    const res = await entitiesMergePost(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.merged).toBe(true);
    expect(body.target).toBe('Acme Corporation');
    expect(body.mentions_updated).toBe(5);
    expect(body.duplicates_removed).toBe(2);

    // Verify RPC called with correct params (sources + target deduplicated)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('merge_entities', {
      p_source_names: expect.arrayContaining(['Acme', 'ACME Corp', 'Acme Corporation']),
      p_target_name: 'Acme Corporation',
      p_entity_type: 'organisation',
    });
  });

  it('returns 500 when RPC fails', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC error', code: '50000' },
    });

    const req = createTestRequest('/api/entities/merge', { method: 'POST', body: validMergeBody });
    const res = await entitiesMergePost(req);
    expect(res.status).toBe(500);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// POST /api/entities/split
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/entities/split', () => {
  const validSplitBody = {
    canonical_name: 'Acme Corp',
    variant_names: ['ACME'],
    new_canonical_name: 'ACME Industries',
  };

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/entities/split', { method: 'POST', body: validSplitBody });
    const res = await entitiesSplitPost(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role (requires admin)', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/entities/split', { method: 'POST', body: validSplitBody });
    const res = await entitiesSplitPost(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 when new_canonical_name equals canonical_name', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/entities/split', {
      method: 'POST',
      body: { canonical_name: 'Acme', variant_names: ['ACME'], new_canonical_name: 'Acme' },
    });
    const res = await entitiesSplitPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('New canonical name must differ from the current one');
  });

  it('returns 404 when no matching variant mentions found', async () => {
    configureRole(mockSupabase, 'admin');

    // Update returns empty array (0 rows updated)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/entities/split', { method: 'POST', body: validSplitBody });
    const res = await entitiesSplitPost(req);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('No matching variant mentions found to split');
  });

  it('returns 200 with split result on success', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({
        data: [{ id: 1 }, { id: 2 }],
        error: null,
      }),
    );

    const req = createTestRequest('/api/entities/split', { method: 'POST', body: validSplitBody });
    const res = await entitiesSplitPost(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.split).toBe(true);
    expect(body.original).toBe('Acme Corp');
    expect(body.new_canonical_name).toBe('ACME Industries');
    expect(body.mentions_moved).toBe(2);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/entities/[canonical_name]/type
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH /api/entities/[canonical_name]/type', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/entities/Acme/type', {
      method: 'PATCH',
      body: { entity_type: 'organisation' },
    });
    const params = createTestParams({ canonical_name: 'Acme' });
    const res = await entityTypePatch(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid entity_type', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/entities/Acme/type', {
      method: 'PATCH',
      body: { entity_type: 'invalid_type' },
    });
    const params = createTestParams({ canonical_name: 'Acme' });
    const res = await entityTypePatch(req, { params });
    expect(res.status).toBe(400);
  });

  it('URL-decodes the canonical_name param', async () => {
    configureRole(mockSupabase, 'admin');
    const encodedName = encodeURIComponent('Acme Corp Ltd');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({
        data: [{ id: 1 }],
        error: null,
      }),
    );

    const req = createTestRequest(`/api/entities/${encodedName}/type`, {
      method: 'PATCH',
      body: { entity_type: 'organisation' },
    });
    const params = createTestParams({ canonical_name: encodedName });
    const res = await entityTypePatch(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.canonical_name).toBe('Acme Corp Ltd');
  });

  it('returns 404 when no mentions found for canonical name', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/entities/Unknown/type', {
      method: 'PATCH',
      body: { entity_type: 'person' },
    });
    const params = createTestParams({ canonical_name: 'Unknown' });
    const res = await entityTypePatch(req, { params });
    expect(res.status).toBe(404);
  });

  it('returns 200 with update count on success', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({
        data: [{ id: 1 }, { id: 2 }, { id: 3 }],
        error: null,
      }),
    );

    const req = createTestRequest('/api/entities/Acme/type', {
      method: 'PATCH',
      body: { entity_type: 'organisation' },
    });
    const params = createTestParams({ canonical_name: 'Acme' });
    const res = await entityTypePatch(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.updated).toBe(true);
    expect(body.entity_type).toBe('organisation');
    expect(body.mentions_updated).toBe(3);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// POST /api/embed
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/embed', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/embed', {
      method: 'POST',
      body: { text: 'hello world' },
    });
    const res = await embedPost(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role (requires editor+)', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/embed', {
      method: 'POST',
      body: { text: 'hello world' },
    });
    const res = await embedPost(req);
    expect(res.status).toBe(403);
  });

  it('returns 429 when rate limited', async () => {
    configureRole(mockSupabase, 'editor');
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const req = createTestRequest('/api/embed', {
      method: 'POST',
      body: { text: 'hello world' },
    });
    const res = await embedPost(req);
    expect(res.status).toBe(429);
  });

  it('returns 400 for missing text field', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/embed', {
      method: 'POST',
      body: {},
    });
    const res = await embedPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 200 with embedding on success', async () => {
    configureRole(mockSupabase, 'editor');
    const fakeEmbedding = new Array(1024).fill(0.1);
    mockGenerateEmbedding.mockResolvedValueOnce(fakeEmbedding);

    const req = createTestRequest('/api/embed', {
      method: 'POST',
      body: { text: 'knowledge hub content' },
    });
    const res = await embedPost(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.embedding).toEqual(fakeEmbedding);
    expect(body.model).toBe('text-embedding-3-large');
    expect(body.dimensions).toBe(1024);
  });

  it('returns 500 when generateEmbedding throws', async () => {
    configureRole(mockSupabase, 'editor');
    mockGenerateEmbedding.mockRejectedValueOnce(new Error('OpenAI API error'));

    const req = createTestRequest('/api/embed', {
      method: 'POST',
      body: { text: 'test text' },
    });
    const res = await embedPost(req);
    expect(res.status).toBe(500);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// POST /api/extract
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/extract', () => {
  const validExtractBody = {
    itemId: VALID_UUID,
    schema: { name: 'string', age: 'number' },
  };

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/extract', { method: 'POST', body: validExtractBody });
    const res = await extractPost(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role (requires editor+)', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/extract', { method: 'POST', body: validExtractBody });
    const res = await extractPost(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid body (missing itemId)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/extract', {
      method: 'POST',
      body: { schema: { name: 'string' } },
    });
    const res = await extractPost(req);
    expect(res.status).toBe(400);
  });

  it('returns AIServiceError status when extraction fails with domain error', async () => {
    configureRole(mockSupabase, 'editor');

    const { AIServiceError } = await import('@/lib/ai/errors');
    mockExtractStructuredContent.mockRejectedValueOnce(
      new AIServiceError('Content item not found', 404),
    );

    const req = createTestRequest('/api/extract', { method: 'POST', body: validExtractBody });
    const res = await extractPost(req);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Content item not found');
  });

  it('returns 200 with extraction result on success', async () => {
    configureRole(mockSupabase, 'editor');
    const extractResult = { data: { name: 'Test', age: 25 }, confidence: 0.95 };
    mockExtractStructuredContent.mockResolvedValueOnce(extractResult);

    const req = createTestRequest('/api/extract', { method: 'POST', body: validExtractBody });
    const res = await extractPost(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual(extractResult);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// GET /api/search/suggestions
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/search/suggestions', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await suggestionsGet();
    expect(res.status).toBe(401);
  });

  it('returns keywords on success', async () => {
    // getAuthenticatedClient does not use rpc, so this mockResolvedValueOnce
    // will be consumed by the route's own rpc call
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        { keyword: 'security', item_count: 15 },
        { keyword: 'compliance', item_count: 10 },
      ],
      error: null,
    });

    const res = await suggestionsGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.keywords).toEqual(['security', 'compliance']);
  });

  it('returns empty keywords array when RPC fails (graceful fallback)', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC not found', code: '42883' },
    });

    const res = await suggestionsGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.keywords).toEqual([]);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// POST /api/users/display-names
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/users/display-names', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/users/display-names', {
      method: 'POST',
      body: { ids: [VALID_UUID] },
    });
    const res = await displayNamesPost(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing ids array', async () => {
    const req = createTestRequest('/api/users/display-names', {
      method: 'POST',
      body: {},
    });
    const res = await displayNamesPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for empty ids array', async () => {
    const req = createTestRequest('/api/users/display-names', {
      method: 'POST',
      body: { ids: [] },
    });
    const res = await displayNamesPost(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when more than 50 IDs provided', async () => {
    const ids = Array.from({ length: 51 }, (_, i) =>
      `a1b2c3d4-e5f6-4890-abcd-ef12345${String(i).padStart(5, '0')}`,
    );

    const req = createTestRequest('/api/users/display-names', {
      method: 'POST',
      body: { ids },
    });
    const res = await displayNamesPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 when IDs are invalid UUIDs', async () => {
    const req = createTestRequest('/api/users/display-names', {
      method: 'POST',
      body: { ids: ['not-a-uuid', 'also-bad'] },
    });
    const res = await displayNamesPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('resolves display names from user_metadata.display_name', async () => {
    mockGetUserById.mockResolvedValueOnce({
      data: {
        user: {
          id: VALID_UUID,
          email: 'alice@example.com',
          user_metadata: { display_name: 'Alice Smith' },
        },
      },
    });

    const req = createTestRequest('/api/users/display-names', {
      method: 'POST',
      body: { ids: [VALID_UUID] },
    });
    const res = await displayNamesPost(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body[VALID_UUID]).toBe('Alice Smith');
  });

  it('falls back to email prefix when no display_name or full_name', async () => {
    mockGetUserById.mockResolvedValueOnce({
      data: {
        user: {
          id: VALID_UUID,
          email: 'bob@example.com',
          user_metadata: {},
        },
      },
    });

    const req = createTestRequest('/api/users/display-names', {
      method: 'POST',
      body: { ids: [VALID_UUID] },
    });
    const res = await displayNamesPost(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body[VALID_UUID]).toBe('bob');
  });

  it('rejects mixed valid and invalid UUIDs with validation error', async () => {
    const req = createTestRequest('/api/users/display-names', {
      method: 'POST',
      body: { ids: [VALID_UUID, 'not-valid'] },
    });
    const res = await displayNamesPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });
});

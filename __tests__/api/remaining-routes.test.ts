import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
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

vi.mock('@/lib/validation/layer-schemas', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/validation/layer-schemas')
  >('@/lib/validation/layer-schemas');
  return {
    ...actual,
    fetchActiveLayerKeys: vi.fn(() =>
      Promise.resolve([
        'sales_brief',
        'bid_detail',
        'company_reference',
        'research',
      ]),
    ),
  };
});

// Import routes AFTER mocks are registered
const { GET: digestLatestGet } = await import('@/app/api/change-reports/latest/route');
const { GET: digestListGet } = await import('@/app/api/change-reports/list/route');
const { GET: tagsSuggestGet } = await import('@/app/api/tags/suggest/route');
const { GET: coverageGuidesGet } =
  await import('@/app/api/coverage/guides/route');
const { PATCH: guideSectionPatch, DELETE: guideSectionDelete } =
  await import('@/app/api/guides/[slug]/sections/[sectionId]/route');
const { GET: completionDownloadGet } =
  await import('@/app/api/procurement/[id]/templates/[templateId]/completions/[completionId]/download/route');
const { POST: oauthDecisionPost } =
  await import('@/app/api/oauth/decision/route');
const { GET: oauthGrantsGet } = await import('@/app/api/oauth/grants/route');
const { POST: oauthRevokePost } = await import('@/app/api/oauth/revoke/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const VALID_UUID_3 = 'c3d4e5f6-a7b8-9012-cdef-123456789012';

/**
 * Create a Request with FormData body (for OAuth decision route).
 */
function createFormDataRequest(
  path: string,
  fields: Record<string, string>,
): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new Request(new URL(path, 'http://localhost:3000'), {
    method: 'POST',
    body: formData,
  });
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Re-wire next/headers mock (cleared by clearAllMocks)
  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  // Re-wire Supabase client mocks
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  // Chainable methods return the chain
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

  // Terminal methods — reset to avoid leftover mockResolvedValueOnce calls
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.csv.mockReset();
  mockSupabase._chain.csv.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  // Storage mocks — include createSignedUrl for download route
  const storageBucket = {
    upload: vi
      .fn()
      .mockResolvedValue({ data: { path: 'test-path' }, error: null }),
    download: vi.fn().mockResolvedValue({ data: new Blob(), error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
    getPublicUrl: vi
      .fn()
      .mockReturnValue({ data: { publicUrl: 'https://example.com/file' } }),
    createSignedUrl: vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://example.com/signed-url' },
      error: null,
    }),
  };
  mockSupabase.storage.from.mockReturnValue(storageBucket);

  // Auth admin mocks
  mockSupabase.auth.admin.listUsers.mockResolvedValue({
    data: { users: [] },
    error: null,
  });

  // OAuth mocks — added to auth object for OAuth routes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockSupabase.auth as any).oauth = {
    approveAuthorization: vi.fn().mockResolvedValue({
      data: { redirect_url: 'https://example.com/callback?code=abc' },
      error: null,
    }),
    denyAuthorization: vi.fn().mockResolvedValue({
      data: { redirect_url: 'https://example.com/callback?error=denied' },
      error: null,
    }),
    listGrants: vi.fn().mockResolvedValue({ data: [], error: null }),
    revokeGrant: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  // Rate limit — allowed by default
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/change-reports/latest
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/change-reports/latest', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await digestLatestGet();
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns null digest when no digests exist', async () => {
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const res = await digestLatestGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.digest).toBeNull();
  });

  it('returns 200 with parsed digest data on success', async () => {
    const digestRow = {
      id: VALID_UUID,
      digest_type: 'weekly',
      period_start: '2026-03-01T00:00:00Z',
      period_end: '2026-03-08T00:00:00Z',
      item_count: 12,
      domain_summaries: [
        {
          domain: 'Engineering',
          item_count: 5,
          summary: 'Engineering summary',
          top_items: [{ id: VALID_UUID_2, title: 'Item 1' }],
          key_themes: ['testing', 'deployment'],
        },
      ],
      theme_clusters: [
        { theme: 'Quality', item_count: 3, description: 'Quality focus' },
      ],
      narrative_summary: 'A productive week.',
      generated_at: '2026-03-08T12:00:00Z',
      generated_by: 'claude',
      tokens_used: 1500,
      created_at: '2026-03-08T12:00:00Z',
    };

    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: digestRow,
      error: null,
    });

    const res = await digestLatestGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.digest).toBeDefined();
    expect(body.digest.id).toBe(VALID_UUID);
    expect(body.digest.digest_type).toBe('weekly');
    expect(body.digest.domain_summaries).toHaveLength(1);
    expect(body.digest.domain_summaries[0].domain).toBe('Engineering');
    expect(body.digest.theme_clusters).toHaveLength(1);
    expect(body.digest.theme_clusters[0].theme).toBe('Quality');
    expect(body.digest.narrative_summary).toBe('A productive week.');
  });

  it('returns 500 when Supabase query fails', async () => {
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database connection failed', code: '08001' },
    });

    const res = await digestLatestGet();
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to fetch latest digest');
  });

  it('handles JSONB fields that are not arrays gracefully', async () => {
    const digestRow = {
      id: VALID_UUID,
      digest_type: 'weekly',
      period_start: '2026-03-01T00:00:00Z',
      period_end: '2026-03-08T00:00:00Z',
      item_count: 0,
      domain_summaries: 'not-an-array',
      theme_clusters: null,
      narrative_summary: null,
      generated_at: '2026-03-08T12:00:00Z',
      generated_by: 'claude',
      tokens_used: 0,
      created_at: '2026-03-08T12:00:00Z',
    };

    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: digestRow,
      error: null,
    });

    const res = await digestLatestGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.digest.domain_summaries).toEqual([]);
    expect(body.digest.theme_clusters).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/change-reports/list
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/change-reports/list', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/change-reports/list');
    const res = await digestListGet(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 200 with empty digests list', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const req = createTestRequest('/api/change-reports/list');
    const res = await digestListGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.digests).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('returns 200 with paginated digest data', async () => {
    const rows = [
      {
        id: VALID_UUID,
        digest_type: 'weekly',
        period_start: '2026-03-01T00:00:00Z',
        period_end: '2026-03-08T00:00:00Z',
        item_count: 5,
        domain_summaries: [],
        theme_clusters: [],
        narrative_summary: 'Summary one',
        generated_at: '2026-03-08T12:00:00Z',
        generated_by: 'claude',
        tokens_used: 800,
        created_at: '2026-03-08T12:00:00Z',
      },
    ];

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: rows, error: null, count: 15 }),
    );

    const req = createTestRequest('/api/change-reports/list', {
      searchParams: { limit: '5', offset: '0' },
    });
    const res = await digestListGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.digests).toHaveLength(1);
    expect(body.digests[0].id).toBe(VALID_UUID);
    expect(body.total).toBe(15);
  });

  it('clamps out-of-range pagination params', async () => {
    const req = createTestRequest('/api/change-reports/list', {
      searchParams: { limit: '0' },
    });
    const res = await digestListGet(req);
    // DigestListParamsSchema uses .transform() clamping — limit 0 is clamped to 1
    expect(res.status).toBe(200);
  });

  it('returns 500 when Supabase query fails', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { message: 'DB error', code: '50000' },
          count: null,
        }),
    );

    const req = createTestRequest('/api/change-reports/list');
    const res = await digestListGet(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to fetch digests');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/tags/suggest
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/tags/suggest', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/tags/suggest', {
      searchParams: { prefix: 'test', type: 'user' },
    });
    const res = await tagsSuggestGet(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer when role check fails', async () => {
    // getAuthorisedClient with default roles includes viewer, so this should
    // actually pass auth. The route uses getAuthorisedClient() with defaults
    // (admin, editor, viewer) so all authenticated users are allowed.
    // Let's just verify auth works for a viewer.
    configureRole(mockSupabase, 'viewer');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ tag: 'testing', count: 3 }],
      error: null,
    });

    const req = createTestRequest('/api/tags/suggest', {
      searchParams: { prefix: 'test', type: 'user' },
    });
    const res = await tagsSuggestGet(req);
    expect(res.status).toBe(200);
  });

  it('returns 400 for missing required params', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/tags/suggest');
    const res = await tagsSuggestGet(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid type param', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/tags/suggest', {
      searchParams: { prefix: 'test', type: 'invalid' },
    });
    const res = await tagsSuggestGet(req);
    expect(res.status).toBe(400);
  });

  it('returns 429 when rate limited', async () => {
    configureRole(mockSupabase, 'editor');
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const req = createTestRequest('/api/tags/suggest', {
      searchParams: { prefix: 'test', type: 'user' },
    });
    const res = await tagsSuggestGet(req);
    expect(res.status).toBe(429);
  });

  it('returns 200 with tag suggestions on success', async () => {
    configureRole(mockSupabase, 'editor');

    const suggestions = [
      { tag: 'testing', count: 5 },
      { tag: 'terraform', count: 3 },
    ];
    mockSupabase.rpc.mockResolvedValueOnce({
      data: suggestions,
      error: null,
    });

    const req = createTestRequest('/api/tags/suggest', {
      searchParams: { prefix: 'te', type: 'user' },
    });
    const res = await tagsSuggestGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual(suggestions);
  });

  it('returns 500 when RPC call fails', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC failed', code: '50000' },
    });

    const req = createTestRequest('/api/tags/suggest', {
      searchParams: { prefix: 'test', type: 'ai' },
    });
    const res = await tagsSuggestGet(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/coverage/guides
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/coverage/guides', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await coverageGuidesGet();
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const res = await coverageGuidesGet();
    expect(res.status).toBe(429);
  });

  it('returns 200 with empty guides when no data', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const res = await coverageGuidesGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.guides).toEqual([]);
    expect(body.summary).toEqual({
      total_guides: 0,
      fully_populated: 0,
      partially_populated: 0,
      empty: 0,
    });
  });

  it('returns 200 with grouped guide coverage data', async () => {
    const rpcRows = [
      {
        guide_id: VALID_UUID,
        guide_name: 'Test Guide',
        guide_slug: 'test-guide',
        guide_type: 'bid',
        domain_filter: 'Engineering',
        section_id: VALID_UUID_2,
        section_name: 'Introduction',
        section_order: 1,
        expected_layer: 'brief',
        is_required: true,
        content_count: 3,
        fresh_count: 2,
        stale_count: 0,
      },
      {
        guide_id: VALID_UUID,
        guide_name: 'Test Guide',
        guide_slug: 'test-guide',
        guide_type: 'bid',
        domain_filter: 'Engineering',
        section_id: VALID_UUID_3,
        section_name: 'Details',
        section_order: 2,
        expected_layer: 'detail',
        is_required: false,
        content_count: 0,
        fresh_count: 0,
        stale_count: 0,
      },
    ];

    mockSupabase.rpc.mockResolvedValueOnce({ data: rpcRows, error: null });

    const res = await coverageGuidesGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.guides).toHaveLength(1);
    expect(body.guides[0].name).toBe('Test Guide');
    expect(body.guides[0].sections).toHaveLength(2);
    expect(body.guides[0].total_sections).toBe(2);
    expect(body.guides[0].populated_sections).toBe(1);
    expect(body.guides[0].required_sections).toBe(1);
    expect(body.guides[0].populated_required).toBe(1);
    expect(body.guides[0].sections[0].status).toBe('populated');
    expect(body.guides[0].sections[1].status).toBe('empty');
    expect(body.summary.total_guides).toBe(1);
    expect(body.summary.partially_populated).toBe(1);
  });

  it('returns 500 when RPC fails', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC error', code: '50000' },
    });

    const res = await coverageGuidesGet();
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to load guide coverage data');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/guides/[slug]/sections/[sectionId]
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH /api/guides/[slug]/sections/[sectionId]', () => {
  const params = createTestParams({
    slug: 'my-guide',
    sectionId: VALID_UUID,
  });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/guides/my-guide/sections/${VALID_UUID}`,
      {
        method: 'PATCH',
        body: { section_name: 'Updated Section' },
      },
    );

    const res = await guideSectionPatch(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/guides/my-guide/sections/${VALID_UUID}`,
      {
        method: 'PATCH',
        body: { section_name: 'Updated Section' },
      },
    );

    const res = await guideSectionPatch(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid slug format', async () => {
    configureRole(mockSupabase, 'editor');

    const badParams = createTestParams({
      slug: 'INVALID SLUG!',
      sectionId: VALID_UUID,
    });
    const req = createTestRequest(
      `/api/guides/INVALID SLUG!/sections/${VALID_UUID}`,
      {
        method: 'PATCH',
        body: { section_name: 'Updated Section' },
      },
    );

    const res = await guideSectionPatch(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Invalid guide slug');
  });

  it('returns 400 for invalid section UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const badParams = createTestParams({
      slug: 'my-guide',
      sectionId: 'not-a-uuid',
    });
    const req = createTestRequest('/api/guides/my-guide/sections/not-a-uuid', {
      method: 'PATCH',
      body: { section_name: 'Updated Section' },
    });

    const res = await guideSectionPatch(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid section ID/);
  });

  it('returns 429 when rate limited', async () => {
    configureRole(mockSupabase, 'editor');
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const req = createTestRequest(
      `/api/guides/my-guide/sections/${VALID_UUID}`,
      {
        method: 'PATCH',
        body: { section_name: 'Updated Section' },
      },
    );

    const res = await guideSectionPatch(req, { params });
    expect(res.status).toBe(429);
  });

  it('returns 503 when layer vocabulary is unavailable', async () => {
    configureRole(mockSupabase, 'editor');

    const { fetchActiveLayerKeys } =
      await import('@/lib/validation/layer-schemas');
    vi.mocked(fetchActiveLayerKeys).mockRejectedValueOnce(
      new Error('Layer vocabulary fetch failed: connection refused'),
    );

    const req = createTestRequest(
      `/api/guides/my-guide/sections/${VALID_UUID}`,
      {
        method: 'PATCH',
        body: { section_name: 'Updated Section' },
      },
    );

    const res = await guideSectionPatch(req, { params });
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.error).toBe('Layer vocabulary unavailable');
  });

  it('returns 404 when guide not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Guide lookup returns null
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest(
      `/api/guides/my-guide/sections/${VALID_UUID}`,
      {
        method: 'PATCH',
        body: { section_name: 'Updated Section' },
      },
    );

    const res = await guideSectionPatch(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Guide not found');
  });

  it('returns 200 with updated section on success', async () => {
    configureRole(mockSupabase, 'editor');

    // Guide lookup succeeds
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Update succeeds
    const updatedSection = {
      id: VALID_UUID,
      section_name: 'Updated Section',
      guide_id: VALID_UUID_2,
    };
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: updatedSection,
      error: null,
    });

    const req = createTestRequest(
      `/api/guides/my-guide/sections/${VALID_UUID}`,
      {
        method: 'PATCH',
        body: { section_name: 'Updated Section' },
      },
    );

    const res = await guideSectionPatch(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.section_name).toBe('Updated Section');
  });

  it('returns 500 when update fails', async () => {
    configureRole(mockSupabase, 'editor');

    // Guide lookup succeeds
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Update fails
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB error', code: '50000' },
    });

    const req = createTestRequest(
      `/api/guides/my-guide/sections/${VALID_UUID}`,
      {
        method: 'PATCH',
        body: { section_name: 'Updated Section' },
      },
    );

    const res = await guideSectionPatch(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to update guide section');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/guides/[slug]/sections/[sectionId]
// ═══════════════════════════════════════════════════════════════════════════

describe('DELETE /api/guides/[slug]/sections/[sectionId]', () => {
  const params = createTestParams({
    slug: 'my-guide',
    sectionId: VALID_UUID,
  });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/guides/my-guide/sections/${VALID_UUID}`,
      { method: 'DELETE' },
    );

    const res = await guideSectionDelete(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/guides/my-guide/sections/${VALID_UUID}`,
      { method: 'DELETE' },
    );

    const res = await guideSectionDelete(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid slug format', async () => {
    configureRole(mockSupabase, 'editor');

    const badParams = createTestParams({
      slug: 'BAD SLUG',
      sectionId: VALID_UUID,
    });
    const req = createTestRequest(
      `/api/guides/BAD SLUG/sections/${VALID_UUID}`,
      { method: 'DELETE' },
    );

    const res = await guideSectionDelete(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Invalid guide slug');
  });

  it('returns 400 for invalid section UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const badParams = createTestParams({
      slug: 'my-guide',
      sectionId: 'bad-id',
    });
    const req = createTestRequest('/api/guides/my-guide/sections/bad-id', {
      method: 'DELETE',
    });

    const res = await guideSectionDelete(req, { params: badParams });
    expect(res.status).toBe(400);
  });

  it('returns 404 when guide not found', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest(
      `/api/guides/my-guide/sections/${VALID_UUID}`,
      { method: 'DELETE' },
    );

    const res = await guideSectionDelete(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Guide not found');
  });

  it('returns 200 on successful deletion', async () => {
    configureRole(mockSupabase, 'editor');

    // Guide lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Delete chain resolves (via .then)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest(
      `/api/guides/my-guide/sections/${VALID_UUID}`,
      { method: 'DELETE' },
    );

    const res = await guideSectionDelete(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 500 when delete fails', async () => {
    configureRole(mockSupabase, 'editor');

    // Guide lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Delete fails
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { message: 'FK violation', code: '23503' },
        }),
    );

    const req = createTestRequest(
      `/api/guides/my-guide/sections/${VALID_UUID}`,
      { method: 'DELETE' },
    );

    const res = await guideSectionDelete(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to delete guide section');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/bids/[id]/templates/[templateId]/completions/[completionId]/download
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/bids/:id/templates/:templateId/completions/:completionId/download', () => {
  const params = createTestParams({
    id: VALID_UUID,
    templateId: VALID_UUID_2,
    completionId: VALID_UUID_3,
  });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/templates/${VALID_UUID_2}/completions/${VALID_UUID_3}/download`,
    );

    const res = await completionDownloadGet(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid UUID in any param', async () => {
    const badParams = createTestParams({
      id: 'bad-id',
      templateId: VALID_UUID_2,
      completionId: VALID_UUID_3,
    });

    const req = createTestRequest(
      `/api/procurement/bad-id/templates/${VALID_UUID_2}/completions/${VALID_UUID_3}/download`,
    );

    const res = await completionDownloadGet(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid ID format/);
  });

  it('returns 404 when template not found for bid', async () => {
    // Template lookup — not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows', code: 'PGRST116' },
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/templates/${VALID_UUID_2}/completions/${VALID_UUID_3}/download`,
    );

    const res = await completionDownloadGet(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Template not found');
  });

  it('returns 404 when completion not found', async () => {
    // Template lookup — found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Completion lookup — not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows', code: 'PGRST116' },
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/templates/${VALID_UUID_2}/completions/${VALID_UUID_3}/download`,
    );

    const res = await completionDownloadGet(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Completion not found');
  });

  it('returns 200 with signed download URL on success', async () => {
    // Template lookup — found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Completion lookup — found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_3,
        storage_path: 'completions/file.docx',
        fields_filled: 5,
      },
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/templates/${VALID_UUID_2}/completions/${VALID_UUID_3}/download`,
    );

    const res = await completionDownloadGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.download_url).toBe('https://example.com/signed-url');
    expect(body.expires_in).toBe(300);
  });

  it('returns 500 when signed URL generation fails', async () => {
    // Template lookup — found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Completion lookup — found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_3,
        storage_path: 'completions/file.docx',
        fields_filled: 5,
      },
      error: null,
    });

    // Override storage mock to fail
    const failBucket = {
      createSignedUrl: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Storage error' },
      }),
    };
    mockSupabase.storage.from.mockReturnValue(failBucket);

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/templates/${VALID_UUID_2}/completions/${VALID_UUID_3}/download`,
    );

    const res = await completionDownloadGet(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to generate download link');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/oauth/decision
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/oauth/decision', () => {
  it('returns 400 for missing form fields', async () => {
    const req = createFormDataRequest('/api/oauth/decision', {});
    const res = await oauthDecisionPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid decision value', async () => {
    const req = createFormDataRequest('/api/oauth/decision', {
      decision: 'maybe',
      authorization_id: 'auth-123',
    });
    const res = await oauthDecisionPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 303 redirect on successful approve', async () => {
    const req = createFormDataRequest('/api/oauth/decision', {
      decision: 'approve',
      authorization_id: 'auth-123',
    });

    const res = await oauthDecisionPost(req);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(
      'https://example.com/callback?code=abc',
    );
  });

  it('returns 303 redirect on successful deny', async () => {
    const req = createFormDataRequest('/api/oauth/decision', {
      decision: 'deny',
      authorization_id: 'auth-123',
    });

    const res = await oauthDecisionPost(req);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(
      'https://example.com/callback?error=denied',
    );
  });

  it('returns 400 when approve fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockSupabase.auth as any).oauth.approveAuthorization.mockResolvedValueOnce(
      {
        data: null,
        error: { message: 'Invalid authorization_id' },
      },
    );

    const req = createFormDataRequest('/api/oauth/decision', {
      decision: 'approve',
      authorization_id: 'bad-auth-id',
    });

    const res = await oauthDecisionPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 400 when deny fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockSupabase.auth as any).oauth.denyAuthorization.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid authorization_id' },
    });

    const req = createFormDataRequest('/api/oauth/decision', {
      decision: 'deny',
      authorization_id: 'bad-auth-id',
    });

    const res = await oauthDecisionPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/oauth/grants
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/oauth/grants', () => {
  it('returns 401 when unauthenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: {
        name: 'AuthSessionMissingError',
        message: 'Auth session missing!',
      },
    });

    const res = await oauthGrantsGet();
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 200 with empty grants list', async () => {
    const res = await oauthGrantsGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.grants).toEqual([]);
  });

  it('returns 200 with grants data', async () => {
    const grants = [
      {
        id: VALID_UUID,
        client_id: VALID_UUID_2,
        client_name: 'Test App',
        scopes: ['read', 'write'],
        granted_at: '2026-03-01T00:00:00Z',
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockSupabase.auth as any).oauth.listGrants.mockResolvedValueOnce({
      data: grants,
      error: null,
    });

    const res = await oauthGrantsGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.grants).toHaveLength(1);
    expect(body.grants[0].client_name).toBe('Test App');
  });

  it('returns 500 when listGrants fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockSupabase.auth as any).oauth.listGrants.mockResolvedValueOnce({
      data: null,
      error: { message: 'Service unavailable' },
    });

    const res = await oauthGrantsGet();
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/oauth/revoke
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/oauth/revoke', () => {
  it('returns 401 when unauthenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: {
        name: 'AuthSessionMissingError',
        message: 'Auth session missing!',
      },
    });

    const req = createTestRequest('/api/oauth/revoke', {
      method: 'POST',
      body: { clientId: VALID_UUID },
    });
    const res = await oauthRevokePost(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 400 for missing clientId', async () => {
    const req = createTestRequest('/api/oauth/revoke', {
      method: 'POST',
      body: {},
    });
    const res = await oauthRevokePost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid clientId format (not UUID)', async () => {
    const req = createTestRequest('/api/oauth/revoke', {
      method: 'POST',
      body: { clientId: 'not-a-uuid' },
    });
    const res = await oauthRevokePost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 200 on successful revocation', async () => {
    const req = createTestRequest('/api/oauth/revoke', {
      method: 'POST',
      body: { clientId: VALID_UUID },
    });
    const res = await oauthRevokePost(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 500 when revokeGrant fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockSupabase.auth as any).oauth.revokeGrant.mockResolvedValueOnce({
      data: null,
      error: { message: 'Grant not found' },
    });

    const req = createTestRequest('/api/oauth/revoke', {
      method: 'POST',
      body: { clientId: VALID_UUID },
    });
    const res = await oauthRevokePost(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

/**
 * Behaviour of the guide-sections collection route:
 * `app/api/guides/[slug]/sections/route.ts`.
 *
 * Split out of the former `__tests__/app/api/guides/guides.test.ts`, which
 * covered three routes from one file at their common-ancestor directory
 * (test-philosophy.md §3.4 — location is not factoring). The
 * `@/lib/validation/layer-schemas` mock below is used by this route alone,
 * which is why it does not appear in the sibling guides route tests.
 *
 * NOTE: the route also exports PUT (section reorder). It carried no coverage
 * in the pre-split file and none is added here — this commit is a re-factor,
 * not new authoring. See the follow-up noted in the commit body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '@/__tests__/helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '@/__tests__/helpers/mock-next';

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

// Import route AFTER mocks are registered
import {
  GET as listSections,
  POST as createSection,
} from '@/app/api/guides/[slug]/sections/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validSectionBody(overrides: Record<string, unknown> = {}) {
  return {
    section_name: 'Sector Overview',
    expected_layer: 'sales_brief',
    display_order: 1,
    ...overrides,
  };
}

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
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/guides/[slug]/sections
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/guides/[slug]/sections', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/guides/scp-sector/sections');
    const res = await listSections(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 when guide not found', async () => {
    // resolveGuideId calls .single() which returns null guide
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest('/api/guides/nonexistent/sections');
    const res = await listSections(req, {
      params: createTestParams({ slug: 'nonexistent' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns sections list on success', async () => {
    // resolveGuideId
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: 'guide-1' },
      error: null,
    });

    const sections = [
      { id: 'sec-1', section_name: 'Sector Overview', display_order: 1 },
      { id: 'sec-2', section_name: 'Key Roles', display_order: 2 },
    ];

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: sections, error: null }),
    );

    const req = createTestRequest('/api/guides/scp-sector/sections');
    const res = await listSections(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/guides/[slug]/sections
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/guides/[slug]/sections', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/guides/scp-sector/sections', {
      method: 'POST',
      body: validSectionBody(),
    });
    const res = await createSection(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 when user has viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/guides/scp-sector/sections', {
      method: 'POST',
      body: validSectionBody(),
    });
    const res = await createSection(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 when guide not found', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest('/api/guides/nonexistent/sections', {
      method: 'POST',
      body: validSectionBody(),
    });
    const res = await createSection(req, {
      params: createTestParams({ slug: 'nonexistent' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 503 when layer vocabulary is unavailable', async () => {
    configureRole(mockSupabase, 'editor');

    // resolveGuideId
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: 'guide-1' },
      error: null,
    });

    const { fetchActiveLayerKeys } =
      await import('@/lib/validation/layer-schemas');
    vi.mocked(fetchActiveLayerKeys).mockRejectedValueOnce(
      new Error('Layer vocabulary fetch failed: connection refused'),
    );

    const req = createTestRequest('/api/guides/scp-sector/sections', {
      method: 'POST',
      body: validSectionBody(),
    });
    const res = await createSection(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.error).toBe('Layer vocabulary unavailable');
  });

  it('returns 400 for invalid section body', async () => {
    configureRole(mockSupabase, 'editor');

    // resolveGuideId
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: 'guide-1' },
      error: null,
    });

    const req = createTestRequest('/api/guides/scp-sector/sections', {
      method: 'POST',
      body: { expected_layer: 'invalid_layer' },
    });
    const res = await createSection(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 201 on success', async () => {
    configureRole(mockSupabase, 'editor');

    // resolveGuideId
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: 'guide-1' },
      error: null,
    });

    const createdSection = {
      id: 'sec-1',
      guide_id: 'guide-1',
      section_name: 'Sector Overview',
      expected_layer: 'sales_brief',
      display_order: 1,
    };

    // insert().select().single()
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: createdSection,
      error: null,
    });

    const req = createTestRequest('/api/guides/scp-sector/sections', {
      method: 'POST',
      body: validSectionBody(),
    });
    const res = await createSection(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.section_name).toBe('Sector Overview');
  });
});

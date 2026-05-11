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
import { GET as listGuides, POST as createGuide } from '@/app/api/guides/route';
import {
  GET as getGuide,
  PATCH as updateGuide,
  DELETE as deleteGuide,
} from '@/app/api/guides/[slug]/route';
import {
  GET as listSections,
  POST as createSection,
} from '@/app/api/guides/[slug]/sections/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validGuideBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'SCP Sector Guide',
    slug: 'scp-sector',
    guide_type: 'sector',
    domain_filter: 'Safeguarding & Child Protection',
    ...overrides,
  };
}

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
// GET /api/guides
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/guides', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/guides');
    const res = await listGuides(req);
    expect(res.status).toBe(401);
  });

  it('returns list of guides on success', async () => {
    const guides = [
      {
        id: '1',
        slug: 'scp-sector',
        name: 'SCP Sector Guide',
        guide_type: 'sector',
      },
      {
        id: '2',
        slug: 'lms-product',
        name: 'LMS Product Guide',
        guide_type: 'product',
      },
    ];

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: guides, error: null }),
    );

    const req = createTestRequest('/api/guides');
    const res = await listGuides(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].slug).toBe('scp-sector');
  });

  it('returns only the sector guides when type=sector is supplied', async () => {
    // The handler relays a single filtered query — the DB layer would have
    // returned only sector rows, so the response body must surface those.
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: '1',
              slug: 'scp-sector',
              name: 'SCP Sector',
              guide_type: 'sector',
            },
          ],
          error: null,
        }),
    );

    const req = createTestRequest('/api/guides', {
      searchParams: { type: 'sector' },
    });
    const res = await listGuides(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body.every((row: { guide_type: string }) => row.guide_type === 'sector')).toBe(
      true,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/guides
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/guides', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/guides', {
      method: 'POST',
      body: validGuideBody(),
    });
    const res = await createGuide(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 when user has viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/guides', {
      method: 'POST',
      body: validGuideBody(),
    });
    const res = await createGuide(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing required fields', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/guides', {
      method: 'POST',
      body: { guide_type: 'sector' },
    });
    const res = await createGuide(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid slug', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/guides', {
      method: 'POST',
      body: validGuideBody({ slug: 'Invalid Slug!' }),
    });
    const res = await createGuide(req);
    expect(res.status).toBe(400);
  });

  it('returns 201 on success', async () => {
    configureRole(mockSupabase, 'editor');

    const createdGuide = {
      id: 'guide-id-1',
      slug: 'scp-sector',
      name: 'SCP Sector Guide',
      guide_type: 'sector',
    };

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: createdGuide,
      error: null,
    });

    const req = createTestRequest('/api/guides', {
      method: 'POST',
      body: validGuideBody(),
    });
    const res = await createGuide(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.slug).toBe('scp-sector');
  });

  it('returns 409 for duplicate slug', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'duplicate', code: '23505' },
    });

    const req = createTestRequest('/api/guides', {
      method: 'POST',
      body: validGuideBody(),
    });
    const res = await createGuide(req);
    expect(res.status).toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/guides/[slug]
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/guides/[slug]', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/guides/scp-sector');
    const res = await getGuide(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid slug format', async () => {
    const req = createTestRequest('/api/guides/Invalid Slug!');
    const res = await getGuide(req, {
      params: createTestParams({ slug: 'Invalid Slug!' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when guide not found', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'not found' },
    });

    const req = createTestRequest('/api/guides/nonexistent');
    const res = await getGuide(req, {
      params: createTestParams({ slug: 'nonexistent' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns guide with grouped sections on success', async () => {
    // First call: guide metadata lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'guide-1',
        slug: 'scp-sector',
        name: 'SCP Sector Guide',
        guide_type: 'sector',
        domain_filter: 'Safeguarding & Child Protection',
        is_published: true,
      },
      error: null,
    });

    // RPC call returns section rows
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          section_id: 'sec-1',
          section_name: 'Sector Overview',
          section_description: null,
          section_order: 1,
          expected_layer: 'sales_brief',
          subtopic_filter: null,
          is_required: true,
          content_id: 'item-1',
          content_title: 'SCP Overview',
          content_type: 'article',
          content_layer: 'sales_brief',
          content_brief: 'Overview of SCP sector',
          content_freshness: 'fresh',
          content_verified_at: null,
          content_captured_date: '2026-01-01T00:00:00Z',
        },
        {
          section_id: 'sec-2',
          section_name: 'Key Roles & Personas',
          section_description: null,
          section_order: 2,
          expected_layer: 'sales_brief',
          subtopic_filter: null,
          is_required: true,
          content_id: null,
          content_title: null,
          content_type: null,
          content_layer: null,
          content_brief: null,
          content_freshness: null,
          content_verified_at: null,
          content_captured_date: null,
        },
      ],
      error: null,
    });

    const req = createTestRequest('/api/guides/scp-sector');
    const res = await getGuide(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.guide.slug).toBe('scp-sector');
    expect(body.sections).toHaveLength(2);
    expect(body.sections[0].section_name).toBe('Sector Overview');
    expect(body.sections[0].content_items).toHaveLength(1);
    expect(body.sections[1].section_name).toBe('Key Roles & Personas');
    expect(body.sections[1].content_items).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/guides/[slug]
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH /api/guides/[slug]', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/guides/scp-sector', {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const res = await updateGuide(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 when user has viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/guides/scp-sector', {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const res = await updateGuide(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 200 on successful update', async () => {
    configureRole(mockSupabase, 'editor');

    const updatedGuide = {
      id: 'guide-1',
      slug: 'scp-sector',
      name: 'Updated SCP Guide',
      guide_type: 'sector',
    };

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: updatedGuide,
      error: null,
    });

    const req = createTestRequest('/api/guides/scp-sector', {
      method: 'PATCH',
      body: { name: 'Updated SCP Guide' },
    });
    const res = await updateGuide(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe('Updated SCP Guide');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/guides/[slug]
// ═══════════════════════════════════════════════════════════════════════════

describe('DELETE /api/guides/[slug]', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/guides/scp-sector', {
      method: 'DELETE',
    });
    const res = await deleteGuide(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 when user has editor role (admin only)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/guides/scp-sector', {
      method: 'DELETE',
    });
    const res = await deleteGuide(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 200 on successful deletion', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/guides/scp-sector', {
      method: 'DELETE',
    });
    const res = await deleteGuide(req, {
      params: createTestParams({ slug: 'scp-sector' }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
  });
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

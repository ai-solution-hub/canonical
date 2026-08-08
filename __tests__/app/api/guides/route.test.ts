/**
 * Behaviour of the guides collection route: `app/api/guides/route.ts`
 * (GET listing + POST create), plus the regression guard for the retired
 * GET `?include=stats` leg.
 *
 * The GET/POST blocks were merged in from the former
 * `__tests__/app/api/guides/guides.test.ts`, which covered three routes from
 * one file at their common-ancestor directory (test-philosophy.md §3.4 —
 * location is not factoring). That file and this one both exercised
 * `GET /api/guides`, but never the same behaviour: this file only ever
 * covered the retired `?include=stats` query leg. Nothing was duplicated, so
 * nothing is dropped — the two sets are unioned here.
 *
 * Retired-leg context — ID-131.19 fix-Executor escalation 2b (DR-034 owner
 * ruling): the content_items-era coverage feature is retired, not re-pointed
 * — this includes the guide-listing `?include=stats` enrichment, whose only
 * data source was the now-dropped `get_guide_coverage()` RPC. Those tests
 * used to assert the enrichment behaviour; they now pin the honest opposite
 * — `include=stats` is inert (ignored, not erroring) and the RPC is never
 * called, so a future edit can't silently resurrect the retired call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '@/__tests__/helpers/mock-supabase';
import { createTestRequest } from '@/__tests__/helpers/mock-next';

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

// Import route AFTER mocks are registered
import { GET as listGuides, POST as createGuide } from '@/app/api/guides/route';

// ---------------------------------------------------------------------------
// Test data
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

// `guideA` / `guideB` are fully-populated rows. The listing tests further down
// deliberately use sparse rows (id/slug/name/guide_type only) instead: the
// route's own `GuideRowSchema` marks every other projected column `.optional()`
// precisely because those sparse assertions exist, so both row shapes are
// load-bearing and must not be unified into one fixture.
const GUIDE_A_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const GUIDE_B_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

const guideA = {
  id: GUIDE_A_ID,
  slug: 'scp-sector',
  name: 'SCP Sector Guide',
  guide_type: 'sector',
  domain_filter: 'Safeguarding & Child Protection',
  icon: null,
  color: null,
  display_order: 1,
  is_published: true,
  created_by: 'user-1',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const guideB = {
  id: GUIDE_B_ID,
  slug: 'lms-product',
  name: 'LMS Product Guide',
  guide_type: 'product',
  domain_filter: 'Learning Management Systems',
  icon: null,
  color: null,
  display_order: 2,
  is_published: true,
  created_by: 'user-1',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

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
    expect(
      body.every((row: { guide_type: string }) => row.guide_type === 'sector'),
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/guides?include=stats (retired leg — ID-131.19 escalation 2b)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/guides?include=stats (retired)', () => {
  it('returns guides with no stats field, even when include=stats is requested', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [guideA, guideB], error: null }),
    );

    const req = createTestRequest('/api/guides', {
      searchParams: { include: 'stats' },
    });
    const res = await listGuides(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].stats).toBeUndefined();
    expect(body[1].stats).toBeUndefined();
  });

  it('never calls the retired get_guide_coverage RPC, even when include=stats is requested', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [guideA, guideB], error: null }),
    );

    const req = createTestRequest('/api/guides', {
      searchParams: { include: 'stats' },
    });
    await listGuides(req);

    expect(mockSupabase.rpc).not.toHaveBeenCalledWith('get_guide_coverage');
  });

  it('returns an empty array when no guides exist, regardless of include=stats', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/guides', {
      searchParams: { include: 'stats' },
    });
    const res = await listGuides(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
    expect(mockSupabase.rpc).not.toHaveBeenCalledWith('get_guide_coverage');
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

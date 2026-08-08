/**
 * Behaviour of the single-guide route: `app/api/guides/[slug]/route.ts`.
 *
 * Split out of the former `__tests__/app/api/guides/guides.test.ts`, which
 * covered three routes from one file at their common-ancestor directory
 * (test-philosophy.md §3.4 — location is not factoring).
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

// Import route AFTER mocks are registered
import {
  GET as getGuide,
  PATCH as updateGuide,
  DELETE as deleteGuide,
} from '@/app/api/guides/[slug]/route';

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

    // RPC call returns section rows.
    //
    // Every content_* column is NULL because that is what the real RPC
    // returns: ID-131 M6 dropped content_items, and
    // 20260707210000_fix_get_guide_content_content_items_residue.sql
    // rewrote get_guide_content to select NULL::<type> for all eight
    // content_* columns by construction. This mock used to hand sec-1 a
    // populated content_id, which asserted a grouping branch the live RPC
    // could never trigger.
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
          content_id: null,
          content_title: null,
          content_type: null,
          content_layer: null,
          content_brief: null,
          content_freshness: null,
          content_verified_at: null,
          content_captured_date: null,
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
    // Grouped by section_id and ordered by section_order — the behaviour
    // this route still owns.
    expect(body.sections[0].section_name).toBe('Sector Overview');
    expect(body.sections[1].section_name).toBe('Key Roles & Personas');
    // Always empty: no successor table carries per-row content matching.
    expect(body.sections[0].content_items).toHaveLength(0);
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

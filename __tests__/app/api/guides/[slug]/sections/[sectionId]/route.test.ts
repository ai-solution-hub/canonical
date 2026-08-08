/**
 * PATCH + DELETE /api/guides/[slug]/sections/[sectionId]
 *
 * Split out of the former `__tests__/app/api/remaining-routes.test.ts`
 * catch-all (test-tree workstream 2b) so each production route has exactly one
 * test file.
 *
 * Provenance carried over from that file: `GET /api/coverage/guides` was
 * retired under ID-131.19 fix-Executor escalation 2 (DR-034 owner ruling) —
 * the content_items-era coverage feature is retired, not re-pointed. The
 * backing `get_guide_coverage` RPC's last live caller (the `?include=stats`
 * leg of `app/api/guides/route.ts`) was retired in escalation 2b; that route's
 * current coverage-free behaviour is pinned by
 * `__tests__/app/api/guides/route.test.ts`, and the DROP FUNCTION statements
 * live in `supabase/migrations/20260706104000_id131_coverage_retire.sql`.
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
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCheckRateLimit } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
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

// Import the route AFTER mocks are registered
import {
  PATCH as guideSectionPatch,
  DELETE as guideSectionDelete,
} from '@/app/api/guides/[slug]/sections/[sectionId]/route';

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

beforeEach(() => {
  vi.clearAllMocks();

  // Re-wire Supabase client mocks
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  // Chainable methods return the chain
  for (const m of ['select', 'update', 'delete', 'eq'] as const) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  // Terminal methods — reset to avoid leftover mockResolvedValueOnce calls
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  // Rate limit — allowed by default
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
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

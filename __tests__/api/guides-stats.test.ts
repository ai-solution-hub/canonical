/**
 * Regression guard for the retired GET /api/guides `?include=stats` leg.
 *
 * ID-131.19 fix-Executor escalation 2b (DR-034 owner ruling): the
 * content_items-era coverage feature is retired, not re-pointed — this
 * includes the guide-listing `?include=stats` enrichment, whose only data
 * source was the now-dropped `get_guide_coverage()` RPC. This file used to
 * assert the enrichment behaviour; it now pins the honest opposite —
 * `include=stats` is inert (ignored, not erroring) and the RPC is never
 * called, so a future edit can't silently resurrect the retired call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

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
import { GET as listGuides } from '@/app/api/guides/route';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

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

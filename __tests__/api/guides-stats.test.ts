/**
 * Tests for GET /api/guides?include=stats
 *
 * Verifies that guide listing stats use the get_guide_coverage() RPC
 * (the same source as the coverage page) rather than a manual calculation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
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

/** Coverage rows returned by get_guide_coverage() RPC */
function makeCoverageRow(overrides: Record<string, unknown> = {}) {
  return {
    guide_id: GUIDE_A_ID,
    guide_name: 'SCP Sector Guide',
    guide_slug: 'scp-sector',
    guide_type: 'sector',
    domain_filter: 'Safeguarding & Child Protection',
    section_id: 'sec-1',
    section_name: 'Overview',
    section_order: 1,
    expected_layer: 'sales_brief',
    is_required: true,
    content_count: 3,
    fresh_count: 2,
    stale_count: 1,
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
// GET /api/guides?include=stats
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/guides?include=stats', () => {
  it('returns RPC-based stats enriched on each guide', async () => {
    // Guide list query returns two guides
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [guideA, guideB], error: null }),
    );

    // RPC returns coverage rows for guide A (2 sections) and guide B (1 section)
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        makeCoverageRow({
          guide_id: GUIDE_A_ID,
          section_id: 'sec-1',
          is_required: true,
          content_count: 3,
        }),
        makeCoverageRow({
          guide_id: GUIDE_A_ID,
          section_id: 'sec-2',
          is_required: false,
          content_count: 0,
        }),
        makeCoverageRow({
          guide_id: GUIDE_B_ID,
          section_id: 'sec-3',
          is_required: true,
          content_count: 5,
          guide_name: 'LMS Product Guide',
        }),
      ],
      error: null,
    });

    const req = createTestRequest('/api/guides', {
      searchParams: { include: 'stats' },
    });
    const res = await listGuides(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);

    // Guide A: 2 total, 1 populated, 1 required, 1 populated_required
    expect(body[0].stats).toEqual({
      total_sections: 2,
      populated_sections: 1,
      required_sections: 1,
      populated_required: 1,
    });

    // Guide B: 1 total, 1 populated, 1 required, 1 populated_required
    expect(body[1].stats).toEqual({
      total_sections: 1,
      populated_sections: 1,
      required_sections: 1,
      populated_required: 1,
    });

    // Verify the RPC was called
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_guide_coverage');
  });

  it('handles RPC error gracefully by returning guides without stats', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [guideA], error: null }),
    );

    // RPC returns an error
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC function not found', code: '42883' },
    });

    const req = createTestRequest('/api/guides', {
      searchParams: { include: 'stats' },
    });
    const res = await listGuides(req);
    const body = await res.json();

    // Should still return 200 with guides (without stats)
    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(GUIDE_A_ID);
    // No stats property when RPC fails — falls through to plain data return
    expect(body[0].stats).toBeUndefined();
  });

  it('returns empty array when no guides exist', async () => {
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
    // RPC should NOT be called when there are no guides
    expect(mockSupabase.rpc).not.toHaveBeenCalledWith('get_guide_coverage');
  });

  it('correctly aggregates stats from multiple section-level rows per guide', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [guideA], error: null }),
    );

    // 4 sections for guide A with varying properties
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        makeCoverageRow({
          section_id: 'sec-1',
          is_required: true,
          content_count: 5,
        }),
        makeCoverageRow({
          section_id: 'sec-2',
          is_required: true,
          content_count: 0,
        }),
        makeCoverageRow({
          section_id: 'sec-3',
          is_required: false,
          content_count: 2,
        }),
        makeCoverageRow({
          section_id: 'sec-4',
          is_required: false,
          content_count: 0,
        }),
      ],
      error: null,
    });

    const req = createTestRequest('/api/guides', {
      searchParams: { include: 'stats' },
    });
    const res = await listGuides(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].stats).toEqual({
      total_sections: 4,
      populated_sections: 2, // sec-1 and sec-3 have content
      required_sections: 2, // sec-1 and sec-2 are required
      populated_required: 1, // only sec-1 is both required and populated
    });
  });

  it('handles guides with zero content across all sections', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [guideA, guideB], error: null }),
    );

    // All sections have content_count = 0
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        makeCoverageRow({
          guide_id: GUIDE_A_ID,
          section_id: 'sec-1',
          is_required: true,
          content_count: 0,
        }),
        makeCoverageRow({
          guide_id: GUIDE_A_ID,
          section_id: 'sec-2',
          is_required: false,
          content_count: 0,
        }),
      ],
      error: null,
    });

    const req = createTestRequest('/api/guides', {
      searchParams: { include: 'stats' },
    });
    const res = await listGuides(req);
    const body = await res.json();

    expect(res.status).toBe(200);

    // Guide A has sections but all empty
    expect(body[0].stats).toEqual({
      total_sections: 2,
      populated_sections: 0,
      required_sections: 1,
      populated_required: 0,
    });

    // Guide B has no coverage rows at all — gets default zeros
    expect(body[1].stats).toEqual({
      total_sections: 0,
      populated_sections: 0,
      required_sections: 0,
      populated_required: 0,
    });
  });
});

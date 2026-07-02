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

const { mockCookies } = vi.hoisted(() => {
  return {
    mockCookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Suppress console.error noise from error handling paths
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handler + escape helper under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { GET, escapeIlike } from '@/app/api/search/preview/route';

// Reset the rate-limit store between tests so each test is independent
import { _resetRateLimitStore } from '@/lib/rate-limit';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/search/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimitStore();

    // Re-wire next/headers mock (cleared by clearAllMocks)
    mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

    // Default authenticated user
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });

    // Default chain response — resolves to empty array when awaited
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );
  });

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/search/preview', {
      searchParams: { q: 'test' },
    });

    const res = await GET(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 500 when auth service fails', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: {
        name: 'AuthApiError',
        message: 'Auth service unavailable',
        status: 503,
      },
    });

    const req = createTestRequest('/api/search/preview', {
      searchParams: { q: 'test' },
    });

    const res = await GET(req);
    expect(res.status).toBe(500);
  });

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  it('returns 400 when q param is missing', async () => {
    const req = createTestRequest('/api/search/preview');

    const res = await GET(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    // `parseSearchParams` returns { error: 'Validation failed', details: [...] }
    expect(json.error).toBe('Validation failed');
    expect(json.details).toBeDefined();
    expect(json.details.some((d: { field: string }) => d.field === 'q')).toBe(
      true,
    );
  });

  it('returns 400 when q param is empty after trim', async () => {
    const req = createTestRequest('/api/search/preview', {
      searchParams: { q: '   ' },
    });

    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  // -----------------------------------------------------------------------
  // Results
  // -----------------------------------------------------------------------

  it('merges typed-record matches into the 4-field shape with owner_kind content_type', async () => {
    // ID-131.11 G-SEARCH (§9): the preview runs THREE ilike queries — over
    // source_documents, q_a_pairs, and reference_items — and merges them into
    // a unified { id, title, content_type, primary_domain } shape where
    // content_type carries the owner_kind. `sb()` awaits each chain in array
    // order, so the shared `_chain.then` resolves in that Promise.all order.
    const sourceDocRows = [
      {
        id: 'sd-1',
        filename: 'risk-report.pdf',
        suggested_title: 'Risk Assessment Guide',
        primary_domain: 'governance',
      },
    ];
    const qaPairRows = [
      { id: 'qa-1', question_text: 'What is the risk escalation policy?' },
    ];
    const refItemRows = [
      { id: 'ri-1', title: 'Safety Policy', primary_domain: null },
    ];

    mockSupabase._chain.then
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: sourceDocRows, error: null, count: 1 }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: qaPairRows, error: null, count: 1 }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: refItemRows, error: null, count: 1 }),
      );

    const req = createTestRequest('/api/search/preview', {
      searchParams: { q: 'risk' },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.results).toHaveLength(3);
    expect(json.count).toBe(3);

    // Merged 4-field shape — `layer` is retired with content_items.
    for (const result of json.results) {
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('content_type');
      expect(result).toHaveProperty('primary_domain');
      expect(result).not.toHaveProperty('layer');
    }

    const byId = Object.fromEntries(
      (json.results as Array<Record<string, unknown>>).map((r) => [r.id, r]),
    );
    // content_type carries the owner_kind of each typed-record class.
    expect(byId['sd-1'].content_type).toBe('source_document');
    expect(byId['qa-1'].content_type).toBe('q_a_pair');
    expect(byId['ri-1'].content_type).toBe('reference_item');
    // Title resolves per class: suggested_title ?? filename / question_text / title.
    expect(byId['sd-1'].title).toBe('Risk Assessment Guide');
    expect(byId['qa-1'].title).toBe('What is the risk escalation policy?');
    expect(byId['ri-1'].title).toBe('Safety Policy');
    // q_a_pairs carry no primary_domain column — null in the merged preview shape.
    expect(byId['qa-1'].primary_domain).toBeNull();
  });

  it('sorts title matches before content-only matches', async () => {
    // Two reference_items — one whose title contains the query, one that does
    // not. source_documents + q_a_pairs resolve empty so the sort is the only
    // variable under test.
    const refItemRows = [
      { id: 'content-only', title: 'General Policy', primary_domain: null },
      {
        id: 'title-match',
        title: 'Risk Assessment Guide',
        primary_domain: 'governance',
      },
    ];

    mockSupabase._chain.then
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: refItemRows, error: null, count: 2 }),
      );

    const req = createTestRequest('/api/search/preview', {
      searchParams: { q: 'risk' },
    });

    const res = await GET(req);
    const json = await res.json();

    // Title-match item ("Risk Assessment Guide" contains "risk") should come first
    expect(json.results[0].id).toBe('title-match');
    expect(json.results[1].id).toBe('content-only');
  });

  // -----------------------------------------------------------------------
  // NOTE — limit cap-at-20 / default-of-8 contracts are migrated to the
  // integration tier under W-RD'. Chain-method asserts on `_chain.limit`
  // coupled to the mock builder rather than observable response shape;
  // the route does not surface its applied limit in the JSON envelope so
  // the only honest verification is at integration tier against the real
  // DB. See remediation-plan.md §3.4 / §3.5.
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Escape helper (pure function — tested directly)
  // -----------------------------------------------------------------------

  describe('escapeIlike', () => {
    it('escapes % wildcard', () => {
      expect(escapeIlike('50% off')).toBe('50\\% off');
    });

    it('escapes _ wildcard', () => {
      expect(escapeIlike('hello_world')).toBe('hello\\_world');
    });

    it('escapes \\ backslash', () => {
      expect(escapeIlike('path\\to\\file')).toBe('path\\\\to\\\\file');
    });

    it('escapes all three characters in combination', () => {
      expect(escapeIlike('50%_test\\')).toBe('50\\%\\_test\\\\');
    });

    it('returns plain strings unchanged', () => {
      expect(escapeIlike('risk assessment')).toBe('risk assessment');
    });
  });

  // -----------------------------------------------------------------------
  // Rate limit
  // -----------------------------------------------------------------------

  it('returns 429 when rate limit is exceeded (boundary: 60 allowed, 61 denied)', async () => {
    // Fire 60 requests — all must succeed (window is exactly 60, not 59).
    let lastStatusInWindow = 0;
    for (let i = 0; i < 60; i++) {
      const req = createTestRequest('/api/search/preview', {
        searchParams: { q: 'test' },
      });
      const res = await GET(req);
      lastStatusInWindow = res.status;
    }
    // 60th response must NOT have been rate-limited.
    expect(lastStatusInWindow).not.toBe(429);

    // 61st request crosses the boundary.
    const req = createTestRequest('/api/search/preview', {
      searchParams: { q: 'test' },
    });

    const res = await GET(req);
    expect(res.status).toBe(429);

    const json = await res.json();
    expect(json.error).toContain('Rate limit');
  });

  // -----------------------------------------------------------------------
  // NOTE — Supabase or() / ilike() composition asserts (table name, select
  // column list, and the assembled OR clause shape) are migrated to the
  // integration tier under W-RD'. The route does not surface the filter
  // string in its response, so the only observable proof of escaping is
  // against a real DB. The pure `escapeIlike` helper is unit-tested above.
  // See remediation-plan.md §3.4 / §3.5.
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('returns 500 when supabase query fails', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: {
            message: 'DB error',
            code: 'PGRST000',
            details: '',
            hint: '',
          },
        }),
    );

    const req = createTestRequest('/api/search/preview', {
      searchParams: { q: 'test' },
    });

    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});

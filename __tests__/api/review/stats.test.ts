/**
 * GET /api/review/stats — review breakdown stats route tests.
 *
 * Asserts the route surfaces the `overdue` field added by the S204 WP-E T0
 * RPC migration (`get_review_breakdown_stats()` now returns a top-level
 * `'overdue'` count). The §5.5 Phase 3 review-cadence overdue filter pill
 * count badge reads `stats?.overdue` end-to-end through this route.
 *
 * Plan: docs/plans/p0-document-control-phase-3-ui-plan.md v1.1 §T0 (T0-AC4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { _resetRateLimitStore } from '@/lib/rate-limit';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handler under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/review/stats/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.clearAllMocks();
  _resetRateLimitStore();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  // Reset chain methods to be chainable + ensure terminal awaits resolve to
  // an empty count by default (the awaiting_publication head:true + count
  // path resolves the chain via .then()).
  const chainableMethods = [
    'select',
    'eq',
    'is',
    'not',
    'in',
    'or',
    'order',
    'range',
    'limit',
  ] as const;
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: null, error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

/**
 * Configure the awaiting_publication count query to resolve with a known
 * value. The route fires this in parallel with the get_review_breakdown_stats
 * RPC via Promise.all (route.ts:43-50). The chain's terminal `.then()` is
 * what supabase-js awaits for the head:true + count: 'exact' shape.
 */
function configureAwaitingPublicationCount(count: number) {
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null, count }),
  );
}

/**
 * ID-63.12 — configure both parallel count queries in array order: the
 * awaiting_publication query (Promise.all index 1) resolves first, the
 * unclassified-coverage query (index 2) second. Both share the `_chain`
 * thenable, so two ordered `mockImplementationOnce` calls map to the two
 * head:true + count='exact' queries the route fires alongside the RPC.
 */
function configureParallelCounts(opts: {
  awaiting: number;
  unclassified: number;
}) {
  mockSupabase._chain.then
    .mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null, count: opts.awaiting }),
    )
    .mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null, count: opts.unclassified }),
    );
}

/**
 * Configure the RPC to return a fully-shaped breakdown including the new
 * `overdue` field. Mirrors the JSON shape produced by the SQL RPC at
 * supabase/migrations/20260427230503_extend_review_breakdown_overdue.sql.
 */
function configureRpcResponse(
  overrides: {
    total?: number;
    verified?: number;
    flagged?: number;
    draft?: number;
    overdue?: number;
  } = {},
) {
  mockSupabase.rpc.mockResolvedValueOnce({
    data: {
      total: overrides.total ?? 100,
      verified: overrides.verified ?? 60,
      flagged: overrides.flagged ?? 5,
      draft: overrides.draft ?? 3,
      overdue: overrides.overdue ?? 7,
      by_domain: {},
      by_content_type: {},
      by_source_file: {},
      by_source_document: {},
    },
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/review/stats', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const res = await GET();
    expect(res.status).toBe(403);
  });

  // T0-AC4: end-to-end assertion that the new `overdue` field flows from RPC
  // → route handler → JSON response without truncation or rename. This is
  // the load-bearing test for the S204 WP-E T0 schema change.
  it('surfaces the overdue field returned by get_review_breakdown_stats RPC', async () => {
    configureRole(mockSupabase, 'admin');
    configureRpcResponse({ overdue: 7, total: 100, verified: 60 });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('overdue', 7);
    expect(body.total).toBe(100);
    expect(body.verified).toBe(60);
    // unverified is computed as total - verified inside the route
    expect(body.unverified).toBe(40);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_review_breakdown_stats');
  });

  it('reports overdue=0 when no rows are overdue', async () => {
    configureRole(mockSupabase, 'editor');
    configureRpcResponse({ overdue: 0 });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.overdue).toBe(0);
  });

  // V_W1 Finding 3 fix — awaiting_publication count must surface from the
  // parallel head:true + count='exact' query at route.ts:43-50. The tab 6
  // badge in ReviewTabs reads `stats?.awaiting_publication` end-to-end.
  describe('awaiting_publication count (V_W1 Finding 3)', () => {
    it('surfaces awaiting_publication=N from the parallel count query (spec §8 (b))', async () => {
      configureRole(mockSupabase, 'admin');
      configureRpcResponse({ overdue: 0 });
      configureAwaitingPublicationCount(11);

      const res = await GET();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.awaiting_publication).toBe(11);

      // The route MUST run this against source_documents (ID-131 {131.19} —
      // content_items is dying) with both publication_status='in_review' AND
      // archived_at IS NULL predicates (route.ts:52-55).
      expect(mockSupabase.from).toHaveBeenCalledWith('source_documents');

      const eqCalls = mockSupabase._chain.eq.mock.calls as Array<
        [string, unknown]
      >;
      const inReviewFilter = eqCalls.find(
        ([col, val]) => col === 'publication_status' && val === 'in_review',
      );
      expect(inReviewFilter).toBeDefined();

      // archived_at IS NULL gate ensures soft-deleted rows don't inflate the
      // badge count.
      const isCalls = mockSupabase._chain.is.mock.calls as Array<
        [string, unknown]
      >;
      const archivedFilter = isCalls.find(
        ([col, val]) => col === 'archived_at' && val === null,
      );
      expect(archivedFilter).toBeDefined();
    });

    it('reports awaiting_publication=0 when nothing is in_review', async () => {
      configureRole(mockSupabase, 'editor');
      configureRpcResponse({ overdue: 0 });
      configureAwaitingPublicationCount(0);

      const res = await GET();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.awaiting_publication).toBe(0);
    });
  });

  // ID-63.12 — unclassified_coverage count must surface from the THIRD
  // parallel head:true + count='exact' query: non-archived content_items on
  // the 'unclassified' taxonomy sentinel ({63.11}). The /review "Unclassified"
  // tab badge reads `stats?.unclassified_coverage` end-to-end.
  describe('unclassified_coverage count (ID-63.12)', () => {
    it('surfaces unclassified_coverage=N from the parallel sentinel count query', async () => {
      configureRole(mockSupabase, 'admin');
      configureRpcResponse({ overdue: 0 });
      configureParallelCounts({ awaiting: 7, unclassified: 12 });

      const res = await GET();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.unclassified_coverage).toBe(12);
      expect(body.awaiting_publication).toBe(7);

      // The sentinel count must run against source_documents (ID-131
      // {131.19} — content_items is dying), exclude archived rows
      // (archived_at IS NULL), and OR the two 'unclassified' predicates.
      expect(mockSupabase.from).toHaveBeenCalledWith('source_documents');

      const isCalls = mockSupabase._chain.is.mock.calls as Array<
        [string, unknown]
      >;
      const archivedFilter = isCalls.find(
        ([col, val]) => col === 'archived_at' && val === null,
      );
      expect(archivedFilter).toBeDefined();

      const orCalls = mockSupabase._chain.or.mock.calls as Array<[string]>;
      const sentinelOr = orCalls.find(([expr]) =>
        expr.includes('primary_domain.eq.unclassified'),
      );
      expect(sentinelOr).toBeDefined();
      expect(sentinelOr?.[0]).toContain('primary_subtopic.eq.unclassified');
    });

    it('reports unclassified_coverage=0 when nothing is unclassified', async () => {
      configureRole(mockSupabase, 'editor');
      configureRpcResponse({ overdue: 0 });
      configureParallelCounts({ awaiting: 0, unclassified: 0 });

      const res = await GET();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.unclassified_coverage).toBe(0);
    });
  });
});

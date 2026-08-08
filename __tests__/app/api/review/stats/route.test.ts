/**
 * GET /api/review/stats — review breakdown stats route tests.
 *
 * Asserts the route surfaces the `overdue` field added by the S204 WP-E T0
 * RPC migration (`get_review_breakdown_stats()` now returns a top-level
 * `'overdue'` count). The §5.5 Phase 3 review-cadence overdue filter pill
 * count badge reads `stats?.overdue` end-to-end through this route.
 *
 * Plan: docs/plans/p0-document-control-phase-3-ui-plan.md v1.1 §T0 (T0-AC4).
 *
 * The auth-gate and full-breakdown pass-through cases came from the
 * `GET /api/review/stats` section of the former `review/review.test.ts`, which
 * covered three unrelated routes from one file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '@/__tests__/helpers/mock-supabase';
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

    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
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

  // The whole RPC breakdown reaches the client unaltered apart from the two
  // handler-computed fields (unverified = total - verified, and
  // awaiting_publication from the parallel count query).
  //
  // id-417 / DR-130 retired the per-domain breakdown: `record_lifecycle.domain`
  // was dropped, `get_review_breakdown_stats` no longer emits `by_domain`, and
  // `ReviewStatsResponseSchema` does not declare it (route.ts:73-76). The mock
  // therefore must not emit it either — a mock that returns a retired key is
  // modelling a database that no longer exists.
  //
  // This previously carried a `by_domain` key and asserted it reached the
  // client. That assertion was vacuous: it tested the mock, not the route. It
  // passed only because `defineRoute`'s response validation is asymmetric on
  // the `NextResponse` path — measured, not inferred: an UNDECLARED key is
  // neither rejected nor stripped (the wrapper returns the original response,
  // so even Zod's default stripping never reaches the caller), while a MISSING
  // declared key throws `response_schema_validation_failed` even in test. So a
  // response schema cannot see additive drift at all, and the old assertion
  // silently encoded that blind spot as intended behaviour.
  //
  // The assertion below is now the positive retirement guard, matching
  // `cadence/route.test.ts:278`, which asserts the same absence for the same
  // reason.
  it('returns 200 with the full stats breakdown', async () => {
    configureRole(mockSupabase, 'editor');

    // The route calls a single RPC: get_review_breakdown_stats
    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        total: 100,
        verified: 60,
        flagged: 5,
        draft: 3,
        overdue: 4,
        by_content_type: {
          article: { total: 2, verified: 2 },
          q_a_pair: { total: 1, verified: 0 },
        },
        by_source_file: {
          'import-batch-1.docx': { total: 2, verified: 1 },
        },
        by_source_document: {},
      },
      error: null,
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json.total).toBe(100);
    expect(json.verified).toBe(60);
    expect(json.flagged).toBe(5);
    expect(json.unverified).toBe(40);
    expect(json.draft).toBe(3);

    // id-417 / DR-130: the per-domain breakdown retired with the axis.
    expect(json).not.toHaveProperty('by_domain');

    expect(json.by_content_type).toEqual({
      article: { total: 2, verified: 2 },
      q_a_pair: { total: 1, verified: 0 },
    });

    expect(json.by_source_file).toEqual({
      'import-batch-1.docx': { total: 2, verified: 1 },
    });

    // Verify the RPC was called
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_review_breakdown_stats');
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

  // (unclassified_coverage tests retired — id-417 / DR-130: the sentinel
  // columns and the count leg are gone; the response no longer carries the
  // field.)
  it('does not emit the retired unclassified_coverage field (id-417)', async () => {
    configureRole(mockSupabase, 'editor');
    configureRpcResponse({ overdue: 0 });
    configureAwaitingPublicationCount(0);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).not.toHaveProperty('unclassified_coverage');

    // And the sentinel OR predicate is never applied.
    const orCalls = mockSupabase._chain.or.mock.calls as Array<[string]>;
    const sentinelOr = orCalls.find(([expr]) =>
      expr.includes('primary_domain.eq.unclassified'),
    );
    expect(sentinelOr).toBeUndefined();
  });

  // ===========================================================================
  // BL-398 (S450) — tombstoned source_documents must be excluded from both
  // direct source_documents count queries (GDPR erasure, ID-138 {138.5}
  // DR-023). The three governance/freshness RPC-backed fields are covered by
  // the migration's own shape test
  // (__tests__/supabase/migrations/bl398-governance-tombstone-filter.test.ts).
  // ===========================================================================
  describe('tombstone exclusion (BL-398)', () => {
    it('excludes tombstoned rows from the awaiting_publication count query', async () => {
      configureRole(mockSupabase, 'admin');
      configureRpcResponse({ overdue: 0 });
      configureAwaitingPublicationCount(3);

      const res = await GET();
      expect(res.status).toBe(200);

      const neqCalls = mockSupabase._chain.neq.mock.calls as Array<
        [string, unknown]
      >;
      const tombstoneFilters = neqCalls.filter(
        ([col, val]) => col === 'admission_status' && val === 'tombstoned',
      );
      expect(tombstoneFilters.length).toBe(1);
    });
  });
});

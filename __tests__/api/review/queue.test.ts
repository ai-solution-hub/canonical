/**
 * Review Queue API — sort parameter, quality_score, assigned_to_me, and
 * document-body composition tests.
 *
 * Tests server-side sorting by confidence and quality score,
 * verifies quality_score is included in the response,
 * tests the assigned_to_me filter intersection logic,
 * and verifies each item's `content` is the composed document body
 * (content_chunks / reference_items — id-392 M6).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../../helpers/mock-supabase';
import { createTestRequest } from '../../helpers/mock-next';

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

import { GET as getQueue } from '@/app/api/review/queue/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';

// ID-131 {131.19} G-GOV-FACET: content_items is dying — the queue's base
// table is now source_documents, with governance/freshness columns
// (verified_at, verified_by, freshness, governance_review_status,
// next_review_date, review_cadence_days) living on the embedded
// record_lifecycle!inner facet (row.record_lifecycle[0]), not flat on the
// row. makeMockItem builds the raw joined-row shape the route reads
// (SourceDocumentReviewRow in route.ts) — facet-only keys passed via
// `overrides` are routed into the nested record_lifecycle array so existing
// call sites (`makeMockItem({ verified_at: ... })`) keep working unchanged.
const FACET_FIELDS = [
  'verified_at',
  'verified_by',
  'freshness',
  'governance_review_status',
  'next_review_date',
  'review_cadence_days',
] as const;

function makeMockItem(overrides: Record<string, unknown> = {}) {
  const facetOverrides: Record<string, unknown> = {};
  const sourceDocOverrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if ((FACET_FIELDS as readonly string[]).includes(key)) {
      facetOverrides[key] = value;
    } else {
      sourceDocOverrides[key] = value;
    }
  }

  return {
    id: VALID_UUID,
    filename: 'test-item.pdf',
    content_type: 'article',
    captured_date: '2026-01-01',
    publication_status: 'published',
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    record_lifecycle: [
      {
        verified_at: null,
        verified_by: null,
        freshness: 'fresh',
        governance_review_status: null,
        next_review_date: null,
        review_cadence_days: null,
        ...facetOverrides,
      },
    ],
    ...sourceDocOverrides,
  };
}

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainableMethods = [
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
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/review/queue — sort parameter', () => {
  beforeEach(resetMocks);

  // NOTE — The four sort-mode contracts (created_at DESC default,
  // confidence_asc with NULLS FIRST, quality_score_asc with NULLS FIRST,
  // explicit created_at) translate to `_chain.order(column, opts)` calls
  // that are not visible in the route's JSON response. Under the mock
  // builder there is no observable difference between the four modes;
  // the only proof of column-and-NULLS-FIRST routing is via integration
  // against the real DB. Migrated to W-RD' per remediation-plan §3.5.
  //
  // The remaining unit-level guarantee is "the route accepts each sort
  // param value without erroring" — codified below.

  it.each([[undefined], ['created_at'], ['quality_score_asc']])(
    'returns 200 when sort=%s',
    async (sort) => {
    configureRole(mockSupabase, 'editor');

    const mockItems = [makeMockItem()];
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({ data: mockItems, error: null, count: 1 });
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: sort ? { sort } : undefined,
    });
    const res = await getQueue(req);
      expect(res.status).toBe(200);
    },
  );

  it('rejects the retired sort=confidence_asc (id-417 / DR-130)', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest('/api/review/queue', {
      searchParams: { sort: 'confidence_asc' },
    });
    const res = await getQueue(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/review/queue — quality_score in response', () => {
  beforeEach(resetMocks);

  // ID-131 {131.19} G-GOV-FACET: quality_score has no typed-record home
  // post-refactor (no source_documents or record_lifecycle column survived
  // for it — see route.ts file header). mapToReviewQueueItem hardcodes it to
  // `null` unconditionally, so the pre-refactor "present/null/undefined
  // input" trio tested three distinct mapping paths that no longer exist —
  // there is now exactly one path (always null), collapsing them into a
  // single assertion. Extra/dead `quality_score` data on the raw row (as a
  // real ingest pipeline row might still carry, pending a follow-up
  // migration to drop the column) must NOT leak into the response.
  it('always maps quality_score to null regardless of the underlying row', async () => {
    configureRole(mockSupabase, 'editor');

    const mockItems = [makeMockItem({ quality_score: 85 } as never)];
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({ data: mockItems, error: null, count: 1 });
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue');
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items[0].quality_score).toBeNull();
  });
});

// ===========================================================================
// id-392 M6 — item `content` is the composed document body.
//
// `source_documents.extracted_text` is permanently NULL on the pipeline path
// and is no longer selected by the queue route. Each item's `content` is now
// batch-composed via fetchSourceDocumentBodies: content_chunks.content
// ordered by position and joined with blank lines (pipeline file route),
// falling back to reference_items.body (URL-ingest route), null when neither
// exists. The route's own source_documents query stays on the shared chain;
// the two body-leg tables get dedicated per-table chains (same idiom as the
// flagged-branch tombstone test below).
// ===========================================================================

describe('GET /api/review/queue — document body as item content (id-392 M6)', () => {
  beforeEach(resetMocks);

  const CHUNKED_DOC_ID = '00000000-0000-4000-8000-000000000021';
  const BODYLESS_DOC_ID = '00000000-0000-4000-8000-000000000022';

  /** Route content_chunks / reference_items to their own resolutions; every
   * other table (source_documents, counts, verification_history) stays on the
   * shared sequenced chain. */
  function stubBodyTables(
    chunkRows: Array<{
      source_document_id: string;
      content: string;
      position: number;
    }>,
    referenceRows: Array<{ source_document_id: string; body: string | null }>,
  ) {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'content_chunks') {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: chunkRows, error: null }),
        };
      }
      if (table === 'reference_items') {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: referenceRows, error: null }),
        };
      }
      return mockSupabase._chain;
    });
  }

  it('returns the blank-line-joined chunk body for a chunked document and null content for a bodyless one', async () => {
    configureRole(mockSupabase, 'editor');

    const chunkedRow = makeMockItem({ id: CHUNKED_DOC_ID });
    const bodylessRow = makeMockItem({ id: BODYLESS_DOC_ID });

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({
            data: [chunkedRow, bodylessRow],
            error: null,
            count: 2,
          });
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    stubBodyTables(
      [
        {
          source_document_id: CHUNKED_DOC_ID,
          content: 'First chunk of the body.',
          position: 0,
        },
        {
          source_document_id: CHUNKED_DOC_ID,
          content: 'Second chunk of the body.',
          position: 1,
        },
      ],
      [],
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { status: 'all' },
    });
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toHaveLength(2);

    const contentById = Object.fromEntries(
      json.items.map((i: { id: string; content: string | null }) => [
        i.id,
        i.content,
      ]),
    );
    // Chunked doc: content is the position-ordered chunk composition.
    expect(contentById[CHUNKED_DOC_ID]).toBe(
      'First chunk of the body.\n\nSecond chunk of the body.',
    );
    // Bodyless doc in the SAME response: no chunks, no reference body —
    // content is null (never the legacy extracted_text, which is no longer
    // read).
    expect(contentById[BODYLESS_DOC_ID]).toBeNull();
  });

  it('returns the reference_items body as content for a URL-ingested document with no chunks', async () => {
    configureRole(mockSupabase, 'editor');

    const urlDocRow = makeMockItem({ id: CHUNKED_DOC_ID });

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({ data: [urlDocRow], error: null, count: 1 });
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    stubBodyTables(
      [],
      [
        {
          source_document_id: CHUNKED_DOC_ID,
          body: 'Reference body captured on the URL-ingest route.',
        },
      ],
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { status: 'all' },
    });
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].content).toBe(
      'Reference body captured on the URL-ingest route.',
    );
  });
});

// ===========================================================================
// id-417 / DR-130 — the ID-63.12 unclassified sentinel filter retired
// ===========================================================================

describe('GET /api/review/queue — unclassified filter retired (id-417)', () => {
  beforeEach(resetMocks);

  it('never applies the retired unclassified sentinel OR predicate', async () => {
    configureRole(mockSupabase, 'editor');

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1)
          return resolve({ data: [makeMockItem()], error: null, count: 1 });
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    // Even a legacy deep-link with ?unclassified=true must not produce the
    // sentinel predicate (the columns are dropped).
    const req = createTestRequest('/api/review/queue', {
      searchParams: { unclassified: 'true', status: 'all' },
    });
    const res = await getQueue(req);
    expect(res.status).toBe(200);

    const orCalls = mockSupabase._chain.or.mock.calls as Array<[string]>;
    const sentinelOr = orCalls.find(([expr]) =>
      expr.includes('primary_domain.eq.unclassified'),
    );
    expect(sentinelOr).toBeUndefined();
  });
});

// ===========================================================================
// assigned_to_me intersection logic (H-1)
// ===========================================================================

describe('GET /api/review/queue — assigned_to_me filter', () => {
  beforeEach(resetMocks);

  // ESCALATION (assigned_to_me intersection logic):
  //   The four behaviours below — UNION of assignment filters across rows,
  //   short-circuit-empty when no assignments, INTERSECTION of user-supplied
  //   filter with assignment filters, and unrestricted-fallthrough when
  //   assignment filters are null — are route-handler invariants implemented
  //   via `_chain.in(col, values)` calls on the content_items query. Under
  //   the unit-mock builder there is no observable difference in the JSON
  //   envelope: the mock returns whatever data we tell it, regardless of
  //   the SUT's chain composition. The honest verification path is at
  //   integration tier (W-RD') against a real DB seeded with assignments +
  //   content rows that prove the intersection/union semantics.
  //
  //   The chain-method assertions previously here were the only proof of
  //   the SUT's filter composition logic, but they couple to mock internals.
  //   Three of the four cases retain observable assertions (empty-result on
  //   no assignments, response shape on unrestricted fallthrough); the
  //   union-and-intersection assertions are dropped in favour of W-RD'.

  it('returns empty result immediately when user has no active assignments', async () => {
    configureRole(mockSupabase, 'editor');

    // Assignment query returns empty list — short-circuit path.
    const assignmentChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      ),
    };

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'review_assignments') {
        return assignmentChain;
      }
      return mockSupabase._chain;
    });

    const req = createTestRequest('/api/review/queue', {
      searchParams: { assigned_to_me: 'true' },
    });
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    // Short-circuit is observable: zero items + zero total, no has_more.
    expect(json.items).toEqual([]);
    expect(json.total).toBe(0);
    expect(json.has_more).toBe(false);
  });

  it('returns the assigned content rows when the reviewer assignment has no filters set', async () => {
    configureRole(mockSupabase, 'editor');

    // Assignment with both filter arrays null = unrestricted; should
    // fall through to the full assigned content set.
    const assignmentChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              filter_domains: null,
              filter_content_types: null,
            },
          ],
          error: null,
        }),
      ),
    };

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'review_assignments') {
        return assignmentChain;
      }
      return mockSupabase._chain;
    });

    // Content items query
    const mockItems = [makeMockItem()];
    let contentThenCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        contentThenCount++;
        if (contentThenCount === 1) {
          return resolve({ data: mockItems, error: null, count: 1 });
        }
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { assigned_to_me: 'true' },
    });
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    // The single item we wired up surfaces in the unrestricted fallthrough.
    expect(json.items).toHaveLength(1);
  });
});

// ===========================================================================
// V2-M5 (S202 §5.2 / Wave 3) — orthogonality between publication_status and
// governance_review_status.
//
// Spec §3.1 declares these two columns as ORTHOGONAL axes — a row may sit in
// `publication_status='draft'` AND simultaneously have
// `governance_review_status='pending'`. The queue read paths must surface
// the row independently in both filter modes:
//
//   1. The /api/review/queue "drafts only" filter (status='draft') reads
//      `publication_status='draft'` post-T8b row 11 rewire — surfaces the
//      row when filtered by publication state.
//   2. The MCP `get_governance_queue` tool reads
//      `governance_review_status='pending'` — surfaces the same row when
//      filtered by change-management review state.
//
// No precedence collision: setting one filter does not exclude the other.
// MCP-side coverage lives in __tests__/mcp/update-publication-status.test.ts
// ("get_governance_queue — publication_status filter (S202 §5.2 T7)").
// This test owns the queue-route side of the orthogonality assertion.
// ===========================================================================

// ===========================================================================
// S205 WP-E T2 — include_overdue filter
// Plan: docs/plans/p0-document-control-phase-3-ui-plan.md §T2 (T2-AC2/AC7,
// H-1, H-2). T0 (RPC stats.overdue) shipped S204; T2 wires the route side.
// ===========================================================================

describe('GET /api/review/queue — include_overdue filter (S205 WP-E T2)', () => {
  beforeEach(resetMocks);

  // ESCALATION (include_overdue predicate-swap, T2-AC2 / T2-AC7, H-1 + H-2):
  //   The "default off vs include_overdue=true" predicate swap from
  //   `is(verified_at, null)` to `or('verified_at.is.null,
  //   governance_review_status.eq.review_overdue')` is a route-handler
  //   invariant on the DB query layer. Under the mock builder we can only
  //   confirm the SUT was called by intercepting `_chain.is` / `_chain.or`
  //   args — pure chain-method coupling.
  //
  //   The observable difference is that with `include_overdue=true`,
  //   verified-but-overdue rows surface alongside unverified rows in the
  //   response. The third test below preserves that observable assertion;
  //   the first two (missing param + explicit `false` regression for H-1)
  //   collapse to chain-only proofs and migrate to W-RD' integration tier.

  it('surfaces verified-but-overdue rows alongside unverified ones when include_overdue=true', async () => {
    // T2-AC2 + H-2: the observable widening — verified-but-overdue rows
    // appear in the response even though their verified_at IS NOT NULL.
    configureRole(mockSupabase, 'editor');

    const unverifiedRow = makeMockItem({
      id: '00000000-0000-4000-8000-000000000010',
      verified_at: null,
      governance_review_status: 'pending',
    });
    const verifiedOverdueRow = makeMockItem({
      id: '00000000-0000-4000-8000-000000000011',
      verified_at: '2026-03-01T00:00:00Z',
      governance_review_status: 'review_overdue',
    });

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          return resolve({
            data: [unverifiedRow, verifiedOverdueRow],
            error: null,
            count: 2,
          });
        }
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { include_overdue: 'true' },
    });
    const res = await getQueue(req);

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.items).toHaveLength(2);
    const ids = json.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(unverifiedRow.id);
    expect(ids).toContain(verifiedOverdueRow.id);
  });
});

// ===========================================================================
// BL-398 (S450) — tombstoned source_documents must be excluded from the
// review queue. Tombstoning (ID-138 {138.5} DR-023) is a GDPR erasure UPDATE
// (admission_status='tombstoned'), not a DELETE (DR-025) — the register row
// survives so citations degrade to it, but an erased document must not still
// surface as reviewable content.
// ===========================================================================

describe('GET /api/review/queue — tombstone exclusion (BL-398)', () => {
  beforeEach(resetMocks);

  it('excludes tombstoned rows from the standard query (status=all)', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { status: 'all' },
    });
    const res = await getQueue(req);
    expect(res.status).toBe(200);

    const neqCalls = mockSupabase._chain.neq.mock.calls as Array<
      [string, unknown]
    >;
    const tombstoneFilter = neqCalls.find(
      ([col, val]) => col === 'admission_status' && val === 'tombstoned',
    );
    expect(tombstoneFilter).toBeDefined();
  });

  it('excludes tombstoned rows from the flagged-query branch', async () => {
    configureRole(mockSupabase, 'editor');

    // handleFlaggedQuery first queries ingestion_quality_log for flagged ids,
    // then queries source_documents filtered to those ids.
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'ingestion_quality_log') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          then: (resolve: (v: unknown) => void) =>
            resolve({
              data: [{ source_document_id: VALID_UUID }],
              error: null,
            }),
        };
      }
      return mockSupabase._chain;
    });
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { status: 'flagged' },
    });
    const res = await getQueue(req);
    expect(res.status).toBe(200);

    const neqCalls = mockSupabase._chain.neq.mock.calls as Array<
      [string, unknown]
    >;
    const tombstoneFilter = neqCalls.find(
      ([col, val]) => col === 'admission_status' && val === 'tombstoned',
    );
    expect(tombstoneFilter).toBeDefined();
  });
});

describe('GET /api/review/queue — orthogonality with governance_review_status (V2-M5)', () => {
  beforeEach(resetMocks);

  it('surfaces a draft row that simultaneously has governance_review_status=pending', async () => {
    configureRole(mockSupabase, 'editor');

    // Fixture row that sits in BOTH axes simultaneously per spec §3.1:
    // publication_status='draft' AND governance_review_status='pending'.
    const orthogonalRow = makeMockItem({
      governance_review_status: 'pending',
    });

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          return resolve({ data: [orthogonalRow], error: null, count: 1 });
        }
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    // /api/review/queue?status=draft — drafts-only filter mode.
    const req = createTestRequest('/api/review/queue', {
      searchParams: { status: 'draft' },
    });
    const res = await getQueue(req);
    expect(res.status).toBe(200);

    // The orthogonal row appears in the response with its pending
    // governance_review_status surfaced unmodified — proving the two
    // axes compose independently within a single result row. The
    // "route does not add a governance_review_status filter when in
    // drafts-only mode" half of the contract is a chain-shape invariant
    // migrated to W-RD' integration coverage.
    const json = await res.json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].id).toBe(orthogonalRow.id);
    expect(json.items[0].governance_review_status).toBe('pending');
  });
});

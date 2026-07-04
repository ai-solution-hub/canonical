import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
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

// Suppress console.error noise from the route's error handling
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handlers under test (AFTER mocks are registered)
// ---------------------------------------------------------------------------

import { GET as getQueue } from '@/app/api/review/queue/route';
import { POST as postAction } from '@/app/api/review/action/route';
import { GET as getStats } from '@/app/api/review/stats/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';
// A distinct id from VALID_UUID (the content_items.id) — proves ingestion_quality_log
// writes/reads resolve through content_items.source_document_id, not item_id directly.
const SOURCE_DOC_UUID = '00000000-0000-4000-8000-000000000002';

/** Reset mock state and restore default authenticated user. */
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
// GET /api/review/queue
// ---------------------------------------------------------------------------

describe('GET /api/review/queue', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/review/queue');
    const res = await getQueue(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/review/queue');
    const res = await getQueue(req);

    expect(res.status).toBe(403);
  });

  it('returns 200 with queue items on success', async () => {
    configureRole(mockSupabase, 'editor');

    const mockItems = [
      {
        id: VALID_UUID,
        title: 'Test Item',
        suggested_title: 'Test Item',
        summary: 'A summary',
        primary_domain: 'Technology',
        primary_subtopic: 'AI',
        secondary_domain: null,
        secondary_subtopic: null,
        content_type: 'article',
        platform: 'web',
        author_name: 'Author',
        source_domain: 'example.com',
        thumbnail_url: null,
        captured_date: '2026-01-01',
        ai_keywords: ['test'],
        classification_confidence: 0.9,
        quality_score: 75,
        priority: 'medium',
        user_tags: [],
        metadata: null,
        content: 'Some content',
        source_url: 'https://example.com',
        verified_at: null,
        verified_by: null,
        freshness: 'fresh',
        governance_review_status: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          return resolve({ data: mockItems, error: null, count: 1 });
        }
        if (thenCallCount === 2) {
          return resolve({ data: null, error: null, count: 5 });
        }
        if (thenCallCount === 3) {
          return resolve({ data: null, error: null, count: 2 });
        }
        return resolve({ data: [], error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue');
    const res = await getQueue(req);

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].id).toBe(VALID_UUID);
    expect(json.items[0].title).toBe('Test Item');
    expect(json.items[0].primary_domain).toBe('Technology');
    expect(json.total).toBe(1);
    expect(json.verified_count).toBe(5);
    expect(json.flagged_count).toBe(2);
    expect(json.has_more).toBe(false);
  });

  // ingestion_quality_log is now keyed by source_document_id (ID-131 {131.13}
  // G-GOV-FACET-B rename), so handleFlaggedQuery's content_items lookup must
  // join on source_document_id instead of id — content_items.id and
  // ingestion_quality_log's flagged ids are no longer the same identifier.
  it('returns flagged items joined via source_document_id', async () => {
    configureRole(mockSupabase, 'editor');

    const mockFlaggedDocIds = [
      { source_document_id: 'doc-1' },
      { source_document_id: 'doc-2' },
    ];
    const mockItems = [
      {
        id: VALID_UUID,
        title: 'Flagged Item',
        suggested_title: 'Flagged Item',
        summary: 'A summary',
        primary_domain: 'Technology',
        primary_subtopic: 'AI',
        secondary_domain: null,
        secondary_subtopic: null,
        content_type: 'article',
        platform: 'web',
        author_name: 'Author',
        source_domain: 'example.com',
        thumbnail_url: null,
        captured_date: '2026-01-01',
        ai_keywords: ['test'],
        classification_confidence: 0.9,
        quality_score: 75,
        priority: 'medium',
        user_tags: [],
        metadata: null,
        content: 'Some content',
        source_url: 'https://example.com',
        verified_at: null,
        verified_by: null,
        freshness: 'fresh',
        governance_review_status: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        // 1: ingestion_quality_log flagged source_document_ids
        if (thenCallCount === 1) {
          return resolve({ data: mockFlaggedDocIds, error: null });
        }
        // 2: content_items filtered by source_document_id
        if (thenCallCount === 2) {
          return resolve({ data: mockItems, error: null, count: 1 });
        }
        // 3: verified count, 4: flagged count (progress bar)
        if (thenCallCount === 3) {
          return resolve({ data: null, error: null, count: 3 });
        }
        if (thenCallCount === 4) {
          return resolve({ data: null, error: null, count: 2 });
        }
        // 5: fetchLastReviewedDates (verification_history)
        return resolve({ data: [], error: null, count: 0 });
      },
    );

    const req = createTestRequest('/api/review/queue', {
      searchParams: { status: 'flagged' },
    });
    const res = await getQueue(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].id).toBe(VALID_UUID);
    expect(json.total).toBe(1);

    // The join key fix under test: content_items is filtered by the
    // resolved source_document_ids, not the (no-longer-matching) content
    // item ids that used to live in ingestion_quality_log.content_item_id.
    expect(mockSupabase._chain.in).toHaveBeenCalledWith('source_document_id', [
      'doc-1',
      'doc-2',
    ]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/review/action
// ---------------------------------------------------------------------------

describe('POST /api/review/action', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'verify' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'verify' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid action type', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'delete' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'action' })]),
    );
  });

  it('returns 400 for missing item_id', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { action: 'verify' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'item_id' })]),
    );
  });

  it('returns 400 for non-UUID item_id', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: 'not-a-uuid', action: 'verify' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 404 when content item does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'verify' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBe('Content item not found');
  });

  it('returns 200 on successful verify action', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'verify' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Persistence contract: POST /api/review/action is a VOID update — the
    // response carries only { success: true } and reads NOTHING back. The
    // verified_at timestamp and server-set verified_by/updated_by are never
    // surfaced, so this update-payload assert is the only proof verifying an
    // item stamps it as verified by the acting user.
    expect(mockSupabase.from).toHaveBeenCalledWith('content_items');
    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        verified_at: expect.any(String),
        verified_by: 'test-user-id',
        updated_by: 'test-user-id',
      }),
    );
  });

  it('returns 200 on successful skip action (no DB write)', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'skip' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
    expect(mockSupabase._chain.insert).not.toHaveBeenCalled();
  });

  it('returns 200 on successful flag action', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, source_document_id: SOURCE_DOC_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: {
        item_id: VALID_UUID,
        action: 'flag',
        flag_details: 'Needs review — content seems outdated',
      },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Persistence contract: VOID insert, response is only { success: true }.
    // The new quality-log row (flag_type/severity/details/created_by) is never
    // read back, so this insert-payload assert is the only proof flagging
    // records a review_needed/warning entry with the operator's note attached.
    // ingestion_quality_log is keyed by source_document_id (ID-131 {131.13}
    // G-GOV-FACET-B rename), resolved from the item's content_items row —
    // never the raw item_id (content_items.id).
    expect(mockSupabase.from).toHaveBeenCalledWith('ingestion_quality_log');
    expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_document_id: SOURCE_DOC_UUID,
        flag_type: 'review_needed',
        severity: 'warning',
        details: { notes: 'Needs review — content seems outdated' },
        created_by: 'test-user-id',
      }),
    );
  });

  it('skips the ingestion_quality_log insert when flagging an item with no backing source document', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, source_document_id: null },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: {
        item_id: VALID_UUID,
        action: 'flag',
        flag_details: 'Needs review',
      },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // No source document to resolve — nothing to insert into
    // ingestion_quality_log. verification_history.source_document_id is NOT
    // NULL post ID-131 {131.29} re-parent, so its audit-trail insert is
    // ALSO skipped (a source-doc-less content item records no audit row);
    // only the content_items status clear (item_id-scoped, unaffected by
    // this migration) still proceeds.
    expect(mockSupabase.from).not.toHaveBeenCalledWith('ingestion_quality_log');
    expect(mockSupabase.from).not.toHaveBeenCalledWith('verification_history');
  });

  it('returns 200 on successful unverify action', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'unverify' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Persistence contract: VOID update, response is only { success: true }.
    // This assert is the only proof unverify clears verified_at/verified_by
    // back to null while stamping updated_by as the acting user.
    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        verified_at: null,
        verified_by: null,
        updated_by: 'test-user-id',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/review/stats
// ---------------------------------------------------------------------------

describe('GET /api/review/stats', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await getStats();
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const res = await getStats();
    expect(res.status).toBe(403);
  });

  it('returns 200 with stats object', async () => {
    configureRole(mockSupabase, 'editor');

    // The route now calls a single RPC: get_review_breakdown_stats
    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        total: 100,
        verified: 60,
        flagged: 5,
        draft: 3,
        overdue: 4,
        by_domain: {
          Technology: { total: 2, verified: 1 },
          Business: { total: 1, verified: 1 },
        },
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

    const res = await getStats();
    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json.total).toBe(100);
    expect(json.verified).toBe(60);
    expect(json.flagged).toBe(5);
    expect(json.unverified).toBe(40);
    expect(json.draft).toBe(3);

    expect(json.by_domain).toEqual({
      Technology: { total: 2, verified: 1 },
      Business: { total: 1, verified: 1 },
    });

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
});

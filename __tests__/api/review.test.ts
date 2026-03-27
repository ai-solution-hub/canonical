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

/** Reset mock state and restore default authenticated user. */
function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainableMethods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null, count: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({ data: null, error: null, count: null });
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
        ai_summary: 'A summary',
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
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) => {
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
    });

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
      expect.arrayContaining([
        expect.objectContaining({ field: 'action' }),
      ]),
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
      expect.arrayContaining([
        expect.objectContaining({ field: 'item_id' }),
      ]),
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

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'verify' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

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
      data: { id: VALID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
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

    expect(mockSupabase.from).toHaveBeenCalledWith('ingestion_quality_log');
    expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        content_item_id: VALID_UUID,
        flag_type: 'review_needed',
        severity: 'warning',
        details: { notes: 'Needs review — content seems outdated' },
        created_by: 'test-user-id',
      }),
    );
  });

  it('returns 200 on successful unverify action', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/review/action', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'unverify' },
    });

    const res = await postAction(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

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

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) => {
      thenCallCount++;
      if (thenCallCount === 1) {
        // Total count (excluding drafts)
        return resolve({ data: null, error: null, count: 100 });
      }
      if (thenCallCount === 2) {
        // Verified count
        return resolve({ data: null, error: null, count: 60 });
      }
      if (thenCallCount === 3) {
        // Flagged items (distinct content_item_ids)
        return resolve({
          data: [
            { content_item_id: 'a1' },
            { content_item_id: 'a2' },
            { content_item_id: 'a3' },
            { content_item_id: 'a4' },
            { content_item_id: 'a5' },
          ],
          error: null,
          count: null,
        });
      }
      if (thenCallCount === 4) {
        // Draft count
        return resolve({ data: null, error: null, count: 3 });
      }
      if (thenCallCount === 5) {
        // Breakdown data for domain/content_type/source_file
        return resolve({
          data: [
            {
              primary_domain: 'Technology',
              content_type: 'article',
              verified_at: '2026-01-01T00:00:00Z',
              source_file: 'import-batch-1.docx',
            },
            {
              primary_domain: 'Technology',
              content_type: 'q_a_pair',
              verified_at: null,
              source_file: 'import-batch-1.docx',
            },
            {
              primary_domain: 'Business',
              content_type: 'article',
              verified_at: '2026-02-01T00:00:00Z',
              source_file: null,
            },
          ],
          error: null,
          count: null,
        });
      }
      return resolve({ data: [], error: null, count: 0 });
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
  });
});

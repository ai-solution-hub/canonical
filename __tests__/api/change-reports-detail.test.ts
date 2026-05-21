import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

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

// Suppress console.error noise from the route's error handling
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handler under test (AFTER mocks are registered)
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/digest/[id]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';

const MOCK_DIGEST_ROW = {
  id: VALID_UUID,
  digest_type: 'weekly',
  period_start: '2026-03-01T00:00:00.000Z',
  period_end: '2026-03-07T23:59:59.999Z',
  item_count: 5,
  domain_summaries: [
    {
      domain: 'Technology',
      item_count: 3,
      summary: 'A busy week for technology content.',
      top_items: [
        { id: 'item-1', title: 'AI Article', content_type: 'article' },
      ],
      key_themes: ['AI', 'Security'],
    },
  ],
  theme_clusters: [
    {
      theme: 'AI Adoption',
      description: 'Multiple items on AI',
      item_count: 3,
    },
  ],
  narrative_summary: 'You captured 5 items this week.',
  generated_at: '2026-03-07T12:00:00.000Z',
  generated_by: 'claude-sonnet-4-6',
  tokens_used: 1500,
  item_ids: ['item-1', 'item-2', 'item-3'],
  created_at: '2026-03-07T12:00:00.000Z',
};

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
// GET /api/digest/[id]
// ---------------------------------------------------------------------------

describe('GET /api/digest/[id]', () => {
  beforeEach(resetMocks);

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/digest/${VALID_UUID}`);
    const res = await GET(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it('returns 400 for invalid UUID format', async () => {
    const req = createTestRequest('/api/digest/not-a-uuid');
    const res = await GET(req, {
      params: createTestParams({ id: 'not-a-uuid' }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid digest ID format');
  });

  it('returns 400 for empty ID', async () => {
    const req = createTestRequest('/api/digest/');
    const res = await GET(req, { params: createTestParams({ id: '' }) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid digest ID format');
  });

  // ── Not Found ─────────────────────────────────────────────────────────────

  it('returns 404 when digest does not exist', async () => {
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest(`/api/digest/${VALID_UUID}`);
    const res = await GET(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Digest not found');
  });

  // ── Success Path ──────────────────────────────────────────────────────────

  it('returns 200 with full digest data', async () => {
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: MOCK_DIGEST_ROW,
      error: null,
    });

    const req = createTestRequest(`/api/digest/${VALID_UUID}`);
    const res = await GET(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.digest).toBeDefined();
    expect(json.digest.id).toBe(VALID_UUID);
    expect(json.digest.digest_type).toBe('weekly');
    expect(json.digest.item_count).toBe(5);
    expect(json.digest.narrative_summary).toBe(
      'You captured 5 items this week.',
    );
    expect(json.digest.item_ids).toEqual(['item-1', 'item-2', 'item-3']);

    // JSONB arrays are parsed
    expect(json.digest.domain_summaries).toHaveLength(1);
    expect(json.digest.domain_summaries[0].domain).toBe('Technology');
    expect(json.digest.domain_summaries[0].top_items).toHaveLength(1);
    expect(json.digest.theme_clusters).toHaveLength(1);
    expect(json.digest.theme_clusters[0].theme).toBe('AI Adoption');
  });

  it('does not include metadata in the response', async () => {
    const rowWithMetadata = {
      ...MOCK_DIGEST_ROW,
      metadata: { some: 'extra data' },
    };
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: rowWithMetadata,
      error: null,
    });

    const req = createTestRequest(`/api/digest/${VALID_UUID}`);
    const res = await GET(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.digest.metadata).toBeUndefined();
  });

  // ── Database Error ────────────────────────────────────────────────────────

  it('returns 500 on database error', async () => {
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database connection failed', code: '500' },
    });

    const req = createTestRequest(`/api/digest/${VALID_UUID}`);
    const res = await GET(req, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBeTruthy();
  });
});

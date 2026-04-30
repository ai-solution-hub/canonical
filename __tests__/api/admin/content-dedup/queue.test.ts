/**
 * GET /api/admin/content-dedup/queue
 *
 * §1.7 Admin Cross-System Dedup Review (S211B).
 * Spec: docs/specs/§1.7-admin-dedup-review-spec.md §5.1
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../../helpers/mock-supabase';
import { createTestRequest } from '../../../helpers/mock-next';

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
// Import route AFTER mocks
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/admin/content-dedup/queue/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'admin-user-id', email: 'admin@example.com' } },
    error: null,
  });

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
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

function configureQueueRows(rows: Array<Record<string, unknown>>) {
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({ data: rows, error: null, count: rows.length }),
  );
}

const SAMPLE_ROW = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  title: 'Cloud security policy',
  content: 'body text…',
  dedup_status: 'suspected_duplicate',
  created_at: '2026-04-28T10:00:00Z',
  primary_domain: 'tech-it',
  content_owner_id: null,
  ingest_source: 'url_import',
  superseded_by: null,
  metadata: { suspected_duplicate_of: 'a4d8e1f2-3b6c-4d7e-9f8a-1b2c3d4e5f60' },
  publication_status: 'in_review',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/content-dedup/queue', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('authentication', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const request = createTestRequest('/api/admin/content-dedup/queue');
      const response = await GET(request);
      expect(response.status).toBe(401);
    });

    it('returns 403 when user has editor role', async () => {
      configureRole(mockSupabase, 'editor');
      const request = createTestRequest('/api/admin/content-dedup/queue');
      const response = await GET(request);
      expect(response.status).toBe(403);
    });

    it('returns 403 when user has viewer role', async () => {
      configureRole(mockSupabase, 'viewer');
      const request = createTestRequest('/api/admin/content-dedup/queue');
      const response = await GET(request);
      expect(response.status).toBe(403);
    });
  });

  describe('happy path', () => {
    it('returns 200 with items + hasMore=false when ≤ limit rows', async () => {
      configureRole(mockSupabase, 'admin');
      configureQueueRows([SAMPLE_ROW]);

      const request = createTestRequest('/api/admin/content-dedup/queue');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(SAMPLE_ROW.id);
      expect(body.hasMore).toBe(false);
      expect(body.nextCursor).toBeNull();
    });

    it('filters by dedup_status=suspected_duplicate and archived_at IS NULL', async () => {
      configureRole(mockSupabase, 'admin');
      configureQueueRows([]);

      const request = createTestRequest('/api/admin/content-dedup/queue');
      await GET(request);

      expect(mockSupabase.from).toHaveBeenCalledWith('content_items');
      expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
        'dedup_status',
        'suspected_duplicate',
      );
      expect(mockSupabase._chain.is).toHaveBeenCalledWith('archived_at', null);
    });

    it('orders by created_at desc by default', async () => {
      configureRole(mockSupabase, 'admin');
      configureQueueRows([]);

      const request = createTestRequest('/api/admin/content-dedup/queue');
      await GET(request);

      expect(mockSupabase._chain.order).toHaveBeenCalledWith('created_at', {
        ascending: false,
      });
    });

    it('applies primary_domain filter when ?domain= present', async () => {
      configureRole(mockSupabase, 'admin');
      configureQueueRows([]);

      const request = createTestRequest('/api/admin/content-dedup/queue', {
        searchParams: { domain: 'tech-it' },
      });
      await GET(request);

      expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
        'primary_domain',
        'tech-it',
      );
    });

    it('applies cursor as < created_at', async () => {
      configureRole(mockSupabase, 'admin');
      configureQueueRows([]);

      const request = createTestRequest('/api/admin/content-dedup/queue', {
        searchParams: { cursor: '2026-04-28T10:00:00.000Z' },
      });
      await GET(request);

      expect(mockSupabase._chain.lt).toHaveBeenCalledWith(
        'created_at',
        '2026-04-28T10:00:00.000Z',
      );
    });

    it('returns hasMore=true and nextCursor when extra peek-ahead row present', async () => {
      configureRole(mockSupabase, 'admin');
      // limit defaults to 50; mock 3 rows with limit=2 query string
      const rows = [
        {
          ...SAMPLE_ROW,
          id: '11111111-1111-4111-8111-111111111111',
          created_at: '2026-04-28T12:00:00Z',
        },
        {
          ...SAMPLE_ROW,
          id: '22222222-2222-4222-8222-222222222222',
          created_at: '2026-04-28T11:00:00Z',
        },
        {
          ...SAMPLE_ROW,
          id: '33333333-3333-4333-8333-333333333333',
          created_at: '2026-04-28T10:00:00Z',
        },
      ];
      configureQueueRows(rows);

      const request = createTestRequest('/api/admin/content-dedup/queue', {
        searchParams: { limit: '2' },
      });
      const response = await GET(request);
      const body = await response.json();

      expect(body.items).toHaveLength(2);
      expect(body.hasMore).toBe(true);
      expect(body.nextCursor).toBe('2026-04-28T11:00:00Z');
    });
  });

  describe('validation', () => {
    it('returns 400 for invalid sort value', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/admin/content-dedup/queue', {
        searchParams: { sort: 'random_unknown' },
      });
      const response = await GET(request);
      expect(response.status).toBe(400);
    });

    it('returns 400 for limit > 100', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/admin/content-dedup/queue', {
        searchParams: { limit: '500' },
      });
      const response = await GET(request);
      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid cursor (non-datetime)', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/admin/content-dedup/queue', {
        searchParams: { cursor: 'not-a-date' },
      });
      const response = await GET(request);
      expect(response.status).toBe(400);
    });
  });

  describe('error handling', () => {
    it('returns 500 when DB query errors', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'boom', code: '42P01' } }),
      );

      const request = createTestRequest('/api/admin/content-dedup/queue');
      const response = await GET(request);
      expect(response.status).toBe(500);
    });
  });
});

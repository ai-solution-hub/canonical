/**
 * GET /api/admin/content-dedup/near-duplicates/[pairId]
 *
 * §1.9 Near-Duplicate Merge Dashboard detail endpoint.
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §5.4, §9 AC4/AC9/AC12
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../../../helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '../../../../helpers/mock-next';

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

import { GET } from '@/app/api/admin/content-dedup/near-duplicates/[pairId]/route';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const PAIR_ID = `${ID_A}__${ID_B}`;

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

const LEFT_ROW = {
  id: ID_A,
  title: 'How are elevated access rights reviewed?',
  content: 'subject body',
  dedup_status: 'clean',
  created_at: '2026-03-14T00:00:00Z',
  primary_domain: 'access-control',
  content_type: 'q_a_pair',
  content_owner_id: null,
  ingest_source: 'example-client-reingest-2026-v2',
  superseded_by: null,
  archived_at: null,
  publication_status: 'published',
};

const RIGHT_ROW = {
  id: ID_B,
  title: 'How are elevated access rights to systems reviewed?',
  content: 'newer body, longer text',
  dedup_status: 'clean',
  created_at: '2026-04-21T00:00:00Z',
  primary_domain: 'access-control',
  content_type: 'q_a_pair',
  content_owner_id: null,
  ingest_source: 'client-new-markdown-2026',
  superseded_by: null,
  archived_at: null,
  publication_status: 'in_review',
};

function configureRowsLookup(rows: (typeof LEFT_ROW)[]) {
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({ data: rows, error: null, count: rows.length }),
  );
}

function configureRpcRows(rows: Array<Record<string, unknown>>) {
  mockSupabase.rpc.mockResolvedValueOnce({ data: rows, error: null });
}

describe('GET /api/admin/content-dedup/near-duplicates/[pairId]', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('authentication / RBAC (AC9)', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(401);
    });

    it('returns 403 when user has editor role', async () => {
      configureRole(mockSupabase, 'editor');
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(403);
    });
  });

  describe('pair-id validation', () => {
    it('returns 400 for malformed pair-id (no separator)', async () => {
      configureRole(mockSupabase, 'admin');
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${ID_A}`,
      );
      const response = await GET(request, {
        params: createTestParams({ pairId: ID_A }),
      });
      expect(response.status).toBe(400);
    });

    it('returns 400 for non-UUID half', async () => {
      configureRole(mockSupabase, 'admin');
      const bogus = `not-a-uuid__${ID_B}`;
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${bogus}`,
      );
      const response = await GET(request, {
        params: createTestParams({ pairId: bogus }),
      });
      expect(response.status).toBe(400);
    });

    it('returns 400 when leftId >= rightId (sort violation)', async () => {
      configureRole(mockSupabase, 'admin');
      const reversed = `${ID_B}__${ID_A}`;
      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${reversed}`,
      );
      const response = await GET(request, {
        params: createTestParams({ pairId: reversed }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('happy path (AC4)', () => {
    it('returns left, right rows + similarity score', async () => {
      configureRole(mockSupabase, 'admin');
      configureRowsLookup([LEFT_ROW, RIGHT_ROW]);
      configureRpcRows([{ id1: ID_A, id2: ID_B, similarity: 0.943 }]);

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.left.id).toBe(ID_A);
      expect(body.right.id).toBe(ID_B);
      expect(body.similarity).toBe(0.943);
      // primary_domain (not domain_primary — see spec correction in CLAUDE-md)
      expect(body.left.primary_domain).toBe('access-control');
    });

    it('matches similarity even when RPC returns the pair in reversed order', async () => {
      configureRole(mockSupabase, 'admin');
      configureRowsLookup([LEFT_ROW, RIGHT_ROW]);
      configureRpcRows([
        // RPC always emits id1 < id2 by contract, but the route's
        // post-filter is order-tolerant for safety.
        { id1: ID_B, id2: ID_A, similarity: 0.943 },
      ]);

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      const body = await response.json();
      expect(body.similarity).toBe(0.943);
    });

    it('returns similarity 0 when pair not found in RPC results', async () => {
      configureRole(mockSupabase, 'admin');
      configureRowsLookup([LEFT_ROW, RIGHT_ROW]);
      configureRpcRows([]);

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      const body = await response.json();
      expect(body.similarity).toBe(0);
    });
  });

  describe('not found', () => {
    it('returns 404 when only one row exists', async () => {
      configureRole(mockSupabase, 'admin');
      configureRowsLookup([LEFT_ROW]);

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(404);
    });

    it('returns 404 when neither row exists', async () => {
      configureRole(mockSupabase, 'admin');
      configureRowsLookup([]);

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(404);
    });
  });

  describe('error handling', () => {
    it('returns 500 when rows lookup errors', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: null,
            error: { message: 'rows lookup boom' },
            count: 0,
          }),
      );

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(500);
    });

    it('returns 500 when similarity RPC errors', async () => {
      configureRole(mockSupabase, 'admin');
      configureRowsLookup([LEFT_ROW, RIGHT_ROW]);
      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'rpc boom' },
      });

      const request = createTestRequest(
        `/api/admin/content-dedup/near-duplicates/${PAIR_ID}`,
      );
      const response = await GET(request, {
        params: createTestParams({ pairId: PAIR_ID }),
      });
      expect(response.status).toBe(500);
    });
  });
});

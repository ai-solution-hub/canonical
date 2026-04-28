/**
 * API route tests for the seed-starter-pack endpoint.
 *
 * Tests:
 *   - Auth gating (unauthenticated, viewer, editor, admin)
 *   - Validation (missing pack ID, unknown pack ID)
 *   - Happy path (seeds feeds into workspace)
 *   - Workspace verification (non-intelligence type, archived)
 *   - Partial failure response shape (mixed success/skip/fail)
 *   - Idempotency (skip-existing)
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

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/intelligence/workspaces/[id]/seed-starter-pack/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function makeContext() {
  return { params: createTestParams({ id: WORKSPACE_UUID }) };
}

function makeRequest(body: unknown) {
  return createTestRequest(
    `/api/intelligence/workspaces/${WORKSPACE_UUID}/seed-starter-pack`,
    { method: 'POST', body },
  );
}

function resetMocks() {
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/intelligence/workspaces/:id/seed-starter-pack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  describe('auth gating', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const res = await POST(
        makeRequest({ starter_pack_id: 'education' }),
        makeContext(),
      );
      expect(res.status).toBe(401);
    });

    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');
      const res = await POST(
        makeRequest({ starter_pack_id: 'education' }),
        makeContext(),
      );
      expect(res.status).toBe(403);
    });

    it('returns 403 for editor role', async () => {
      configureRole(mockSupabase, 'editor');
      const res = await POST(
        makeRequest({ starter_pack_id: 'education' }),
        makeContext(),
      );
      expect(res.status).toBe(403);
    });
  });

  describe('validation', () => {
    it('returns 400 when starter_pack_id is missing', async () => {
      configureRole(mockSupabase, 'admin');
      const res = await POST(makeRequest({}), makeContext());
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
    });

    it('returns 404 for unknown starter pack ID', async () => {
      configureRole(mockSupabase, 'admin');
      const res = await POST(
        makeRequest({ starter_pack_id: 'nonexistent-pack' }),
        makeContext(),
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('nonexistent-pack');
    });
  });

  describe('happy path', () => {
    it('seeds feeds into an empty workspace', async () => {
      configureRole(mockSupabase, 'admin');

      // Workspace verification — maybeSingle returns workspace
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: WORKSPACE_UUID, type: 'intelligence' },
        error: null,
      });

      // For each feed in education pack (6 feeds):
      // 1. SELECT check — no existing feed (maybeSingle returns null)
      // 2. INSERT — success (single returns created row)
      for (let i = 0; i < 6; i++) {
        mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
          data: null,
          error: null,
        });
        mockSupabase._chain.single.mockResolvedValueOnce({
          data: { id: `feed-${i}`, workspace_id: WORKSPACE_UUID },
          error: null,
        });
      }

      const res = await POST(
        makeRequest({ starter_pack_id: 'education' }),
        makeContext(),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.starter_pack_id).toBe('education');
      expect(body.seeded).toHaveLength(6);
      expect(body.skipped_existing).toHaveLength(0);
      expect(body.failed).toHaveLength(0);
    });
  });

  describe('workspace verification', () => {
    it('returns 404 for a non-intelligence workspace', async () => {
      configureRole(mockSupabase, 'admin');

      // Workspace query filters by type='intelligence', so a non-intelligence
      // workspace returns null from maybeSingle
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const res = await POST(
        makeRequest({ starter_pack_id: 'education' }),
        makeContext(),
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Intelligence workspace not found');
    });

    it('returns 404 for an archived workspace', async () => {
      configureRole(mockSupabase, 'admin');

      // Workspace query filters by is_archived=false, so an archived
      // workspace returns null from maybeSingle
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const res = await POST(
        makeRequest({ starter_pack_id: 'procurement' }),
        makeContext(),
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Intelligence workspace not found');
    });
  });

  describe('partial failure', () => {
    it('returns correct shape when some feeds fail and some are skipped', async () => {
      configureRole(mockSupabase, 'admin');

      // Workspace verification — maybeSingle returns workspace
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: WORKSPACE_UUID, type: 'intelligence' },
        error: null,
      });

      // Procurement pack has 4 feeds. Configure each feed's check + insert:
      // Feed 1: check null (no existing), insert succeeds
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: 'feed-1', workspace_id: WORKSPACE_UUID },
        error: null,
      });

      // Feed 2: check returns existing row (skip)
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: 'existing-feed-2' },
        error: null,
      });

      // Feed 3: check null (no existing), insert returns DB error
      // sb() throws SupabaseError when error is present, caught by the route's try/catch
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint',
        },
      });

      // Feed 4: check null (no existing), insert succeeds
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: 'feed-4', workspace_id: WORKSPACE_UUID },
        error: null,
      });

      const res = await POST(
        makeRequest({ starter_pack_id: 'procurement' }),
        makeContext(),
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.seeded).toHaveLength(2);
      expect(body.skipped_existing).toHaveLength(1);
      expect(body.failed).toHaveLength(1);
      expect(body.failed[0]).toHaveProperty('url');
      expect(body.failed[0]).toHaveProperty('error');
      expect(body.warnings).toHaveLength(1);
      expect(body.warnings[0]).toContain('failed');
    });
  });

  describe('idempotency', () => {
    it('skips feeds that already exist', async () => {
      configureRole(mockSupabase, 'admin');

      // Workspace verification
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: WORKSPACE_UUID, type: 'intelligence' },
        error: null,
      });

      // For each feed in procurement pack (4 feeds):
      // All exist already — maybeSingle returns a row
      for (let i = 0; i < 4; i++) {
        mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
          data: { id: `existing-${i}` },
          error: null,
        });
      }

      const res = await POST(
        makeRequest({ starter_pack_id: 'procurement' }),
        makeContext(),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.seeded).toHaveLength(0);
      expect(body.skipped_existing).toHaveLength(4);
      expect(body.failed).toHaveLength(0);
    });
  });
});

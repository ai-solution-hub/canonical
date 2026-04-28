/**
 * Tests for GET /api/admin/taxonomy-sync/status (drift-detection endpoint).
 *
 * Covers:
 * - Admin-only auth gate
 * - Returns in_sync: true when hashes match
 * - Returns in_sync: false with both hashes when they differ
 * - Stale-run sweep: running row > 10 min old → failed with
 *   workflow_callback_timeout (spec §5.4.3 / AC-16)
 * - Does not sweep fresh running rows (< 10 min old)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockSupabase: MockSupabaseClient = createMockSupabaseClient();

vi.mock('@/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    getAuthorisedClient: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/admin/taxonomy-sync/status/route';
import { getAuthorisedClient } from '@/lib/auth';

const getAuthorisedClientMock = vi.mocked(getAuthorisedClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const MOCK_DOMAINS = [
  {
    id: '1',
    name: 'Construction',
    description: 'Building sector',
    key_signal: 'signal',
    display_order: 1,
    is_active: true,
  },
];

const MOCK_SUBTOPICS = [
  {
    id: '10',
    domain_id: '1',
    name: 'Tenders',
    description: 'Tender docs',
    display_order: 1,
    is_active: true,
  },
];

function configureAdminAuth() {
  getAuthorisedClientMock.mockResolvedValue({
    success: true,
    user: { id: TEST_USER_ID, email: 'admin@test.com' } as never,
    supabase: mockSupabase as never,
    role: 'admin',
  });
}

/**
 * Build a self-contained chainable mock for a single table.
 */
function makeChain(terminalData: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
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
  ];
  for (const m of chainable) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue({
    data: terminalData,
    error: null,
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({
    data: terminalData,
    error: null,
  });
  chain.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve({ data: terminalData, error: null }),
  );
  return chain;
}

/**
 * Configure the mock chain for the status route's DB calls.
 *
 * Call sequence:
 * 1. from('pipeline_runs').update(...).eq(...).eq(...).lt(...) — stale sweep
 * 2. from('taxonomy_domains').select(...) — fetch domains
 * 3. from('taxonomy_subtopics').select(...) — fetch subtopics
 * 4. from('taxonomy_sync_state').select(...).limit(1).single() — fetch state
 */
function configureStatusFetch(
  syncHash: string,
  lastSyncAt: string | null = null,
) {
  // Track stale sweep calls for assertion
  const pipelineChain = makeChain(null);
  const sweepUpdateMock = pipelineChain.update;

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'pipeline_runs') {
      return pipelineChain;
    }
    if (table === 'taxonomy_domains') {
      return makeChain(MOCK_DOMAINS);
    }
    if (table === 'taxonomy_subtopics') {
      return makeChain(MOCK_SUBTOPICS);
    }
    if (table === 'taxonomy_sync_state') {
      return makeChain({ last_sync_hash: syncHash, last_sync_at: lastSyncAt });
    }
    return mockSupabase._chain;
  });

  return { sweepUpdateMock };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/taxonomy-sync/status', () => {
  describe('Auth gates', () => {
    it('returns 403 for non-admin users', async () => {
      getAuthorisedClientMock.mockResolvedValue({
        success: false,
        reason: 'forbidden',
      });
      const res = await GET();
      expect(res.status).toBe(403);
    });

    it('returns 401 for unauthenticated users', async () => {
      getAuthorisedClientMock.mockResolvedValue({
        success: false,
        reason: 'unauthenticated',
      });
      const res = await GET();
      expect(res.status).toBe(401);
    });
  });

  describe('Drift detection', () => {
    it('returns in_sync: true when hashes match', async () => {
      configureAdminAuth();

      const { computeTaxonomyHash } =
        await import('@/lib/taxonomy/sync-trigger');
      const matchingHash = computeTaxonomyHash({
        domains: MOCK_DOMAINS,
        subtopics: MOCK_SUBTOPICS,
      });

      configureStatusFetch(matchingHash, '2026-04-21T10:30:00Z');

      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.in_sync).toBe(true);
      expect(body.last_sync_at).toBe('2026-04-21T10:30:00Z');
      expect(body.current_hash).toBe(matchingHash);
      expect(body.synced_hash).toBe(matchingHash);
    });

    it('returns in_sync: false with both hashes when they differ', async () => {
      configureAdminAuth();

      const { computeTaxonomyHash } =
        await import('@/lib/taxonomy/sync-trigger');
      const currentHash = computeTaxonomyHash({
        domains: MOCK_DOMAINS,
        subtopics: MOCK_SUBTOPICS,
      });

      const staleHash = 'totally_different_hash';
      configureStatusFetch(staleHash, '2026-04-20T10:30:00Z');

      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.in_sync).toBe(false);
      expect(body.current_hash).toBe(currentHash);
      expect(body.synced_hash).toBe(staleHash);
    });
  });

  describe('Stale-run sweep (spec §5.4.3 / AC-16)', () => {
    it('sweeps running rows older than 10 minutes to failed with workflow_callback_timeout', async () => {
      configureAdminAuth();

      const { computeTaxonomyHash } =
        await import('@/lib/taxonomy/sync-trigger');
      const matchingHash = computeTaxonomyHash({
        domains: MOCK_DOMAINS,
        subtopics: MOCK_SUBTOPICS,
      });

      const { sweepUpdateMock } = configureStatusFetch(matchingHash);

      await GET();

      // Verify the stale sweep was attempted
      expect(mockSupabase.from).toHaveBeenCalledWith('pipeline_runs');
      expect(sweepUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          error_message: 'workflow_callback_timeout',
        }),
      );
    });

    it('executes stale sweep before returning status', async () => {
      configureAdminAuth();

      const { computeTaxonomyHash } =
        await import('@/lib/taxonomy/sync-trigger');
      const matchingHash = computeTaxonomyHash({
        domains: MOCK_DOMAINS,
        subtopics: MOCK_SUBTOPICS,
      });

      const callOrder: string[] = [];
      mockSupabase.from.mockImplementation((table: string) => {
        callOrder.push(table);
        if (table === 'pipeline_runs') {
          return makeChain(null);
        }
        if (table === 'taxonomy_domains') {
          return makeChain(MOCK_DOMAINS);
        }
        if (table === 'taxonomy_subtopics') {
          return makeChain(MOCK_SUBTOPICS);
        }
        if (table === 'taxonomy_sync_state') {
          return makeChain({
            last_sync_hash: matchingHash,
            last_sync_at: null,
          });
        }
        return mockSupabase._chain;
      });

      await GET();

      // pipeline_runs (stale sweep) should be called first
      expect(callOrder[0]).toBe('pipeline_runs');
    });
  });
});

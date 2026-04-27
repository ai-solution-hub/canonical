/**
 * Tests for POST /api/admin/taxonomy-sync (dispatch route).
 *
 * Covers:
 * - Admin-only auth gate (non-admin returns 403)
 * - In-sync case: returns { dispatched: false, reason: 'in_sync' },
 *   records no-op pipeline_runs via recordPipelineRun
 * - Drift case: inserts 'running' pipeline_runs row via raw sb()
 *   (NOT via recordPipelineRun — per spec §4.1.1)
 * - GitHub 401/403 → 502 with github_token_invalid + Sentry
 * - GitHub 404/422 → 502 with github_workflow_missing + Sentry
 * - GitHub 5xx (retry exhausted) → 502 with github_api_unavailable + Sentry
 * - pipeline_runs row has pipeline_name = 'taxonomy_sync'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const mockDispatchResult = vi.hoisted(() => ({
  current: { ok: true, status: 204 } as {
    ok: boolean;
    status: number;
    error?: string;
  },
}));

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

vi.mock('@/lib/pipeline/record-run', () => ({
  recordPipelineRun: vi.fn(),
}));

vi.mock('@/lib/integrations/github-dispatch', () => ({
  dispatchTaxonomySync: vi.fn(() =>
    Promise.resolve(mockDispatchResult.current),
  ),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/admin/taxonomy-sync/route';
import { getAuthorisedClient } from '@/lib/auth';
import { recordPipelineRun } from '@/lib/pipeline/record-run';
import { dispatchTaxonomySync } from '@/lib/integrations/github-dispatch';
import * as Sentry from '@sentry/nextjs';

const getAuthorisedClientMock = vi.mocked(getAuthorisedClient);
const recordPipelineRunMock = vi.mocked(recordPipelineRun);
const dispatchTaxonomySyncMock = vi.mocked(dispatchTaxonomySync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const RUN_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

function configureAdminAuth() {
  getAuthorisedClientMock.mockResolvedValue({
    success: true,
    user: { id: TEST_USER_ID, email: 'admin@test.com' } as never,
    supabase: mockSupabase as never,
    role: 'admin',
  });
}

function configureForbiddenAuth() {
  getAuthorisedClientMock.mockResolvedValue({
    success: false,
    reason: 'forbidden',
  });
}

/** Standard taxonomy data that produces a known hash. */
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

/**
 * Build a self-contained chainable mock for a single table.
 * Every chain method returns the same chain object so the
 * route's `.from('x').select().eq().single()` pattern works.
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
  // Make the chain awaitable for non-single terminators
  chain.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve({ data: terminalData, error: null }),
  );
  return chain;
}

/**
 * Configure the mock chain to return taxonomy data and sync state.
 * Call sequence: from('taxonomy_domains') -> from('taxonomy_subtopics') ->
 * from('taxonomy_sync_state') -> (optionally) from('pipeline_runs').
 */
function configureTaxonomyFetch(syncHash: string) {
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'taxonomy_domains') {
      return makeChain(MOCK_DOMAINS);
    }
    if (table === 'taxonomy_subtopics') {
      return makeChain(MOCK_SUBTOPICS);
    }
    if (table === 'taxonomy_sync_state') {
      return makeChain({ last_sync_hash: syncHash });
    }
    if (table === 'pipeline_runs') {
      return makeChain({ id: RUN_ID });
    }
    return mockSupabase._chain;
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockDispatchResult.current = { ok: true, status: 204 };
  // Reset the default from mock
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/taxonomy-sync', () => {
  describe('Auth gates', () => {
    it('returns 403 for non-admin users', async () => {
      configureForbiddenAuth();
      const res = await POST();
      expect(res.status).toBe(403);
    });

    it('returns 401 for unauthenticated users', async () => {
      getAuthorisedClientMock.mockResolvedValue({
        success: false,
        reason: 'unauthenticated',
      });
      const res = await POST();
      expect(res.status).toBe(401);
    });
  });

  describe('In-sync case', () => {
    it('returns { dispatched: false, reason: "in_sync" } when hashes match', async () => {
      configureAdminAuth();

      // Use computeTaxonomyHash to get the matching hash
      const { computeTaxonomyHash } =
        await import('@/lib/taxonomy/sync-trigger');
      const matchingHash = computeTaxonomyHash({
        domains: MOCK_DOMAINS,
        subtopics: MOCK_SUBTOPICS,
      });

      configureTaxonomyFetch(matchingHash);

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ dispatched: false, reason: 'in_sync' });
    });

    it('records a no-op pipeline_runs row via recordPipelineRun', async () => {
      configureAdminAuth();

      const { computeTaxonomyHash } =
        await import('@/lib/taxonomy/sync-trigger');
      const matchingHash = computeTaxonomyHash({
        domains: MOCK_DOMAINS,
        subtopics: MOCK_SUBTOPICS,
      });

      configureTaxonomyFetch(matchingHash);

      await POST();

      expect(recordPipelineRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          pipelineName: 'taxonomy_sync',
          status: 'completed',
          itemsProcessed: 0,
        }),
      );
    });
  });

  describe('Drift case — successful dispatch', () => {
    it('returns { dispatched: true, run_id } on hash mismatch', async () => {
      configureAdminAuth();
      configureTaxonomyFetch('stale_hash_that_does_not_match');
      mockDispatchResult.current = { ok: true, status: 204 };

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.dispatched).toBe(true);
      expect(body.run_id).toBe(RUN_ID);
    });

    it('inserts running pipeline_runs row via raw sb() (NOT recordPipelineRun)', async () => {
      configureAdminAuth();
      configureTaxonomyFetch('stale_hash');
      mockDispatchResult.current = { ok: true, status: 204 };

      await POST();

      // recordPipelineRun should NOT be called for the initial running row
      expect(recordPipelineRunMock).not.toHaveBeenCalled();
      // dispatchTaxonomySync should have been called
      expect(dispatchTaxonomySyncMock).toHaveBeenCalledTimes(1);
    });

    it('inserts pipeline_runs row with pipeline_name = taxonomy_sync', async () => {
      configureAdminAuth();

      // Track the insert payload for the pipeline_runs table specifically
      let capturedInsertPayload: Record<string, unknown> | null = null;
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'taxonomy_domains') {
          return makeChain(MOCK_DOMAINS);
        }
        if (table === 'taxonomy_subtopics') {
          return makeChain(MOCK_SUBTOPICS);
        }
        if (table === 'taxonomy_sync_state') {
          return makeChain({ last_sync_hash: 'stale_hash' });
        }
        if (table === 'pipeline_runs') {
          const chain = makeChain({ id: RUN_ID });
          const originalInsert = chain.insert;
          chain.insert = vi.fn((payload: Record<string, unknown>) => {
            capturedInsertPayload = payload;
            return originalInsert(payload);
          });
          return chain;
        }
        return mockSupabase._chain;
      });
      mockDispatchResult.current = { ok: true, status: 204 };

      await POST();

      // Verify from('pipeline_runs') was called
      expect(mockSupabase.from).toHaveBeenCalledWith('pipeline_runs');
      // Verify INSERT payload contains pipeline_name = 'taxonomy_sync'
      expect(capturedInsertPayload).toEqual(
        expect.objectContaining({
          pipeline_name: 'taxonomy_sync',
          status: 'running',
        }),
      );
    });
  });

  describe('Drift case — GitHub API errors', () => {
    it('returns 502 with github_token_invalid on 401 + fires Sentry', async () => {
      configureAdminAuth();
      configureTaxonomyFetch('stale_hash');
      mockDispatchResult.current = {
        ok: false,
        status: 401,
        error: 'GitHub token expired or invalid',
      };

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.error).toBe('github_token_invalid');
      expect(body.message).toContain('Rotate GITHUB_SYNC_TOKEN');
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('returns 502 with github_token_invalid on 403 + fires Sentry', async () => {
      configureAdminAuth();
      configureTaxonomyFetch('stale_hash');
      mockDispatchResult.current = {
        ok: false,
        status: 403,
        error: 'Token lacks scope',
      };

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.error).toBe('github_token_invalid');
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('returns 502 with github_workflow_missing on 404 + fires Sentry', async () => {
      configureAdminAuth();
      configureTaxonomyFetch('stale_hash');
      mockDispatchResult.current = {
        ok: false,
        status: 404,
        error: 'Not found',
      };

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.error).toBe('github_workflow_missing');
      expect(body.message).toContain('taxonomy-sync.yml');
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('returns 502 with github_workflow_missing on 422 + fires Sentry', async () => {
      configureAdminAuth();
      configureTaxonomyFetch('stale_hash');
      mockDispatchResult.current = {
        ok: false,
        status: 422,
        error: 'Workflow not configured',
      };

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.error).toBe('github_workflow_missing');
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('returns 502 with github_api_unavailable on 5xx (retry exhausted) + fires Sentry', async () => {
      configureAdminAuth();
      configureTaxonomyFetch('stale_hash');
      mockDispatchResult.current = {
        ok: false,
        status: 500,
        error: 'Internal server error',
      };

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.error).toBe('github_api_unavailable');
      expect(body.message).toContain('drift banner will retry');
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('returns 502 with github_api_unavailable on network error (status 0) + fires Sentry', async () => {
      configureAdminAuth();
      configureTaxonomyFetch('stale_hash');
      mockDispatchResult.current = {
        ok: false,
        status: 0,
        error: 'Network error after retry',
      };

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.error).toBe('github_api_unavailable');
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });
  });
});

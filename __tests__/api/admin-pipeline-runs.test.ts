/**
 * Tests for GET /api/admin/pipeline-runs/recent.
 *
 * Pure unit tests for the route's transformation logic — no real DB.
 * Mocks `getAuthorisedClient` (so the route receives a mock supabase client)
 * and configures the mocked `pipeline_runs` chain via `mockSupabase._chain.then`.
 *
 * Closes S156 resolution spec WP-3 (Sweep 3 Finding 3.1, Medium severity).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Shared mock client + module mocks (must be declared BEFORE route import)
// ---------------------------------------------------------------------------

const mockSupabase: MockSupabaseClient = createMockSupabaseClient();

vi.mock('@/lib/auth', async () => {
  // Re-export the real authFailureResponse so 401/403/500 mapping
  // matches production behaviour exactly.
  const actual =
    await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    getAuthorisedClient: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/admin/pipeline-runs/recent/route';
import { getAuthorisedClient } from '@/lib/auth';

const getAuthorisedClientMock = vi.mocked(getAuthorisedClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PipelineRunRow {
  pipeline_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

/**
 * Configure the mocked Supabase chain to resolve `pipeline_runs` queries
 * with the supplied rows. The route awaits the chain (via `sb()`), which
 * triggers the `then` mock — so we override `then` for one call.
 */
function mockPipelineRunsRows(rows: PipelineRunRow[]) {
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({ data: rows, error: null, count: rows.length }),
  );
}

/**
 * Configure the mocked chain to resolve with a Postgrest error so that
 * `sb()` throws and the route's top-level try/catch fires.
 */
function mockPipelineRunsError(message: string, code: string) {
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({
        data: null,
        error: { message, code, details: '', hint: '' },
        count: null,
      }),
  );
}

/**
 * Configure `getAuthorisedClient` to return a successful auth result that
 * exposes our mocked Supabase client to the route under test.
 */
function mockAuthSuccess() {
  getAuthorisedClientMock.mockResolvedValueOnce({
    success: true,
    user: { id: 'admin-user-id', email: 'admin@example.com' },
    // The mock client is structurally compatible with the parts of the
    // SupabaseClient surface the route exercises (`from().select().gte().order()`).
    supabase: mockSupabase as unknown as Awaited<
      ReturnType<typeof getAuthorisedClient>
    > extends { success: true; supabase: infer S }
      ? S
      : never,
    role: 'admin',
  });
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  getAuthorisedClientMock.mockReset();

  // Reset the chain and re-establish chainable returns.
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  const chain = mockSupabase._chain;
  const chainableMethods: (keyof typeof chain)[] = [
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
  for (const method of chainableMethods) {
    chain[method].mockReturnValue(chain);
  }
  mockSupabase.from.mockReturnValue(chain);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/pipeline-runs/recent', () => {
  // -------------------------------------------------------------------------
  // Auth failure paths
  // -------------------------------------------------------------------------

  describe('auth failures', () => {
    it('returns 403 when the caller is not an admin (forbidden)', async () => {
      getAuthorisedClientMock.mockResolvedValueOnce({
        success: false,
        reason: 'forbidden',
      });

      const response = await GET();
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.error).toBe('Forbidden');
    });

    it('returns 401 when the caller is unauthenticated', async () => {
      getAuthorisedClientMock.mockResolvedValueOnce({
        success: false,
        reason: 'unauthenticated',
      });

      const response = await GET();
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBe('Unauthorised');
    });

    it('returns 500 when role lookup fails (transient DB glitch)', async () => {
      getAuthorisedClientMock.mockResolvedValueOnce({
        success: false,
        reason: 'role_lookup_failed',
      });

      const response = await GET();
      expect(response.status).toBe(500);

      const body = await response.json();
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Happy-path transformation logic
  // -------------------------------------------------------------------------

  describe('transformation logic', () => {
    it('returns an empty envelope when there are no recent pipeline runs', async () => {
      mockAuthSuccess();
      mockPipelineRunsRows([]);

      const response = await GET();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.summaries).toEqual([]);
      expect(body.totalRuns).toBe(0);
      expect(body.totalFailures).toBe(0);
      expect(body.hasAnyFailures).toBe(false);
      expect(body.windowHours).toBe(24);
      expect(typeof body.generatedAt).toBe('string');
      // generatedAt must be a valid ISO timestamp.
      expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
    });

    it('groups a single completed run into one summary', async () => {
      mockAuthSuccess();
      mockPipelineRunsRows([
        {
          pipeline_name: 'content_gaps',
          status: 'completed',
          started_at: '2026-04-08T10:00:00.000Z',
          completed_at: '2026-04-08T10:05:00.000Z',
          error_message: null,
        },
      ]);

      const response = await GET();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.summaries).toHaveLength(1);

      const summary = body.summaries[0];
      expect(summary.pipelineName).toBe('content_gaps');
      expect(summary.runCount).toBe(1);
      expect(summary.failureCount).toBe(0);
      expect(summary.completedWithErrorsCount).toBe(0);
      expect(summary.lastRunStatus).toBe('completed');
      expect(summary.lastRunAt).toBe('2026-04-08T10:05:00.000Z');
      expect(summary.lastFailureAt).toBeNull();
      expect(summary.lastFailureMessage).toBeNull();

      expect(body.totalRuns).toBe(1);
      expect(body.totalFailures).toBe(0);
      expect(body.hasAnyFailures).toBe(false);
    });

    it('aggregates multiple pipelines with mixed statuses', async () => {
      mockAuthSuccess();
      // Returned in started_at DESC order (most recent first).
      mockPipelineRunsRows([
        {
          pipeline_name: 'quality_score',
          status: 'completed_with_errors',
          started_at: '2026-04-08T11:00:00.000Z',
          completed_at: '2026-04-08T11:02:00.000Z',
          error_message: null,
        },
        {
          pipeline_name: 'freshness_transitions',
          status: 'failed',
          started_at: '2026-04-08T10:30:00.000Z',
          completed_at: null,
          error_message: 'Connection refused',
        },
        {
          pipeline_name: 'content_gaps',
          status: 'completed',
          started_at: '2026-04-08T10:00:00.000Z',
          completed_at: '2026-04-08T10:05:00.000Z',
          error_message: null,
        },
      ]);

      const response = await GET();
      expect(response.status).toBe(200);

      const body = await response.json();
      // Summaries are sorted alphabetically by pipelineName.
      expect(body.summaries).toHaveLength(3);
      expect(
        body.summaries.map((s: { pipelineName: string }) => s.pipelineName),
      ).toEqual(['content_gaps', 'freshness_transitions', 'quality_score']);

      const contentGaps = body.summaries.find(
        (s: { pipelineName: string }) => s.pipelineName === 'content_gaps',
      );
      expect(contentGaps.runCount).toBe(1);
      expect(contentGaps.failureCount).toBe(0);
      expect(contentGaps.completedWithErrorsCount).toBe(0);
      expect(contentGaps.lastRunStatus).toBe('completed');
      expect(contentGaps.lastFailureAt).toBeNull();
      expect(contentGaps.lastFailureMessage).toBeNull();

      const freshness = body.summaries.find(
        (s: { pipelineName: string }) =>
          s.pipelineName === 'freshness_transitions',
      );
      expect(freshness.runCount).toBe(1);
      expect(freshness.failureCount).toBe(1);
      expect(freshness.completedWithErrorsCount).toBe(0);
      expect(freshness.lastRunStatus).toBe('failed');
      expect(freshness.lastFailureAt).toBe('2026-04-08T10:30:00.000Z');
      expect(freshness.lastFailureMessage).toBe('Connection refused');

      const quality = body.summaries.find(
        (s: { pipelineName: string }) => s.pipelineName === 'quality_score',
      );
      expect(quality.runCount).toBe(1);
      expect(quality.failureCount).toBe(0);
      expect(quality.completedWithErrorsCount).toBe(1);
      expect(quality.lastRunStatus).toBe('completed_with_errors');

      expect(body.totalRuns).toBe(3);
      expect(body.totalFailures).toBe(1);
      expect(body.hasAnyFailures).toBe(true);
    });

    it('records the most recent failure when a pipeline has multiple failures', async () => {
      mockAuthSuccess();
      // Two failures for the same pipeline, ordered started_at DESC
      // (most recent first — matches the DB ordering the route relies on).
      mockPipelineRunsRows([
        {
          pipeline_name: 'content_gaps',
          status: 'failed',
          started_at: '2026-04-08T11:00:00.000Z',
          completed_at: null,
          error_message: 'Most recent failure',
        },
        {
          pipeline_name: 'content_gaps',
          status: 'failed',
          started_at: '2026-04-08T09:00:00.000Z',
          completed_at: null,
          error_message: 'Older failure',
        },
      ]);

      const response = await GET();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.summaries).toHaveLength(1);

      const summary = body.summaries[0];
      expect(summary.pipelineName).toBe('content_gaps');
      expect(summary.runCount).toBe(2);
      expect(summary.failureCount).toBe(2);
      // The first row in DESC order is the most recent — that's the one
      // whose timestamp + message must surface in lastFailure*.
      expect(summary.lastFailureAt).toBe('2026-04-08T11:00:00.000Z');
      expect(summary.lastFailureMessage).toBe('Most recent failure');
      expect(summary.lastRunStatus).toBe('failed');

      expect(body.totalRuns).toBe(2);
      expect(body.totalFailures).toBe(2);
      expect(body.hasAnyFailures).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe('error path', () => {
    it('returns 500 with an error envelope when the DB query fails', async () => {
      mockAuthSuccess();
      mockPipelineRunsError('relation "pipeline_runs" does not exist', '42P01');

      const response = await GET();
      expect(response.status).toBe(500);

      const body = await response.json();
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    });
  });
});

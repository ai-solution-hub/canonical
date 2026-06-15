/**
 * Tests for `lib/queue/dispatch.ts` — batch_reclassify pipeline_runs
 * finalisation on cooperative cancellation (ID-76).
 *
 * Context: when the batch_reclassify handler returns `result.cancelled`,
 * the dispatcher's Pattern-2 direct UPDATE on the pre-allocated
 * `pipeline_runs` row must record `status='cancelled'` (superseding the
 * prior §5.4.4 §10 D-8 'completed_with_errors' shortcut) and must NOT emit
 * a Sentry alert — a user-initiated cancel is not a degradation.
 *
 * This is a dispatch-layer test: `runBatchReclassifyJob` (the handler) and
 * `reValidateAuthContext` are mocked so only the dispatch finalisation
 * branch is exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Hoisted mocks — handler + auth re-validation + Sentry.
// ---------------------------------------------------------------------------
const { mockRunBatchReclassifyJob, mockReValidateAuthContext } = vi.hoisted(
  () => ({
    mockRunBatchReclassifyJob: vi.fn(),
    mockReValidateAuthContext: vi.fn(),
  }),
);

vi.mock('@/lib/queue/handlers/batch-reclassify', () => ({
  runBatchReclassifyJob: mockRunBatchReclassifyJob,
}));

vi.mock('@/lib/queue/auth', () => ({
  reValidateAuthContext: mockReValidateAuthContext,
}));

// The other handlers are imported by dispatch.ts at module load — stub them
// so the import graph resolves without pulling the AI stack.
vi.mock('@/lib/queue/handlers/procurement-draft-all', () => ({
  runBidDraftAllJob: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
}));

import * as Sentry from '@sentry/nextjs';

// Import the dispatch entry AFTER the mocks are registered.
const { runJobByType } = await import('@/lib/queue/dispatch');

// ---------------------------------------------------------------------------
// Fixtures — RFC 4122 v4 UUIDs (Zod-strict).
// ---------------------------------------------------------------------------
const JOB_ID = 'b0b0b0b0-0000-4000-8000-000000000001';
const USER_ID = 'b0b0b0b0-0000-4000-8000-000000000002';
const WORKSPACE_ID = 'b0b0b0b0-0000-4000-8000-000000000003';
const PIPELINE_RUN_ID = 'c0ffee00-1234-4567-89ab-cdef01234567';

function makeJob() {
  return {
    id: JOB_ID,
    job_type: 'batch_reclassify',
    payload: {
      envelope_version: 1 as const,
      auth_context: {
        user_id: USER_ID,
        role: 'editor' as const,
        workspace_id: WORKSPACE_ID,
      },
      pipeline_run_id: PIPELINE_RUN_ID,
      body: { workspace_id: WORKSPACE_ID },
    },
    attempts: 0,
    max_attempts: 3,
  };
}

describe('runJobByType — batch_reclassify cancelled finalisation (ID-76)', () => {
  let supabase: MockSupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    supabase = createMockSupabaseClient();
    // Auth re-validation passes.
    mockReValidateAuthContext.mockResolvedValue({ ok: true });
    // pipeline_runs UPDATE resolves cleanly (awaited via .eq terminal).
    supabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );
  });

  it('records status=cancelled on pipeline_runs when the handler returns cancelled=true', async () => {
    mockRunBatchReclassifyJob.mockResolvedValue({
      cancelled: true,
      cancellation_message: 'cancelled mid-run after 7/25 items',
      results: [],
      total_items: 25,
      reclassified: 7,
      failed: 0,
      total_cost: 0.01,
    });

    await runJobByType(
      makeJob(),
      supabase as unknown as Parameters<typeof runJobByType>[1],
    );

    // The pipeline_runs UPDATE carries status='cancelled'.
    const updateCall = supabase._chain.update.mock.calls.find(
      (call) =>
        call[0] &&
        typeof call[0] === 'object' &&
        (call[0] as Record<string, unknown>).status === 'cancelled',
    );
    expect(updateCall).toBeDefined();
    const payload = updateCall![0] as Record<string, unknown>;
    expect(payload.status).toBe('cancelled');
    expect(payload.error_message).toBe('cancelled mid-run after 7/25 items');

    // The UPDATE targets the pre-allocated row.
    expect(supabase.from).toHaveBeenCalledWith('pipeline_runs');
    expect(supabase._chain.eq).toHaveBeenCalledWith('id', PIPELINE_RUN_ID);

    // ID-76: cancellation is SILENT — no Sentry alert fires.
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('still fires a Sentry warning on a genuinely-degraded (completed_with_errors) run — cancellation silence does not suppress real alerts', async () => {
    mockRunBatchReclassifyJob.mockResolvedValue({
      cancelled: false,
      results: [],
      total_items: 25,
      reclassified: 20,
      failed: 5,
      total_cost: 0.02,
    });

    await runJobByType(
      makeJob(),
      supabase as unknown as Parameters<typeof runJobByType>[1],
    );

    // A real degradation DOES alert (warning level) — proves the silence is
    // cancellation-specific, not a blanket suppression.
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [, options] = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(options).toMatchObject({ level: 'warning' });
  });
});

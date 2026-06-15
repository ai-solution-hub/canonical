/**
 * Tests for `app/api/jobs/[id]/cancel/route.ts` — pending-job cancellation.
 *
 * Spec: docs/specs/background-queue-infra-spec.md §5.6 (cancellation, lines
 * 859-878):
 *   - Pending → cancelled (race-safe via `.in('status', ['pending'])` filter).
 *   - Processing → 409 Conflict (worker cannot be interrupted in v1).
 * Plan: docs/plans/background-queue-infra-plan.md §2 W2 (cancel route).
 *
 * AC coverage:
 *   - AC-9 : Pending job cancellation transitions to `cancelled`.
 *   - AC-10: Processing job cannot be cancelled by request → 409.
 *
 * Spec §5.6 reference shape (lines 864-871):
 *   await supabase
 *     .from('processing_queue')
 *     .update({ status: 'cancelled', completed_at: new Date().toISOString(),
 *               error_message: 'cancelled by user' })
 *     .eq('id', jobId)
 *     .in('status', ['pending']);  // race-safe filter
 *
 * Implementation note: the W2 cancel route impl file lands in a parallel
 * worktree. Tests run after merge — `bunx tsc --noEmit` in THIS worktree
 * will fail with `Cannot find module '@/app/api/jobs/[id]/cancel/route'`
 * until then; expected, not a regression.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createMockSupabaseClient,
  configureRole,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '@/__tests__/helpers/mock-next';

// ---------------------------------------------------------------------------
// Mock setup — registered BEFORE importing the route handler.
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// Import handler AFTER mocks. The route is a Next.js 16 dynamic route so
// `params` arrives as a Promise per `createTestParams`.
const { PATCH } = await import('@/app/api/jobs/[id]/cancel/route');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
// RFC 4122 v4-compliant — z.string().uuid() rejects all-zero placeholders.
const JOB_ID = 'e1f2a3b4-c5d6-4789-e0f1-a2b3c4d5e6f7';
const USER_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';

function makePatchRequest() {
  return createTestRequest(`/api/jobs/${JOB_ID}/cancel`, {
    method: 'PATCH',
  });
}

function configureAuth(role: 'admin' | 'editor' | 'viewer' = 'editor') {
  // First .single() resolves the auth role lookup (mirrors the
  // getAuthorisedClient pattern other routes use).
  mockSupabase.auth.getUser.mockResolvedValueOnce({
    data: {
      user: { id: USER_ID, email: 'test@example.com' },
    },
    error: null,
  });
  configureRole(mockSupabase as MockSupabaseClient, role);
}

describe('PATCH /api/jobs/[id]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain returns so each test starts from defaults.
    mockSupabase.from.mockReturnValue(mockSupabase._chain);
    mockSupabase._chain.select.mockReturnValue(mockSupabase._chain);
    mockSupabase._chain.update.mockReturnValue(mockSupabase._chain);
    mockSupabase._chain.eq.mockReturnValue(mockSupabase._chain);
    mockSupabase._chain.in.mockReturnValue(mockSupabase._chain);
  });

  // -------------------------------------------------------------------------
  // AC-9: Pending job → cancelled
  // -------------------------------------------------------------------------
  it('AC-9: cancels a pending job, returns 200 with status=cancelled', async () => {
    configureAuth('editor');

    // First terminal: SELECT status of the job → 'pending'
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: JOB_ID, status: 'pending' },
      error: null,
    });
    // Second terminal: the UPDATE chain resolves successfully.
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: JOB_ID }], error: null }),
    );

    const req = makePatchRequest();
    const params = createTestParams({ id: JOB_ID });
    const res = await PATCH(req as never, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Body MUST include the jobId + cancelled status (per spec §3.4 step 3
    // and the AC-9 assertion contract).
    expect(body).toMatchObject({
      jobId: JOB_ID,
      status: 'cancelled',
    });

    // Content-of-write: the UPDATE payload should include status='cancelled'
    // + completed_at + error_message='cancelled by user' (verbatim from spec
    // §5.6 lines 868-870). The race-safe `.in('status', ['pending'])` filter
    // is a chain-shape invariant that surfaces only against the real DB —
    // migrated to W-RD' integration tier per remediation-plan §3.5.
    const updateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateArg).toMatchObject({
      status: 'cancelled',
      error_message: 'cancelled by user',
    });
    expect(updateArg.completed_at).toEqual(expect.any(String));
  });

  // -------------------------------------------------------------------------
  // AC-10: Processing job → 409 Conflict, no UPDATE
  // -------------------------------------------------------------------------
  it('AC-10: returns 409 Conflict when the job is already processing, with no UPDATE call', async () => {
    configureAuth('editor');

    // SELECT status of the job → 'processing'
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: JOB_ID, status: 'processing' },
      error: null,
    });

    const req = makePatchRequest();
    const params = createTestParams({ id: JOB_ID });
    const res = await PATCH(req as never, { params });

    expect(res.status).toBe(409);
    const body = await res.json();
    // Spec §5.6 line 117: "job already in progress" message surface.
    expect(typeof body.error).toBe('string');
    // No UPDATE allowed for an in-flight job (spec §5.6 lines 873-875).
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Surface check: terminal-state jobs (already completed/failed/cancelled)
  // should also be rejected — but the spec only mandates 409 for processing.
  // We verify the impl at minimum doesn't issue an UPDATE that re-cancels
  // a completed row.
  // -------------------------------------------------------------------------
  it('does not write a cancellation UPDATE when job is already completed', async () => {
    configureAuth('editor');

    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: JOB_ID, status: 'completed' },
      error: null,
    });

    const req = makePatchRequest();
    const params = createTestParams({ id: JOB_ID });
    const res = await PATCH(req as never, { params });

    // Must not be a successful 200 cancel (it's already terminal).
    expect(res.status).not.toBe(200);
    // Must not write an update (race-safe filter would no-op anyway, but
    // the route should short-circuit before issuing the UPDATE).
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // §5.4.2 D-9 — cooperative-cancel widening (S225 W1-IMPL).
  //
  // For job_types in `COOPERATIVELY_CANCELLABLE_JOB_TYPES`
  // (`lib/queue/cooperative-cancel.ts`), a `'processing'` job IS cancellable
  // and the route returns 200 with `status='cancelled'` (instead of the
  // §5.4.1 hard-409). The race-safe UPDATE filter widens to
  // `.in('status', ['pending', 'processing'])` so that a worker claim
  // between SELECT and UPDATE doesn't double-transition.
  //
  // Symmetric assertion: non-opt-in job_types still get hard-409 on
  // `'processing'` (preserves §5.4.1 semantics for everyone else).
  //
  // Note: we use the REAL `canCooperativelyCancel` helper (not a mock) per
  // `feedback_centralised_constant_mock_adoption_sweep` — mocking the
  // exported constant would silently bypass the contract being tested.
  // The integration test at `__tests__/integration/queue/batch-reclassify.
  // integration.test.ts` (AC-9 processing → 200 cooperative) covers the
  // end-to-end path against the real DB; this unit case locks the cancel
  // route's branch logic at the unit level.
  // -------------------------------------------------------------------------
  it('returns 200 when cancelling a status="processing" job whose job_type is in the cooperative-cancel allow-list', async () => {
    configureAuth('editor');

    // SELECT returns a processing batch_reclassify job — opt-in per
    // COOPERATIVELY_CANCELLABLE_JOB_TYPES = ['batch_reclassify'].
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        id: JOB_ID,
        status: 'processing',
        job_type: 'batch_reclassify',
      },
      error: null,
    });
    // The widened UPDATE chain resolves successfully.
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: JOB_ID }], error: null }),
    );

    const req = makePatchRequest();
    const params = createTestParams({ id: JOB_ID });
    const res = await PATCH(req as never, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ jobId: JOB_ID, status: 'cancelled' });

    // The widened race-safe `.in('status', ['pending', 'processing'])`
    // filter is a chain-shape invariant that surfaces only against the
    // real DB — migrated to W-RD' integration tier per
    // remediation-plan §3.5. The 200/cancelled response distinguishes
    // this path from the §5.4.1 hard-409 (verified in the sibling test).
    // Content-of-write: the UPDATE payload matches the §5.6 shape.
    const updateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateArg).toMatchObject({
      status: 'cancelled',
      error_message: 'cancelled by user',
    });
    expect(updateArg.completed_at).toEqual(expect.any(String));
  });

  it('returns 409 when cancelling a status="processing" job whose job_type is NOT in the cooperative-cancel allow-list', async () => {
    configureAuth('editor');

    // SELECT returns a processing 'classify' job — NOT in
    // COOPERATIVELY_CANCELLABLE_JOB_TYPES, so §5.4.1 hard-409 applies.
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        id: JOB_ID,
        status: 'processing',
        job_type: 'classify',
      },
      error: null,
    });

    const req = makePatchRequest();
    const params = createTestParams({ id: JOB_ID });
    const res = await PATCH(req as never, { params });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
    // No UPDATE for non-opt-in processing jobs — the route short-circuits
    // before issuing the UPDATE (preserves §5.4.1 semantics).
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // ID-76 — pending-cancel orphan fix.
  //
  // When a *pending* job carrying a `pipeline_run_id` on its envelope is
  // cancelled, the route MUST also close the pre-allocated `pipeline_runs`
  // row to `status='cancelled'` (otherwise the worker never runs and the
  // row stays 'running'/'in_progress' forever, spinning the upload-tab
  // poller). The close-out uses the SERVICE-role client because
  // `pipeline_runs` has NO UPDATE policy for the auth-scoped client.
  //
  // Symmetric assertion: a *processing* cooperative cancel must NOT write
  // pipeline_runs from the route — the worker's finaliseRun / dispatch
  // owns that terminal write, and a route-side write would be a double-write
  // race.
  // -------------------------------------------------------------------------
  const PIPELINE_RUN_ID = 'c0ffee00-1234-4567-89ab-cdef01234567';

  it('ID-76: closes the pipeline_runs row to cancelled on a pending cancel carrying a pipeline_run_id (service client)', async () => {
    configureAuth('editor');

    // SELECT returns a pending job whose envelope payload carries the
    // pre-allocated pipeline_run_id (batch_reclassify is one such producer).
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        id: JOB_ID,
        status: 'pending',
        job_type: 'batch_reclassify',
        payload: { pipeline_run_id: PIPELINE_RUN_ID },
      },
      error: null,
    });
    // Both the queue UPDATE and the pipeline_runs UPDATE resolve cleanly.
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: JOB_ID }], error: null }),
    );

    const req = makePatchRequest();
    const params = createTestParams({ id: JOB_ID });
    const res = await PATCH(req as never, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ jobId: JOB_ID, status: 'cancelled' });

    // Behaviour: a pipeline_runs close-out UPDATE to 'cancelled' was issued
    // against the pre-allocated row. Locate it by its distinctive payload
    // (not by call position / count — those couple to the shared-chain mock
    // shape rather than to behaviour).
    expect(mockSupabase.from).toHaveBeenCalledWith('pipeline_runs');
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('id', PIPELINE_RUN_ID);
    const pipelineRunUpdate = mockSupabase._chain.update.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find(
        (payload) =>
          payload.error_message === 'cancelled before processing started',
      );
    expect(pipelineRunUpdate).toBeDefined();
    expect(pipelineRunUpdate).toMatchObject({
      status: 'cancelled',
      error_message: 'cancelled before processing started',
    });
    expect(pipelineRunUpdate?.completed_at).toEqual(expect.any(String));
  });

  it('ID-76: a pending cancel WITHOUT a pipeline_run_id writes only the queue UPDATE (no pipeline_runs close-out)', async () => {
    configureAuth('editor');

    // Pending job whose envelope has no pipeline_run_id (e.g. a job_type
    // that never pre-allocates a pipeline_runs row).
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        id: JOB_ID,
        status: 'pending',
        job_type: 'classify',
        payload: {},
      },
      error: null,
    });
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: JOB_ID }], error: null }),
    );

    const req = makePatchRequest();
    const params = createTestParams({ id: JOB_ID });
    const res = await PATCH(req as never, { params });

    expect(res.status).toBe(200);
    // Only the queue UPDATE — no pipeline_runs close-out without a run id.
    expect(mockSupabase._chain.update).toHaveBeenCalledTimes(1);
    expect(mockSupabase.from).not.toHaveBeenCalledWith('pipeline_runs');
  });

  it('ID-76: a processing cooperative cancel does NOT write pipeline_runs (no double-write — worker owns the terminal write)', async () => {
    configureAuth('editor');

    // Processing batch_reclassify job — cooperative cancel returns 200, but
    // the route must NOT touch pipeline_runs: the worker's dispatch
    // finalisation owns that terminal write.
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        id: JOB_ID,
        status: 'processing',
        job_type: 'batch_reclassify',
        payload: { pipeline_run_id: PIPELINE_RUN_ID },
      },
      error: null,
    });
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: JOB_ID }], error: null }),
    );

    const req = makePatchRequest();
    const params = createTestParams({ id: JOB_ID });
    const res = await PATCH(req as never, { params });

    expect(res.status).toBe(200);
    // Only the queue UPDATE — the worker, not the route, closes pipeline_runs.
    expect(mockSupabase._chain.update).toHaveBeenCalledTimes(1);
    expect(mockSupabase.from).not.toHaveBeenCalledWith('pipeline_runs');
  });
});

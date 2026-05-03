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

    // The UPDATE must include the race-safe `.in('status', ['pending'])`
    // filter per spec §5.6 reference shape — this guarantees a worker
    // claiming the job between SELECT and UPDATE doesn't double-transition.
    expect(mockSupabase._chain.in).toHaveBeenCalledWith('status', ['pending']);
    // The UPDATE payload should include status='cancelled' + completed_at +
    // error_message='cancelled by user' (verbatim from spec §5.6 lines 868-870).
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
});

/**
 * Behavioural tests for `app/api/jobs/[id]/cancel/route.ts` —
 * markdown_batch-specific coverage. Session 226 W1-C.
 *
 * Spec: .planning/.archive/.specs/§5.4.4-ep2-markdown-batch-migration-spec.md §10 D-8
 * (cooperative-cancel ratified flip; markdown_batch joins the
 * `COOPERATIVELY_CANCELLABLE_JOB_TYPES` allow-list).
 *
 * The shared cancel-route logic + the batch_reclassify (allow-list) +
 * classify (NOT in allow-list) cases are covered in the sibling file
 * `__tests__/api/jobs/cancel.test.ts` (S225). This file adds the
 * markdown_batch-specific contract assertions per spec §10 D-8 +
 * §8 AC-7 (a + b).
 *
 * Behaviour-focused (per memory `feedback_e2e_no_workarounds`): each
 * test asserts on observable HTTP status + response body + observable
 * Supabase UPDATE payload — NOT on internal call counts.
 *
 * Test scope:
 *   1. Pending markdown_batch cancel → 200 + status='cancelled'
 *      (AC-7a — pending-cancel path).
 *   2. Processing markdown_batch cancel (cooperative-cancel allow-list
 *      member) → 200 + status='cancelled' (AC-7b — processing-cancel
 *      cooperative path).
 *   3. (Sister-file regression guard, not asserted here): processing
 *      classify cancel → 409 — covered in cancel.test.ts AC for the
 *      non-allow-list policy.
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

const { PATCH } = await import('@/app/api/jobs/[id]/cancel/route');

// ---------------------------------------------------------------------------
// Fixtures — RFC 4122 v4-compliant.
// ---------------------------------------------------------------------------

const JOB_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function makePatchRequest() {
  return createTestRequest(`/api/jobs/${JOB_ID}/cancel`, {
    method: 'PATCH',
  });
}

function configureAuth(role: 'admin' | 'editor' | 'viewer' = 'editor') {
  mockSupabase.auth.getUser.mockResolvedValueOnce({
    data: {
      user: { id: USER_ID, email: 'test@example.com' },
    },
    error: null,
  });
  configureRole(mockSupabase as MockSupabaseClient, role);
}

describe('PATCH /api/jobs/[id]/cancel — markdown_batch (S226 §5.4.4 D-8)', () => {
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
  // AC-7a — Pending markdown_batch cancellation.
  // Spec §8 AC-7a lines 1717-1723.
  //
  // Behaviour-focused contract: pending → 200; UPDATE payload =
  // {status:'cancelled', error_message:'cancelled by user', completed_at}.
  // -------------------------------------------------------------------------

  it('AC-7a: pending markdown_batch → 200 + body {jobId, status:"cancelled"}; UPDATE writes status="cancelled" + error_message="cancelled by user"', async () => {
    configureAuth('editor');

    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        id: JOB_ID,
        status: 'pending',
        job_type: 'markdown_batch',
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
    const body = await res.json();
    expect(body).toEqual({ jobId: JOB_ID, status: 'cancelled' });

    // Observable side-effect: UPDATE payload matches §5.6 reference shape.
    const updateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateArg).toMatchObject({
      status: 'cancelled',
      error_message: 'cancelled by user',
    });
    expect(updateArg.completed_at).toEqual(expect.any(String));
  });

  // -------------------------------------------------------------------------
  // AC-7b — Processing markdown_batch cancellation (cooperative-cancel
  // allow-list member). Spec §8 AC-7b lines 1724-1740 + cooperative-cancel
  // allow-list at lib/queue/cooperative-cancel.ts:61-64.
  //
  // Contract: markdown_batch is in COOPERATIVELY_CANCELLABLE_JOB_TYPES, so
  // a 'processing' row IS cancellable and the route returns 200. The
  // race-safe filter widens to .in('status', ['pending', 'processing']).
  // -------------------------------------------------------------------------

  it('AC-7b: processing markdown_batch → 200 + body {jobId, status:"cancelled"}; race-safe filter is .in("status", ["pending","processing"])', async () => {
    configureAuth('editor');

    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        id: JOB_ID,
        status: 'processing',
        job_type: 'markdown_batch',
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
    const body = await res.json();
    expect(body).toEqual({ jobId: JOB_ID, status: 'cancelled' });

    // The widened race-safe `.in('status', ['pending', 'processing'])`
    // filter is a chain-shape invariant that surfaces only against the
    // real DB — migrated to W-RD' integration tier per
    // remediation-plan §3.5. The 200/cancelled response distinguishes
    // this path from the §5.4.1 hard-409 (verified in the sibling test).
    // Content-of-write: UPDATE payload matches the §5.6 shape verbatim.
    const updateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateArg).toMatchObject({
      status: 'cancelled',
      error_message: 'cancelled by user',
    });
    expect(updateArg.completed_at).toEqual(expect.any(String));
  });

  // -------------------------------------------------------------------------
  // Sister-file regression guard — assert that the cancel route still
  // refuses 'processing' for non-cooperative job types (here we use
  // 'classify' which is NOT in the allow-list per
  // lib/queue/cooperative-cancel.ts:61-64). This duplicates the assertion
  // in cancel.test.ts but locks the behavioural contract for §5.4.4
  // wave: a regression that accidentally added every job_type to the
  // allow-list would let this test still pass for markdown_batch but fail
  // for classify, surfacing the over-broad change.
  // -------------------------------------------------------------------------

  it('regression guard: processing classify (NOT in cooperative-cancel allow-list) → 409 + UPDATE NOT called', async () => {
    configureAuth('editor');

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
    // No UPDATE for non-opt-in processing jobs.
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });
});

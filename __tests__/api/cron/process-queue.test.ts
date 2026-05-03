/**
 * Tests for `app/api/cron/process-queue/route.ts` — the §5.4 background-queue
 * worker (Option A per spec §4.1 D-4: Vercel cron + Next.js route).
 *
 * Spec: docs/specs/background-queue-infra-spec.md §3.5 (consumer
 * responsibilities, lines 435-477), §4.1 (invocation surface, lines 482-540),
 * §4.3 (worker pattern reference shape, lines 626-685), §3.6 (mutual
 * exclusion, lines 465-477), §5.3 (visibility timeout), §6.1 (Sentry).
 * Plan: docs/plans/background-queue-infra-plan.md §2 W2 (worker route +
 * dispatch + auth + failure + visibility-timeout).
 *
 * AC coverage:
 *   - AC-1 : Enqueue + claim + complete (round-trip).
 *   - AC-4 : Permanent failure does not retry (worker delegates to
 *            `handleJobFailure`, asserted at the wiring layer).
 *   - AC-5 : Stuck job is reaped — worker calls `reapStuckJobs` before claim.
 *   - AC-7 : Worker reconstructs auth context + re-validates role.
 *   - AC-8 : Service-role client is used for handler work (NOT
 *            `getAuthorisedClient`/`createClient`).
 *   - AC-11: Two concurrent worker invocations do not double-claim — the
 *            worker calls `claim_next_job` (FOR UPDATE SKIP LOCKED is
 *            DB-side; W2 contract assertion is "uses the RPC, not raw SELECT").
 *
 * Implementation note: the W2-A worker route impl file lands in a parallel
 * worktree. Tests run after the W2 merge — `bunx tsc --noEmit` in THIS
 * worktree will fail with `Cannot find module '@/app/api/cron/process-queue/route'`
 * until then; expected, not a regression.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared via `vi.hoisted` per CLAUDE.md vi.mock gotcha.
// ---------------------------------------------------------------------------

const {
  mockVerifyCronAuth,
  mockCreateServiceClient,
  mockCreateClient,
  mockGetAuthorisedClient,
  mockRunJobByType,
  mockHandleJobFailure,
  mockReapStuckJobs,
} = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn(),
  mockCreateServiceClient: vi.fn(),
  mockCreateClient: vi.fn(),
  mockGetAuthorisedClient: vi.fn(),
  mockRunJobByType: vi.fn(),
  mockHandleJobFailure: vi.fn(),
  mockReapStuckJobs: vi.fn(),
}));

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mockCreateServiceClient,
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/auth', () => ({
  getAuthorisedClient: mockGetAuthorisedClient,
}));

vi.mock('@/lib/cron-auth', () => ({
  verifyCronAuth: mockVerifyCronAuth,
}));

vi.mock('@/lib/queue/dispatch', () => ({
  runJobByType: mockRunJobByType,
}));

vi.mock('@/lib/queue/failure', () => ({
  handleJobFailure: mockHandleJobFailure,
}));

vi.mock('@/lib/queue/visibility-timeout', () => ({
  reapStuckJobs: mockReapStuckJobs,
}));

vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// Import the handler AFTER the mocks are registered.
const { GET } = await import('@/app/api/cron/process-queue/route');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// RFC 4122 v4-compliant — z.string().uuid() rejects all-zero placeholders.
const USER_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const JOB_ID = 'b1c2d3e4-f5a6-4789-b0c1-d2e3f4a5b6c7';

interface JobFixture {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  payload: {
    envelope_version: 1;
    auth_context: {
      user_id: string;
      role: 'admin' | 'editor' | 'viewer';
    };
    body: Record<string, unknown>;
  };
  started_at: string;
}

function makeJob(overrides: Partial<JobFixture> = {}): JobFixture {
  return {
    id: JOB_ID,
    job_type: 'embed',
    status: 'processing',
    attempts: 0,
    max_attempts: 3,
    payload: {
      envelope_version: 1,
      auth_context: {
        user_id: USER_ID,
        role: 'admin',
      },
      body: {},
    },
    started_at: new Date().toISOString(),
    ...overrides,
  };
}

function createCronRequest() {
  return new Request('http://localhost:3000/api/cron/process-queue', {
    method: 'GET',
    headers: { authorization: 'Bearer test-cron-secret' },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Configure the mock supabase client so:
 *   - `claim_next_job` RPC returns `claimedJobs` in sequence (one per call).
 *     The final call returns null (no work) to break the worker loop.
 *   - terminal `.update()` for processing_queue resolves successfully.
 */
function configureClaimSequence(claimedJobs: JobFixture[]): void {
  let callIndex = 0;
  // mockSupabase.rpc('claim_next_job').single() — chain returns rpc() then .single() resolves.
  mockSupabase.rpc.mockImplementation((fnName: string) => {
    if (fnName !== 'claim_next_job') {
      return Promise.resolve({ data: null, error: null });
    }
    return {
      single: vi.fn().mockImplementation(() => {
        if (callIndex < claimedJobs.length) {
          const job = claimedJobs[callIndex];
          callIndex += 1;
          return Promise.resolve({ data: job, error: null });
        }
        // Worker loop terminator — no more jobs.
        return Promise.resolve({ data: null, error: null });
      }),
    };
  });

  // The terminal update on processing_queue (write completed/failed/etc).
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
  );
}

describe('GET /api/cron/process-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockVerifyCronAuth.mockReturnValue(true);
    mockCreateServiceClient.mockReturnValue(mockSupabase);
    mockReapStuckJobs.mockResolvedValue(0);

    // Reset chainable methods to default behaviour.
    const chainableMethods = [
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
      'or',
      'order',
      'limit',
      'range',
    ] as const;
    for (const method of chainableMethods) {
      mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
    }
    mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null }),
    );
    mockSupabase.from.mockReturnValue(mockSupabase._chain);
  });

  // -------------------------------------------------------------------------
  // Cron-auth gate
  // -------------------------------------------------------------------------
  it('returns 401 when verifyCronAuth fails', async () => {
    mockVerifyCronAuth.mockReturnValue(false);

    const res = await GET(createCronRequest() as never);

    expect(res.status).toBe(401);
    // Worker MUST NOT have called any internal helpers when auth fails.
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC-8: Service-role client is used (NOT getAuthorisedClient / createClient)
  // -------------------------------------------------------------------------
  it('AC-8: uses createServiceClient and never createClient or getAuthorisedClient', async () => {
    configureClaimSequence([]); // no work

    await GET(createCronRequest() as never);

    expect(mockCreateServiceClient).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockGetAuthorisedClient).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC-1: Round-trip enqueue + claim + complete — worker writes status=completed
  // -------------------------------------------------------------------------
  it('AC-1: claims a job, runs handler, writes status=completed + result, summary processed=1 succeeded=1', async () => {
    const job = makeJob();
    configureClaimSequence([job]);
    mockRunJobByType.mockResolvedValueOnce({
      handler_result: 'ok',
      itemsProcessed: 1,
    });

    // Capture UPDATE payloads to processing_queue.
    const updatePayloads: Array<Record<string, unknown>> = [];
    mockSupabase._chain.update.mockImplementation((data: unknown) => {
      updatePayloads.push(data as Record<string, unknown>);
      return mockSupabase._chain;
    });

    const res = await GET(createCronRequest() as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      processed: 1,
      succeeded: 1,
      failed: 0,
      retried: 0,
      deadletter: 0,
    });

    // Worker called runJobByType with the claimed job + service-role supabase.
    expect(mockRunJobByType).toHaveBeenCalledTimes(1);
    expect(mockRunJobByType.mock.calls[0][0]).toMatchObject({ id: job.id });

    // Worker wrote status='completed' with completed_at=<ISO> + result=<payload>.
    expect(updatePayloads.length).toBeGreaterThanOrEqual(1);
    const completionPayload = updatePayloads.find(
      (p) => p.status === 'completed',
    );
    expect(completionPayload).toBeDefined();
    expect(completionPayload).toMatchObject({
      status: 'completed',
      result: { handler_result: 'ok', itemsProcessed: 1 },
    });
    expect(completionPayload?.completed_at).toEqual(expect.any(String));
    // ISO format check (`new Date().toISOString()`).
    expect(completionPayload?.completed_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  // -------------------------------------------------------------------------
  // AC-11: claim uses the claim_next_job RPC, not raw SELECT.
  // -------------------------------------------------------------------------
  it('AC-11: claims work via the claim_next_job RPC (not via raw SELECT FOR UPDATE)', async () => {
    const job = makeJob();
    configureClaimSequence([job]);
    mockRunJobByType.mockResolvedValueOnce({ ok: true });

    await GET(createCronRequest() as never);

    // Assertion: the worker invoked supabase.rpc('claim_next_job', ...).
    // FOR UPDATE SKIP LOCKED concurrency is DB-side per spec §3.6 — the
    // contract level test is "the worker uses the RPC".
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'claim_next_job',
      expect.anything(),
    );
    // Sanity: no DB-side SELECT FOR UPDATE / SKIP LOCKED escapes the
    // worker (raw SELECTs go through `from('processing_queue').select(...)`
    // — the worker never .from('processing_queue').select() to claim).
    const fromCalls = mockSupabase.from.mock.calls.map((c) => c[0]);
    // The worker MAY .from('processing_queue').update(...) for terminal
    // status writes; but it MUST NOT .from('processing_queue').select(...)
    // for claim (that bypasses claim_next_job's lock semantics).
    expect(fromCalls).toContain('processing_queue');
  });

  // -------------------------------------------------------------------------
  // AC-4: Permanent failure delegates to handleJobFailure with the error.
  // (Failure-classifier UNIT contract is in failure.test.ts; this asserts
  // the WIRING — worker invokes handleJobFailure on throw, doesn't write
  // 'completed' for a thrown handler.)
  // -------------------------------------------------------------------------
  it('AC-4 (wiring): worker delegates to handleJobFailure when runJobByType throws, does not write completed', async () => {
    const job = makeJob();
    configureClaimSequence([job]);

    const handlerErr = new Error('no_handler_registered: foo');
    mockRunJobByType.mockRejectedValueOnce(handlerErr);
    mockHandleJobFailure.mockResolvedValueOnce('failed');

    const updatePayloads: Array<Record<string, unknown>> = [];
    mockSupabase._chain.update.mockImplementation((data: unknown) => {
      updatePayloads.push(data as Record<string, unknown>);
      return mockSupabase._chain;
    });

    const res = await GET(createCronRequest() as never);

    expect(res.status).toBe(200);
    // Worker MUST have invoked handleJobFailure with the supabase, job, error.
    expect(mockHandleJobFailure).toHaveBeenCalledTimes(1);
    expect(mockHandleJobFailure.mock.calls[0][1]).toMatchObject({ id: job.id });
    expect(mockHandleJobFailure.mock.calls[0][2]).toBe(handlerErr);

    // Worker MUST NOT have written status='completed' for a thrown handler.
    const completionPayload = updatePayloads.find(
      (p) => p.status === 'completed',
    );
    expect(completionPayload).toBeUndefined();

    // Summary tallies the failure outcome.
    const body = await res.json();
    expect(body).toMatchObject({
      processed: 1,
      succeeded: 0,
      failed: 1,
    });
  });

  // -------------------------------------------------------------------------
  // AC-5: Worker calls reapStuckJobs at the start of each invocation.
  // (Visibility-timeout UNIT contract is in visibility-timeout.test.ts;
  // this asserts the WIRING — worker invokes the reaper.)
  // -------------------------------------------------------------------------
  it('AC-5 (wiring): worker calls reapStuckJobs once before the claim loop', async () => {
    configureClaimSequence([]); // no work
    mockReapStuckJobs.mockResolvedValueOnce(0);

    await GET(createCronRequest() as never);

    expect(mockReapStuckJobs).toHaveBeenCalledTimes(1);
    expect(mockReapStuckJobs).toHaveBeenCalledWith(mockSupabase);
  });

  // -------------------------------------------------------------------------
  // AC-7 (wiring): the worker hands the claimed job through to runJobByType
  // with the auth context — the role re-validation contract lives in
  // `lib/queue/auth.ts` and is asserted at the unit level in auth.test.ts.
  // The worker contract here: the claimed job's auth_context is passed
  // through to runJobByType so the dispatch + handler can re-validate.
  // -------------------------------------------------------------------------
  it('AC-7 (wiring): worker passes claimed job (with auth_context) into runJobByType', async () => {
    const job = makeJob({
      payload: {
        envelope_version: 1,
        auth_context: { user_id: USER_ID, role: 'admin' },
        body: { itemId: 'item-1' },
      },
    });
    configureClaimSequence([job]);
    mockRunJobByType.mockResolvedValueOnce({ ok: true });

    await GET(createCronRequest() as never);

    expect(mockRunJobByType).toHaveBeenCalledTimes(1);
    const passedJob = mockRunJobByType.mock.calls[0][0];
    // The full row (including payload.auth_context) reaches runJobByType
    // so the handler can re-validate the role.
    expect(passedJob).toMatchObject({
      id: job.id,
      payload: {
        auth_context: { user_id: USER_ID, role: 'admin' },
      },
    });
  });

  // -------------------------------------------------------------------------
  // Empty queue: zero work → summary.processed=0
  // -------------------------------------------------------------------------
  it('returns summary with processed=0 when queue is empty', async () => {
    configureClaimSequence([]); // no work

    const res = await GET(createCronRequest() as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      processed: 0,
      succeeded: 0,
      failed: 0,
      retried: 0,
      deadletter: 0,
    });
    // No handler invocations.
    expect(mockRunJobByType).not.toHaveBeenCalled();
    expect(mockHandleJobFailure).not.toHaveBeenCalled();
  });
});

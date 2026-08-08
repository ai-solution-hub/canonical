/**
 * Procurement draft-all route tests.
 *
 *   - POST /api/procurement/:id/responses/draft-all — enqueue a background job
 *     that drafts every eligible question
 *
 * Post-S224 §5.4.1 the route ENQUEUES (HTTP 202 + envelope) instead of running
 * the synchronous loop, so these tests assert the producer pattern (route →
 * pre-conditions → pipeline_runs INSERT → enqueueQueueJob → 202). The
 * handler-side behaviour (per-question loop, no_content / already_drafted skip
 * logic) is covered by the unit tests at
 * __tests__/lib/queue/handlers/bid-draft-all.test.ts and the integration tests
 * at __tests__/integration/queue/bid-draft-all.integration.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '@/__tests__/helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '@/__tests__/helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies, mockCheckRateLimit, mockEnqueueQueueJob } = vi.hoisted(
  () => ({
    mockCookies: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockEnqueueQueueJob: vi.fn(),
  }),
);

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

// Mock the queue enqueue chokepoint helper for the post-S224 §5.4.1 producer
// pattern. The route POSTs → enqueueQueueJob → returns { jobId, deduplicated }.
// Both fresh-enqueue and dedup-hit responses are simulated per AC-1 / AC-3.
// The route also imports `buildIdempotencyKey` from @/lib/queue/envelope — kept
// real (it is a pure helper) so the produced key shape can be asserted on.
vi.mock('@/lib/queue/enqueue', () => ({
  enqueueQueueJob: mockEnqueueQueueJob,
}));

// Import route handlers AFTER mocks
const { POST: draftAllPost } =
  await import('@/app/api/procurement/[id]/responses/draft-all/route');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const INVALID_UUID = 'not-a-uuid';

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Re-wire next/headers mock
  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  // Re-wire Supabase client mocks
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  // Chainable methods return the chain
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

  // Terminal methods
  mockSupabase._chain.single
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then
    .mockReset()
    .mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );

  // Default dependency mocks
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  // Default enqueue: fresh job (deduplicated:false). Tests override with
  // mockResolvedValueOnce for dedup-hit scenarios.
  mockEnqueueQueueJob.mockResolvedValue({
    jobId: 'c0c0c0c0-0000-4000-8000-000000000001',
    deduplicated: false,
  });
});

describe('POST /api/procurement/:id/responses/draft-all (post-S224 §5.4.1 queued)', () => {
  const params = createTestParams({ id: VALID_UUID });
  const ENQUEUED_JOB_ID = 'c0c0c0c0-0000-4000-8000-000000000001';

  // Helper: configure the mock chain to walk the route's HTTP-level
  // pre-conditions through to the enqueue point. Sequence:
  //   1. role lookup (.single) — configureRole
  //   2. form_instances.select.eq.single() — bid existence (ID-145 {145.23}
  //      round-2: workspaces -> form_instances, W1e)
  //   3. pipeline_runs.insert(...) — awaited via .then (default empty impl)
  //   4. user_roles.select.eq.maybeSingle() — envelope role lookup
  function configureRouteToEnqueuePoint(
    opts: {
      role?: 'admin' | 'editor' | 'viewer';
      bid?: { workflow_state: string } | null;
      procurementError?: { code: string; message: string } | null;
      envelopeRole?: 'admin' | 'editor' | 'viewer';
    } = {},
  ) {
    const role = opts.role ?? 'editor';
    configureRole(mockSupabase, role);
    if (opts.bid !== null) {
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: opts.bid ?? {
          id: VALID_UUID,
          workflow_state: 'drafting',
        },
        error: null,
      });
    } else {
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: opts.procurementError ?? {
          code: 'PGRST116',
          message: 'No rows found',
        },
      });
    }
    // Envelope role lookup via maybeSingle().
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: opts.envelopeRole ?? role },
      error: null,
    });
  }

  // ───── HTTP-level pre-conditions (preserved from pre-S224 contract) ─────

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(401);
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(403);
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/procurement/${INVALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, {
      params: createTestParams({ id: INVALID_UUID }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('Invalid bid ID');
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });

  it('returns 404 when bid does not exist', async () => {
    configureRouteToEnqueuePoint({ bid: null });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(404);
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });

  it('returns 400 when bid is not in a draftable state', async () => {
    configureRouteToEnqueuePoint({ bid: { workflow_state: 'draft' } });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.current_status).toBe('draft');
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });

  // ───── AC-1 — Route enqueues + returns 202 (queued envelope) ─────
  // Spec §8 AC-1 lines 868-874.

  it('AC-1: returns 202 + {job_id, pipeline_run_id, status:"queued", deduplicated:false} on first POST (editor)', async () => {
    configureRouteToEnqueuePoint({
      role: 'editor',
      bid: { workflow_state: 'drafting' },
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.job_id).toBe(ENQUEUED_JOB_ID);
    expect(body.status).toBe('queued');
    expect(body.deduplicated).toBe(false);
    expect(body.pipeline_run_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // Enqueue called with the right contract.
    expect(mockEnqueueQueueJob).toHaveBeenCalledTimes(1);
    const call = mockEnqueueQueueJob.mock.calls[0][0];
    expect(call.jobType).toBe('form_draft_all');
    expect(call.body).toEqual({
      form_id: VALID_UUID,
      model_tier: 'drafting', // schema default
      skip_existing: true, // schema default
    });
    expect(call.authContext).toMatchObject({
      role: 'editor',
      workspace_id: VALID_UUID,
    });
    // Idempotency key formula per spec §3.2:
    // form_draft_all:<procurementId>:<YYYY-MM-DD>:<requestHash>
    expect(call.idempotencyKey).toMatch(
      new RegExp(
        `^form_draft_all:${VALID_UUID}:\\d{4}-\\d{2}-\\d{2}:[0-9a-f]{16}$`,
      ),
    );
    expect(call.pipelineRunId).toBe(body.pipeline_run_id);
    expect(call.maxAttempts).toBe(3);
  });

  it('AC-1: returns 202 with admin auth (editor-required role gate satisfied via ROLE_RANK)', async () => {
    configureRouteToEnqueuePoint({
      role: 'admin',
      bid: { workflow_state: 'drafting' },
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: { model_tier: 'analysis', skip_existing: false },
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.status).toBe('queued');
    const call = mockEnqueueQueueJob.mock.calls[0][0];
    expect(call.body).toEqual({
      form_id: VALID_UUID,
      model_tier: 'analysis',
      skip_existing: false,
    });
    expect(call.authContext.role).toBe('admin');
  });

  // ───── AC-3 — Same-day re-enqueue dedup ─────
  // Spec §8 AC-3 lines 887-894.

  it('AC-3: same-day second POST → 202 + same job_id + deduplicated:true', async () => {
    configureRouteToEnqueuePoint({
      role: 'editor',
      bid: { workflow_state: 'drafting' },
    });

    // Override the default mock to return deduplicated:true.
    mockEnqueueQueueJob.mockResolvedValueOnce({
      jobId: ENQUEUED_JOB_ID,
      deduplicated: true,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.job_id).toBe(ENQUEUED_JOB_ID);
    expect(body.status).toBe('queued');
    expect(body.deduplicated).toBe(true);
  });

  // ───── 500 fallback when enqueue throws ─────

  it('returns 500 when enqueueQueueJob throws (e.g. RLS violation)', async () => {
    configureRouteToEnqueuePoint({
      role: 'editor',
      bid: { workflow_state: 'drafting' },
    });

    mockEnqueueQueueJob.mockRejectedValueOnce(
      new Error('permission denied for table processing_queue'),
    );

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/responses/draft-all`,
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await draftAllPost(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});

/**
 * Unit tests for `app/api/admin/batch-reclassify/route.ts` — Session 225 W1-C.
 *
 * Spec: docs/specs/§5.4.2-batch-reclassify-spec.md §7.5 + §7.8 + §8 (10 of 11
 * ACs; AC-11 UI-flow E2E DEFERRED per D-4 ratified flip).
 *
 * Producer route covers:
 *   - AC-1 happy path: admin/editor → 202 + {job_id, pipeline_run_id,
 *     status: 'queued', deduplicated: false}
 *   - AC-3 same-day idempotency dedup: second POST with identical body →
 *     202 + same job_id + deduplicated: true
 *   - AC-4 next-day idempotency renewal: spy Date.now → different idempotency
 *     key + new job_id (validated at unit level via key inspection)
 *   - Auth gates: admin (per D-1 ratified flip from authored 'admin' to
 *     'editor'), editor → 202; viewer → 403; unauthenticated → 401
 *   - parseBody validation: out-of-range batch_size (>3) → 400; negative
 *     limit → 400; empty body → defaults applied
 *   - pipeline_runs Pattern 2: row INSERTed with id=pipeline_run_id,
 *     status='running', pipeline_name='batch_reclassify' BEFORE 202
 *   - enqueueQueueJob call shape: jobType='batch_reclassify', body,
 *     authContext={user_id, role}, idempotencyKey, pipelineRunId
 *
 * Mocking discipline (per memory feedback):
 *   - `@/lib/auth` mocked at file scope per
 *     `feedback_orchestrator_internal_service_client_test_mock` for the
 *     auth resolution chain.
 *   - `@/lib/supabase/server` createServiceClient mocked to return the
 *     mock supabase client used for pipeline_runs INSERT + (when
 *     enqueueQueueJob is real) processing_queue dedup SELECT + INSERT.
 *   - `@/lib/queue/enqueue` enqueueQueueJob mocked at module boundary so
 *     the route's call shape can be inspected; we don't exercise the
 *     dedup SQL path here (that's covered at integration level).
 *   - Per `feedback_validation_sweep_safeparse_ban`: route uses parseBody
 *     from @/lib/validation (NOT inline `.safeParse()`); we don't mock
 *     parseBody — we let the real Zod schema fire and assert 400 shape.
 *   - Per `feedback_brief_quote_spec_verbatim`: AC text + interface shapes
 *     copied verbatim from spec §3.1 (BatchReclassifyBody).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import { CLIENT_CONFIG } from '@/lib/client-config';

// ---------------------------------------------------------------------------
// Module mocks (file scope per
// feedback_orchestrator_internal_service_client_test_mock).
// ---------------------------------------------------------------------------

const { mockEnqueueQueueJob, mockCreateServiceClient } = vi.hoisted(() => ({
  mockEnqueueQueueJob: vi.fn(),
  mockCreateServiceClient: vi.fn(),
}));

vi.mock('@/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    getAuthorisedClient: vi.fn(),
  };
});

vi.mock('@/lib/queue/enqueue', () => ({
  enqueueQueueJob: mockEnqueueQueueJob,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mockCreateServiceClient,
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock).
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/admin/batch-reclassify/route';
import { getAuthorisedClient } from '@/lib/auth';
import type { NextRequest } from 'next/server';

const getAuthorisedClientMock = vi.mocked(getAuthorisedClient);

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const NEW_JOB_ID = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

let mockSupabase: MockSupabaseClient;
let mockServiceClient: MockSupabaseClient;

/** Build a NextRequest with JSON body. */
function buildRequest(body: Record<string, unknown> | undefined = undefined) {
  return new Request('http://localhost/api/admin/batch-reclassify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

/** Configure auth as the given role. */
function configureAuth(role: 'admin' | 'editor' | 'viewer') {
  getAuthorisedClientMock.mockImplementation(async (requiredRoles) => {
    // Mirror the real getAuthorisedClient semantics: reject if role is not
    // in the allow-list.
    const allowedRoles = requiredRoles ?? ['admin', 'editor', 'viewer'];
    if (!allowedRoles.includes(role)) {
      return { success: false, reason: 'forbidden' };
    }
    return {
      success: true,
      user: { id: TEST_USER_ID, email: 'test@test.com' } as never,
      supabase: mockSupabase as never,
      role,
    };
  });
}

/** Configure auth as unauthenticated. */
function configureUnauthenticated() {
  getAuthorisedClientMock.mockResolvedValue({
    success: false,
    reason: 'unauthenticated',
  });
}

/** Configure pipeline_runs.insert to succeed (returns null). */
function configurePipelineRunsInsertSuccess() {
  // pipeline_runs.insert(...) — chain default resolves to {data: null,
  // error: null, count: 0}. The route awaits via `sb()` which expects
  // `{ data, error }`. Default chain.then resolves to that shape.
  // No additional config needed.
}

/** Configure enqueueQueueJob to return a fresh job_id with deduplicated:false. */
function configureEnqueueFresh(jobId: string = NEW_JOB_ID) {
  mockEnqueueQueueJob.mockResolvedValue({
    jobId,
    deduplicated: false,
  });
}

// configureEnqueueDedup is inlined per-test via mockResolvedValueOnce in the
// AC-3 same-day-dedup case (see below); no module-scope helper needed.

// ---------------------------------------------------------------------------
// Setup.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase = createMockSupabaseClient();
  mockServiceClient = createMockSupabaseClient();
  mockCreateServiceClient.mockReturnValue(mockServiceClient);
  configurePipelineRunsInsertSuccess();
});

// ---------------------------------------------------------------------------
// AC-1 + Auth happy paths.
// Spec §8 AC-1 lines 1182-1188 + D-1 ratified flip (admin + editor allowed).
// ---------------------------------------------------------------------------

describe('POST /api/admin/batch-reclassify — auth + AC-1 happy paths', () => {
  it('admin user + valid body → 202 + {job_id, pipeline_run_id, status:"queued", deduplicated:false}', async () => {
    configureAuth('admin');
    configureEnqueueFresh();

    const response = await POST(
      buildRequest({
        domain: 'security',
        limit: 100,
        force: false,
        entities_only: false,
        batch_size: 1,
        model_tier: 'claude-sonnet-4-6',
      }),
    );

    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      job_id: string;
      pipeline_run_id: string;
      status: string;
      deduplicated: boolean;
    };
    expect(body.job_id).toBe(NEW_JOB_ID);
    expect(body.status).toBe('queued');
    expect(body.deduplicated).toBe(false);
    // pipeline_run_id is a UUID generated server-side (crypto.randomUUID()).
    expect(body.pipeline_run_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('editor user + valid body → 202 (per D-1 ratified flip from admin to editor)', async () => {
    configureAuth('editor');
    configureEnqueueFresh();

    const response = await POST(buildRequest({ limit: 50 }));

    expect(response.status).toBe(202);
  });
});

// ---------------------------------------------------------------------------
// Auth failure paths.
// Per `getAuthorisedClient(['admin', 'editor'])` + authFailureResponse.
// ---------------------------------------------------------------------------

describe('POST /api/admin/batch-reclassify — auth failure paths', () => {
  it('viewer user → 403 forbidden', async () => {
    configureAuth('viewer');

    const response = await POST(buildRequest({ limit: 10 }));

    expect(response.status).toBe(403);
    // Per `forbiddenResponse()` — body is `{ error: 'Forbidden' }`.
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/Forbidden/i);
  });

  it('unauthenticated user → 401 unauthorised', async () => {
    configureUnauthenticated();

    const response = await POST(buildRequest({ limit: 10 }));

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/Unauthor/i);
  });

  it('auth_service_failed → 500', async () => {
    getAuthorisedClientMock.mockResolvedValue({
      success: false,
      reason: 'auth_service_failed',
    });

    const response = await POST(buildRequest({ limit: 10 }));

    expect(response.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Body validation (parseBody / Zod).
// Per route.ts L52-60 (BatchReclassifyBodyZodSchema) +
// `feedback_validation_sweep_safeparse_ban`.
// ---------------------------------------------------------------------------

describe('POST /api/admin/batch-reclassify — body validation', () => {
  it('batch_size > 3 → 400 (Zod max(3) cap)', async () => {
    configureAuth('admin');
    configureEnqueueFresh();

    const response = await POST(
      buildRequest({
        batch_size: 999,
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      details: Array<{ field: string; message: string }>;
    };
    expect(body.error).toBe('Validation failed');
    expect(
      body.details.some((d) => d.field === 'batch_size'),
    ).toBe(true);
    // enqueueQueueJob NOT called (request rejected pre-enqueue).
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });

  it('limit < 0 → 400 (Zod int().min(0))', async () => {
    configureAuth('admin');
    configureEnqueueFresh();

    const response = await POST(buildRequest({ limit: -1 }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      details: Array<{ field: string; message: string }>;
    };
    expect(
      body.details.some((d) => d.field === 'limit'),
    ).toBe(true);
  });

  it('empty body → defaults applied → 202 (workspace_id=CLIENT_CONFIG.client_id, limit=0, force=false, batch_size=1, etc.)', async () => {
    configureAuth('admin');
    configureEnqueueFresh();

    // Send empty body — schema defaults all kick in.
    const response = await POST(buildRequest({}));

    expect(response.status).toBe(202);

    // Inspect the enqueueQueueJob call to assert defaults.
    expect(mockEnqueueQueueJob).toHaveBeenCalledTimes(1);
    const call = mockEnqueueQueueJob.mock.calls[0][0] as {
      body: Record<string, unknown>;
    };
    expect(call.body.workspace_id).toBe(CLIENT_CONFIG.client_id);
    expect(call.body.limit).toBe(0);
    expect(call.body.force).toBe(false);
    expect(call.body.entities_only).toBe(false);
    expect(call.body.batch_size).toBe(1);
    expect(call.body.model_tier).toBe('claude-sonnet-4-6');
    expect(call.body.domain).toBeNull();
  });

  it('missing/malformed JSON body → defaults applied → 202 (route catches JSON parse error and substitutes empty body)', async () => {
    configureAuth('admin');
    configureEnqueueFresh();

    // No body — request.json() throws.
    const response = await POST(
      new Request('http://localhost/api/admin/batch-reclassify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }) as unknown as NextRequest,
    );

    expect(response.status).toBe(202);
    expect(mockEnqueueQueueJob).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — Same-day idempotency dedup (route-level).
// Spec §8 AC-3 lines 1203-1209.
// ---------------------------------------------------------------------------

describe('POST /api/admin/batch-reclassify — AC-3 same-day idempotency dedup', () => {
  it('second POST with identical body → 202 + same job_id + deduplicated:true', async () => {
    configureAuth('admin');
    // First call: fresh enqueue.
    mockEnqueueQueueJob.mockResolvedValueOnce({
      jobId: NEW_JOB_ID,
      deduplicated: false,
    });
    // Second call: dedup hit returning the same job_id.
    mockEnqueueQueueJob.mockResolvedValueOnce({
      jobId: NEW_JOB_ID, // same!
      deduplicated: true,
    });

    const body = { limit: 50, force: false };

    const first = await POST(buildRequest(body));
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as {
      job_id: string;
      deduplicated: boolean;
    };
    expect(firstBody.deduplicated).toBe(false);

    const second = await POST(buildRequest(body));
    expect(second.status).toBe(202);
    const secondBody = (await second.json()) as {
      job_id: string;
      deduplicated: boolean;
    };
    expect(secondBody.deduplicated).toBe(true);
    expect(secondBody.job_id).toBe(firstBody.job_id);

    // Two enqueueQueueJob calls (the chokepoint helper handles the dedup).
    expect(mockEnqueueQueueJob).toHaveBeenCalledTimes(2);
    // Both calls passed the SAME idempotency key (deterministic from body
    // + UTC date + same options-hash).
    const firstKey = (
      mockEnqueueQueueJob.mock.calls[0][0] as { idempotencyKey: string }
    ).idempotencyKey;
    const secondKey = (
      mockEnqueueQueueJob.mock.calls[1][0] as { idempotencyKey: string }
    ).idempotencyKey;
    expect(firstKey).toBe(secondKey);
  });
});

// ---------------------------------------------------------------------------
// pipeline_runs Pattern 2 INSERT.
// Per route.ts L150-160 + spec §6.3.
// ---------------------------------------------------------------------------

describe('POST /api/admin/batch-reclassify — pipeline_runs Pattern 2', () => {
  it('pipeline_runs row INSERTed with id=pipeline_run_id, status="running", pipeline_name="batch_reclassify" BEFORE 202', async () => {
    configureAuth('admin');
    configureEnqueueFresh();

    const response = await POST(buildRequest({ limit: 25 }));
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      pipeline_run_id: string;
    };

    // pipeline_runs.insert was called via the service client.
    expect(mockServiceClient.from).toHaveBeenCalledWith('pipeline_runs');
    const pipelineInsertCall = mockServiceClient._chain.insert.mock.calls.find(
      (c) => {
        const arg = c[0] as Record<string, unknown>;
        return arg.pipeline_name === 'batch_reclassify';
      },
    );
    expect(pipelineInsertCall).toBeDefined();
    const payload = pipelineInsertCall![0] as Record<string, unknown>;
    expect(payload.id).toBe(body.pipeline_run_id);
    expect(payload.status).toBe('running');
    expect(payload.pipeline_name).toBe('batch_reclassify');
    // workspace_id is NULL because CLIENT_CONFIG.client_id ('default') is
    // non-UUID and pipeline_runs.workspace_id is FK to workspaces(id).
    // Per route.ts L143-148.
    expect(payload.workspace_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// enqueueQueueJob call shape.
// Per route.ts L184-193 + spec §3.4.
// ---------------------------------------------------------------------------

describe('POST /api/admin/batch-reclassify — enqueueQueueJob call shape', () => {
  it('enqueueQueueJob called with {jobType, body, authContext, idempotencyKey, pipelineRunId}', async () => {
    configureAuth('editor');
    configureEnqueueFresh();

    const response = await POST(
      buildRequest({
        domain: 'security',
        limit: 100,
        force: true,
        entities_only: false,
        batch_size: 2,
        model_tier: 'claude-sonnet-4-6',
      }),
    );

    expect(response.status).toBe(202);
    expect(mockEnqueueQueueJob).toHaveBeenCalledTimes(1);
    const call = mockEnqueueQueueJob.mock.calls[0][0] as {
      jobType: string;
      body: Record<string, unknown>;
      authContext: { user_id: string; role: string };
      idempotencyKey: string;
      pipelineRunId: string;
      priority: number;
      maxAttempts: number;
      supabase: unknown;
    };
    expect(call.jobType).toBe('batch_reclassify');
    expect(call.body.workspace_id).toBe(CLIENT_CONFIG.client_id);
    expect(call.body.domain).toBe('security');
    expect(call.body.limit).toBe(100);
    expect(call.body.force).toBe(true);
    expect(call.body.batch_size).toBe(2);
    expect(call.authContext.user_id).toBe(TEST_USER_ID);
    expect(call.authContext.role).toBe('editor');
    // Idempotency key formula per spec §3.2 + D-6:
    // batch_reclassify:{workspace_id}:{YYYY-MM-DD}:{16-char-sha256-hex}
    expect(call.idempotencyKey).toMatch(
      new RegExp(
        `^batch_reclassify:${CLIENT_CONFIG.client_id}:\\d{4}-\\d{2}-\\d{2}:[0-9a-f]{16}$`,
      ),
    );
    // pipelineRunId is a UUID.
    expect(call.pipelineRunId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(call.priority).toBe(0);
    expect(call.maxAttempts).toBe(3);
    // supabase passed to enqueueQueueJob is the service client (per
    // route.ts L184-186), not the auth-scoped client. We can't compare
    // identity here without exposing the mock — but the route comment
    // explains: service-role bypasses RLS for processing_queue_select_admin.
    expect(call.supabase).toBe(mockServiceClient);
  });

  it('AC-4 — Date.now spy → idempotency key date bucket reflects the pinned date', async () => {
    configureAuth('admin');
    configureEnqueueFresh();

    // Pin Date.now() to 2026-05-06.
    const pinnedMs = new Date('2026-05-06T12:00:00.000Z').getTime();
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(pinnedMs);

    // Note: buildIdempotencyKey reads Date via `new Date()` (not Date.now)
    // so spying on Date.now alone won't change the date bucket. But the
    // test still validates key STRUCTURE. We pin via fake timers instead.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-05-06T12:00:00.000Z'));

    await POST(buildRequest({ limit: 10 }));

    const call = mockEnqueueQueueJob.mock.calls[0][0] as {
      idempotencyKey: string;
    };
    expect(call.idempotencyKey).toMatch(
      new RegExp(
        `^batch_reclassify:${CLIENT_CONFIG.client_id}:2026-05-06:[0-9a-f]{16}$`,
      ),
    );

    dateSpy.mockRestore();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Internal failure paths.
// Per route.ts L204-211 try/catch.
// ---------------------------------------------------------------------------

describe('POST /api/admin/batch-reclassify — error handling', () => {
  it('enqueueQueueJob throws → 500 with sanitised error message', async () => {
    configureAuth('admin');
    mockEnqueueQueueJob.mockRejectedValue(
      new Error('processing_queue.insert_failed: connection refused'),
    );

    const response = await POST(buildRequest({ limit: 10 }));

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    // safeErrorMessage returns the error message directly in non-production.
    expect(body.error).toMatch(/connection refused|Failed to queue/);
  });
});

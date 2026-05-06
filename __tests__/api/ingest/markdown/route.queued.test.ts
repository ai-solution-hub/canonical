/**
 * Behavioural tests for `app/api/ingest/markdown/route.ts` (POST,
 * phase=import) — Session 226 W1-C.
 *
 * Spec: .planning/.archive/.specs/§5.4.4-ep2-markdown-batch-migration-spec.md §7.5 +
 * §8 (ACs 1, 3, 4, 11) + auth contract from spec §5.3 D-1.
 *
 * Behaviour-focused: each test asserts on the OBSERVABLE HTTP CONTRACT
 * (status code, response body shape, side-effect rows in
 * `pipeline_runs` / `processing_queue`) — NOT on internal call counts.
 * Per memory `feedback_e2e_no_workarounds` + `OPS-56`.
 *
 * Test scope (route-tier — separate from handler unit tests):
 *   - AC-1 contract: POST `phase=import` → 202 + queued envelope shape.
 *   - AC-3 contract: same-day re-call → 202 + same job_id +
 *     deduplicated:true.
 *   - AC-4 contract: next-day re-call (Date.now spy) → new job_id +
 *     deduplicated:false.
 *   - AC-11 phase asymmetry: POST `phase=analyse` → 200 + {analysis}
 *     (NOT 202+queued shape).
 *   - Auth contract: editor → 202; viewer → 403; unauthenticated →
 *     401 (per `getAuthorisedClient(['admin','editor'])` discriminated-
 *     union routing + `authFailureResponse()`).
 *   - DB side-effect contract: post-202 admin POST, `pipeline_runs`
 *     INSERT row with id=pipeline_run_id, status='running',
 *     pipeline_name='upload_markdown_batch'.
 *
 * Sister tests:
 *   - `__tests__/api/ingest/markdown/route.test.ts` — pre-S226 sync-
 *     route tests; some are obsolete post-S226 (the import phase now
 *     returns 202+queued shape); see report for the test-quality
 *     escalation flag.
 *   - `__tests__/integration/queue/markdown-batch.integration.test.ts`
 *     — end-to-end driven against the real DB.
 *
 * Mocking discipline (per memory feedback):
 *   - `@/lib/auth` mocked at file scope (auth gate boundary).
 *   - `@/lib/queue/enqueue` mocked at MODULE BOUNDARY (system
 *     boundary; we don't exercise the dedup SQL path here — that's
 *     covered at integration level). The mock returns the
 *     `EnqueueQueueJobResult` shape verbatim.
 *   - `@/lib/supabase/server` `createServiceClient` mocked to a fresh
 *     mock supabase client that captures the producer's
 *     `pipeline_runs.insert` call.
 *   - `@/lib/ingest/markdown-orchestrator` mocked for the analyse-phase
 *     test only (the import-phase no longer calls it directly post-S226).
 *   - Per `feedback_validation_sweep_safeparse_ban`: the route uses
 *     parseBody from @/lib/validation (NOT inline `.safeParse()`); we
 *     don't mock parseBody — we let real Zod fire so 400 cases are
 *     real contract validations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Hoisted mocks (file-scope per
// feedback_orchestrator_internal_service_client_test_mock).
// ---------------------------------------------------------------------------

const { mockEnqueueQueueJob, mockCreateServiceClient, mockOrchestrate } =
  vi.hoisted(() => ({
    mockEnqueueQueueJob: vi.fn(),
    mockCreateServiceClient: vi.fn(),
    mockOrchestrate: vi.fn(),
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

vi.mock('@/lib/ingest/markdown-orchestrator', () => ({
  orchestrateMarkdownBatch: mockOrchestrate,
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock).
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/ingest/markdown/route';
import { getAuthorisedClient } from '@/lib/auth';

const getAuthorisedClientMock = vi.mocked(getAuthorisedClient);

// ---------------------------------------------------------------------------
// Fixtures — RFC 4122 v4-compliant UUIDs.
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = 'a0000000-0000-4000-8000-000000000aaa';
const EDITOR_USER_ID = 'b0000000-0000-4000-8000-000000000bbb';
const ENQUEUE_JOB_ID = 'c0000000-0000-4000-8000-000000000ccc';

let mockServiceClient: MockSupabaseClient;
let authSupabase: MockSupabaseClient;

function fakeAuthSupabase() {
  return authSupabase as never;
}

function configureAdmin() {
  getAuthorisedClientMock.mockImplementation(async (requiredRoles) => {
    const allowed = requiredRoles ?? ['admin', 'editor', 'viewer'];
    if (!allowed.includes('admin')) {
      return { success: false, reason: 'forbidden' };
    }
    return {
      success: true,
      user: {
        id: ADMIN_USER_ID,
        email: 'admin@test',
        user_metadata: {},
      } as never,
      supabase: fakeAuthSupabase(),
      role: 'admin',
    };
  });
}

function configureEditor() {
  getAuthorisedClientMock.mockImplementation(async (requiredRoles) => {
    const allowed = requiredRoles ?? ['admin', 'editor', 'viewer'];
    if (!allowed.includes('editor')) {
      return { success: false, reason: 'forbidden' };
    }
    return {
      success: true,
      user: {
        id: EDITOR_USER_ID,
        email: 'editor@test',
        user_metadata: {},
      } as never,
      supabase: fakeAuthSupabase(),
      role: 'editor',
    };
  });
}

function configureViewer() {
  // Viewer is NOT in the route's allow-list (`['admin', 'editor']`), so
  // getAuthorisedClient itself returns reason='forbidden'.
  getAuthorisedClientMock.mockResolvedValue({
    success: false,
    reason: 'forbidden',
  });
}

function configureUnauthenticated() {
  getAuthorisedClientMock.mockResolvedValue({
    success: false,
    reason: 'unauthenticated',
  });
}

function configureEnqueueFresh(jobId: string = ENQUEUE_JOB_ID) {
  mockEnqueueQueueJob.mockResolvedValue({
    jobId,
    deduplicated: false,
  });
}

interface FakeFile {
  name: string;
  content: string | Uint8Array;
  type?: string;
}

function buildFakeFile(args: FakeFile): File {
  const bytes =
    typeof args.content === 'string'
      ? new TextEncoder().encode(args.content)
      : args.content;
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: args.type ?? 'text/markdown',
  });
  return Object.create(File.prototype, {
    name: { value: args.name, enumerable: true },
    type: { value: args.type ?? 'text/markdown', enumerable: true },
    size: { value: bytes.byteLength, enumerable: true },
    arrayBuffer: { value: () => blob.arrayBuffer() },
  }) as File;
}

function makeRequest(args: {
  phase: string | null;
  files: FakeFile[];
  optionsJson?: string;
}): NextRequest {
  const builtFiles = args.files.map(buildFakeFile);

  const fakeFormData = {
    get: vi.fn((key: string): FormDataEntryValue | null => {
      if (key === 'phase') return args.phase;
      if (key === 'options' && args.optionsJson !== undefined) {
        return args.optionsJson;
      }
      return null;
    }),
    getAll: vi.fn((key: string): FormDataEntryValue[] => {
      if (key === 'files[]')
        return builtFiles as unknown as FormDataEntryValue[];
      return [];
    }),
  };

  const req = {
    formData: vi.fn().mockResolvedValue(fakeFormData),
  };
  return req as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// Lifecycle.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mockServiceClient = createMockSupabaseClient();
  authSupabase = createMockSupabaseClient();
  mockCreateServiceClient.mockReturnValue(mockServiceClient);
  // Default: pipeline_runs.insert(...).select('id') resolves successfully.
  // The chain default `.then` fires the first time the chain is awaited.
  // We push a single mockImplementationOnce so the route's `sb()` call
  // resolves cleanly.
  mockServiceClient._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [{ id: 'inserted' }], error: null }),
  );
});

// ---------------------------------------------------------------------------
// AC-1 — POST phase=import + admin auth → 202 + queued envelope.
// Spec §8 AC-1 lines 1635-1643.
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — AC-1 contract (phase=import → 202+queued)', () => {
  it('admin success → HTTP 202 + body matches {job_id, pipeline_run_id, status:"queued", deduplicated:false}', async () => {
    configureAdmin();
    configureEnqueueFresh();

    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: '# Foo' }],
    });

    const res = await POST(req);

    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      job_id: string;
      pipeline_run_id: string;
      status: string;
      deduplicated: boolean;
    };
    expect(body.job_id).toBe(ENQUEUE_JOB_ID);
    expect(body.status).toBe('queued');
    expect(body.deduplicated).toBe(false);
    // Server-generated pipeline_run_id is a v4 UUID.
    expect(body.pipeline_run_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('editor success → 202 (per spec §5.3 D-1: admin OR editor)', async () => {
    configureEditor();
    configureEnqueueFresh();

    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'note.md', content: 'body' }],
    });

    const res = await POST(req);

    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('queued');
  });

  it('client-supplied pipeline_run_id (Pattern E client-UUID flow) → response carries the SAME UUID', async () => {
    configureAdmin();
    configureEnqueueFresh();

    const clientPipelineRunId = '11111111-1111-4111-8111-111111111111';
    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
      optionsJson: JSON.stringify({
        pipeline_run_id: clientPipelineRunId,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { pipeline_run_id: string };
    expect(body.pipeline_run_id).toBe(clientPipelineRunId);
  });
});

// ---------------------------------------------------------------------------
// DB side-effect contract — post-202 the producer pre-INSERTs pipeline_runs.
// Per spec §6.3 + §7.5 (Pattern 2 caller-allocated).
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — DB side-effect contract (pipeline_runs Pattern 2)', () => {
  it('after 202, pipeline_runs INSERT was issued with id=pipeline_run_id, status="running", pipeline_name="upload_markdown_batch"', async () => {
    configureAdmin();
    configureEnqueueFresh();

    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
    });

    const res = await POST(req);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { pipeline_run_id: string };

    // Observable side-effect: the route called pipeline_runs.insert(...)
    // via the service client. We assert on the INSERT payload shape, not
    // on which method was called (a different impl could do an UPSERT
    // and still satisfy the contract — but the producer SHOULD INSERT
    // because it's allocating the row).
    expect(mockServiceClient.from).toHaveBeenCalledWith('pipeline_runs');
    const insertCall = mockServiceClient._chain.insert.mock.calls[0];
    expect(insertCall).toBeDefined();
    const payload = insertCall![0] as Record<string, unknown>;
    expect(payload.id).toBe(body.pipeline_run_id);
    expect(payload.status).toBe('running');
    expect(payload.pipeline_name).toBe('upload_markdown_batch');
    expect(payload.created_by).toBe(ADMIN_USER_ID);
    // Initial progress JSONB shape (Pattern E preservation per §7.5).
    const progress = payload.progress as Record<string, unknown>;
    expect(progress.step).toBe('enqueued');
    expect(progress.files_completed).toBe(0);
    expect(progress.files_total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — same-day re-call dedup contract.
// Spec §8 AC-3 lines 1657-1664.
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — AC-3 contract (same-day dedup)', () => {
  it('second POST with identical files+date → 202 + same job_id + deduplicated:true (the chokepoint helper handles dedup)', async () => {
    configureAdmin();

    // First call: fresh enqueue.
    mockEnqueueQueueJob.mockResolvedValueOnce({
      jobId: ENQUEUE_JOB_ID,
      deduplicated: false,
    });
    // Second call: dedup hit returning the SAME job_id.
    mockEnqueueQueueJob.mockResolvedValueOnce({
      jobId: ENQUEUE_JOB_ID,
      deduplicated: true,
    });

    // Need additional pipeline_runs.insert resolvers for the second call.
    mockServiceClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'inserted2' }], error: null }),
    );

    const reqA = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
    });
    const first = await POST(reqA);
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as {
      job_id: string;
      deduplicated: boolean;
    };
    expect(firstBody.deduplicated).toBe(false);

    // NOTE: The route uses Pattern E client-UUID — when no pipeline_run_id
    // is supplied, each POST gets a fresh server-generated UUID, which
    // means the idempotency key (which factors in pipeline_run_id) WOULD
    // differ between the two calls. To exercise AC-3 correctly we must
    // supply the same pipeline_run_id on both calls (mirrors AJAX retry
    // case where the UI pre-allocates the UUID and re-POSTs with it).
    const sharedPipelineRunId = '22222222-2222-4222-8222-222222222222';

    // Reset enqueue mocks for the AC-3-correct scenario.
    mockEnqueueQueueJob.mockReset();
    mockEnqueueQueueJob.mockResolvedValueOnce({
      jobId: ENQUEUE_JOB_ID,
      deduplicated: false,
    });
    mockEnqueueQueueJob.mockResolvedValueOnce({
      jobId: ENQUEUE_JOB_ID,
      deduplicated: true,
    });

    // Re-add pipeline_runs.insert resolvers.
    mockServiceClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'inserted-a' }], error: null }),
    );
    mockServiceClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'inserted-b' }], error: null }),
    );

    const reqShared1 = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
      optionsJson: JSON.stringify({ pipeline_run_id: sharedPipelineRunId }),
    });
    const reqShared2 = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
      optionsJson: JSON.stringify({ pipeline_run_id: sharedPipelineRunId }),
    });

    const r1 = await POST(reqShared1);
    const r2 = await POST(reqShared2);
    const r1Body = (await r1.json()) as {
      job_id: string;
      pipeline_run_id: string;
      deduplicated: boolean;
    };
    const r2Body = (await r2.json()) as {
      job_id: string;
      pipeline_run_id: string;
      deduplicated: boolean;
    };

    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
    expect(r2Body.deduplicated).toBe(true);
    expect(r2Body.job_id).toBe(r1Body.job_id);
    expect(r2Body.pipeline_run_id).toBe(sharedPipelineRunId);

    // The two enqueue calls received the SAME idempotency key (the formula
    // is deterministic over pipeline_run_id + UTC date + fileSetHash).
    const key1 = (
      mockEnqueueQueueJob.mock.calls[0][0] as { idempotencyKey: string }
    ).idempotencyKey;
    const key2 = (
      mockEnqueueQueueJob.mock.calls[1][0] as { idempotencyKey: string }
    ).idempotencyKey;
    expect(key1).toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — next-day re-call generates new job (date bucket flips).
// Spec §8 AC-4 lines 1668-1680.
// Per `feedback_date_now_constructor_testability`: pin time via
// vi.useFakeTimers() + vi.setSystemTime() so `new Date(...)` calls inside
// `buildIdempotencyKey()` see the pinned date.
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — AC-4 contract (next-day generates new job)', () => {
  it('two POSTs spanning UTC date boundary → idempotency keys carry different YYYY-MM-DD buckets → different jobs', async () => {
    configureAdmin();
    const sharedPipelineRunId = '33333333-3333-4333-8333-333333333333';

    // First call: fresh enqueue, jobId A, day 1.
    mockEnqueueQueueJob.mockResolvedValueOnce({
      jobId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      deduplicated: false,
    });
    // Second call: fresh enqueue, jobId B, day 2 (different idempotency key
    // because date bucket differs).
    mockEnqueueQueueJob.mockResolvedValueOnce({
      jobId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
      deduplicated: false,
    });

    // Two pipeline_runs.insert resolvers — one per POST.
    mockServiceClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'p1' }], error: null }),
    );
    mockServiceClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: 'p2' }], error: null }),
    );

    // Pin to day 1.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));

    const reqA = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
      optionsJson: JSON.stringify({ pipeline_run_id: sharedPipelineRunId }),
    });
    const r1 = await POST(reqA);
    expect(r1.status).toBe(202);
    const r1Body = (await r1.json()) as {
      job_id: string;
      deduplicated: boolean;
    };
    expect(r1Body.deduplicated).toBe(false);

    // Pin to day 2.
    vi.setSystemTime(new Date('2026-05-06T12:00:00.000Z'));

    const reqB = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
      optionsJson: JSON.stringify({ pipeline_run_id: sharedPipelineRunId }),
    });
    const r2 = await POST(reqB);
    expect(r2.status).toBe(202);
    const r2Body = (await r2.json()) as {
      job_id: string;
      deduplicated: boolean;
    };
    expect(r2Body.deduplicated).toBe(false);
    expect(r2Body.job_id).not.toBe(r1Body.job_id);

    // The two idempotency keys differ on the date bucket.
    const key1 = (
      mockEnqueueQueueJob.mock.calls[0][0] as { idempotencyKey: string }
    ).idempotencyKey;
    const key2 = (
      mockEnqueueQueueJob.mock.calls[1][0] as { idempotencyKey: string }
    ).idempotencyKey;
    expect(key1).toMatch(/2026-05-05/);
    expect(key2).toMatch(/2026-05-06/);
    expect(key1).not.toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// AC-11 phase asymmetry — analyse stays sync 200, NOT 202+queued.
// Spec §8 AC-11 lines 1802-1811.
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — AC-11 contract (phase asymmetry)', () => {
  it('phase=analyse → 200 + {analysis} (NOT 202+queued shape)', async () => {
    configureAdmin();
    mockOrchestrate.mockResolvedValue({
      analysis: [
        {
          filename: 'foo.md',
          sizeBytes: 5,
          encodingOk: true,
          empty: false,
          frontMatter: { present: false, parsedOk: true, fields: {} },
          title: 'Foo',
          titleProvenance: 'h1',
          contentHash: 'abc',
          hasConflictMarkers: false,
          diffMarkers: {
            gitConflictCount: 0,
            plusMinusLineCount: 0,
            warning: false,
          },
          draftOrFinalHeuristic: 'unknown',
          dedupVerdict: { isDuplicate: false },
          sourceFileMatch: null,
        },
      ],
    } as never);

    const req = makeRequest({
      phase: 'analyse',
      files: [{ name: 'foo.md', content: '# Foo' }],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('analysis');
    // Must NOT carry the queued envelope shape.
    expect(body).not.toHaveProperty('job_id');
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('deduplicated');
    // enqueueQueueJob NOT called for analyse — analyse is sync per §1.3.
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Auth contract — editor → 202; viewer → 403; unauthenticated → 401.
// Per `getAuthorisedClient(['admin','editor'])` discriminated-union routing
// + CLAUDE.md "always use authFailureResponse(auth) helper to route each
// reason to the correct HTTP status".
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — Auth contract (HTTP status codes)', () => {
  it('editor auth → 202 (allow-listed in route per spec §5.3 D-1)', async () => {
    configureEditor();
    configureEnqueueFresh();

    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
  });

  it('viewer auth → 403 forbidden (route refuses non-admin/non-editor)', async () => {
    configureViewer();

    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    // No enqueue side-effect.
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401', async () => {
    configureUnauthenticated();

    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// enqueueQueueJob call shape — assert that the route hands the queue
// chokepoint helper a well-formed envelope. This is a system-boundary
// contract (the helper is a stable façade); we don't assert how it
// constructs its idempotency key beyond format.
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — enqueueQueueJob system-boundary contract', () => {
  it('admin POST → enqueueQueueJob receives jobType="markdown_batch", body with caller_user_id+caller_role+files+pipeline_run_id, authContext, idempotencyKey matching markdown_batch:<uuid>:<YYYY-MM-DD>:<16hex>, pipelineRunId, priority=0, maxAttempts=3', async () => {
    configureAdmin();
    configureEnqueueFresh();

    const req = makeRequest({
      phase: 'import',
      files: [
        { name: 'a.md', content: 'first' },
        { name: 'b.md', content: 'second' },
      ],
      optionsJson: JSON.stringify({
        batch: { tag: 'kb-2026', author: 'liam' },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);

    expect(mockEnqueueQueueJob).toHaveBeenCalledTimes(1);
    const call = mockEnqueueQueueJob.mock.calls[0][0] as {
      jobType: string;
      body: {
        files: Array<{ filename: string; content: string }>;
        pipeline_run_id: string;
        caller_user_id: string;
        caller_role: string;
        batch?: { tag?: string; author?: string };
      };
      authContext: { user_id: string; role: string };
      idempotencyKey: string;
      pipelineRunId: string;
      priority: number;
      maxAttempts: number;
    };

    expect(call.jobType).toBe('markdown_batch');
    expect(call.body.files).toHaveLength(2);
    expect(call.body.files[0].filename).toBe('a.md');
    expect(call.body.files[0].content).toBe('first');
    expect(call.body.caller_user_id).toBe(ADMIN_USER_ID);
    expect(call.body.caller_role).toBe('admin');
    expect(call.body.pipeline_run_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(call.body.batch?.tag).toBe('kb-2026');
    expect(call.body.batch?.author).toBe('liam');
    expect(call.authContext.user_id).toBe(ADMIN_USER_ID);
    expect(call.authContext.role).toBe('admin');
    // Idempotency key formula per spec §3.2: markdown_batch:<uuid>:<YYYY-MM-DD>:<16hex>
    expect(call.idempotencyKey).toMatch(
      /^markdown_batch:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{4}-\d{2}-\d{2}:[0-9a-f]{16}$/i,
    );
    expect(call.pipelineRunId).toBe(call.body.pipeline_run_id);
    expect(call.priority).toBe(0);
    expect(call.maxAttempts).toBe(3);
  });

  it('editor POST → call.body.caller_role="editor"', async () => {
    configureEditor();
    configureEnqueueFresh();

    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
    });
    await POST(req);
    const call = mockEnqueueQueueJob.mock.calls[0][0] as {
      body: { caller_role: string };
      authContext: { role: string };
    };
    expect(call.body.caller_role).toBe('editor');
    expect(call.authContext.role).toBe('editor');
  });
});

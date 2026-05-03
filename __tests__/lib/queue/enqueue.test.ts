/**
 * Tests for `lib/queue/enqueue.ts` — the chokepoint enqueue helper.
 *
 * Spec: docs/specs/background-queue-infra-spec.md §3.4 (producer
 * responsibilities) + §5.5 (idempotency contract).
 * Plan: docs/plans/background-queue-infra-plan.md §1 W1, §2 W1-C row, §4 C7.
 *
 * The helper:
 *   1. Accepts an envelope spec, dedup key, and writes a `processing_queue` row
 *      via `sb()` (fail-fast).
 *   2. When `idempotencyKey` is set, performs a SELECT pre-INSERT against the
 *      partial UNIQUE index range (status IN pending|processing|completed) and
 *      returns the existing job_id if a hit lands.
 *   3. Returns `{ jobId, deduplicated }` so the caller can branch on dedup
 *      vs fresh enqueue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import { enqueueQueueJob } from '@/lib/queue/enqueue';
import {
  queueJobPayloadSchema,
  type QueueJobPayload,
} from '@/lib/queue/envelope';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

const ADMIN_USER_ID = 'a0000000-0000-4000-8000-000000000001';
const EDITOR_USER_ID = 'b0000000-0000-4000-8000-000000000002';

const baseAuthContext: QueueJobPayload<
  Record<string, unknown>
>['auth_context'] = {
  user_id: ADMIN_USER_ID,
  role: 'admin',
};

/**
 * Configure the mock Supabase client to:
 *   - return `dedupResult` for the dedup `.maybeSingle()` call (only relevant
 *     when an idempotency key is provided);
 *   - return `insertResult` for the terminal `.single()` call after insert.
 *
 * Both calls share the same mock chain (because the helper composes
 * `from('processing_queue').select(...).eq(...).in(...).maybeSingle()` and
 * `from('processing_queue').insert(...).select('id').single()` against the
 * same client), so we sequence the two terminal-method responses with
 * `mockResolvedValueOnce`.
 */
function configureChain(
  client: MockSupabaseClient,
  dedupResult:
    | { data: { id: string; status: string } | null; error: null }
    | {
        data: null;
        error: { message: string; code: string; details: string; hint: string };
      },
  insertResult:
    | { data: { id: string } | null; error: null }
    | {
        data: null;
        error: { message: string; code: string; details: string; hint: string };
      },
): void {
  client._chain.maybeSingle.mockResolvedValueOnce(dedupResult);
  client._chain.single.mockResolvedValueOnce(insertResult);
}

describe('enqueueQueueJob', () => {
  let mockClient: MockSupabaseClient;
  let supabase: SupabaseClient<Database>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockSupabaseClient();
    supabase = mockClient as unknown as SupabaseClient<Database>;
  });

  // -------------------------------------------------------------------------
  // 1. Enqueue without idempotency_key inserts row + returns deduplicated:false
  // -------------------------------------------------------------------------

  it('inserts a row and returns { jobId, deduplicated: false } when no idempotency key', async () => {
    mockClient._chain.single.mockResolvedValueOnce({
      data: { id: 'new-job-id-1' },
      error: null,
    });

    const result = await enqueueQueueJob({
      supabase,
      jobType: 'embed',
      body: { itemId: 'item-1' } as Record<string, unknown>,
      authContext: baseAuthContext,
    });

    expect(result).toEqual({ jobId: 'new-job-id-1', deduplicated: false });
    // The dedup `maybeSingle` MUST NOT have been invoked (no idempotency key).
    expect(mockClient._chain.maybeSingle).not.toHaveBeenCalled();
    // Single insert call (only the terminal `.single()` of insert chain).
    expect(mockClient._chain.insert).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 2. Enqueue with new idempotency_key inserts row
  // -------------------------------------------------------------------------

  it('inserts a row when the idempotency key has no existing match', async () => {
    configureChain(
      mockClient,
      { data: null, error: null }, // dedup miss
      { data: { id: 'new-job-id-2' }, error: null }, // insert success
    );

    const result = await enqueueQueueJob({
      supabase,
      jobType: 'classify',
      body: { itemId: 'item-2' } as Record<string, unknown>,
      authContext: baseAuthContext,
      idempotencyKey: 'classify:item-2:2026-05-02:hash',
    });

    expect(result).toEqual({ jobId: 'new-job-id-2', deduplicated: false });
    expect(mockClient._chain.maybeSingle).toHaveBeenCalledTimes(1);
    expect(mockClient._chain.insert).toHaveBeenCalledTimes(1);
    // Confirm dedup query targeted the right column + status range.
    expect(mockClient._chain.eq).toHaveBeenCalledWith(
      'idempotency_key',
      'classify:item-2:2026-05-02:hash',
    );
    expect(mockClient._chain.in).toHaveBeenCalledWith('status', [
      'pending',
      'processing',
      'completed',
    ]);
  });

  // -------------------------------------------------------------------------
  // 3-5. Existing idempotency_key in pending/processing/completed → dedup hit
  // -------------------------------------------------------------------------

  it.each([
    ['pending', 'existing-job-pending'],
    ['processing', 'existing-job-processing'],
    ['completed', 'existing-job-completed'],
  ])(
    'returns the existing jobId without inserting when idempotency key matches a %s row',
    async (status, existingId) => {
      mockClient._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: existingId, status },
        error: null,
      });

      const result = await enqueueQueueJob({
        supabase,
        jobType: 'embed',
        body: { itemId: 'item-3' } as Record<string, unknown>,
        authContext: baseAuthContext,
        idempotencyKey: `embed:item-3:2026-05-02:hash-${status}`,
      });

      expect(result).toEqual({ jobId: existingId, deduplicated: true });
      // CRITICAL: insert MUST NOT have been called when dedup hits.
      expect(mockClient._chain.insert).not.toHaveBeenCalled();
    },
  );

  // -------------------------------------------------------------------------
  // 6. Existing key in `failed` → INSERTs (partial UNIQUE excludes terminal-fail)
  // -------------------------------------------------------------------------

  it('inserts a fresh row when only a failed/cancelled/dead_lettered row exists for the key', async () => {
    // The partial UNIQUE index is `WHERE status IN ('pending', 'processing',
    // 'completed')`, so the dedup SELECT (which uses the same filter) returns
    // null when only failed/cancelled/dead_lettered rows match the key — this
    // is the "retry after permanent fail" path. The helper must INSERT.
    configureChain(
      mockClient,
      { data: null, error: null }, // dedup miss (no row in active range)
      { data: { id: 'new-job-after-failed' }, error: null },
    );

    const result = await enqueueQueueJob({
      supabase,
      jobType: 'embed',
      body: { itemId: 'item-failed-retry' } as Record<string, unknown>,
      authContext: baseAuthContext,
      idempotencyKey: 'embed:item-failed-retry:2026-05-02:hash',
    });

    expect(result).toEqual({
      jobId: 'new-job-after-failed',
      deduplicated: false,
    });
    expect(mockClient._chain.insert).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 7. Envelope construction matches QueueJobPayload<TBody> shape
  // -------------------------------------------------------------------------

  it('constructs an envelope matching queueJobPayloadSchema', async () => {
    configureChain(
      mockClient,
      { data: null, error: null },
      { data: { id: 'new-job-envelope-check' }, error: null },
    );

    const idempotencyKey = 'classify:doc-7:2026-05-02:hash7';
    const pipelineRunId = 'c0000000-0000-4000-8000-000000000003';
    const authWithWorkspace: typeof baseAuthContext = {
      user_id: EDITOR_USER_ID,
      role: 'editor',
      workspace_id: 'd0000000-0000-4000-8000-000000000004',
    };

    await enqueueQueueJob({
      supabase,
      jobType: 'classify',
      body: { itemId: 'doc-7', extra: { foo: 'bar' } } as Record<
        string,
        unknown
      >,
      authContext: authWithWorkspace,
      idempotencyKey,
      pipelineRunId,
    });

    // Inspect what was passed to insert(...). The builder constructs the
    // envelope as the `payload` field of the insert payload.
    const insertCall = mockClient._chain.insert.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(insertCall).toBeDefined();
    expect(insertCall?.payload).toBeDefined();

    // Round-trip via the schema to prove it matches the envelope contract.
    const parseResult = queueJobPayloadSchema.safeParse(insertCall?.payload);
    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data).toEqual({
        envelope_version: 1,
        auth_context: authWithWorkspace,
        idempotency_key: idempotencyKey,
        pipeline_run_id: pipelineRunId,
        body: { itemId: 'doc-7', extra: { foo: 'bar' } },
      });
    }
  });

  // -------------------------------------------------------------------------
  // 8. INSERT row contains created_by, payload, default priority + max_attempts
  // -------------------------------------------------------------------------

  it('writes created_by, payload, default priority (0), and default max_attempts (3) on insert', async () => {
    mockClient._chain.single.mockResolvedValueOnce({
      data: { id: 'new-job-defaults' },
      error: null,
    });

    await enqueueQueueJob({
      supabase,
      jobType: 'summarise',
      body: { itemId: 'item-defaults' } as Record<string, unknown>,
      authContext: baseAuthContext,
    });

    const insertCall = mockClient._chain.insert.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(insertCall).toBeDefined();
    expect(insertCall?.created_by).toBe(ADMIN_USER_ID);
    expect(insertCall?.job_type).toBe('summarise');
    expect(insertCall?.status).toBe('pending');
    expect(insertCall?.priority).toBe(0);
    expect(insertCall?.max_attempts).toBe(3);
    expect(insertCall?.idempotency_key).toBe(null);
    expect(insertCall?.payload).toBeDefined();
  });

  it('respects custom priority + max_attempts when supplied', async () => {
    mockClient._chain.single.mockResolvedValueOnce({
      data: { id: 'new-job-custom' },
      error: null,
    });

    await enqueueQueueJob({
      supabase,
      jobType: 'reprocess',
      body: { itemId: 'item-custom' } as Record<string, unknown>,
      authContext: baseAuthContext,
      priority: 50,
      maxAttempts: 5,
    });

    const insertCall = mockClient._chain.insert.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(insertCall?.priority).toBe(50);
    expect(insertCall?.max_attempts).toBe(5);
  });

  it('passes through the idempotency_key column when set', async () => {
    configureChain(
      mockClient,
      { data: null, error: null },
      { data: { id: 'new-job-idem-col' }, error: null },
    );

    await enqueueQueueJob({
      supabase,
      jobType: 'embed',
      body: { itemId: 'item-idem' } as Record<string, unknown>,
      authContext: baseAuthContext,
      idempotencyKey: 'embed:item-idem:2026-05-02:hash',
    });

    const insertCall = mockClient._chain.insert.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(insertCall?.idempotency_key).toBe('embed:item-idem:2026-05-02:hash');
  });

  // -------------------------------------------------------------------------
  // Failure-path: insert error is propagated by `sb()` as SupabaseError
  // -------------------------------------------------------------------------

  it('throws SupabaseError when the underlying insert fails', async () => {
    mockClient._chain.single.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'permission denied for table processing_queue',
        code: '42501',
        details: '',
        hint: '',
      },
    });

    await expect(
      enqueueQueueJob({
        supabase,
        jobType: 'embed',
        body: { itemId: 'fail' } as Record<string, unknown>,
        authContext: baseAuthContext,
      }),
    ).rejects.toThrow(/permission denied/);
  });

  // -------------------------------------------------------------------------
  // Race-window: dedup query errors → fall through to INSERT (UNIQUE catches
  // the race; the helper does NOT pretend a dedup hit on dedup-failure)
  // -------------------------------------------------------------------------

  it('proceeds to INSERT when the dedup SELECT errors (UNIQUE catches any race)', async () => {
    // Dedup errors → tryQuery returns ok:false. The helper must NOT short-circuit
    // (otherwise we drop legitimate enqueues); it INSERTs and lets the partial
    // UNIQUE index reject any actual duplicate.
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'connection timed out',
        code: 'NETWORK_ERROR',
        details: '',
        hint: '',
      },
    });
    mockClient._chain.single.mockResolvedValueOnce({
      data: { id: 'new-job-after-dedup-error' },
      error: null,
    });

    const result = await enqueueQueueJob({
      supabase,
      jobType: 'embed',
      body: { itemId: 'race' } as Record<string, unknown>,
      authContext: baseAuthContext,
      idempotencyKey: 'embed:race:2026-05-02:hash',
    });

    expect(result).toEqual({
      jobId: 'new-job-after-dedup-error',
      deduplicated: false,
    });
    expect(mockClient._chain.insert).toHaveBeenCalledTimes(1);
  });
});

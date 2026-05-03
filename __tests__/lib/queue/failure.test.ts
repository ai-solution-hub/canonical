/**
 * Tests for `lib/queue/failure.ts` — `handleJobFailure` retry/dead-letter
 * classifier.
 *
 * Spec: docs/specs/background-queue-infra-spec.md §5.1 (retry budget +
 * classification, lines 717-730), §5.4 (dead-letter, lines 771-787).
 * Plan: docs/plans/background-queue-infra-plan.md §2 W2 (failure classifier).
 *
 * AC coverage:
 *   - AC-2: Transient failure triggers retry (`status='pending', attempts++`).
 *   - AC-3: Retry exhaustion → dead-letter (`status='dead_lettered'`).
 *   - AC-4: Permanent failure does not retry (`status='failed', no retry`).
 *
 * The contract under test:
 *   handleJobFailure(supabase, job, err): Promise<'retried' | 'failed' | 'dead_lettered'>
 *
 * Per spec §5.1 + plan §2 W2:
 *   - Transient error  + attempts < max_attempts - 1 → 'retried'   (UPDATE pending, attempts++).
 *   - Transient error  + attempts >= max_attempts - 1 → 'dead_lettered' (UPDATE dead_lettered, attempts=max).
 *   - Permanent error  → 'failed' (UPDATE failed, NO further retry on this row).
 *
 * Implementation note: the W2-A `lib/queue/failure.ts` impl file lands in a
 * parallel worktree. Tests run after the W2-A merge — `bunx tsc --noEmit` in
 * THIS worktree will fail with `Cannot find module '@/lib/queue/failure'`
 * until then; that is expected and not a regression.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import { handleJobFailure } from '@/lib/queue/failure';
import type { Database } from '@/supabase/types/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

const FIXED_NOW_MS = Date.UTC(2026, 4, 3, 12, 0, 0); // 2026-05-03T12:00:00Z
const FIXED_NOW_ISO = new Date(FIXED_NOW_MS).toISOString();

const JOB_ID = 'c1d2e3f4-a5b6-4789-c0d1-e2f3a4b5c6d7';

interface JobFixture {
  id: string;
  job_type: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
  started_at: string;
}

function makeJob(overrides: Partial<JobFixture> = {}): JobFixture {
  return {
    id: JOB_ID,
    job_type: 'embed',
    attempts: 0,
    max_attempts: 3,
    payload: {},
    started_at: FIXED_NOW_ISO,
    ...overrides,
  };
}

describe('handleJobFailure', () => {
  let mockClient: MockSupabaseClient;
  let supabase: SupabaseClient<Database>;
  /** Captured `update()` calls so tests can inspect SET payloads. */
  let updatePayloads: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
    mockClient = createMockSupabaseClient();
    supabase = mockClient as unknown as SupabaseClient<Database>;
    updatePayloads = [];

    // Capture any UPDATE calls — `from('processing_queue').update({...})`
    // Tests below assert on `updatePayloads`.
    mockClient._chain.update.mockImplementation((data: unknown) => {
      updatePayloads.push(data as Record<string, unknown>);
      return mockClient._chain;
    });
    // .eq('id', ...) terminates as a thenable that resolves with `{ data: null, error: null }`
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );
  });

  // -------------------------------------------------------------------------
  // AC-2: Transient failure triggers retry
  // -------------------------------------------------------------------------
  it('AC-2: classifies a transient error as retried and writes status=pending + attempts++', async () => {
    const job = makeJob({ attempts: 0, max_attempts: 3 });
    const transientErr = new Error('Anthropic 429');

    const outcome = await handleJobFailure(supabase, job, transientErr);

    expect(outcome).toBe('retried');
    expect(updatePayloads).toHaveLength(1);
    const payload = updatePayloads[0];
    // Spec §5.1 transient row: attempts++, status='pending', error_message=null
    expect(payload).toMatchObject({
      status: 'pending',
      error_message: null,
      attempts: 1,
    });
    // The UPDATE must be filtered to this exact job id.
    expect(mockClient._chain.eq).toHaveBeenCalledWith('id', job.id);
  });

  it('AC-2: subsequent retry (attempts=1, max=3) is also retried not dead_lettered', async () => {
    const job = makeJob({ attempts: 1, max_attempts: 3 });
    const transientErr = new Error('Supabase 503');

    const outcome = await handleJobFailure(supabase, job, transientErr);

    expect(outcome).toBe('retried');
    expect(updatePayloads[0]).toMatchObject({
      status: 'pending',
      error_message: null,
      attempts: 2,
    });
  });

  // -------------------------------------------------------------------------
  // AC-3: Retry exhaustion → dead-letter
  // -------------------------------------------------------------------------
  it('AC-3: classifies a transient error as dead_lettered when attempts will reach max_attempts', async () => {
    // attempts=2, max_attempts=3 — incrementing to 3 hits the cap.
    const job = makeJob({ attempts: 2, max_attempts: 3 });
    const transientErr = new Error('Anthropic 503 (exhaustion)');

    const outcome = await handleJobFailure(supabase, job, transientErr);

    expect(outcome).toBe('dead_lettered');
    expect(updatePayloads).toHaveLength(1);
    const payload = updatePayloads[0];
    expect(payload).toMatchObject({
      status: 'dead_lettered',
      attempts: 3,
    });
    // Spec §5.4 dead-letter row carries error_message + completed_at.
    expect(payload.error_message).toEqual(expect.any(String));
    expect(payload.error_message).toContain('Anthropic 503 (exhaustion)');
    expect(payload.completed_at).toBe(FIXED_NOW_ISO);
    // The UPDATE must be filtered to this exact job id.
    expect(mockClient._chain.eq).toHaveBeenCalledWith('id', job.id);
  });

  // -------------------------------------------------------------------------
  // AC-4: Permanent failure does NOT retry
  // -------------------------------------------------------------------------
  it('AC-4: classifies a permanent error as failed without retrying', async () => {
    const job = makeJob({ attempts: 0, max_attempts: 3 });
    // Duck-type: an error with `permanent: true` flag indicates a
    // non-retryable failure (e.g. envelope schema mismatch, no_handler_registered).
    const permanentErr = {
      permanent: true,
      message: 'no_handler_registered: foo',
    } as unknown as Error;

    const outcome = await handleJobFailure(supabase, job, permanentErr);

    expect(outcome).toBe('failed');
    // Crucial AC-4 contract: NO retry — single UPDATE call, never to 'pending'.
    expect(updatePayloads).toHaveLength(1);
    const payload = updatePayloads[0];
    expect(payload).toMatchObject({
      status: 'failed',
      error_message: 'no_handler_registered: foo',
      attempts: 1,
    });
    expect(payload.completed_at).toBe(FIXED_NOW_ISO);
    // Sanity: status was NOT set to 'pending' on any update.
    const statuses = updatePayloads.map((p) => p.status);
    expect(statuses).not.toContain('pending');
    // Sanity: the same row was the only target.
    expect(mockClient._chain.eq).toHaveBeenCalledWith('id', job.id);
  });

  it('AC-4: permanent error skips retry even with low attempts (attempts=0)', async () => {
    // Same scenario different angle: assert NO second update writes pending.
    const job = makeJob({ attempts: 0, max_attempts: 3 });
    const permanentErr = {
      permanent: true,
      message: 'unsupported_envelope_version: 999',
    } as unknown as Error;

    const outcome = await handleJobFailure(supabase, job, permanentErr);

    expect(outcome).toBe('failed');
    // Only ONE UPDATE. AC-4 forbids any second UPDATE that writes 'pending'.
    expect(updatePayloads).toHaveLength(1);
    expect(updatePayloads[0].status).toBe('failed');
  });
});

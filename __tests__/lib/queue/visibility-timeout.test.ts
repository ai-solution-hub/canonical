/**
 * Tests for `lib/queue/visibility-timeout.ts` — `reapStuckJobs` orphaned-job
 * recovery.
 *
 * Spec: docs/specs/background-queue-infra-spec.md §5.3 (visibility timeout,
 * lines 750-769) — UPDATE rows whose `started_at < NOW() - 5 min` AND
 * `status = 'processing'` back to `pending`, incrementing `attempts`.
 *
 * AC coverage: AC-5 (Stuck job is reaped).
 *
 * Authored default per spec §5.3 line 764: visibility_timeout = 5 minutes.
 *
 * Post-S223 W3-A: the reaper now calls the `reap_stuck_jobs(p_timeout_seconds)`
 * RPC (migration 20260505153750_*) which performs the UPDATE +
 * `attempts = attempts + 1` atomically server-side. Previously the impl was
 * a supabase-js `.update()` chain that could not express the raw column
 * increment (S222 W2-B fallback, deferred per AC-5 spec §8 line 1080).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import { reapStuckJobs } from '@/lib/queue/visibility-timeout';
import type { Database } from '@/supabase/types/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_TIMEOUT_SECONDS = 5 * 60;

describe('reapStuckJobs', () => {
  let mockClient: MockSupabaseClient;
  let supabase: SupabaseClient<Database>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockSupabaseClient();
    supabase = mockClient as unknown as SupabaseClient<Database>;
  });

  // -------------------------------------------------------------------------
  // AC-5: Stuck job is reaped — RPC reap_stuck_jobs(p_timeout_seconds) returns
  // the count of reaped rows. The DB function performs the UPDATE +
  // attempts = attempts + 1 atomically (raw column increment).
  // -------------------------------------------------------------------------
  it('AC-5: invokes reap_stuck_jobs RPC with the 5-minute default timeout', async () => {
    mockClient.rpc.mockResolvedValueOnce({ data: 1, error: null });

    const result = await reapStuckJobs(supabase);

    expect(mockClient.rpc).toHaveBeenCalledTimes(1);
    expect(mockClient.rpc).toHaveBeenCalledWith('reap_stuck_jobs', {
      p_timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
    });
    expect(result).toBe(1);
  });

  it('AC-5: returns the count from the RPC result (multi-row reap)', async () => {
    mockClient.rpc.mockResolvedValueOnce({ data: 3, error: null });

    const result = await reapStuckJobs(supabase);

    expect(result).toBe(3);
  });

  it('AC-5: zero stuck rows returns 0 (no error)', async () => {
    mockClient.rpc.mockResolvedValueOnce({ data: 0, error: null });

    const result = await reapStuckJobs(supabase);

    expect(mockClient.rpc).toHaveBeenCalledTimes(1);
    expect(result).toBe(0);
  });

  it('AC-5: null data from RPC coerces to 0', async () => {
    mockClient.rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await reapStuckJobs(supabase);

    expect(result).toBe(0);
  });

  it('AC-5: visibilityTimeoutSeconds override is forwarded to the RPC arg', async () => {
    mockClient.rpc.mockResolvedValueOnce({ data: 0, error: null });

    await reapStuckJobs(supabase, { visibilityTimeoutSeconds: 60 });

    expect(mockClient.rpc).toHaveBeenCalledWith('reap_stuck_jobs', {
      p_timeout_seconds: 60,
    });
  });

  it('AC-5: RPC error surfaces as a thrown error', async () => {
    mockClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for function reap_stuck_jobs' },
    });

    await expect(reapStuckJobs(supabase)).rejects.toMatchObject({
      message: 'permission denied for function reap_stuck_jobs',
    });
  });
});

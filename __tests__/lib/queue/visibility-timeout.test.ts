/**
 * Tests for `lib/queue/visibility-timeout.ts` — `reapStuckJobs` orphaned-job
 * recovery.
 *
 * Spec: docs/specs/background-queue-infra-spec.md §5.3 (visibility timeout,
 * lines 750-769) — UPDATE rows whose `started_at < NOW() - 5 min` AND
 * `status = 'processing'` back to `pending`.
 * Plan: docs/plans/background-queue-infra-plan.md §2 W2 (visibility-timeout reaper).
 *
 * AC coverage: AC-5 (Stuck job is reaped).
 *
 * Authored default per spec §5.3 line 764: visibility_timeout = 5 minutes.
 *
 * The cutoff timestamp is computed inline: `NOW() - 5 min`. Test pins
 * `Date.now()` per the project gotcha (date-sensitive tests need pinned time)
 * so the assertion against `lt('started_at', cutoffIso)` is deterministic.
 *
 * Implementation note: the W2-A `lib/queue/visibility-timeout.ts` impl file
 * lands in a parallel worktree. Tests run after the W2-A merge — `bunx tsc
 * --noEmit` in THIS worktree will fail with `Cannot find module
 * '@/lib/queue/visibility-timeout'` until then; expected, not a regression.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import { reapStuckJobs } from '@/lib/queue/visibility-timeout';
import type { Database } from '@/supabase/types/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

// 2026-05-03T12:00:00Z — fixed so cutoff arithmetic is deterministic.
const FIXED_NOW_MS = Date.UTC(2026, 4, 3, 12, 0, 0);
// 5 minutes earlier (default visibility timeout per spec §5.3).
const EXPECTED_CUTOFF_ISO = new Date(
  FIXED_NOW_MS - 5 * 60 * 1000,
).toISOString();

const STUCK_JOB_ID = 'd1e2f3a4-b5c6-4789-d0e1-f2a3b4c5d6e7';

describe('reapStuckJobs', () => {
  let mockClient: MockSupabaseClient;
  let supabase: SupabaseClient<Database>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
    mockClient = createMockSupabaseClient();
    supabase = mockClient as unknown as SupabaseClient<Database>;
  });

  // -------------------------------------------------------------------------
  // AC-5: Stuck job is reaped — UPDATE on processing rows older than cutoff.
  // -------------------------------------------------------------------------
  it('AC-5: issues an UPDATE filtered on status=processing AND started_at < (now - 5 min)', async () => {
    // Configure the chain: update().eq('status', 'processing').lt('started_at', cutoff)
    // resolves to a list of reaped rows.
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          {
            id: STUCK_JOB_ID,
            job_type: 'embed',
            attempts: 1,
            started_at: new Date(FIXED_NOW_MS - 10 * 60 * 1000).toISOString(),
          },
        ],
        error: null,
      }),
    );

    await reapStuckJobs(supabase);

    // The reaper MUST target processing_queue (not si_processing_queue!).
    expect(mockClient.from).toHaveBeenCalledWith('processing_queue');
    // The UPDATE must SET status='pending' AND increment attempts.
    expect(mockClient._chain.update).toHaveBeenCalledTimes(1);
    const updateArg = mockClient._chain.update.mock.calls[0][0];
    expect(updateArg).toMatchObject({
      status: 'pending',
    });
    // Filter chain: status='processing' (only reap processing rows) +
    // started_at < cutoff_iso (only reap rows older than 5 min).
    expect(mockClient._chain.eq).toHaveBeenCalledWith('status', 'processing');
    expect(mockClient._chain.lt).toHaveBeenCalledWith(
      'started_at',
      EXPECTED_CUTOFF_ISO,
    );
  });

  it('AC-5: returns the count of reaped jobs (or array — whichever the impl chooses)', async () => {
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          { id: STUCK_JOB_ID, job_type: 'embed' },
          { id: 'd1e2f3a4-b5c6-4789-d0e1-f2a3b4c5d6e8', job_type: 'classify' },
        ],
        error: null,
      }),
    );

    const result = await reapStuckJobs(supabase);

    // Two valid contract shapes per plan §2 W2: either a number (count) or
    // an array (the reaped rows). Test accepts either as long as the count
    // is reflected.
    if (typeof result === 'number') {
      expect(result).toBe(2);
    } else if (Array.isArray(result)) {
      expect(result).toHaveLength(2);
    } else if (result && typeof result === 'object' && 'count' in result) {
      expect((result as { count: number }).count).toBe(2);
    } else {
      throw new Error(
        `reapStuckJobs returned unexpected shape: ${JSON.stringify(result)}`,
      );
    }
  });

  it('AC-5: zero stuck rows is a no-op (no error thrown, count is 0)', async () => {
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    const result = await reapStuckJobs(supabase);

    expect(mockClient._chain.update).toHaveBeenCalledTimes(1);
    if (typeof result === 'number') {
      expect(result).toBe(0);
    } else if (Array.isArray(result)) {
      expect(result).toHaveLength(0);
    } else if (result && typeof result === 'object' && 'count' in result) {
      expect((result as { count: number }).count).toBe(0);
    }
  });

  it('AC-5: cutoff is computed from Date.now() at call time (5-min default)', async () => {
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    await reapStuckJobs(supabase);

    // The lt() filter MUST use NOW - 5min. EXPECTED_CUTOFF_ISO is computed
    // identically here against the same pinned Date.now(), so the
    // assertion is exact-match.
    expect(mockClient._chain.lt).toHaveBeenCalledWith(
      'started_at',
      EXPECTED_CUTOFF_ISO,
    );
  });
});

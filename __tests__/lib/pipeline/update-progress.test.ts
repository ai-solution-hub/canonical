/**
 * Tests for `lib/pipeline/update-progress.ts`.
 *
 * S212 W2 (Pattern E retrofit): the mid-flight UPDATE helper is the
 * SILENT-CATCH surface of the lifecycle (at-start INSERT and terminal
 * UPDATE are both fail-fast). Tests assert:
 *   1. UPDATE goes through createServiceClient() (bypasses RLS).
 *   2. UPDATE writes the supplied progress to `pipeline_runs.progress`.
 *   3. extraFields are merged into the same UPDATE payload (so EP3 can
 *      atomically set status + error_message + completed_at + progress
 *      on the failure path — see app/api/upload/route.ts:362-374).
 *   4. SILENT-CATCH on insert failure (returns undefined, does not throw).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the service client factory so we control its return value per-test.
const { mockServiceClient, createServiceClientMock } = vi.hoisted(() => {
  return {
    mockServiceClient: { from: vi.fn() },
    createServiceClientMock: vi.fn(),
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: createServiceClientMock,
}));

import { updatePipelineProgress } from '@/lib/pipeline/update-progress';

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a chain that resolves
 * `from('pipeline_runs').update(...).eq('id', x)` with the supplied
 * resolution (resolve to a no-op object or throw at chain time).
 */
function configureChain(opts: { throwOnUpdate?: boolean } = {}) {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn(() => {
    if (opts.throwOnUpdate) {
      throw new Error('connection refused');
    }
    return { eq };
  });
  const from = vi.fn(() => ({ update }));
  mockServiceClient.from = from;
  createServiceClientMock.mockReturnValue(mockServiceClient);
  return { from, update, eq };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

describe('updatePipelineProgress', () => {
  it('UPDATEs pipeline_runs.progress via the service client (bypasses RLS)', async () => {
    const chain = configureChain();

    await updatePipelineProgress('run-id-1', {
      step: 'importing',
      files_completed: 2,
      files_total: 5,
      detail: 'Processing foo.md…',
    });

    expect(createServiceClientMock).toHaveBeenCalledTimes(1);
    expect(chain.from).toHaveBeenCalledWith('pipeline_runs');
    expect(chain.update).toHaveBeenCalledTimes(1);
    expect(chain.eq).toHaveBeenCalledWith('id', 'run-id-1');
    const payload = (chain.update.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(payload.progress).toMatchObject({
      step: 'importing',
      files_completed: 2,
      files_total: 5,
      detail: 'Processing foo.md…',
    });
  });

  it('merges extraFields into the same UPDATE payload (EP3 failure-path atomic write)', async () => {
    const chain = configureChain();

    await updatePipelineProgress(
      'run-id-1',
      {
        step: 'failed',
        steps_completed: 0,
        steps_total: 6,
        detail: 'Failed to upload to storage.',
      },
      {
        status: 'failed',
        error_message: 'Failed to upload file to storage.',
        completed_at: '2026-04-29T22:00:00Z',
      },
    );

    const payload = (chain.update.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(payload.status).toBe('failed');
    expect(payload.error_message).toBe('Failed to upload file to storage.');
    expect(payload.completed_at).toBe('2026-04-29T22:00:00Z');
    expect(payload.progress).toBeDefined();
  });

  it('SILENT-CATCH on update failure (returns undefined, does not throw)', async () => {
    configureChain({ throwOnUpdate: true });

    // Should NOT throw — silent-catch is intentional per file header.
    await expect(
      updatePipelineProgress('run-id-1', {
        step: 'importing',
        files_completed: 1,
        files_total: 5,
        detail: 'Processing foo.md…',
      }),
    ).resolves.toBeUndefined();
  });

  it('accepts EP3 steps_* shape and EP2 files_* shape interchangeably (free-form JSONB)', async () => {
    const chain = configureChain();

    // EP3 shape
    await updatePipelineProgress('run-1', {
      step: 'extracting',
      steps_completed: 1,
      steps_total: 6,
      detail: 'Extracting text from document...',
    });

    // EP2 shape
    await updatePipelineProgress('run-2', {
      step: 'importing',
      files_completed: 3,
      files_total: 10,
      detail: 'Processing bar.md…',
    });

    expect(chain.update).toHaveBeenCalledTimes(2);
    const ep3 = (chain.update.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    const ep2 = (chain.update.mock.calls[1] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect((ep3.progress as Record<string, unknown>).steps_completed).toBe(1);
    expect((ep2.progress as Record<string, unknown>).files_completed).toBe(3);
  });
});

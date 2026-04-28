/**
 * Tests for `lib/pipeline/record-run.ts`.
 *
 * S152B WP4: verifies that the `recordPipelineRun` helper:
 * 1. Inserts a row into `pipeline_runs` with the correct payload.
 * 2. Never throws — all failure modes are captured.
 * 3. Fires Sentry.captureMessage on `failed` (level: error) and
 *    `completed_with_errors` (level: warning) but NOT on `completed`.
 * 4. Fires Sentry.captureMessage on DB insertion failure (level: error).
 * 5. Respects `skipSentryAlert: true` for tests / backfills.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Sentry BEFORE importing the module under test (vi.mock is hoisted).
// ---------------------------------------------------------------------------

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

// Import after the mock so the module picks up the mocked Sentry.
import * as Sentry from '@sentry/nextjs';
import { recordPipelineRun } from '@/lib/pipeline/record-run';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSupabase(
  insertResult:
    | { data: null; error: null }
    | {
        data: null;
        error: { message: string; code: string; details: string; hint: string };
      },
): {
  client: SupabaseClient<Database>;
  insertSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn(() => Promise.resolve(insertResult));
  const fromSpy = vi.fn(() => ({ insert: insertSpy }));
  return {
    client: { from: fromSpy } as unknown as SupabaseClient<Database>,
    insertSpy,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recordPipelineRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('inserts a pipeline_runs row with the expected shape on completed', async () => {
    const { client, insertSpy } = createMockSupabase({
      data: null,
      error: null,
    });

    await recordPipelineRun({
      supabase: client,
      pipelineName: 'content_gaps',
      status: 'completed',
      itemsProcessed: 42,
      result: { snapshot: 'ok' },
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.pipeline_name).toBe('content_gaps');
    expect(payload.status).toBe('completed');
    expect(payload.items_processed).toBe(42);
    expect(payload.result).toEqual({ snapshot: 'ok' });
    expect(typeof payload.completed_at).toBe('string');
  });

  it('does NOT fire Sentry on a completed run', async () => {
    const { client } = createMockSupabase({ data: null, error: null });
    await recordPipelineRun({
      supabase: client,
      pipelineName: 'content_gaps',
      status: 'completed',
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Alerting on non-completed runs
  // -------------------------------------------------------------------------

  it('fires Sentry at error level on a failed run', async () => {
    const { client } = createMockSupabase({ data: null, error: null });
    await recordPipelineRun({
      supabase: client,
      pipelineName: 'classification_quality',
      status: 'failed',
      errorMessage: 'all items errored',
    });

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = (
      Sentry.captureMessage as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(message).toContain('classification_quality');
    expect(message).toContain('failed');
    expect(message).toContain('all items errored');
    expect(options).toMatchObject({ level: 'error' });
  });

  it('fires Sentry at warning level on a completed_with_errors run', async () => {
    const { client } = createMockSupabase({ data: null, error: null });
    await recordPipelineRun({
      supabase: client,
      pipelineName: 'quality_score',
      status: 'completed_with_errors',
      errorMessage: '3 of 100 items errored',
    });

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [, options] = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(options).toMatchObject({ level: 'warning' });
  });

  // -------------------------------------------------------------------------
  // Never-throws contract
  // -------------------------------------------------------------------------

  it('never throws when the DB insert fails', async () => {
    const { client } = createMockSupabase({
      data: null,
      error: {
        message: 'duplicate key violation',
        code: '23505',
        details: '',
        hint: '',
      },
    });

    await expect(
      recordPipelineRun({
        supabase: client,
        pipelineName: 'coverage_alert',
        status: 'completed',
      }),
    ).resolves.toBeUndefined();
  });

  it('fires Sentry at error level when the DB insert fails', async () => {
    const { client } = createMockSupabase({
      data: null,
      error: {
        message: 'duplicate key violation',
        code: '23505',
        details: '',
        hint: '',
      },
    });

    await recordPipelineRun({
      supabase: client,
      pipelineName: 'coverage_alert',
      status: 'completed',
    });

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = (
      Sentry.captureMessage as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(message).toContain('pipeline_runs insert failed');
    expect(message).toContain('coverage_alert');
    expect(options).toMatchObject({ level: 'error' });
  });

  // -------------------------------------------------------------------------
  // skipSentryAlert
  // -------------------------------------------------------------------------

  it('does NOT fire Sentry when skipSentryAlert is true, even on failed', async () => {
    const { client } = createMockSupabase({ data: null, error: null });
    await recordPipelineRun({
      supabase: client,
      pipelineName: 'content_gaps',
      status: 'failed',
      errorMessage: 'test failure',
      skipSentryAlert: true,
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('does NOT fire Sentry on insert failure when skipSentryAlert is true', async () => {
    const { client } = createMockSupabase({
      data: null,
      error: {
        message: 'db down',
        code: '08000',
        details: '',
        hint: '',
      },
    });
    await recordPipelineRun({
      supabase: client,
      pipelineName: 'content_gaps',
      status: 'completed',
      skipSentryAlert: true,
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});

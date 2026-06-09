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
import { createMockSupabaseTable } from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Adapter to the canonical `createMockSupabaseTable`. The lib under test
 * does `await supabase.from('pipeline_runs').insert(row)`, which the
 * canonical helper supports — `chain.insert(...)` returns the chain
 * whose `then` resolves to the `initialResolution`. Exposes `insertSpy`
 * so callers can introspect the insert payload via `mock.calls[0][0]`.
 */
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
  const supabase = createMockSupabaseTable(insertResult);
  return {
    client: supabase as unknown as SupabaseClient<Database>,
    insertSpy: supabase._chain.insert,
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

  it('includes op_id in the insert payload when opId is provided', async () => {
    const { client, insertSpy } = createMockSupabase({
      data: null,
      error: null,
    });
    const testOpId = '550e8400-e29b-41d4-a716-446655440000';

    await recordPipelineRun({
      supabase: client,
      pipelineName: 'kh_canonical_pipeline',
      status: 'completed',
      opId: testOpId,
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.op_id).toBe(testOpId);
  });

  it('inserts op_id as null when opId is omitted', async () => {
    const { client, insertSpy } = createMockSupabase({
      data: null,
      error: null,
    });

    await recordPipelineRun({
      supabase: client,
      pipelineName: 'content_gaps',
      status: 'completed',
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.op_id).toBeNull();
  });

  it('inserts op_id as null when opId is explicitly null', async () => {
    const { client, insertSpy } = createMockSupabase({
      data: null,
      error: null,
    });

    await recordPipelineRun({
      supabase: client,
      pipelineName: 'content_gaps',
      status: 'completed',
      opId: null,
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.op_id).toBeNull();
  });

  // -------------------------------------------------------------------------
  // ended_at terminal-status writer (bl-271)
  //
  // `ended_at` (mig 20260530121355) is the run-finished timestamp. It had no
  // writer anywhere — `recordPipelineRun` only ever wrote `completed_at`.
  // The writer stamps `ended_at` only on the four terminal statuses and
  // leaves it NULL for the `in_progress` flow-start emission, so downstream
  // observability can tell a still-running flow from a finished one.
  // -------------------------------------------------------------------------

  it.each([
    'completed',
    'completed_with_errors',
    'failed',
    'cancelled',
  ] as const)('stamps ended_at on a terminal %s run', async (status) => {
    const { client, insertSpy } = createMockSupabase({
      data: null,
      error: null,
    });

    await recordPipelineRun({
      supabase: client,
      pipelineName: 'kh_canonical_pipeline',
      status,
      errorMessage: status === 'completed' ? null : 'something to report',
      skipSentryAlert: true,
    });

    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof payload.ended_at).toBe('string');
    // ended_at and completed_at share the single capture instant for a
    // terminal row (the run finished as it was recorded).
    expect(payload.ended_at).toBe(payload.completed_at);
  });

  it('leaves ended_at NULL on an in_progress (flow-start) run', async () => {
    const { client, insertSpy } = createMockSupabase({
      data: null,
      error: null,
    });

    await recordPipelineRun({
      supabase: client,
      pipelineName: 'kh_canonical_pipeline',
      status: 'in_progress',
      progress: { stage: 'started' },
    });

    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.ended_at).toBeNull();
    // completed_at is still stamped on the start row (it timestamps the
    // insert, not the run end).
    expect(typeof payload.completed_at).toBe('string');
  });

  // -------------------------------------------------------------------------
  // stageCounts merge (ID-28.11 — Inv-17 rollup substrate)
  // -------------------------------------------------------------------------

  it('lands stageCounts inside result.stage_counts when no result is supplied', async () => {
    const { client, insertSpy } = createMockSupabase({
      data: null,
      error: null,
    });
    const stageCounts = {
      source_walk: 5,
      binary_conversion: 5,
      llm_extraction: 5,
      embedding: 5,
      entity_resolution: 5,
      chunking: 5,
      postgres_upsert: 5,
    };

    await recordPipelineRun({
      supabase: client,
      pipelineName: 'kh_canonical_pipeline',
      status: 'completed',
      stageCounts,
    });

    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.result).toEqual({ stage_counts: stageCounts });
  });

  it('merges stageCounts INTO caller-supplied result without dropping siblings', async () => {
    const { client, insertSpy } = createMockSupabase({
      data: null,
      error: null,
    });
    const stageCounts = {
      source_walk: 1,
      binary_conversion: 1,
      llm_extraction: 1,
      embedding: 1,
      entity_resolution: 1,
      chunking: 1,
      postgres_upsert: 1,
    };

    await recordPipelineRun({
      supabase: client,
      pipelineName: 'kh_canonical_pipeline',
      status: 'completed',
      result: { extractor_version: 'abc123', error_class: null },
      stageCounts,
    });

    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.result).toEqual({
      extractor_version: 'abc123',
      error_class: null,
      stage_counts: stageCounts,
    });
  });

  it('keeps result null when neither result nor stageCounts is supplied', async () => {
    const { client, insertSpy } = createMockSupabase({
      data: null,
      error: null,
    });

    await recordPipelineRun({
      supabase: client,
      pipelineName: 'content_gaps',
      status: 'completed',
    });

    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.result).toBeNull();
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

  // Regression — ID-28.11 FX-1
  // Pipeline flow-start webhooks pass status='in_progress' (a healthy
  // lifecycle event, not a failure). The original Sentry-guard at line
  // 206 only short-circuited on 'completed', so every flow-start fired
  // a spurious Sentry warning in production. The guard now covers both
  // 'completed' AND 'in_progress'; only 'failed' / 'completed_with_errors'
  // should trigger an alert.
  it('does NOT fire Sentry on an in_progress run (flow-start lifecycle)', async () => {
    const { client } = createMockSupabase({ data: null, error: null });
    await recordPipelineRun({
      supabase: client,
      pipelineName: 'kh_canonical_pipeline',
      status: 'in_progress',
      progress: { stage: 'started' },
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  // ID-76 — user-initiated cancellation is a first-class terminal status.
  // It inserts the row (partial work preserved in `result`) but emits NO
  // Sentry alert: a user cancel is not a degradation. The guard now covers
  // 'completed', 'in_progress', AND 'cancelled'.
  it('inserts the row and does NOT fire Sentry on a cancelled run (ID-76)', async () => {
    const { client, insertSpy } = createMockSupabase({
      data: null,
      error: null,
    });
    await recordPipelineRun({
      supabase: client,
      pipelineName: 'batch_reclassify',
      status: 'cancelled',
      itemsProcessed: 7,
      result: { partial: 'work' },
      errorMessage: 'cancelled mid-run after 7/25 items',
    });

    // The row is still inserted (partial work preserved).
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe('cancelled');
    expect(payload.result).toEqual({ partial: 'work' });

    // No Sentry alert — cancellation is silent.
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

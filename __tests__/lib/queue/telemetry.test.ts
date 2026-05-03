/**
 * Tests for `lib/queue/telemetry.ts` — Sentry + PostHog instrumentation
 * helpers for the background-queue worker.
 *
 * Spec: docs/specs/background-queue-infra-spec.md §6.1 (Sentry signals) +
 * §6.2 (PostHog events).
 * Plan: docs/plans/background-queue-infra-plan.md §1 W1, §2 W1-C row.
 *
 * The Sentry helper distinguishes:
 *   - `error` set    → captureException (severity from level || 'error')
 *   - `error` unset  → captureMessage   (severity defaults to 'warning')
 *
 * The PostHog helper emits the four terminal-state events from spec §6.2.
 * Because no PostHog client is wired in this codebase yet, the helper
 * documents a stub-via-Sentry-breadcrumb fallback (see lib/queue/telemetry.ts
 * TSDoc). The tests assert the breadcrumb shape is correct.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — declare BEFORE importing the module under test.
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import * as Sentry from '@sentry/nextjs';

import {
  emitQueueAnalytics,
  emitQueueSentry,
  type QueueAnalyticsEvent,
} from '@/lib/queue/telemetry';

const sampleJob = {
  job_id: 'job-1',
  job_type: 'embed' as const,
  attempts: 1,
  max_attempts: 3,
};
const sampleAuth = {
  user_id: 'a0000000-0000-4000-8000-000000000001',
  role: 'admin' as const,
};

describe('emitQueueSentry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. With error → captureException with queue + stage tags
  // -------------------------------------------------------------------------

  it('calls captureException with queue=processing_queue and the supplied stage when an error is provided', () => {
    const err = new Error('handler boom');
    emitQueueSentry({
      stage: 'handler',
      job: sampleJob,
      authContext: sampleAuth,
      error: err,
    });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();

    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call?.[0]).toBe(err);
    const opts = call?.[1] as Record<string, unknown> | undefined;
    expect(opts?.tags).toMatchObject({
      queue: 'processing_queue',
      stage: 'handler',
      job_type: 'embed',
    });
    expect(opts?.extra).toMatchObject({
      job: sampleJob,
      auth_context: sampleAuth,
    });
    expect(opts?.level).toBe('error');
  });

  it('respects the supplied level: warning when set', () => {
    emitQueueSentry({
      stage: 'handler',
      job: sampleJob,
      error: new Error('transient'),
      level: 'warning',
    });
    const opts = (Sentry.captureException as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(opts?.level).toBe('warning');
  });

  // -------------------------------------------------------------------------
  // 2. dead_lettered:true tags propagate
  // -------------------------------------------------------------------------

  it('adds tags.dead_lettered when deadLettered: true', () => {
    emitQueueSentry({
      stage: 'handler',
      job: sampleJob,
      error: new Error('exhausted'),
      deadLettered: true,
    });
    const opts = (Sentry.captureException as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(opts?.tags).toMatchObject({
      queue: 'processing_queue',
      stage: 'handler',
      dead_lettered: 'true',
    });
  });

  it('omits the dead_lettered tag when not set', () => {
    emitQueueSentry({
      stage: 'visibility_timeout',
      job: sampleJob,
    });
    const opts = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as Record<string, unknown> | undefined;
    const tags = opts?.tags as Record<string, string> | undefined;
    expect(tags).toBeDefined();
    expect(tags && 'dead_lettered' in tags).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 3. No error → captureMessage with default level: warning
  // -------------------------------------------------------------------------

  it('calls captureMessage with level: warning when no error is supplied', () => {
    emitQueueSentry({
      stage: 'visibility_timeout',
      job: sampleJob,
    });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();

    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call?.[0]).toBe('queue.visibility_timeout');
    const opts = call?.[1] as Record<string, unknown> | undefined;
    expect(opts?.level).toBe('warning');
    expect(opts?.tags).toMatchObject({
      queue: 'processing_queue',
      stage: 'visibility_timeout',
      job_type: 'embed',
    });
    expect(opts?.extra).toMatchObject({ job: sampleJob });
  });

  it('handles the invocation stage (worker harness crash before any job)', () => {
    const err = new Error('claim_next_job RPC threw');
    emitQueueSentry({
      stage: 'invocation',
      error: err,
    });
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call?.[0]).toBe(err);
    const opts = call?.[1] as Record<string, unknown> | undefined;
    expect(opts?.tags).toMatchObject({
      queue: 'processing_queue',
      stage: 'invocation',
    });
    // No job_type tag because no job context.
    const tags = opts?.tags as Record<string, string> | undefined;
    expect(tags && 'job_type' in tags).toBe(false);
  });
});

describe('emitQueueAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 4. queue_job_completed → correct event name + properties
  // -------------------------------------------------------------------------

  it('emits queue_job_completed with job_type, duration_ms, attempts, success: true', () => {
    emitQueueAnalytics({
      event: 'queue_job_completed',
      job: { ...sampleJob, attempts: 1 },
      durationMs: 1234,
    });
    // Stub fallback writes a Sentry breadcrumb with the event payload.
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    const crumb = (Sentry.addBreadcrumb as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(crumb?.category).toBe('queue.analytics');
    expect(crumb?.message).toBe('queue_job_completed');
    expect(crumb?.data).toMatchObject({
      event: 'queue_job_completed',
      job_type: 'embed',
      duration_ms: 1234,
      attempts: 1,
      success: true,
    });
  });

  // -------------------------------------------------------------------------
  // 5. queue_job_failed → includes error_class
  // -------------------------------------------------------------------------

  it('emits queue_job_failed with error_class property', () => {
    emitQueueAnalytics({
      event: 'queue_job_failed',
      job: { ...sampleJob, attempts: 2 },
      durationMs: 5500,
      errorClass: 'transient',
    });
    const crumb = (Sentry.addBreadcrumb as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(crumb?.data).toMatchObject({
      event: 'queue_job_failed',
      job_type: 'embed',
      duration_ms: 5500,
      attempts: 2,
      error_class: 'transient',
    });
  });

  it('emits queue_job_dead_lettered with the supplied attempts', () => {
    emitQueueAnalytics({
      event: 'queue_job_dead_lettered',
      job: { ...sampleJob, attempts: 3, max_attempts: 3 },
    });
    const crumb = (Sentry.addBreadcrumb as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(crumb?.data).toMatchObject({
      event: 'queue_job_dead_lettered',
      job_type: 'embed',
      attempts: 3,
    });
  });

  it('emits queue_job_cancelled with cancelled_after_ms', () => {
    emitQueueAnalytics({
      event: 'queue_job_cancelled',
      job: sampleJob,
      cancelledAfterMs: 250,
    });
    const crumb = (Sentry.addBreadcrumb as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(crumb?.data).toMatchObject({
      event: 'queue_job_cancelled',
      job_type: 'embed',
      cancelled_after_ms: 250,
    });
  });

  // -------------------------------------------------------------------------
  // Type test: the four event names exist as a closed union
  // -------------------------------------------------------------------------

  it('exposes the four spec §6.2 event names as a closed union', () => {
    const events: QueueAnalyticsEvent[] = [
      'queue_job_completed',
      'queue_job_failed',
      'queue_job_dead_lettered',
      'queue_job_cancelled',
    ];
    expect(events).toHaveLength(4);
  });
});

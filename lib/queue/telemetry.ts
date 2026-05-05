/**
 * Queue worker telemetry helpers — Sentry instrumentation + PostHog event
 * emission for the `processing_queue` background-job worker. Session 221
 * Wave 1-C.
 *
 * Spec: `docs/specs/background-queue-infra-spec.md` §6.1 (Sentry signals,
 * lines 884-901) + §6.2 (PostHog events, lines 903-917).
 * Plan: `docs/plans/background-queue-infra-plan.md` §1 W1, §2 W1-C, §4 C7.
 *
 * ## Sentry helper (`emitQueueSentry`)
 *
 * Wraps `Sentry.captureException` / `Sentry.captureMessage` with the queue's
 * standard tag set:
 *   - `queue: 'processing_queue'` on every emission
 *   - `stage: <invocation | handler | visibility_timeout>` per spec §6.1
 *   - `job_type: <type>` when a job is in scope
 *   - `dead_lettered: 'true'` when an exhausted-retries failure is being
 *     reported (per spec §6.1.1)
 *
 * The two-tier severity model (warning for visibility-timeout / transient
 * retry, error for permanent / dead-letter) mirrors `recordPipelineRun()`'s
 * existing pattern (`lib/pipeline/record-run.ts` L196).
 *
 * ## PostHog helper (`emitQueueAnalytics`)
 *
 * The four terminal-state events from spec §6.2 lines 909-914:
 *   - `queue_job_completed`     (success)
 *   - `queue_job_failed`        (transient or permanent failure)
 *   - `queue_job_dead_lettered` (exhausted retries)
 *   - `queue_job_cancelled`     (user cancellation)
 *
 * **PostHog client status (S221):** No PostHog wiring exists in this
 * codebase yet — `lib/intelligence/health.ts` is the spec-cited reference
 * but no `posthog-node` import exists. Per W1-C brief, the helper is a
 * documented STUB that emits a Sentry breadcrumb with the event payload
 * so the call is observable in tests + production until the PostHog
 * client lands. When PostHog is wired (post-W1, tracked separately), the
 * stub implementation can be swapped for `posthog.capture(...)` without
 * changing any caller. Event names + property names MUST stay verbatim
 * from spec §6.2 across the swap.
 */

import * as Sentry from '@sentry/nextjs';

import type { JobType } from '@/lib/queue/envelope';

// ---------------------------------------------------------------------------
// Sentry helper
// ---------------------------------------------------------------------------

/**
 * Reference shape for a queue job in telemetry payloads. Subset of the
 * `processing_queue` row — only the fields telemetry consumers actually
 * need so we don't accidentally leak the whole envelope into Sentry extras.
 */
interface QueueJobRef {
  job_id: string;
  job_type: JobType;
  attempts?: number;
  max_attempts?: number;
}

/**
 * Reference shape for the auth context in telemetry payloads. Mirrors the
 * envelope's `auth_context` so the two stay in sync — Sentry extras render
 * the same shape the worker reconstructs at claim time.
 */
interface AuthContextRef {
  user_id: string;
  role: 'admin' | 'editor' | 'viewer';
  workspace_id?: string;
}

/**
 * The three Sentry signal stages from spec §6.1:
 *   - `invocation`         — worker harness crashes (claim_next_job RPC
 *     throws, JSON parse fails before any job is in scope).
 *   - `handler`            — job-type handler throws (the most common case).
 *   - `visibility_timeout` — visibility-timeout reaper rescued an orphaned
 *     `status='processing'` row.
 */
/** @public */
export type QueueSentryStage = 'invocation' | 'handler' | 'visibility_timeout';

/**
 * Arguments for `emitQueueSentry`.
 */
/** @public */
export interface EmitQueueSentryArgs {
  /** Which observability surface is firing — see `QueueSentryStage`. */
  stage: QueueSentryStage;
  /** Optional job context. Omitted for `invocation` stage when no job is
   *  in scope (e.g. RPC threw before any row was claimed). */
  job?: QueueJobRef;
  /** Optional auth context for cross-referencing the enqueueing user. */
  authContext?: AuthContextRef;
  /** When set, the helper calls `Sentry.captureException(error, ...)`.
   *  When omitted, it calls `Sentry.captureMessage('queue.<stage>', ...)`
   *  — used for non-throw signals like the visibility-timeout reaper. */
  error?: unknown;
  /** Severity. Defaults to 'error' when `error` is set, 'warning' when
   *  `error` is omitted (matches the two-tier model in §6.1). */
  level?: 'warning' | 'error';
  /** When true, adds `tags.dead_lettered = 'true'` so the Sentry inbox
   *  can filter exhausted-retry rows separately from regular failures
   *  (per spec §6.1 point 1, dead-letter sub-bullet). */
  deadLettered?: boolean;
}

/**
 * Emit a Sentry signal for a queue event. Routes to `captureException` when
 * an `error` is set, otherwise `captureMessage`.
 *
 * @example
 *   // Job-type handler threw a transient error
 *   emitQueueSentry({
 *     stage: 'handler',
 *     job: { job_id, job_type, attempts, max_attempts },
 *     authContext,
 *     error: err,
 *     level: 'warning',  // transient → warning per §5.1
 *   });
 *
 * @example
 *   // Visibility-timeout reaper rescued a stuck job
 *   emitQueueSentry({
 *     stage: 'visibility_timeout',
 *     job: { job_id, job_type, attempts },
 *   });
 *   // → captureMessage('queue.visibility_timeout', { level: 'warning', ... })
 */
export function emitQueueSentry(args: EmitQueueSentryArgs): void {
  const tags: Record<string, string> = {
    queue: 'processing_queue',
    stage: args.stage,
    ...(args.job ? { job_type: args.job.job_type } : {}),
    ...(args.deadLettered ? { dead_lettered: 'true' } : {}),
  };
  const extra: Record<string, unknown> = {
    ...(args.job ? { job: args.job } : {}),
    ...(args.authContext ? { auth_context: args.authContext } : {}),
  };

  if (args.error !== undefined) {
    Sentry.captureException(args.error, {
      tags,
      extra,
      level: args.level ?? 'error',
    });
  } else {
    Sentry.captureMessage(`queue.${args.stage}`, {
      tags,
      extra,
      level: args.level ?? 'warning',
    });
  }
}

// ---------------------------------------------------------------------------
// PostHog helper (stub-via-Sentry-breadcrumb until client is wired)
// ---------------------------------------------------------------------------

/**
 * The four terminal-state event names from spec §6.2. MUST stay verbatim —
 * dashboard queries and any future `posthog.capture(...)` swap depend on
 * the exact strings.
 */
export type QueueAnalyticsEvent =
  | 'queue_job_completed'
  | 'queue_job_failed'
  | 'queue_job_dead_lettered'
  | 'queue_job_cancelled';

/**
 * Arguments for `emitQueueAnalytics`. The required fields per event vary —
 * see spec §6.2 lines 909-914 — but the helper accepts a single
 * superset-shaped args object and writes only the fields that are set.
 */
/** @public */
export interface EmitQueueAnalyticsArgs {
  /** The terminal-state event being reported. */
  event: QueueAnalyticsEvent;
  /** Job context (always required). `attempts` is rendered as the spec's
   *  `attempts` (or `total_attempts` for dead_lettered) property. */
  job: QueueJobRef;
  /** Wall-clock duration from claim to terminal state. Required for
   *  `queue_job_completed` + `queue_job_failed` (per spec §6.2). */
  durationMs?: number;
  /** Required for `queue_job_failed` (per spec §6.2): classifies the
   *  failure as transient (retryable) or permanent (no-retry). */
  errorClass?: 'transient' | 'permanent';
  /** Required for `queue_job_cancelled` (per spec §6.2): time from
   *  enqueue to cancellation. */
  cancelledAfterMs?: number;
}

/**
 * Emit a PostHog terminal-state event for a queue job.
 *
 * **Implementation note:** No PostHog client is wired in this codebase yet.
 * The helper writes the event payload as a Sentry breadcrumb (category
 * `queue.analytics`) so the call is observable in production via the next
 * Sentry capture, and tests can spy on `Sentry.addBreadcrumb`. When PostHog
 * is wired (out of W1 scope), swap the breadcrumb call for
 * `posthog.capture(args.event, properties)` without changing the public
 * signature.
 *
 * Property naming follows spec §6.2 exactly:
 *   - `job_type`            — JobType union value
 *   - `duration_ms`         — wall-clock ms
 *   - `attempts`            — completed/failed attempt count
 *   - `success: true`       — completed only
 *   - `error_class`         — failed only ('transient' | 'permanent')
 *   - `cancelled_after_ms`  — cancelled only
 *
 * @example
 *   emitQueueAnalytics({
 *     event: 'queue_job_completed',
 *     job: { job_id, job_type, attempts },
 *     durationMs: 1234,
 *   });
 */
export function emitQueueAnalytics(args: EmitQueueAnalyticsArgs): void {
  // Build the property bag in the snake_case shape PostHog will receive.
  // Conditional spreads keep absent fields out of the payload entirely so
  // dashboards filter on presence vs absence cleanly.
  const properties: Record<string, unknown> = {
    event: args.event,
    job_type: args.job.job_type,
    job_id: args.job.job_id,
    ...(args.job.attempts !== undefined ? { attempts: args.job.attempts } : {}),
    ...(args.job.max_attempts !== undefined
      ? { max_attempts: args.job.max_attempts }
      : {}),
    ...(args.durationMs !== undefined ? { duration_ms: args.durationMs } : {}),
    ...(args.errorClass ? { error_class: args.errorClass } : {}),
    ...(args.cancelledAfterMs !== undefined
      ? { cancelled_after_ms: args.cancelledAfterMs }
      : {}),
    ...(args.event === 'queue_job_completed' ? { success: true } : {}),
  };

  // Stub fallback: write a Sentry breadcrumb. When the next exception
  // captures, the breadcrumb timeline will include this event so the
  // call is observable end-to-end. Tests assert on this shape.
  Sentry.addBreadcrumb({
    category: 'queue.analytics',
    message: args.event,
    level: 'info',
    data: properties,
  });
}

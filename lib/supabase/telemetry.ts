// lib/supabase/telemetry.ts
import * as Sentry from '@sentry/nextjs';
import { logger } from '@/lib/logger/client';

/**
 * Log a best-effort warning from an API route.
 *
 * This is the ONLY sanctioned way to swallow a non-fatal error in a route
 * handler. It writes a structured `logger.warn` (via the client-safe shim
 * — usable from both client and server bundles) for local development
 * visibility AND emits a Sentry breadcrumb so the swallow is observable
 * in production.
 *
 * **Category naming convention (JSDoc-only, not enforced at runtime).**
 * Use lowercase dot-delimited paths matching `/^[a-z]+(\.[a-z]+)+$/`. The
 * convention is `<domain>.<entity>.<action>`, e.g. `items.owner.notify`,
 * `governance.review.trigger`, `bids.session.cleanup`. Two or more
 * dot-delimited segments are required so Sentry grouping is meaningful.
 * The convention is documented here only — there is **no runtime
 * assertion** on `category`. Reviewers should reject PRs that use
 * single-word or non-namespaced categories.
 *
 * @param category - short dot-delimited path identifying the swallow site,
 *   e.g. 'items.owner.notify' or 'governance.review.trigger'. Used for
 *   Sentry grouping and ops queries. See convention above.
 * @param message - human-readable description of what was swallowed.
 * @param context - additional structured data (entity ID, error code, etc.).
 *
 * @example
 *   try {
 *     await notifyOwner(userId, itemId);
 *   } catch (err) {
 *     logBestEffortWarn('items.owner.notify', 'Failed to notify new owner', {
 *       userId, itemId, error: err instanceof Error ? err.message : String(err),
 *     });
 *   }
 */
export function logBestEffortWarn(
  category: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  // This helper IS the sanctioned swallow path. The structured logger
  // routes via the client-safe shim so the call works in both client and
  // server bundles (importers include client components like
  // `components/shell/sign-out-button.tsx`).
  logger.warn({ ...(context ?? {}), category }, message);

  Sentry.addBreadcrumb({
    category,
    message,
    level: 'warning',
    data: context,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Variant for when a SupabaseError (or any error) needs to be swallowed.
 * Records the error code and message, and promotes to a Sentry captureMessage
 * if `severity === 'elevated'`.
 */
export function logSwallowedError(
  category: string,
  error: unknown,
  options: {
    message?: string;
    context?: Record<string, unknown>;
    severity?: 'normal' | 'elevated';
  } = {},
): void {
  const { message, context, severity = 'normal' } = options;
  const errMessage = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : undefined;

  const payload = { ...context, error: errMessage, code };

  // Sanctioned swallow path — see the note on `logBestEffortWarn` above.
  logger.warn({ ...payload, category }, message ?? 'Swallowed error');

  Sentry.addBreadcrumb({
    category,
    message: message ?? 'Swallowed error',
    level: 'warning',
    data: payload,
    timestamp: Date.now() / 1000,
  });

  if (severity === 'elevated') {
    Sentry.captureMessage(`${category}: ${message ?? errMessage}`, {
      level: 'warning',
      extra: payload,
    });
  }
}

// lib/client-telemetry.ts
//
// Client-side error capture helper for UI components. Wraps Sentry's
// captureException with a standard scope tag so dashboards can filter
// by component/action pair. Silent no-op if Sentry is not configured.

import * as Sentry from '@sentry/nextjs';

interface CaptureOptions {
  /** Dot-delimited scope tag, e.g. 'item-detail.content-body.updateStatus' */
  scope: string;
  /** Arbitrary extras — IDs, user input, anything that helps debugging. */
  extras?: Record<string, unknown>;
}

/**
 * Capture an error from a client component for Sentry + dev-time logging.
 *
 * Safe to call when Sentry is not initialised — it falls back silently.
 * In development mode, also emits a console.debug line so the error is
 * visible during local work.
 */
export function captureClientException(
  err: unknown,
  options: CaptureOptions,
): void {
  // Dev-time visibility — console.debug is intentional (not .error),
  // so it does not trip the no-console ESLint rule's error level.
  if (process.env.NODE_ENV === 'development') {
    console.debug(`[${options.scope}]`, err, options.extras ?? {});
  }

  try {
    Sentry.withScope((scope) => {
      scope.setTag('ui.scope', options.scope);
      if (options.extras) {
        for (const [key, value] of Object.entries(options.extras)) {
          scope.setExtra(key, value);
        }
      }
      Sentry.captureException(err);
    });
  } catch {
    // Sentry not initialised or misconfigured — silent fallback.
  }
}

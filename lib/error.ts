import * as Sentry from '@sentry/nextjs';

/**
 * Returns a safe error message for API responses.
 *
 * In development, includes the real error for debugging convenience. In
 * production, returns only the generic fallback message. The signature
 * is stable — 168 callers across `app/api/` and `lib/` rely on it.
 *
 * Phase 1 of structured-logging-spec.md (§4.5):
 *
 * - `safeErrorMessage` runs in BOTH client and server bundles (digest UI
 *   imports it, so do API routes). Therefore it CANNOT import the
 *   structured logger directly — `lib/logger/index.ts` pulls in pino +
 *   `node:async_hooks` which Turbopack cannot bundle for the browser.
 * - On the server, routes that want full structured logging should
 *   `import { logger } from '@/lib/logger'` inside their catch arm
 *   directly. Phase 2 of the spec migrates the high-volume routes to
 *   do exactly this.
 * - Here at the chokepoint, we capture the error to Sentry directly via
 *   the universal SDK (`@sentry/nextjs` exposes the same surface in
 *   client + server bundles). This preserves the previous "every error
 *   that flows through `safeErrorMessage` reaches Sentry" guarantee
 *   without bundling node-only modules into the browser.
 *
 * Spec §10 decision 1 ("logger.warn writes to Sentry — CONFIRMED") is
 * wired in `lib/logger/sentry-bridge.ts` for the server logger path.
 *
 * Return-string behaviour is unchanged: production gets the fallback,
 * development concatenates `${fallback}: ${err.message}` for `Error`
 * instances. The original spec test pinned this contract (see
 * `__tests__/lib/error.test.ts`).
 */
export function safeErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    Sentry.captureException(err, { extra: { fallback } });
  } else {
    Sentry.captureException(new Error(fallback), {
      extra: { fallback, cause: err },
    });
  }
  if (process.env.NODE_ENV === 'development' && err instanceof Error) {
    return `${fallback}: ${err.message}`;
  }
  return fallback;
}

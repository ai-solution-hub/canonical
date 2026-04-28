import { logger } from '@/lib/logger';

/**
 * Returns a safe error message for API responses.
 *
 * In development, includes the real error for debugging convenience. In
 * production, returns only the generic fallback message. The signature
 * is stable — 168 callers across `app/api/` and `lib/` rely on it.
 *
 * Phase 1 of structured-logging-spec.md (§4.5):
 *
 * - The previous `console.error` + dynamic Sentry import is replaced by
 *   `logger.error({ err }, fallback)`. The logger's wrapped `error` level
 *   forwards to Sentry automatically (see `lib/logger/sentry-bridge.ts`),
 *   so existing Sentry alerting still fires for every call.
 * - Logger output carries the per-request scope (`requestId` / `userId` /
 *   `route` / `method`) via the AsyncLocalStorage mixin in
 *   `lib/logger/index.ts` — Sentry events from inside this helper inherit
 *   the same scope as tags.
 * - Spec §10 decision 1 ("logger.warn writes to Sentry — CONFIRMED") is
 *   wired in the logger module, not here.
 *
 * Return-string behaviour is unchanged: production gets the fallback,
 * development concatenates `${fallback}: ${err.message}` for `Error`
 * instances. The original spec test pinned this contract (see
 * `__tests__/lib/error.test.ts`).
 */
export function safeErrorMessage(err: unknown, fallback: string): string {
  logger.error({ err }, fallback);
  if (process.env.NODE_ENV === 'development' && err instanceof Error) {
    return `${fallback}: ${err.message}`;
  }
  return fallback;
}

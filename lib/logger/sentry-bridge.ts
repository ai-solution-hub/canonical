/**
 * Sentry composition layer.
 *
 * Spec: docs/specs/structured-logging-spec.md §4.4 + §10 decision 1
 * (`logger.warn` → Sentry CONFIRMED).
 *
 * Two responsibilities:
 *
 * 1. `applyRequestContextToSentry()` mirrors the AsyncLocalStorage scope
 *    onto the current Sentry scope so any subsequent
 *    `Sentry.captureException` automatically inherits `requestId` /
 *    `route` / `userId` tags. Called once per request inside
 *    `withRequestContext()` (Phase 2 wiring) and pre-emptively from the
 *    `safeErrorMessage` shim so existing callers gain scope without code
 *    changes.
 *
 * 2. `captureForLevel()` — invoked by the root logger at `warn` / `error`
 *    / `fatal` levels — funnels the supplied error through
 *    `Sentry.captureException` with the request scope applied as tags +
 *    user. Anonymous traffic still gets the requestId tag.
 *
 * The bridge MUST be safe to call when Sentry is disabled (no DSN, dev
 * mode without observability env vars). It treats the SDK as
 * best-effort: any thrown error from inside Sentry is swallowed so a
 * logger call never breaks a request.
 */

import * as Sentry from '@sentry/nextjs';

import type { LogContext } from './types';
import { getRequestContext } from './request-context';

/** The pino levels at which we forward to Sentry per spec §10 decision 1. */
const SENTRY_FORWARD_LEVELS = new Set(['warn', 'error', 'fatal']);

/**
 * Mirror the current request context onto the Sentry scope. Idempotent
 * within a single request — calling it twice just overwrites the same
 * tags with the same values.
 */
export function applyRequestContextToSentry(): void {
  const ctx = getRequestContext();
  if (!ctx) return;
  try {
    const scope = Sentry.getCurrentScope();
    scope.setTag('requestId', ctx.requestId);
    scope.setTag('route', ctx.route);
    scope.setTag('method', ctx.method);
    if (ctx.userId) {
      scope.setUser({ id: ctx.userId });
    }
    if (ctx.userRole) {
      scope.setTag('userRole', ctx.userRole);
    }
  } catch {
    // Sentry SDK failure must never break the request.
  }
}

/**
 * Forward an error to Sentry from a logger call when the level is at or
 * above `warn`. The pino root logger's `error`/`warn`/`fatal` wrappers
 * call this directly; nothing else should.
 *
 * The first object argument to `logger.error({ err, ... }, msg)` is what
 * pino calls the "merging object" — `err` is the conventional key for
 * the throwable. We accept any of `err`/`error`/`exception` as
 * synonyms.
 *
 * No DSN gate: when `NEXT_PUBLIC_SENTRY_DSN` is unset the Sentry SDK
 * silently noops on `captureException`. The (small) call overhead is
 * acceptable in exchange for not coupling this hot path to env-var
 * parsing — same decoupling rationale as the OPS-38 harden of
 * `sentry.{client,server,edge}.config.ts`.
 */
export function captureForLevel(
  level: string,
  obj: LogContext | undefined,
  msg: string | undefined,
): void {
  if (!SENTRY_FORWARD_LEVELS.has(level)) return;
  applyRequestContextToSentry();
  try {
    const candidate = obj?.err ?? obj?.error ?? obj?.exception ?? undefined;
    const payload =
      candidate instanceof Error
        ? candidate
        : new Error(
            msg ?? (candidate ? safeStringify(candidate) : `logger.${level}`),
          );
    Sentry.captureException(payload, (scope) => {
      scope.setLevel(
        level === 'fatal' ? 'fatal' : level === 'warn' ? 'warning' : 'error',
      );
      if (obj && Object.keys(obj).length > 0) {
        scope.setContext('logger', sanitiseForSentry(obj));
      }
      return scope;
    });
  } catch {
    // Sentry SDK failure must never break the request.
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Strip non-cloneable fields (functions, classes, the raw err object)
 * from the context before handing to Sentry — `setContext` requires a
 * JSON-serialisable bag.
 */
function sanitiseForSentry(obj: LogContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'err' || k === 'error' || k === 'exception') continue;
    if (typeof v === 'function') continue;
    out[k] = v;
  }
  return out;
}

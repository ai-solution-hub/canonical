/**
 * Structured logging — client-safe shim.
 *
 * Spec: docs/specs/structured-logging-spec.md §4 (module layout) + §5 Phase 4.
 *
 * The root logger at `lib/logger/index.ts` is built on Pino + AsyncLocalStorage
 * + Sentry SDK — Node-only modules. Importing it from any file that gets
 * bundled into the browser/edge client breaks Turbopack (silently, prior to
 * the `'server-only'` marker added on `index.ts`; deterministically now).
 *
 * This shim exposes the same `(ctx, msg)` interface used by the server logger
 * so that consumers can swap entry points without changing call shape:
 *
 * ```ts
 * import { logger } from '@/lib/logger/client';
 * logger.error({ err }, 'Failed to load bids');
 * ```
 *
 * Implementation is a thin wrapper around `console.*`. Each method routes to
 * the matching console level so structured fields stay inspectable in browser
 * DevTools and Vercel CLI tail output.
 *
 * Design choices:
 * - **No Pino, no AsyncLocalStorage, no Sentry SDK, no `node:*`.** Every
 *   import here MUST stay safe in the client bundle. `LogContext` is a
 *   type-only import to avoid pulling runtime from `./types`.
 * - **No Sentry forwarding.** Browser-side errors are captured by
 *   `Sentry.init` in `instrumentation-client.ts`; we do not need a second
 *   path. Non-error console output is not interesting to Sentry anyway.
 * - **No request-context propagation.** AsyncLocalStorage is server-only.
 *   Browser logs do not need request correlation — each tab is its own
 *   "request" and the user agent already provides that scope.
 *
 * Use this entry point from:
 * - any file in `app/` that is `page.tsx`, `layout.tsx`, `error.tsx`,
 *   `loading.tsx`, `not-found.tsx`, or `template.tsx` (these get
 *   client-bundled by Next.js);
 * - any `lib/` module imported (transitively) by client-bundled code;
 * - shared utilities where the import graph is mixed runtime.
 *
 * Use `@/lib/logger` (the full Pino server logger) ONLY in route handlers
 * (`route.ts`) and server-only service modules.
 */

import type { LogContext } from './types';

interface ClientLogger {
  error(ctx: LogContext, msg: string): void;
  error(msg: string): void;
  warn(ctx: LogContext, msg: string): void;
  warn(msg: string): void;
  info(ctx: LogContext, msg: string): void;
  info(msg: string): void;
  debug(ctx: LogContext, msg: string): void;
  debug(msg: string): void;
}

/**
 * Resolve the structured args into a single `console.LEVEL` invocation.
 *
 * Pino-shape callers pass `(obj, msg)` — we forward as `console.LEVEL(msg, obj)`
 * so the human-readable message stays in front of the structured payload in
 * DevTools. Single-arg callers pass `(msg)` and we forward as-is.
 */
function emit(
  level: 'error' | 'warn' | 'info' | 'debug',
  ctxOrMsg: LogContext | string,
  msg?: string,
): void {
  // Use the matching console level so DevTools / Vercel CLI tail can
  // colour-code the output. This is the chokepoint — `console.*` here is
  // sanctioned because the entire purpose of the shim is to delegate to
  // `console`. When `no-console` lint becomes enforced, add a single
  // `// eslint-disable-next-line no-console` directive on the line below.
  const sink = console[level];
  if (typeof ctxOrMsg === 'string') {
    sink(ctxOrMsg);
    return;
  }
  // (ctx, msg) form
  sink(msg, ctxOrMsg);
}

export const logger: ClientLogger = {
  error(ctxOrMsg: LogContext | string, msg?: string): void {
    emit('error', ctxOrMsg, msg);
  },
  warn(ctxOrMsg: LogContext | string, msg?: string): void {
    emit('warn', ctxOrMsg, msg);
  },
  info(ctxOrMsg: LogContext | string, msg?: string): void {
    emit('info', ctxOrMsg, msg);
  },
  debug(ctxOrMsg: LogContext | string, msg?: string): void {
    emit('debug', ctxOrMsg, msg);
  },
};

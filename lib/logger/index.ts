/**
 * Structured logging — root logger.
 *
 * Spec: docs/specs/structured-logging-spec.md §3 (Pino, sync stdout) +
 * §4.1 (root config) + §10 (warn → Sentry confirmed).
 *
 * The exported `logger` is a singleton. Files import it directly:
 *
 * ```ts
 * import { logger } from '@/lib/logger';
 * logger.error({ err, op: 'embedding.generate' }, 'Embedding failed');
 * ```
 *
 * Per-request context (requestId/userId/route/method) is read from
 * AsyncLocalStorage via the pino `mixin` hook — callers do NOT pass it
 * explicitly. See `lib/logger/request-context.ts`.
 *
 * `warn`/`error`/`fatal` calls additionally forward to Sentry with the
 * request scope applied as tags. See `lib/logger/sentry-bridge.ts`.
 *
 * Phase 1 ships JSON to stdout only (Vercel captures it per invocation).
 * Phase 6 will wire Vercel Log Drain → Axiom for searchable retention.
 *
 * **Server-only.** Pino + AsyncLocalStorage + Sentry SDK are all Node
 * runtime modules — importing them into the client bundle breaks Turbopack.
 * The `import 'server-only'` directive on the next line forces the failure
 * to surface deterministically at build time rather than failing silently
 * (S17 hit this — see commit 29a659e3 for the revert). Files in client-
 * bundled paths (`app/**` page/layout/error/loading, `'use client'`
 * modules, anything they transitively import) MUST import from
 * `@/lib/logger/client` instead — that module is a console-backed shim
 * with the same `(ctx, msg)` interface and zero Node-only deps.
 */

import 'server-only';

import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';

import { getRequestContext } from './request-context';
import { captureForLevel } from './sentry-bridge';
import {
  serialiseError,
  serialiseRequest,
  serialiseResponse,
  REDACT_PATHS,
  REDACT_CENSOR,
} from './serialisers';
import type { LogContext } from './types';

// Re-export public API surface so `@/lib/logger` is the single entry.
export type { RequestContext } from './types';
export {
  getRequestContext,
  runWithRequestContext,
  updateRequestContext,
  withRequestContext,
  withRequestContextBare,
} from './request-context';
export { applyRequestContextToSentry } from './sentry-bridge';

const isDev = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Resolved log level. Order of precedence:
 *   1. Explicit `LOG_LEVEL` env var (any deployment can override).
 *   2. `silent` in tests so vitest output stays readable.
 *   3. `debug` in development for richer local feedback.
 *   4. `info` in production.
 */
function resolveLevel(): string {
  const explicit = process.env.LOG_LEVEL;
  if (explicit) return explicit;
  if (isTest) return 'silent';
  return isDev ? 'debug' : 'info';
}

/**
 * Pino options shared between the runtime singleton and any test
 * factory that wants to inspect the same configuration.
 */
function rootLoggerOptions(): LoggerOptions {
  return {
    level: resolveLevel(),
    base: { service: 'knowledge-hub' },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: serialiseError,
      error: serialiseError,
      exception: serialiseError,
      req: serialiseRequest,
      request: serialiseRequest,
      res: serialiseResponse,
      response: serialiseResponse,
    },
    redact: {
      paths: REDACT_PATHS,
      censor: REDACT_CENSOR,
    },
    mixin() {
      const ctx = getRequestContext();
      if (!ctx) return {};
      const out: Record<string, unknown> = {
        requestId: ctx.requestId,
        route: ctx.route,
        method: ctx.method,
      };
      if (ctx.userId) out.userId = ctx.userId;
      if (ctx.userRole) out.userRole = ctx.userRole;
      return out;
    },
    /**
     * Format the level as a string ("info") rather than the integer (30).
     * Vercel/Axiom dashboards filter on the string form by convention.
     */
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };
}

/**
 * Wrap a pino logger so warn/error/fatal additionally forward to Sentry.
 *
 * Pino does not expose a "level hook" out of the box; the cleanest way
 * to satisfy spec §10 decision 1 (`warn` → Sentry confirmed) without
 * monkey-patching internals is a thin proxy that keeps the original
 * pino API surface intact (`.child()`, `.bindings()`, `.flush()`, etc.)
 * and merely intercepts the three forwarding levels.
 */
function wrapWithSentry(base: PinoLogger): PinoLogger {
  const handler: ProxyHandler<PinoLogger> = {
    get(target, prop, receiver) {
      if (prop === 'warn' || prop === 'error' || prop === 'fatal') {
        const original = Reflect.get(target, prop, receiver) as (
          ...args: unknown[]
        ) => void;
        const level = prop;
        return function pinoWithSentry(
          this: unknown,
          ...args: unknown[]
        ): void {
          // pino accepts (obj, msg) | (msg) | (obj, msg, ...interpolation).
          let obj: LogContext | undefined;
          let msg: string | undefined;
          if (typeof args[0] === 'string') {
            msg = args[0];
          } else if (args[0] && typeof args[0] === 'object') {
            obj = args[0] as LogContext;
            if (typeof args[1] === 'string') msg = args[1];
          }
          captureForLevel(level, obj, msg);
          original.apply(target, args);
        };
      }
      if (prop === 'child') {
        const childFn = Reflect.get(
          target,
          prop,
          receiver,
        ) as PinoLogger['child'];
        return function child(
          this: unknown,
          ...args: Parameters<PinoLogger['child']>
        ) {
          const childLogger = childFn.apply(
            target,
            args,
          ) as unknown as PinoLogger;
          return wrapWithSentry(childLogger);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  };
  return new Proxy(base, handler);
}

/**
 * Internal factory — exported solely for tests that need to capture
 * pino output via a custom destination stream. Production code uses the
 * `logger` singleton below.
 */
export function createLogger(destination?: pino.DestinationStream): PinoLogger {
  const base = destination
    ? pino(rootLoggerOptions(), destination)
    : pino(rootLoggerOptions());
  return wrapWithSentry(base);
}

/**
 * The application-wide root logger. Sync writes to stdout; Vercel
 * captures stdout per invocation.
 */
export const logger: PinoLogger = createLogger();

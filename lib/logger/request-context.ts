/**
 * Per-request context propagation via Node's `AsyncLocalStorage`.
 *
 * Spec: docs/specs/structured-logging-spec.md §4.2 + §4.3.
 *
 * The store is established by `runWithRequestContext()` (or the
 * `withRequestContext()` route-wrapper helper) at the top of an API route
 * handler. AsyncLocalStorage propagates the value across awaits and into
 * any helper the handler calls, so `getRequestContext()` returns the same
 * object regardless of how deep in the call stack the caller lives.
 *
 * The Pino root logger reads from `getRequestContext()` via its `mixin`
 * hook so every log line automatically carries `requestId`/`userId`/
 * `userRole`/`route`/`method` without callers having to thread them.
 *
 * Phase 1 ships only the propagation primitives. Phase 2 will introduce
 * the `withRequestContext()` route wrapper that uses these helpers.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext } from './types';

/**
 * Module-level singleton — cross-request leakage is impossible because
 * AsyncLocalStorage is per-execution-context, not per-thread.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Returns the current request's context, or `undefined` if the calling
 * code is running outside a `runWithRequestContext()` scope (e.g. cold
 * start, top-level module init, batch scripts that have not yet entered
 * a context).
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Runs `fn` inside a fresh request-context scope. Helpers and route
 * handlers called from `fn` (synchronously or asynchronously) will see
 * `ctx` via `getRequestContext()`.
 *
 * Returns whatever `fn` returns — wrap an async handler and the awaited
 * result flows through unchanged.
 */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContextStorage.run(ctx, fn);
}

/**
 * Mutates the current request's context in place. Used by
 * `getAuthorisedClient()` (Phase 2 wiring) to attach `userId`/`userRole`
 * once auth resolves — anonymous traffic still has a request ID, this
 * just upgrades the scope when the user identity is known.
 *
 * No-op if called outside a request-context scope.
 */
export function updateRequestContext(
  patch: Partial<Omit<RequestContext, 'requestId' | 'startedAt'>>,
): void {
  const current = requestContextStorage.getStore();
  if (!current) return;
  if (patch.userId !== undefined) current.userId = patch.userId;
  if (patch.userRole !== undefined) current.userRole = patch.userRole;
  if (patch.route !== undefined) current.route = patch.route;
  if (patch.method !== undefined) current.method = patch.method;
}

/**
 * Convenience wrapper for route handlers — Phase 2 will replace direct
 * `runWithRequestContext()` calls in routes with this helper, which
 * additionally syncs the context onto the Sentry scope (see
 * `sentry-bridge.ts`).
 *
 * Phase 1 ships the primitive only; the surface is exported now so route
 * migrations in Phase 2 can wire to a stable name.
 */
export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return runWithRequestContext(ctx, fn);
}

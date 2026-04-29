/**
 * Per-request context propagation via Node's `AsyncLocalStorage`.
 *
 * Spec: docs/specs/structured-logging-spec.md §4.2 + §4.3 + §5 Phase 2.
 *
 * The store is established by `runWithRequestContext()` (or the
 * `withRequestContext()` decorator below) at the top of an API route
 * handler. AsyncLocalStorage propagates the value across awaits and into
 * any helper the handler calls, so `getRequestContext()` returns the same
 * object regardless of how deep in the call stack the caller lives.
 *
 * The Pino root logger reads from `getRequestContext()` via its `mixin`
 * hook so every log line automatically carries `requestId`/`userId`/
 * `userRole`/`route`/`method` without callers having to thread them.
 *
 * `withRequestContext()` is an overloaded function with two call shapes:
 *
 *   1. **Value-form** — `withRequestContext(ctx, fn)` runs `fn` inside the
 *      supplied `ctx`. Used by `proxy.ts` and other call sites that have
 *      already minted a context.
 *   2. **Decorator-form** — `withRequestContext(handler)` wraps a Next.js
 *      route handler so every call automatically reads / mints
 *      `x-request-id`, seeds the AsyncLocalStorage scope, mirrors the
 *      context onto the Sentry scope, and echoes `x-request-id` on the
 *      outbound response. Used by API routes:
 *
 *        export const POST = withRequestContext(async (request) => { ... });
 *
 * The two forms are distinguished at runtime by the second argument:
 * value-form passes a function, decorator-form passes nothing. TypeScript
 * picks the right overload at the call site so callers see precise
 * signatures for each shape — see the overload signatures below.
 *
 * Idiomatic precedents for this dual-shape pattern in TS land: React's
 * `useState` (initial-state vs lazy-initialiser), Next.js's `cookies()` /
 * `headers()` (sync vs awaited), Express middleware factories.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { NextRequest } from 'next/server';
import type { RequestContext } from './types';

// `applyRequestContextToSentry` lives in `./sentry-bridge`. Importing it
// inline at the top of the module is safe because `sentry-bridge` only
// imports `getRequestContext` from this file (no cycle on the function
// values used at runtime — only a type-level dependency).
import { applyRequestContextToSentry } from './sentry-bridge';

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

// ---------------------------------------------------------------------------
// Route-decorator infrastructure (Phase 2).
// ---------------------------------------------------------------------------

const REQUEST_ID_HEADER = 'x-request-id';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolve the per-request correlation id. Honour any well-formed UUID
 * supplied via `x-request-id` (proxy mints one for production traffic);
 * mint a fresh v4 otherwise so test scaffolding and out-of-band invocations
 * still carry a deterministic id.
 */
function resolveRequestId(request: NextRequest): string {
  const supplied = request.headers.get(REQUEST_ID_HEADER);
  if (supplied && UUID_RE.test(supplied)) return supplied.toLowerCase();
  return crypto.randomUUID();
}

/**
 * Echo `x-request-id` onto the outbound response. We mutate the supplied
 * response in place because `NextResponse.headers` is a writable
 * `Headers` instance and cloning the response on every call would lose
 * the original handler's body+status semantics.
 */
function echoRequestId(response: Response, requestId: string): Response {
  // Headers may already carry an `x-request-id` (e.g. when the handler
  // proxied a downstream response). We always overwrite with our own —
  // a single canonical id per request ingress.
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

/**
 * Internal core — single implementation that runs the handler inside a
 * request-context scope, applies the Sentry scope, and echoes the
 * `x-request-id` header on the response. The public surface uses
 * overloads to give each Next.js handler shape a precise signature.
 *
 * Sentry scope MUST be applied BEFORE the handler body executes so that
 * a handler which throws synchronously on its first line still produces
 * a Sentry event tagged with the requestId. See the ordering test in
 * `__tests__/lib/logger/request-context.test.ts`.
 */
function runHandler<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Response | Promise<Response>,
  args: TArgs,
): Promise<Response> {
  const request = args[0] as NextRequest | undefined;
  const requestId = request ? resolveRequestId(request) : crypto.randomUUID();

  const ctx: RequestContext = {
    requestId,
    route: request?.nextUrl?.pathname ?? 'unknown',
    method: request?.method ?? 'UNKNOWN',
    startedAt: Date.now(),
  };

  return runWithRequestContext(ctx, async () => {
    // Mirror the AsyncLocalStorage scope onto Sentry BEFORE invoking the
    // handler so any captureException() raised from inside — directly or
    // via the safeErrorMessage chokepoint, including a synchronous
    // throw on the very first line of the handler — inherits requestId/
    // route/method tags. Idempotent within the request scope.
    applyRequestContextToSentry();
    const response = await handler(...args);
    return echoRequestId(response, requestId);
  });
}

// ---------------------------------------------------------------------------
// withRequestContext — overloaded value-form + decorator-form.
// ---------------------------------------------------------------------------

// Overload 1 (value-form): `(ctx, fn)` → T. Runs `fn` inside the supplied
// context. Used by proxy.ts and other call sites with a pre-built ctx.
export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T;
// Overload 2 (decorator-form, simple): `(request) => Response`. Used by
// collection routes (`/api/items`, `/api/search`).
export function withRequestContext(
  handler: (request: NextRequest) => Response | Promise<Response>,
): (request: NextRequest) => Promise<Response>;
// Overload 3 (decorator-form, dynamic): `(request, { params }) => Response`.
// Used by dynamic-segment routes (`/api/items/[id]`).
export function withRequestContext<TParams>(
  handler: (
    request: NextRequest,
    ctx: { params: Promise<TParams> },
  ) => Response | Promise<Response>,
): (
  request: NextRequest,
  ctx: { params: Promise<TParams> },
) => Promise<Response>;
// Implementation signature — internal. Branches on the second argument:
// when `arg2` is a function, value-form (sync run); otherwise the first
// argument is a route handler, decorator-form.
export function withRequestContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arg1: RequestContext | ((...args: any[]) => unknown),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arg2?: () => any,
): unknown {
  // Value-form: second arg is the function-to-run.
  if (typeof arg2 === 'function') {
    const ctx = arg1 as RequestContext;
    return runWithRequestContext(ctx, arg2);
  }
  // Decorator-form: first arg is the handler, return a wrapped version.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = arg1 as (...args: any[]) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (...args: any[]) =>
    runHandler(
      handler as (...a: unknown[]) => Response | Promise<Response>,
      args,
    );
}

/**
 * Convenience helper for the bodyless-handler shape. Equivalent to a
 * dedicated `withRequestContext` overload for `() => Response`, but
 * exported separately so call sites such as
 * `app/api/freshness/recalculate-all` don't need an explicit empty-tuple
 * generic annotation. Internally synthesises a minimal request context
 * (route='unknown', method='UNKNOWN') because Next.js does not pass the
 * request object to bodyless handlers.
 */
export function withRequestContextBare(
  handler: () => Response | Promise<Response>,
): () => Promise<Response> {
  return () => runHandler(handler as (...args: unknown[]) => Response, []);
}

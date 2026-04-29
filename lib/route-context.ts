/**
 * Route-handler decorator for structured logging Phase 2.
 *
 * Spec: docs/specs/structured-logging-spec.md §4.3 + §5 Phase 2.
 *
 * Phase 1 (already shipped, in `lib/logger/`) ships the AsyncLocalStorage
 * primitive (`runWithRequestContext`), the proxy-side request-id minting
 * (`x-request-id`), the Sentry bridge, and a value-form helper
 * `withRequestContext(ctx, fn)`. Phase 2 introduces the route-decorator
 * form `withRequestContext(handler)` so each API route can wrap its
 * exported handler with one line:
 *
 *   export const POST = withRequestContext(async (request) => { ... });
 *
 * The decorator does four things, in order:
 *
 *   1. Read `x-request-id` from the inbound request headers (set by
 *      `proxy.ts`). Honour it when present and well-formed; mint a fresh
 *      v4 UUID otherwise (covers test-scaffolding paths that bypass
 *      the proxy and any direct invocations).
 *   2. Build a `RequestContext` from the request URL + method + the
 *      resolved request id, then enter `runWithRequestContext()` so all
 *      downstream `logger.*` calls automatically carry the scope.
 *   3. Mirror the context onto the Sentry scope via
 *      `applyRequestContextToSentry()` so any `Sentry.captureException`
 *      raised inside the handler — including the existing
 *      `safeErrorMessage()` chokepoint — inherits requestId / route /
 *      method tags.
 *   4. Echo `x-request-id` on the outbound response so the caller (or
 *      browser devtools, Vercel access logs, Axiom/Sentry searches) can
 *      correlate end-to-end.
 *
 * Why this lives outside `lib/logger/`:
 *
 *   `lib/logger/request-context.ts` already exports a
 *   `withRequestContext(ctx, fn)` value form consumed by `proxy.ts`. The
 *   route-decorator form takes a different argument shape (just the
 *   handler) and therefore cannot share the symbol without an overload-
 *   loaded API surface. Keeping the route wrapper as a sibling module
 *   avoids destabilising the Phase 1 chokepoint and keeps the lib/logger
 *   surface focused on the logger primitives.
 *
 * Sandbox-friendliness: the wrapper has zero static module-level work
 * beyond imports — no env reads, no Sentry init, no logger init. All
 * runtime work happens on the request hot path.
 */

import { NextRequest } from 'next/server';
import {
  runWithRequestContext,
  applyRequestContextToSentry,
} from '@/lib/logger';
import type { RequestContext } from '@/lib/logger';

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
    // Mirror the AsyncLocalStorage scope onto Sentry so any
    // captureException() called from inside the handler — directly or
    // via the safeErrorMessage chokepoint — inherits requestId/route/
    // method tags. Idempotent within the request scope.
    applyRequestContextToSentry();
    const response = await handler(...args);
    return echoRequestId(response, requestId);
  });
}

/**
 * Route-handler decorator. Wraps a Next.js App Router handler so every
 * log line, Sentry event, and outbound response carries the same
 * request-scoped correlation id.
 *
 * The decorator carries three overloads, one for each Next.js App Router
 * handler shape we ship today:
 *
 *  1. `(request: NextRequest) => Response | Promise<Response>` — POST/GET
 *     on collection routes (e.g. `/api/items`, `/api/search`).
 *  2. `(request: NextRequest, ctx: { params: Promise<P> }) => …` —
 *     dynamic-segment routes (e.g. `/api/items/[id]`).
 *  3. `() => Response | Promise<Response>` — bodyless handlers (e.g.
 *     `/api/freshness/recalculate-all`).
 *
 * TypeScript picks the right overload at the call site so the wrapped
 * export's signature is identical to the inner handler's — the handler
 * keeps its parameter types untouched.
 */
// Overload 1: simple (request) => Response
export function withRequestContext(
  handler: (request: NextRequest) => Response | Promise<Response>,
): (request: NextRequest) => Promise<Response>;
// Overload 2: dynamic-route (request, { params }) => Response
export function withRequestContext<TParams>(
  handler: (
    request: NextRequest,
    ctx: { params: Promise<TParams> },
  ) => Response | Promise<Response>,
): (
  request: NextRequest,
  ctx: { params: Promise<TParams> },
) => Promise<Response>;
// Implementation signature — internal. Accepts the union of the two
// overload shapes so TypeScript matches both. Uses `any[]` because the
// concrete Next.js handler shapes have different arities and TS cannot
// infer a single tuple shape that satisfies all overloads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withRequestContext(handler: (...args: any[]) => unknown) {
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

// Re-export the response helper so a route handler that wants to set
// additional headers on a redirect/streamed response can still keep the
// requestId echo by piping its result through `echoRequestId`. Not
// currently used by any of the 6 Phase 2 routes — exported for future
// streamed-response routes (Phase 3+).
export { echoRequestId as _attachRequestId };

// Surface the canonical header name so route bodies that want to read or
// write the header explicitly stay consistent with proxy.ts.
export { REQUEST_ID_HEADER };

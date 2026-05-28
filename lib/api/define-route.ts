/**
 * `defineRoute(ResponseSchema, handler)` — typed Zod-backed PASS-THROUGH
 * validator for Next.js App Router API route handlers (Option-4 contract).
 *
 * Spec:
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PRODUCT.md §8.0 — the
 *     behaviour invariants INV-PT (pass-through) and INV-FP (fail-open-prod /
 *     loud-dev+CI+test) this wrapper implements.
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/TECH.md §2.4a — the
 *     GOVERNING pass-through contract (supersedes the S11 payload-returning
 *     contract); §2.4a.2 the failure policy; §2.4a.3 the compile-time clause;
 *     §2.4a.4 the imports.
 *
 * Contract (per TECH §2.4a — the governing spec):
 *   The wrapper calls the handler, then BRANCHES on the return value:
 *
 *   (1) Handler returned a `Response`/`NextResponse` (the majority path —
 *       defect B4 proved ~178/195 corpus handlers return `NextResponse`
 *       inline). The wrapper is a TRANSPARENT pass-through:
 *         - VALIDATE the body ONLY when status is 2xx AND content-type starts
 *           `application/json` AND the cloned body parses as JSON. The body is
 *           read from `res.clone()`, never the original (so the stream the
 *           caller sends is never consumed — verified Next.js 16.2.6 / undici,
 *           TECH §12).
 *         - For everything else — non-2xx (401/500 error envelopes), 3xx
 *           redirects, 204/205/empty, non-JSON content-type, streaming
 *           (text/event-stream, ReadableStream) — pass the ORIGINAL response
 *           through UNCHANGED with NO clone-read and NO schema parse.
 *
 *   (2) Handler returned a raw (non-`Response`) payload (the minority path —
 *       naturally-conforming new code). Validate the payload, then
 *       `NextResponse.json(parsed.data)` on success. This keeps the wrapper
 *       POLYMORPHIC: both return styles are supported.
 *
 * Failure policy (INV-FP, TECH §2.4a.2 — Liam-confirmed). When a 2xx JSON body
 * (case 1) OR a raw payload (case 2) fails `schema.safeParse`:
 *   - LOUD (`NODE_ENV !== 'production'` OR `process.env.CI` set — dev, test,
 *     and CI): THROW `ResponseSchemaValidationError` so the drift is caught
 *     before it ships. This is the mock-proof net working.
 *   - FAIL-OPEN (production AND not CI): LOG the drift via the canonical
 *     `lib/logger`, then return the ORIGINAL unmodified response (case 1) or
 *     `NextResponse.json(payload)` (case 2). A drift defect must never take
 *     down a live endpoint.
 *
 * Compile-time contract (TECH §2.4a.3 — non-binding bonus): the handler's
 * return type is `Promise<Response | z.infer<S>>`. The `z.infer<S>` arm is a
 * FREE bonus for the handful of routes that genuinely return a raw payload; it
 * is NOT a guarantee forced on the ~178 `NextResponse`-returning routes.
 *
 * Auth-agnostic: this wrapper does NOT call `getAuthorisedClient`. The
 * downstream handler retains responsibility for auth/role gating using the
 * canonical pattern (`auth.success` check + `authFailureResponse(auth)`); those
 * 401/403 responses pass through unchanged under case (1).
 *
 * Method-agnostic: returns a `(request, ctx?) => Promise<Response>` that the
 * route file exports under any HTTP-method name (GET/POST/PATCH/DELETE/PUT/
 * HEAD/OPTIONS). The codemod assigns the wrapped value to the appropriate
 * `export const METHOD = ...` binding.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { z } from 'zod';

import { logger } from '@/lib/logger';

/**
 * The signature Next.js App Router calls for a route handler — a
 * `NextRequest` and an optional dynamic-segment context whose `params` is
 * a `Promise` (Next.js 15+ async params shape, used by ~78 of the 92
 * parameterised routes in the corpus per TECH §8.2).
 *
 * The context is `unknown`-typed at the wrapper boundary because dynamic
 * route params are per-route-specific; downstream handlers may narrow via
 * generics or runtime checks. The wrapper itself only forwards the value
 * unchanged.
 */
export type RouteHandlerContext = {
  params?: Promise<unknown>;
};

/**
 * The shape of a wrapped route export. Next.js calls this with the request
 * and (for dynamic routes) a context object; the wrapper returns the handler's
 * `Response` (pass-through) or a JSON-wrapped raw payload.
 */
export type WrappedRoute = (
  request: NextRequest,
  ctx?: RouteHandlerContext,
) => Promise<Response>;

/**
 * Thrown by the LOUD failure path (dev / test / CI) when a 2xx JSON response
 * body or a raw payload fails the response schema. Carries the route id and
 * the Zod issues so the failing test / CI run surfaces the drift precisely.
 *
 * In production (and not CI) this is NEVER thrown — the wrapper fails open
 * (logs + returns the original response) per INV-FP.
 */
export class ResponseSchemaValidationError extends Error {
  readonly route: string;
  readonly issues: z.ZodIssue[];

  constructor(route: string, issues: z.ZodIssue[]) {
    super(
      `response_schema_validation_failed: ${route} — ${issues.length} issue(s)`,
    );
    this.name = 'ResponseSchemaValidationError';
    this.route = route;
    this.issues = issues;
  }
}

/**
 * Resolve the LOUD-vs-fail-open environment split (INV-FP, TECH §2.4a.2).
 *
 * LOUD when `NODE_ENV !== 'production'` OR `process.env.CI` is set — this
 * covers dev, test, AND the spec-valid case where a CI runner sets
 * `NODE_ENV=production` + `CI=true` (that run must FAIL LOUD, not fail-open).
 * Fail-open (production) therefore fires ONLY when in production AND NOT in CI.
 *
 * Read fresh on every call (not module-load) so per-test `vi.stubEnv` flips
 * take effect — the env is process-global and the wrapper is long-lived.
 */
function isLoudEnvironment(): boolean {
  return process.env.NODE_ENV !== 'production' || !!process.env.CI;
}

/**
 * Best-effort route id for log/error context — the request pathname.
 *
 * Fully null-safe: route unit tests routinely invoke the wrapped export with
 * an undefined or partial request, and the route id is only ever used for a
 * log/error label — it must NEVER itself throw and mask the real flow.
 */
function routeIdFor(request: NextRequest | undefined): string {
  const url = request?.url;
  if (!url) return 'unknown';
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Whether a `Response` is a 2xx `application/json` response whose body should
 * be validated. Non-2xx, 3xx redirects, 204/205, non-JSON content-types, and
 * streaming bodies are all excluded — those pass through unchanged.
 */
function shouldValidateResponseBody(res: Response): boolean {
  if (res.status < 200 || res.status >= 300) return false; // non-2xx (incl. 3xx)
  if (res.status === 204 || res.status === 205) return false; // empty by spec
  const contentType = res.headers.get('content-type') ?? '';
  return contentType.toLowerCase().startsWith('application/json');
}

/**
 * Apply the INV-FP failure policy for a validation failure.
 *
 * @param route   The route id for log/error context.
 * @param issues  The Zod issues from the failed `safeParse`.
 * @param fallback A factory producing the response to return in the FAIL-OPEN
 *                 (production) branch — the original response (case 1) or
 *                 `NextResponse.json(payload)` (case 2).
 * @returns       The fail-open response (production only).
 * @throws        `ResponseSchemaValidationError` in LOUD environments.
 */
function handleValidationFailure(
  route: string,
  issues: z.ZodIssue[],
  fallback: () => Response,
): Response {
  if (isLoudEnvironment()) {
    // LOUD: surface the drift so it is caught before it ships. The route-unit
    // test / CI run fails — the mock-proof net working.
    throw new ResponseSchemaValidationError(route, issues);
  }
  // FAIL-OPEN (production, not CI): a drift defect must NEVER take down a live
  // endpoint. Log the drift, then return the unmodified response.
  logger.error(
    { route, issues },
    'response_schema_validation_failed (fail-open: returning original response)',
  );
  return fallback();
}

/**
 * Wrap a route handler with a Zod response schema (pass-through validator).
 *
 * @param schema  The Zod schema describing the handler's response payload.
 *                Compile-time: the handler may return `Response | z.infer<S>`.
 *                Runtime: 2xx JSON bodies / raw payloads validated via
 *                `safeParse()`.
 * @param handler The async route handler. May return a `Response`/`NextResponse`
 *                (passed through per INV-PT) or a raw `z.infer<S>` payload
 *                (validated + JSON-wrapped).
 * @returns       A Next.js-compatible route export.
 *
 * @example
 *   const ItemsResponse = z.object({ items: z.array(ItemSchema) });
 *   export const GET = defineRoute(ItemsResponse, async (request) => {
 *     const auth = await getAuthorisedClient(['admin', 'editor']);
 *     if (!auth.success) return authFailureResponse(auth); // → 401, passed through
 *     const items = await fetchItems(auth.supabase);
 *     return NextResponse.json({ items }); // → 200 JSON, validated
 *   });
 */
export function defineRoute<S extends z.ZodTypeAny>(
  schema: S,
  handler: (
    request: NextRequest,
    ctx?: RouteHandlerContext,
  ) => Promise<Response | z.infer<S>>,
): WrappedRoute {
  return async (
    request: NextRequest,
    ctx?: RouteHandlerContext,
  ): Promise<Response> => {
    const result = await handler(request, ctx);
    const route = routeIdFor(request);

    // ── Case 1: handler returned a Response/NextResponse (the majority path).
    if (result instanceof Response) {
      const response = result;

      // Pass through unchanged unless this is a 2xx application/json response.
      if (!shouldValidateResponseBody(response)) {
        return response;
      }

      // Read the body from a CLONE so the original stream is never consumed.
      let body: unknown;
      try {
        body = await response.clone().json();
      } catch {
        // Declared application/json but the body did not parse as JSON
        // (empty body, malformed stream). Be transparent — pass through.
        return response;
      }

      const parsed = schema.safeParse(body);
      if (parsed.success) {
        return response; // validated; original passed through unchanged
      }
      // Validation failed: LOUD → throw; fail-open → log + return original.
      return handleValidationFailure(
        route,
        parsed.error.issues,
        () => response,
      );
    }

    // ── Case 2: handler returned a raw (non-Response) payload.
    const parsed = schema.safeParse(result);
    if (parsed.success) {
      return NextResponse.json(parsed.data);
    }
    // Validation failed: LOUD → throw; fail-open → log + serialise the
    // original (un-validated) payload so the endpoint stays up.
    return handleValidationFailure(route, parsed.error.issues, () =>
      NextResponse.json(result),
    );
  };
}

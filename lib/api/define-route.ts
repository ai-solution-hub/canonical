/**
 * `defineRoute(ResponseSchema, handler)` — typed Zod-backed wrapper for
 * Next.js App Router API route handlers.
 *
 * Spec:
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md §1 (rationale —
 *     enforces structural symmetry between handler return payload and the
 *     client-side fetcher interface).
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §2.4 (the rewrite
 *     target; downstream Subtasks 32.10/32.11 rewrite handlers to call this).
 *   - docs/specs/silent-failure-prevention-spec.md (validation failures must
 *     fail fast — no silent fallthrough).
 *
 * Contract (per testStrategy on Subtask 32.5):
 *   (a) Returns a callable route export that invokes the handler with the
 *       (request, ctx) tuple Next.js passes to App Router handlers.
 *   (b) Runtime-validates the handler's return value against `ResponseSchema`
 *       via `schema.safeParse()`.
 *   (c) On validation failure returns a 500 envelope
 *       `{ error: 'response_schema_validation_failed', issues: [...] }`
 *       — never a silent 200.
 *
 * Compile-time contract: the handler's return type is constrained to
 * `z.infer<S>` so the type system rejects route authors who return a shape
 * that does not match the schema's inferred output.
 *
 * Auth-agnostic: this wrapper does NOT call `getAuthorisedClient`. The
 * downstream handler retains responsibility for auth/role gating using the
 * canonical pattern (`auth.success` check + `authFailureResponse(auth)`).
 *
 * Method-agnostic: returns a `(request, ctx?) => Promise<NextResponse>`
 * that the route file exports under any HTTP-method name (GET/POST/PATCH/
 * DELETE/PUT/HEAD/OPTIONS). The codemod assigns the wrapped value to the
 * appropriate `export const METHOD = ...` binding.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { z } from 'zod';

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
 * and (for dynamic routes) a context object; the wrapper returns a
 * `NextResponse` carrying either the validated payload (200) or the
 * validation-failure envelope (500).
 */
export type WrappedRoute = (
  request: NextRequest,
  ctx?: RouteHandlerContext,
) => Promise<NextResponse>;

/**
 * Wrap a route handler with a Zod response schema.
 *
 * @param schema  The Zod schema describing the handler's response payload.
 *                Compile-time: constrains the handler's return type to
 *                `z.infer<S>`. Runtime: validated via `safeParse()`.
 * @param handler The async route handler. Returns a payload of type
 *                `z.infer<S>` (the wrapper serialises it via
 *                `NextResponse.json()`).
 * @returns       A Next.js-compatible route export.
 *
 * @example
 *   const ItemsResponse = z.object({ items: z.array(ItemSchema) });
 *   export const GET = defineRoute(ItemsResponse, async (request) => {
 *     const auth = await getAuthorisedClient(['admin', 'editor']);
 *     if (!auth.success) return authFailureResponse(auth);
 *     const items = await fetchItems(auth.supabase);
 *     return { items };
 *   });
 */
export function defineRoute<S extends z.ZodTypeAny>(
  schema: S,
  handler: (
    request: NextRequest,
    ctx?: RouteHandlerContext,
  ) => Promise<z.infer<S>>,
): WrappedRoute {
  return async (
    request: NextRequest,
    ctx?: RouteHandlerContext,
  ): Promise<NextResponse> => {
    const payload = await handler(request, ctx);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      // Fail-fast per silent-failure-prevention-spec — never a silent 200
      // for a payload that violates the declared response contract.
      return NextResponse.json(
        {
          error: 'response_schema_validation_failed',
          issues: parsed.error.issues,
        },
        { status: 500 },
      );
    }
    return NextResponse.json(parsed.data);
  };
}

/**
 * Canonical API-request factory for Next.js route-handler tests.
 *
 * Replaces 3 copy-pasted `buildRequest()` definitions across
 * `__tests__/api/` per W-RG in `remediation-plan.md` §3.8 and the S37 audit
 * Agent A finding C6 (`agent-a-output.md` §C6 buildRequest cluster).
 *
 * The helper is a thin convenience wrapper over `createTestRequest()` in
 * `__tests__/helpers/mock-next.ts` — the canonical lower-level NextRequest
 * builder. We re-export it here so the `factories/` directory is the single
 * landing place for all API-request-shaped factories per the W-RG home-table
 * in remediation-plan.md §3.8.
 *
 * The `body` field is auto-JSON-serialised. For routes whose handlers parse
 * non-JSON bodies (FormData uploads), use
 * `__tests__/helpers/factories/file-upload.ts` instead.
 *
 * Pattern reference: `validCreateBody(overrides)` in
 * `__tests__/api/items.test.ts` and `createMockMcpServer(overrides)` in
 * `__tests__/helpers/mcp-server.ts` — Liam-preferred `Partial<T>` overrides
 * convention per Test Philosophy §1 #6.
 */
import type { NextRequest } from 'next/server';
import { createTestRequest } from '../mock-next';

/** Options accepted by `createMockApiRequest()`. */
export interface ApiRequestOptions {
  /**
   * Path on `http://localhost:3000`. Pass the route's own URL (e.g.
   * `/api/items/${itemId}/classify`). Required because every consumer
   * pre-S44 hard-coded its own path.
   */
  path: string;
  /** HTTP method. Defaults to `POST` (the common case for write routes). */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /**
   * Request body. Auto-JSON-serialised. Omit for GET / HEAD or for routes
   * that test the "body absent" path explicitly.
   */
  body?: Record<string, unknown> | unknown[] | string;
  /** URL searchParams to set on the request. */
  searchParams?: Record<string, string>;
  /** Extra headers — `content-type` is auto-set when `body` is present. */
  headers?: Record<string, string>;
}

/**
 * Build a `NextRequest` for an API-route-handler test.
 *
 * @param overrides Options — `path` is required. Other fields fall back to
 *                  sensible defaults: `POST`, JSON body, no searchParams.
 *
 * @example POST with JSON body
 * ```ts
 * const req = createMockApiRequest({
 *   path: '/api/items/123/classify',
 *   body: { force: true },
 * });
 * ```
 *
 * @example GET with query params
 * ```ts
 * const req = createMockApiRequest({
 *   path: '/api/search',
 *   method: 'GET',
 *   searchParams: { q: 'foo' },
 * });
 * ```
 *
 * @example POST with no body (auth-failure path test)
 * ```ts
 * const req = createMockApiRequest({ path: '/api/admin/batch-reclassify' });
 * expect((await POST(req)).status).toBe(401);
 * ```
 */
export function createMockApiRequest(
  overrides: ApiRequestOptions,
): NextRequest {
  const { path, method = 'POST', body, searchParams, headers } = overrides;

  return createTestRequest(path, {
    method,
    body,
    searchParams,
    headers,
  });
}

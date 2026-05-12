/**
 * Canonical cron-request builder for cron-route tests.
 *
 * Replaces 6 copy-pasted `createCronRequest()` definitions across
 * `__tests__/api/cron/` and `__tests__/api/freshness-transitions-cron.test.ts`.
 * Per W-RG in `remediation-plan.md` §3.8 and the S37 audit Agent A finding
 * C6 (`agent-a-output.md` §C6 cron-request cluster).
 *
 * Cron routes accept a `GET` with `Authorization: Bearer <cron-secret>`. The
 * helper keeps the secret and path overridable so each cron suite can pin to
 * its own route URL; the body field exists for future cron routes that
 * accept a `POST` payload (none today, but the signature is forward-compatible).
 *
 * Pattern reference: `validCreateBody(overrides)` in
 * `__tests__/api/items.test.ts` and `createMockMcpServer(overrides)` in
 * `__tests__/helpers/mcp-server.ts` — Liam-preferred `Partial<T>` overrides
 * convention per Test Philosophy §1 #6.
 */

/** Default cron secret used across cron-route tests. */
const DEFAULT_CRON_SECRET = 'test-cron-secret';

/** Default cron route — only used when the caller omits `path`. */
const DEFAULT_CRON_PATH = '/api/cron/test';

/** Options accepted by `createMockCronRequest()`. */
export interface CronRequestOptions {
  /**
   * Path on `http://localhost:3000`. Most cron suites pass the cron
   * route's own path (e.g. `/api/cron/quality-score`).
   */
  path?: string;
  /**
   * Bearer secret. Defaults to `test-cron-secret`. Pass a wrong value to
   * verify the auth-failure path.
   */
  secret?: string;
  /** HTTP method. Defaults to `GET` — every cron route uses GET today. */
  method?: 'GET' | 'POST';
  /**
   * Optional body. If provided as a string, sent as-is; if an object,
   * JSON-serialised. Forward-compatible — no current cron route uses this.
   */
  body?: string | Record<string, unknown>;
  /** Extra headers (e.g. `x-request-id`, `x-test-fixture`). */
  headers?: Record<string, string>;
}

/**
 * Build a `Request` shaped like a Vercel cron invocation.
 *
 * @param overrides Partial overrides — `path` is typically the only one
 *                  callers need to set; `secret`, `method`, and `body` exist
 *                  for the rare cron route that needs them.
 *
 * @example Basic cron request (per-route path)
 * ```ts
 * const res = await GET(createMockCronRequest({ path: '/api/cron/quality-score' }) as never);
 * ```
 *
 * @example Forged or missing-secret negative test
 * ```ts
 * const res = await GET(createMockCronRequest({ secret: 'wrong-secret' }) as never);
 * expect(res.status).toBe(401);
 * ```
 */
export function createMockCronRequest(
  overrides: CronRequestOptions = {},
): Request {
  const {
    path = DEFAULT_CRON_PATH,
    secret = DEFAULT_CRON_SECRET,
    method = 'GET',
    body,
    headers: extraHeaders,
  } = overrides;

  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
    ...extraHeaders,
  };

  return new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    ...(body !== undefined
      ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
      : {}),
  });
}

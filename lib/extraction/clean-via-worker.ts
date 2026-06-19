/**
 * cleanViaWorker — server-side seam onto the B1 `/extract` pure-cleaner
 * endpoint (Task ID-112 {112.10}, PI-1 / PI-2 / PI-9).
 *
 * The manual URL-import route keeps its OWN SSRF-gated fetch (the Vercel route's
 * `validateUrl` is the SSRF surface). `/extract` is a PURE CLEANER — it does NOT
 * fetch and has no SSRF surface on B1; the caller hands it the already-fetched
 * HTML bytes and it returns the same in-house Trafilatura clean the cocoindex
 * worker runs in-process.
 *
 * Contract (scripts/cocoindex_pipeline/server.py::_extract_handler, landed in
 * {112.6}):
 *   - POST `${COCOINDEX_WORKER_URL}/extract?url=<encoded finalUrl>`
 *     (the `url` query param is OPTIONAL — it feeds Trafilatura's link/metadata
 *     resolution; it is NOT fetched server-side).
 *   - `Authorization: Bearer ${EXTRACT_API_TOKEN}` — the DEDICATED token
 *     ({112.6}), a different blast radius from `CRON_SECRET`.
 *   - request body: the raw HTML to clean (the handler reads the body as text).
 *   - 200 response body: `{ text, verdict, warnings }` where `verdict` is one of
 *     `'reject' | 'warn' | 'ok'` and `warnings` is always an array.
 *
 * A REJECT verdict (content too short) is a 200 SUCCESS carrying that verdict —
 * NOT an HTTP error. The route maps REJECT → 422 downstream; the SOFT-COUPLE
 * outage (unreachable endpoint / non-2xx / unset config) is a distinct
 * `ExtractEndpointError` the route maps to a recoverable 503 (never a 500, and
 * never an in-process Readability fallback — a fallback would keep
 * @mozilla/readability alive past the {112.13} deletion).
 */

/** Fetch timeout for the /extract call: 30 seconds (a clean is CPU-bound). */
const EXTRACT_TIMEOUT_MS = 30_000;

/** The verdict the B1 quality gate returns (mirrors extract.py::GateVerdict). */
export type ExtractVerdict = 'reject' | 'warn' | 'ok';

/** The shape the `/extract` endpoint returns on a 200. */
export interface ExtractResult {
  text: string;
  verdict: ExtractVerdict;
  warnings: string[];
}

/**
 * Thrown when the `/extract` endpoint is unreachable, returns a non-2xx, or its
 * configuration (`COCOINDEX_WORKER_URL` / `EXTRACT_API_TOKEN`) is unset. The
 * manual route maps this to a recoverable HTTP 503 — an outage, distinct from a
 * successful REJECT verdict (422) — so the caller is told to retry shortly. NOT
 * a generic 500: the endpoint being down is operationally recoverable.
 */
export class ExtractEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractEndpointError';
  }
}

/**
 * Resolve the worker base URL + dedicated extract token, or throw a typed
 * outage error. Mirrors `folder-drop.ts::resolveWorkerConfig` — a missing
 * config value is a loud, recoverable outage, never a silent skip.
 */
function resolveExtractConfig(): { workerUrl: string; token: string } {
  const workerUrl = process.env.COCOINDEX_WORKER_URL;
  if (!workerUrl) {
    throw new ExtractEndpointError(
      'COCOINDEX_WORKER_URL is unset — /extract cleaner is unavailable',
    );
  }
  const token = process.env.EXTRACT_API_TOKEN;
  if (!token) {
    throw new ExtractEndpointError(
      'EXTRACT_API_TOKEN is unset — /extract auth is unavailable',
    );
  }
  // Trim a single trailing slash so `${workerUrl}/extract` never doubles up.
  return { workerUrl: workerUrl.replace(/\/$/, ''), token };
}

/**
 * Clean already-fetched HTML via the B1 `/extract` pure-cleaner endpoint.
 *
 * @param html - the raw HTML body the caller already fetched (SSRF-gated by the
 *   caller). Sent verbatim as the request body.
 * @param finalUrl - the post-redirect document URL; passed as the optional
 *   `?url=` query param for Trafilatura link/metadata resolution (NOT fetched
 *   by B1).
 * @returns the parsed `{ text, verdict, warnings }` from the endpoint.
 * @throws {ExtractEndpointError} on unset config, unreachable endpoint, or a
 *   non-2xx response — the caller maps this to a recoverable 503.
 */
export async function cleanViaWorker(
  html: string,
  finalUrl: string,
): Promise<ExtractResult> {
  const { workerUrl, token } = resolveExtractConfig();
  const endpoint = `${workerUrl}/extract?url=${encodeURIComponent(finalUrl)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/html; charset=utf-8',
      },
      body: html,
    });
  } catch (err) {
    // Network-level failure (connection refused, DNS, timeout/abort): the
    // endpoint is unreachable — a recoverable outage, not a 500.
    const reason = err instanceof Error ? err.message : 'unknown error';
    throw new ExtractEndpointError(`/extract endpoint unreachable: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    // Any non-2xx from B1 (401 auth, 413 over-cap, 429 rate-limit, 5xx) is an
    // outage from the route's perspective — recoverable, retry shortly.
    throw new ExtractEndpointError(
      `/extract returned non-2xx status ${response.status}`,
    );
  }

  const parsed = (await response.json()) as ExtractResult;
  return {
    text: parsed.text,
    verdict: parsed.verdict,
    warnings: parsed.warnings ?? [],
  };
}

// lib/intelligence/url-validation.ts
//
// Leaf module for web URL validation. Extracted from
// `lib/intelligence/feed-poller.ts` so it can be imported by
// `lib/validation/schemas.ts` without dragging in rss-parser /
// firecrawl dependencies (S222 W3-A §2.3.4 D-4).
//
// Used by:
// - `pollWebSource()` (feed-poller.ts) — pre-flight validation at poll
//   time (existing behaviour).
// - `FeedSourceCreateSchema` (validation/schemas.ts) — pre-insert
//   refinement (D-4 ratified).

import { FEED_FETCH_TIMEOUT_MS } from './types';

const USER_AGENT =
  'KnowledgeHub/1.0 (+https://knowledge-hub-seven-kappa.vercel.app)';

/** Accepted HTML content types for web source validation */
const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];

/**
 * Validate that a URL returns an HTML page suitable for web source scraping.
 * Prefers HEAD for cheapness; falls back to ranged GET when the server rejects HEAD.
 * Throws a descriptive error on any failure (non-200, non-HTML, empty body).
 */
export async function validateWebUrl(url: string): Promise<void> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });

    // Some servers reject HEAD with 405, 501 (Not Implemented), or 403
    // (Forbidden for HEAD but serve GET correctly) — fall back to ranged GET
    if ([405, 501, 403].includes(response.status)) {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Range: 'bytes=0-1023',
        },
        signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
        redirect: 'follow',
      });
    }
  } catch (err) {
    throw new Error(
      `Web URL validation failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Accept 200 and 206 (partial content from Range header)
  if (!response.ok && response.status !== 206) {
    throw new Error(
      `Web URL validation failed for ${url}: HTTP ${response.status}`,
    );
  }

  const contentType = (
    response.headers.get('content-type') ?? ''
  ).toLowerCase();
  const isHtml = HTML_CONTENT_TYPES.some((ct) => contentType.startsWith(ct));
  if (!isHtml) {
    throw new Error(
      `Web URL validation failed for ${url}: expected HTML content-type but got '${contentType}'`,
    );
  }

  // M-3: Defence-in-depth — reject explicitly empty responses.
  // Only check when Content-Length header is present (streaming responses
  // omit it, so absence is NOT a rejection signal).
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && contentLength === '0') {
    throw new Error(
      `Web URL validation failed for ${url}: Content-Length is 0 (empty body)`,
    );
  }
}

export { USER_AGENT, HTML_CONTENT_TYPES };

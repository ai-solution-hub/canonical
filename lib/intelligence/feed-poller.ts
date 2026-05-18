// lib/intelligence/feed-poller.ts
import Parser from 'rss-parser';
import * as Sentry from '@sentry/nextjs';
import type { ParsedFeedItem, PollResult } from './types';
import { FEED_FETCH_TIMEOUT_MS } from './types';
import { RateLimitError, getGlobalRateLimiter } from './rate-limiter';
import { validateWebUrl, USER_AGENT } from './url-validation';

// Re-export validateWebUrl for backwards compatibility — original
// implementation now lives in lib/intelligence/url-validation.ts (leaf
// module, importable by lib/validation/schemas.ts without circular deps).
// S222 W3-A §2.3.4 D-4.
export { validateWebUrl };

/**
 * Normalise a feed title by collapsing whitespace (newlines, tabs, multiple
 * spaces) to single spaces and trimming. Some publishers (e.g. Diocese of
 * Portsmouth) emit titles with literal `\n` characters that break downstream
 * rendering. Exported for unit testing.
 */
export function normaliseFeedTitle(title: string | null | undefined): string {
  if (!title) return '';
  return title.replace(/\s+/g, ' ').trim();
}

const parser = new Parser({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'creator'],
    ],
  },
});

interface FeedSourceRef {
  id: string;
  url: string;
  etag: string | null;
  last_modified: string | null;
}

/** Extract Atom category terms from raw XML for a given entry (rss-parser doesn't parse these) */
function extractAtomCategories(xml: string): Map<string, string[]> {
  const categories = new Map<string, string[]>();
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let entryMatch;
  while ((entryMatch = entryRegex.exec(xml)) !== null) {
    const entryContent = entryMatch[1];
    const idMatch = entryContent.match(/<id[^>]*>([^<]+)<\/id>/i);
    if (idMatch) {
      const id = idMatch[1].trim();
      const cats: string[] = [];
      const catRegex = /<category[^>]*term="([^"]+)"/gi;
      let catMatch;
      while ((catMatch = catRegex.exec(entryContent)) !== null) {
        cats.push(catMatch[1]);
      }
      if (cats.length > 0) {
        categories.set(id, cats);
      }
    }
  }
  return categories;
}

/** Parse raw XML/Atom into normalised feed items */
export async function parseFeedItems(xml: string): Promise<ParsedFeedItem[]> {
  const feed = await parser.parseString(xml);
  // Pre-extract Atom categories since rss-parser doesn't handle <category term="..."/>
  const atomCategories = extractAtomCategories(xml);
  return (feed.items ?? []).map((item) => {
    const rawItem = item as unknown as Record<string, unknown>;
    const itemId = item.guid ?? (rawItem.id as string) ?? '';
    const rssCategories = item.categories ?? [];
    const atomCats = atomCategories.get(itemId) ?? [];
    const allCategories = [...new Set([...rssCategories, ...atomCats])];
    return {
      title: normaliseFeedTitle(item.title) || 'Untitled',
      url: item.link ?? '',
      guid: item.guid ?? (rawItem.id as string) ?? null,
      publishedAt: item.isoDate ?? null,
      summary: item.contentSnippet ?? item.summary ?? null,
      contentEncoded: (rawItem.contentEncoded as string | null) ?? null,
      categories: allCategories,
    };
  });
}

/** Validation result for a feed URL */
/** @public */
export interface FeedValidationResult {
  valid: boolean;
  title?: string;
  articleCount?: number;
  error?: string;
}

/** Validate a URL is a working RSS/Atom feed before adding as a source */
export async function validateFeedUrl(
  url: string,
): Promise<FeedValidationResult> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'application/atom+xml, application/rss+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        valid: false,
        error: `URL returned HTTP ${response.status}`,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const xml = await response.text();

    // Quick check: does the content look like XML/RSS/Atom?
    const trimmed = xml.trimStart();
    const looksLikeXml =
      trimmed.startsWith('<?xml') ||
      trimmed.startsWith('<rss') ||
      trimmed.startsWith('<feed') ||
      contentType.includes('xml') ||
      contentType.includes('rss') ||
      contentType.includes('atom');

    if (!looksLikeXml) {
      return {
        valid: false,
        error: 'URL does not return RSS or Atom content',
      };
    }

    // Try to parse as a feed
    try {
      const feed = await parser.parseString(xml);
      return {
        valid: true,
        title: feed.title ? normaliseFeedTitle(feed.title) : undefined,
        articleCount: feed.items?.length ?? 0,
      };
    } catch {
      return {
        valid: false,
        error:
          'URL returned XML but it could not be parsed as an RSS or Atom feed',
      };
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        valid: false,
        error: 'Feed URL timed out',
      };
    }
    return {
      valid: false,
      error: `Failed to fetch URL: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Poll a single feed source with conditional request support */
export async function pollFeed(source: FeedSourceRef): Promise<PollResult> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept:
      'application/atom+xml, application/rss+xml, application/xml, text/xml',
  };

  if (source.etag) {
    headers['If-None-Match'] = source.etag;
  }
  if (source.last_modified) {
    headers['If-Modified-Since'] = source.last_modified;
  }

  try {
    // Wait for per-domain rate limit before fetching
    const rateLimiter = getGlobalRateLimiter();
    await rateLimiter.waitForDomain(source.url);

    const response = await fetch(source.url, {
      headers,
      signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
    });

    if (response.status === 304) {
      rateLimiter.recordSuccess(source.url);
      return {
        feedSourceId: source.id,
        status: 'not_modified',
        items: [],
        etag: source.etag,
        lastModified: source.last_modified,
      };
    }

    if (response.status === 429) {
      // Parse Retry-After header if present (seconds)
      const retryAfter = response.headers.get('Retry-After');
      const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 0;
      rateLimiter.recordRateLimit(source.url);
      throw new RateLimitError(
        new URL(source.url).hostname,
        retryAfterMs ||
          rateLimiter.getRequiredDelay(
            new URL(source.url).hostname.toLowerCase(),
          ),
      );
    }

    if (!response.ok) {
      return {
        feedSourceId: source.id,
        status: 'error',
        error: `HTTP ${response.status}`,
        items: [],
        etag: null,
        lastModified: null,
      };
    }

    const xml = await response.text();
    const items = await parseFeedItems(xml);

    rateLimiter.recordSuccess(source.url);

    return {
      feedSourceId: source.id,
      status: 'success',
      items,
      etag: response.headers.get('ETag') ?? null,
      lastModified: response.headers.get('Last-Modified') ?? null,
    };
  } catch (err) {
    // Re-throw RateLimitError so the pipeline can record it distinctly
    if (err instanceof RateLimitError) {
      throw err;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        feedSourceId: source.id,
        status: 'timeout',
        error: 'Feed fetch timed out',
        items: [],
        etag: null,
        lastModified: null,
      };
    }
    return {
      feedSourceId: source.id,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      items: [],
      etag: null,
      lastModified: null,
    };
  }
}

// ── Web source polling (P0-WEB / §2.3.4) ──

/**
 * Web source reference — subset of FeedSource from pipeline.ts.
 * Kept minimal to avoid importing the full pipeline module.
 *
 * S222 W3-A §2.3.4: `etag`/`last_modified` added so HEAD pre-flight can
 * issue conditional-GET headers (parity with `pollFeed` lines 170-175).
 */
interface WebSourceRef {
  id: string;
  url: string;
  name?: string;
  etag?: string | null;
  last_modified?: string | null;
}

/**
 * Web-source poll options. `dryRun` is set by the test endpoint to suppress
 * any side-effect bookkeeping (none today, but the contract is explicit
 * for AC-10 — admin-initiated test must not affect `consecutive_failures`).
 *
 * Note: `pollWebSource` itself never writes to `feed_sources`; that is the
 * caller's responsibility (`processFeedSource` in pipeline.ts). The
 * `dryRun` flag is a forward-compatibility hint — today it's a no-op
 * inside this function, but downstream telemetry sinks (cron handler vs
 * test endpoint) read it to decide whether to count the credit toward
 * the operator-visible quota.
 */
/** @public */
export interface PollWebSourceOptions {
  dryRun?: boolean;
}

/**
 * Result envelope for `pollWebSource` — includes the standard `PollResult`
 * plus telemetry fields needed for the test endpoint (AC-10) and future
 * `pipeline_runs.result.firecrawl_credits_consumed` aggregation (AC-12).
 */
/** @public */
export interface WebPollResult extends PollResult {
  /** HTTP status of the HEAD pre-flight; null if HEAD was not issued
   *  (e.g. because validateWebUrl already failed). */
  headPreflightStatus: number | null;
  /** Whether `firecrawl.scrape()` was actually invoked. False on HEAD-304
   *  short-circuit, false on validateWebUrl failure, true otherwise. */
  firecrawlCalled: boolean;
}

/**
 * Poll a single web source by scraping with Firecrawl (HTML mode + Turndown).
 * Returns a `WebPollResult` (extends `PollResult`) so downstream processing
 * (dedup, classify, store) is identical to RSS while also surfacing the
 * HEAD pre-flight status + Firecrawl-call flag for telemetry.
 *
 * Unlike RSS polling, web sources produce exactly one item per poll
 * (the page itself). The item's guid is set to the source URL so
 * dedup treats each URL as a unique entity.
 *
 * S222 W3-A §2.3.4 changes (vs P0-WEB MVP):
 *   - Per-domain rate-limit gate (parity with `pollFeed()` lines 178-180).
 *   - HEAD pre-flight with `If-None-Match` / `If-Modified-Since` per
 *     spec §3.3.2 Option A (D-3 ratified). On HTTP 304, short-circuit
 *     to `status='not_modified'` without spending a Firecrawl credit.
 *   - Firecrawl-credit telemetry via `Sentry.addBreadcrumb` per spec
 *     §3.3.3 (D-5 ratified). Breadcrumb only — `pipeline_runs.result`
 *     aggregation is a TODO until the cron handler is wired to
 *     `recordPipelineRun` (see footer comment).
 */
export async function pollWebSource(
  source: WebSourceRef,
  options: PollWebSourceOptions = {},
): Promise<WebPollResult> {
  const { dryRun = false } = options;

  // 1. Validate the URL is reachable and returns HTML.
  // We keep this BEFORE the rate-limit + HEAD pre-flight to preserve the
  // existing contract (validation runs first in the MVP) — failing fast
  // on a 404 / non-HTML response is cheaper than waiting on the rate
  // limiter for a doomed call.
  try {
    await validateWebUrl(source.url);
  } catch (err) {
    return {
      feedSourceId: source.id,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      items: [],
      etag: null,
      lastModified: null,
      headPreflightStatus: null,
      firecrawlCalled: false,
    };
  }

  // 2. Per-domain rate-limit gate (parity with pollFeed). MIN_DOMAIN_DELAY_MS
  //    = 1500ms applies identically to RSS and web (rate-limiter.ts:4).
  const rateLimiter = getGlobalRateLimiter();
  await rateLimiter.waitForDomain(source.url);

  // 3. HEAD pre-flight per spec §3.3.2 Option A (D-3 ratified). Issues
  //    `If-None-Match` + `If-Modified-Since` when stored; on HTTP 304,
  //    return `status='not_modified'` immediately, skipping Firecrawl.
  const preflightHeaders: Record<string, string> = { 'User-Agent': USER_AGENT };
  if (source.etag) preflightHeaders['If-None-Match'] = source.etag;
  if (source.last_modified)
    preflightHeaders['If-Modified-Since'] = source.last_modified;

  let preflight: Response;
  let headPreflightStatus: number | null;
  try {
    preflight = await fetch(source.url, {
      method: 'HEAD',
      headers: preflightHeaders,
      signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    headPreflightStatus = preflight.status;
  } catch {
    // HEAD-rejecting servers / transient errors: fall through to Firecrawl
    // (today's behaviour) rather than re-issuing a ranged GET — the
    // ranged-GET fallback is already in `validateWebUrl` (lines 280-294
    // of url-validation.ts). Treat HEAD failure as "proceed to Firecrawl".
    preflight = new Response(null, { status: 200 });
    headPreflightStatus = null;
  }

  if (preflight.status === 304) {
    Sentry.addBreadcrumb({
      category: 'intelligence.web-source.firecrawl-call',
      message: 'HEAD-304 short-circuit — Firecrawl skipped',
      level: 'info',
      data: {
        sourceId: source.id,
        url: source.url,
        success: true,
        status: 'unchanged',
        firecrawlCalled: false,
        dryRun,
      },
      timestamp: Date.now() / 1000,
    });
    return {
      feedSourceId: source.id,
      status: 'not_modified',
      items: [],
      etag: source.etag ?? null,
      lastModified: source.last_modified ?? null,
      headPreflightStatus,
      firecrawlCalled: false,
    };
  }

  // 4. Capture new ETag/Last-Modified from pre-flight response so the
  //    next poll cycle can issue a fresh conditional-GET. Headers may
  //    legitimately be absent (origin server omits ETag) — that maps
  //    to the canonical "wasted credit" telemetry case in spec §3.3.3.
  const newEtag = preflight.headers.get('ETag') ?? null;
  const newLastModified = preflight.headers.get('Last-Modified') ?? null;

  // 5. Scrape with Firecrawl using HTML format (F-1 fix: avoids double-escape).
  let firecrawlCalled = false;
  try {
    const { default: Firecrawl } = await import('@mendable/firecrawl-js');
    const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
    firecrawlCalled = true; // count the call attempt (matches Firecrawl billing)
    const doc = await firecrawl.scrape(source.url, {
      formats: ['html'] as const,
    });

    if (!doc.html) {
      Sentry.addBreadcrumb({
        category: 'intelligence.web-source.firecrawl-call',
        message: 'Firecrawl returned no HTML body',
        level: 'warning',
        data: {
          sourceId: source.id,
          url: source.url,
          success: false,
          status: 'error',
          firecrawlCalled: true,
          dryRun,
        },
        timestamp: Date.now() / 1000,
      });
      throw new Error('Firecrawl returned no HTML body');
    }

    rateLimiter.recordSuccess(source.url);

    Sentry.addBreadcrumb({
      category: 'intelligence.web-source.firecrawl-call',
      message: 'Firecrawl scrape completed',
      level: 'info',
      data: {
        sourceId: source.id,
        url: source.url,
        success: true,
        status: 'modified',
        firecrawlCalled: true,
        dryRun,
      },
      timestamp: Date.now() / 1000,
    });

    const metadata = (doc.metadata ?? {}) as Record<string, string | undefined>;

    // 6. Synthesise a single ParsedFeedItem with RAW HTML in contentEncoded.
    // Option C (F-1 fix): pollers always produce HTML in contentEncoded,
    // and extractContent does the single Turndown conversion — consistent
    // with the RSS path. Avoids the double-Turndown regression where
    // pollWebSource converts to markdown and extractContent converts again.
    const item: ParsedFeedItem = {
      title: normaliseFeedTitle(metadata.title) || source.name || source.url,
      url: source.url,
      guid: source.url, // guid === url for web sources (one page per source)
      publishedAt: metadata.publishedTime ?? new Date().toISOString(),
      summary: metadata.description ?? null,
      contentEncoded: doc.html, // raw HTML — extractContent handles Turndown
      categories: [],
    };

    return {
      feedSourceId: source.id,
      status: 'success',
      items: [item],
      etag: newEtag,
      lastModified: newLastModified,
      headPreflightStatus,
      firecrawlCalled,
    };
  } catch (err) {
    // Sentry breadcrumb already emitted on the no-HTML branch; emit one
    // here for SDK-thrown errors (4xx/5xx wrapped by @mendable/firecrawl-js,
    // network errors, etc.). Per spec §3.3.3 (D-5) + §6 AC-12, an errored
    // Firecrawl call STILL counts as a credit attempt — the SDK has
    // already hit the network even if the response was non-2xx. The
    // `firecrawlCalled` flag tracks attempts, not successes.
    if (firecrawlCalled) {
      Sentry.addBreadcrumb({
        category: 'intelligence.web-source.firecrawl-call',
        message: 'Firecrawl scrape failed',
        level: 'error',
        data: {
          sourceId: source.id,
          url: source.url,
          success: false,
          status: 'error',
          firecrawlCalled: true,
          dryRun,
          error: err instanceof Error ? err.message : String(err),
        },
        timestamp: Date.now() / 1000,
      });
    }
    return {
      feedSourceId: source.id,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      items: [],
      etag: null,
      lastModified: null,
      headPreflightStatus,
      firecrawlCalled,
    };
  }
}

// TODO(roadmap §8.3): `pipeline_runs.result.firecrawl_credits_consumed`
// per spec §2.3.4 §3.3.3 / AC-12 + D-5 requires the cron handler at
// `app/api/cron/intelligence-poll/route.ts` to call `recordPipelineRun`
// from `@/lib/pipeline/record-run` with the aggregated counter as the
// `result` payload. Today the cron handler does NOT call recordPipelineRun
// at all (`runPipeline` returns the pipeline summary; the route returns it
// in the response body, no `pipeline_runs` insert). Bundled into roadmap
// §8.3 (Cost telemetry hybrid) per S222 V_W3 M1 finding — that work
// already needs to bootstrap pipeline_runs writes for classification +
// embedding token aggregation; firecrawl-credit wiring rides along. Until
// then, AC-12 is verified via the Sentry breadcrumb stream + the
// `firecrawlCalled` flag returned from this function.

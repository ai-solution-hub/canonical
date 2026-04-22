// lib/intelligence/feed-poller.ts
import Parser from 'rss-parser';
import type { ParsedFeedItem, PollResult } from './types';
import { FEED_FETCH_TIMEOUT_MS } from './types';
import { RateLimitError, getGlobalRateLimiter } from './rate-limiter';

const USER_AGENT =
  'KnowledgeHub/1.0 (+https://knowledge-hub-seven-kappa.vercel.app)';

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
        error: 'URL returned XML but it could not be parsed as an RSS or Atom feed',
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
        retryAfterMs || rateLimiter.getRequiredDelay(new URL(source.url).hostname.toLowerCase()),
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

// ── Web source polling (P0-WEB) ──

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

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
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

/**
 * Web source reference — subset of FeedSource from pipeline.ts.
 * Kept minimal to avoid importing the full pipeline module.
 */
interface WebSourceRef {
  id: string;
  url: string;
  name?: string;
}

/**
 * Poll a single web source by scraping with Firecrawl (HTML mode + Turndown).
 * Returns a PollResult in the same shape as pollFeed() so downstream
 * processing (dedup, classify, store) is identical.
 *
 * Unlike RSS polling, web sources produce exactly one item per poll
 * (the page itself). The item's guid is set to the source URL so
 * dedup treats each URL as a unique entity.
 */
export async function pollWebSource(source: WebSourceRef): Promise<PollResult> {
  try {
    // 1. Validate the URL is reachable and returns HTML
    await validateWebUrl(source.url);

    // 2. Scrape with Firecrawl using HTML format (F-1 fix: avoids double-escape)
    const { default: Firecrawl } = await import('@mendable/firecrawl-js');
    const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
    const doc = await firecrawl.scrape(source.url, {
      formats: ['html'] as const,
    });

    if (!doc.html) {
      throw new Error('Firecrawl returned no HTML body');
    }

    const metadata = (doc.metadata ?? {}) as Record<string, string | undefined>;

    // 3. Synthesise a single ParsedFeedItem with RAW HTML in contentEncoded.
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
      etag: null,
      lastModified: null,
    };
  } catch (err) {
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

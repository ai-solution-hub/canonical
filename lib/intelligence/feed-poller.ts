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

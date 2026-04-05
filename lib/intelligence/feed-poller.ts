// lib/intelligence/feed-poller.ts
import Parser from 'rss-parser';
import type { ParsedFeedItem, PollResult } from './types';
import { FEED_FETCH_TIMEOUT_MS } from './types';
import { RateLimitError, getGlobalRateLimiter } from './rate-limiter';

const USER_AGENT =
  'KnowledgeHub/1.0 (+https://knowledge-hub-seven-kappa.vercel.app)';

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
      title: item.title ?? 'Untitled',
      url: item.link ?? '',
      guid: item.guid ?? (rawItem.id as string) ?? null,
      publishedAt: item.isoDate ?? null,
      summary: item.contentSnippet ?? item.summary ?? null,
      contentEncoded: (rawItem.contentEncoded as string | null) ?? null,
      categories: allCategories,
    };
  });
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

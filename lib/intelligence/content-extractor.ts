// lib/intelligence/content-extractor.ts
import type { ParsedFeedItem, ExtractionResult } from './types';
import { MIN_CONTENT_WORDS, EXTRACTION_TIMEOUT_MS } from './types';

const USER_AGENT = 'KnowledgeHub/1.0 (+https://knowledge-hub-seven-kappa.vercel.app)';

/** Count words in a string */
function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Strip HTML tags to get plain text */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Try extracting the main content from HTML using simple heuristics */
function extractMainContent(html: string): string {
  // Try <article> first, then <main>, then <body>
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return stripHtml(articleMatch[1]);

  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) return stripHtml(mainMatch[1]);

  return stripHtml(html);
}

/** Normalise a URL for dedup: lowercase hostname, strip tracking params, remove trailing slash */
export function normaliseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    // Remove common tracking query params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'source'];
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }
    // Remove trailing slash from pathname
    if (parsed.pathname.endsWith('/') && parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Extract full content for a feed article.
 * Priority: RSS content:encoded > direct fetch > Firecrawl > summary fallback
 */
export async function extractContent(item: ParsedFeedItem): Promise<ExtractionResult> {
  const baseResult = {
    title: item.title,
    description: item.summary,
    thumbnailUrl: null,
  };

  // 1. Check RSS content:encoded
  if (item.contentEncoded) {
    const text = stripHtml(item.contentEncoded);
    if (wordCount(text) >= MIN_CONTENT_WORDS) {
      return {
        ...baseResult,
        content: text,
        method: 'rss_content',
        wordCount: wordCount(text),
      };
    }
  }

  // 2. Try direct fetch (handles static HTML pages — most gov.uk content)
  try {
    const response = await fetch(item.url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
      redirect: 'follow',
    });

    if (response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        const html = await response.text();
        const text = extractMainContent(html);
        if (wordCount(text) >= MIN_CONTENT_WORDS) {
          return {
            ...baseResult,
            content: text,
            method: 'fetch',
            wordCount: wordCount(text),
          };
        }
      }
    }
  } catch {
    // Fall through to Firecrawl
  }

  // 3. Firecrawl fallback — scrape() returns a Document directly
  try {
    const { default: Firecrawl } = await import('@mendable/firecrawl-js');
    const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
    const doc = await firecrawl.scrape(item.url, { formats: ['markdown'] as const });

    if (doc.markdown) {
      const text = doc.markdown;
      return {
        ...baseResult,
        content: text,
        title: (doc.metadata as Record<string, string> | undefined)?.title ?? item.title,
        description: (doc.metadata as Record<string, string> | undefined)?.description ?? item.summary,
        thumbnailUrl: (doc.metadata as Record<string, string> | undefined)?.ogImage ?? null,
        method: 'firecrawl',
        wordCount: wordCount(text),
      };
    }
  } catch {
    // Firecrawl failed — use whatever we have
  }

  // 4. Last resort: use summary (tagged as summary_fallback, not fetch)
  const fallbackContent = item.summary ?? item.title;
  return {
    ...baseResult,
    content: fallbackContent,
    method: 'summary_fallback',
    wordCount: wordCount(fallbackContent),
  };
}

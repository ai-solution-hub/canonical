// lib/intelligence/content-extractor.ts
import type { ParsedFeedItem, ExtractionResult } from './types';
import { MIN_CONTENT_WORDS, EXTRACTION_TIMEOUT_MS } from './types';
import { RateLimitError, getGlobalRateLimiter } from './rate-limiter';

const USER_AGENT =
  'KnowledgeHub/1.0 (+https://knowledge-hub-seven-kappa.vercel.app)';

/** Whether the Firecrawl API key warning has already been logged this process */
let firecrawlWarningLogged = false;

/**
 * SI-H4: Tracks whether the Firecrawl API key is missing in the current
 * process. Set by checkFirecrawlApiKey() in non-production environments so
 * downstream code (e.g. health endpoints) can surface the degraded state.
 */
let firecrawlKeyMissing = false;

/**
 * SI-H4: Whether Firecrawl is configured (i.e. API key present).
 * Other modules (health endpoint, status pages) can read this without having
 * to re-check the env var, and to avoid relying on side-effects of
 * checkFirecrawlApiKey().
 */
export function isFirecrawlConfigured(): boolean {
  return !firecrawlKeyMissing && Boolean(process.env.FIRECRAWL_API_KEY);
}

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

/** Check if a URL is a Google News redirect */
export function isGoogleNewsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'news.google.com';
  } catch {
    return false;
  }
}

/**
 * Resolve a Google News redirect URL to the actual article URL.
 * Google News URLs (news.google.com/rss/articles/...) redirect to the real article.
 * Returns the resolved URL, or the original URL if not a Google News URL or resolution fails.
 */
export async function resolveGoogleNewsUrl(url: string): Promise<string> {
  if (!isGoogleNewsUrl(url)) return url;

  try {
    // Follow the redirect but don't download the body — we only need the final URL
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });

    // response.url contains the final URL after redirects
    if (response.url && response.url !== url) {
      return response.url;
    }

    // Some servers don't support HEAD — fall back to GET
    const getResponse = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });

    if (getResponse.url && getResponse.url !== url) {
      return getResponse.url;
    }

    return url;
  } catch {
    // Resolution failed — return original URL to avoid data loss
    return url;
  }
}

/** Normalise a URL for dedup: lowercase hostname, strip tracking params, remove trailing slash */
export function normaliseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    // Remove common tracking query params
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'ref',
      'source',
    ];
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
 * SI-H4: Verify Firecrawl is configured at pipeline startup.
 *
 * Behaviour by environment (NODE_ENV):
 * - production: throw an Error to fail-fast. The pipeline must refuse to run
 *   rather than silently degrade to summary_fallback (very low content
 *   quality). Pre-launch policy: zero tolerance for silent failures.
 * - non-production (development, test, staging): log a prominent WARNING and
 *   set firecrawlKeyMissing so health/status endpoints can surface the
 *   degraded state. The warning is logged once per process to avoid log spam.
 *
 * Called once at pipeline startup (runPipeline), not per article.
 */
export function checkFirecrawlApiKey(): void {
  if (process.env.FIRECRAWL_API_KEY) {
    firecrawlKeyMissing = false;
    return;
  }

  firecrawlKeyMissing = true;

  if (process.env.NODE_ENV === 'production') {
    // Fail-fast in production: refuse to run the pipeline so the operator
    // notices immediately. Surfacing early is far cheaper than discovering
    // weeks of summary_fallback-only ingests later.
    throw new Error(
      '[SI Pipeline] FIRECRAWL_API_KEY is not set — refusing to start pipeline in production. ' +
        'Set FIRECRAWL_API_KEY in the environment, or explicitly run with NODE_ENV != production ' +
        'to enable degraded extraction.',
    );
  }

  // Non-production: log a prominent warning once.
  if (!firecrawlWarningLogged) {
    console.warn(
      '[SI Pipeline] WARNING: FIRECRAWL_API_KEY is not set — Firecrawl extraction tier will be unavailable. ' +
        'The pipeline will fall back to summary_fallback for any article that earlier tiers cannot extract, ' +
        'which produces very low-quality content. This would FAIL FAST in production.',
    );
    firecrawlWarningLogged = true;
  }
}

/**
 * Extract full content for a feed article.
 * Priority: RSS content:encoded > direct fetch > Jina Reader > Firecrawl > summary fallback
 */
export async function extractContent(
  item: ParsedFeedItem,
): Promise<ExtractionResult> {
  const baseResult = {
    title: item.title,
    description: item.summary,
    thumbnailUrl: null,
  };

  // 1. Check RSS content:encoded
  if (item.contentEncoded) {
    const text = stripHtml(item.contentEncoded);
    if (wordCount(text) >= MIN_CONTENT_WORDS) {
      console.log(
        `[Extraction] ${item.url} — Tier 1 (rss_content), ${wordCount(text)} words`,
      );
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
    // Wait for per-domain rate limit before fetching content
    const rateLimiter = getGlobalRateLimiter();
    await rateLimiter.waitForDomain(item.url);

    const response = await fetch(item.url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
      redirect: 'follow',
    });

    if (response.status === 429) {
      rateLimiter.recordRateLimit(item.url);
      throw new RateLimitError(
        new URL(item.url).hostname,
        0,
      );
    }

    if (response.ok) {
      rateLimiter.recordSuccess(item.url);
      const contentType = response.headers.get('content-type') ?? '';
      if (
        contentType.includes('text/html') ||
        contentType.includes('application/xhtml')
      ) {
        const html = await response.text();
        const text = extractMainContent(html);
        if (wordCount(text) >= MIN_CONTENT_WORDS) {
          console.log(
            `[Extraction] ${item.url} — Tier 2 (fetch), ${wordCount(text)} words`,
          );
          return {
            ...baseResult,
            content: text,
            method: 'fetch',
            wordCount: wordCount(text),
          };
        }
      }
    }
  } catch (err) {
    console.error(
      `[Extraction] ${item.url} — Tier 2 (fetch) failed:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 2.5. Jina Reader — free markdown extraction, no API key needed
  try {
    const jinaUrl = `https://r.jina.ai/${item.url}`;
    const response = await fetch(jinaUrl, {
      headers: {
        Accept: 'text/markdown',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
    });

    if (response.ok) {
      const text = await response.text();
      if (wordCount(text) >= MIN_CONTENT_WORDS) {
        console.log(
          `[Extraction] ${item.url} — Tier 2.5 (jina_reader), ${wordCount(text)} words`,
        );
        return {
          ...baseResult,
          content: text,
          method: 'jina_reader',
          wordCount: wordCount(text),
        };
      }
    }
  } catch (err) {
    console.error(
      `[Extraction] ${item.url} — Tier 2.5 (jina_reader) failed:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 3. Firecrawl fallback — scrape() returns a Document directly
  try {
    const { default: Firecrawl } = await import('@mendable/firecrawl-js');
    const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
    const doc = await firecrawl.scrape(item.url, {
      formats: ['markdown'] as const,
    });

    if (doc.markdown) {
      const text = doc.markdown;
      console.log(
        `[Extraction] ${item.url} — Tier 3 (firecrawl), ${wordCount(text)} words`,
      );
      return {
        ...baseResult,
        content: text,
        title:
          (doc.metadata as Record<string, string> | undefined)?.title ??
          item.title,
        description:
          (doc.metadata as Record<string, string> | undefined)?.description ??
          item.summary,
        thumbnailUrl:
          (doc.metadata as Record<string, string> | undefined)?.ogImage ?? null,
        method: 'firecrawl',
        wordCount: wordCount(text),
      };
    }
  } catch (err) {
    console.error(
      `[Extraction] ${item.url} — Tier 3 (firecrawl) failed:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 4. Last resort: use summary (tagged as summary_fallback, not fetch).
  // SI-H4: Log a prominent WARN — summary_fallback is very low-quality content
  // and should be visible. Include the reason so operators can diagnose
  // (e.g. all 4 tiers failed, or Firecrawl is not configured).
  const fallbackContent = item.summary ?? item.title;
  const fallbackReason = firecrawlKeyMissing
    ? 'all extraction tiers failed and Firecrawl is not configured (FIRECRAWL_API_KEY missing)'
    : 'all extraction tiers failed (rss_content, fetch, jina_reader, firecrawl)';
  console.warn(
    `[Extraction] WARN ${item.url} — degraded to Tier 4 (summary_fallback), ${wordCount(fallbackContent)} words. Reason: ${fallbackReason}`,
  );
  return {
    ...baseResult,
    content: fallbackContent,
    method: 'summary_fallback',
    wordCount: wordCount(fallbackContent),
  };
}

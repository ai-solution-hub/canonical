/**
 * URL fetch orchestrator — determines URL type and delegates to
 * the appropriate content extractor (HTML via the B1 /extract cleaner,
 * or PDF via unpdf in-process).
 *
 * Includes SSRF protection, redirect validation, timeout, and
 * size limits. {112.10} splits the SSRF-gated fetch portion out as
 * `fetchForExtraction` so the manual route can fetch HTML itself and
 * hand it to the pure-cleaner /extract endpoint via `cleanViaWorker`,
 * while the PDF branch stays in-process.
 */

import { validateUrl } from './url-validation';
import { extractFromHtml } from './html';
import { extractPdfText } from './pdf';
import { extractOgMetadata } from './og-metadata';

/** @public */
export interface ExtractedContent {
  title: string;
  content: string;
  author: string;
  excerpt: string;
  ogImage: string;
  ogDescription: string;
  ogDate: string;
  extractionMethod: 'readability' | 'unpdf';
  pageCount?: number;
  contentLength: number;
}

/** Maximum response size: 20 MB */
const MAX_CONTENT_SIZE = 20 * 1024 * 1024;

/** Fetch timeout: 15 seconds */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Locally-derived HTML metadata (title / author / excerpt / og:*) — extracted
 * from the raw HTML WITHOUT Readability, so the manual route can populate the
 * reference row even though the body now comes from the B1 /extract cleaner.
 * {112.13} deletes @mozilla/readability; this path must not depend on it.
 *
 * @public
 */
export interface HtmlMetadata {
  title: string;
  author: string;
  excerpt: string;
  ogImage: string;
  ogDescription: string;
  ogDate: string;
}

/**
 * The SSRF-gated fetch result, discriminated by content kind. The caller runs
 * the appropriate extractor: PDF via in-process unpdf, HTML via the B1 /extract
 * pure cleaner. {112.10}.
 *
 * @public
 */
export type FetchedForExtraction =
  | { kind: 'pdf'; buffer: ArrayBuffer; finalUrl: string }
  | { kind: 'html'; html: string; finalUrl: string };

/**
 * Fetch a URL with SSRF protection, the 20 MB cap, redirect re-validation, and
 * PDF-vs-HTML detection — WITHOUT extracting content. The reusable fetch seam
 * the manual route ({112.10}) uses before handing HTML to `cleanViaWorker`.
 *
 * 1. Validates the URL (SSRF protection).
 * 2. Fetches with timeout + declared-size limit.
 * 3. Re-validates the final URL after redirects.
 * 4. Detects PDF vs HTML by content-type and returns the raw bytes/string.
 *
 * @param url - The URL to fetch.
 * @returns The fetched bytes/string discriminated by kind, plus the final URL.
 * @throws On validation failure, blocked redirect, over-cap body, or fetch error.
 */
export async function fetchForExtraction(
  url: string,
): Promise<FetchedForExtraction> {
  // 1. Validate URL (SSRF protection)
  const validation = validateUrl(url);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // 2. Fetch with timeout and size limits
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'KnowledgeHub/1.0 (content ingestion)',
        Accept: 'text/html,application/xhtml+xml,application/pdf,*/*',
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}`);
  }

  // Check content length header (if present)
  const contentLength = parseInt(
    response.headers.get('content-length') ?? '0',
    10,
  );
  if (contentLength > MAX_CONTENT_SIZE) {
    throw new Error('Content too large (over 20 MB)');
  }

  // 3. Re-validate final URL after redirects (SSRF protection)
  const finalUrl = response.url;
  const finalValidation = validateUrl(finalUrl);
  if (!finalValidation.valid) {
    throw new Error(`Redirect to blocked URL: ${finalValidation.error}`);
  }

  // 4. Detect PDF vs HTML by content type and return the raw payload.
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/pdf')) {
    const buffer = await response.arrayBuffer();
    return { kind: 'pdf', buffer, finalUrl };
  }

  const html = await response.text();
  return { kind: 'html', html, finalUrl };
}

/** Extract the page title from `og:title`, falling back to `<title>`. */
function extractTitle(html: string): string {
  const og = html.match(
    /<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']*)["']/i,
  );
  if (og?.[1]) return og[1].trim();
  const ogAlt = html.match(
    /<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']og:title["']/i,
  );
  if (ogAlt?.[1]) return ogAlt[1].trim();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title?.[1]?.trim() ?? '';
}

/**
 * Derive title / author / excerpt / og:* from raw HTML locally, WITHOUT
 * Readability. Used by the manual route ({112.10}) to populate the reference
 * row's metadata while the body comes from the B1 /extract cleaner.
 *
 * @param html - Raw HTML of the page.
 * @returns Best-effort metadata; empty strings for any missing value.
 */
export function extractHtmlMetadata(html: string): HtmlMetadata {
  const og = extractOgMetadata(html);
  return {
    title: extractTitle(html),
    author: og.ogAuthor,
    excerpt: og.ogDescription,
    ogImage: og.ogImage,
    ogDescription: og.ogDescription,
    ogDate: og.ogDate,
  };
}

/**
 * Fetch and extract content from a URL.
 *
 * NOTE ({112.10}): the manual ingest route no longer calls this — it composes
 * `fetchForExtraction` + `cleanViaWorker` (HTML) / `extractPdfText` (PDF)
 * directly. This function is retained (HTML path still via Readability) for any
 * latent caller until {112.13} removes @mozilla/readability and prunes it.
 *
 * @param url - The URL to fetch and extract from
 * @returns Extracted content with metadata
 * @throws On validation failure, fetch errors, or extraction failure
 */
export async function extractFromUrl(url: string): Promise<ExtractedContent> {
  const fetched = await fetchForExtraction(url);

  if (fetched.kind === 'pdf') {
    const pdf = await extractPdfText(fetched.buffer);
    return {
      title: '',
      content: pdf.text,
      author: '',
      excerpt: '',
      ogImage: '',
      ogDescription: '',
      ogDate: '',
      extractionMethod: 'unpdf',
      pageCount: pdf.pageCount,
      contentLength: pdf.text.length,
    };
  }

  const { html, finalUrl } = fetched;
  const ogMeta = extractOgMetadata(html);
  const extracted = await extractFromHtml(html, finalUrl);

  return {
    title: extracted.title,
    content: extracted.content,
    author: extracted.author || ogMeta.ogAuthor,
    excerpt: extracted.excerpt,
    ogImage: ogMeta.ogImage,
    ogDescription: ogMeta.ogDescription,
    ogDate: ogMeta.ogDate,
    extractionMethod: 'readability',
    contentLength: extracted.content.length,
  };
}

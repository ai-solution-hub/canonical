/**
 * URL fetch orchestrator — determines URL type and delegates to
 * the appropriate content extractor (HTML via Readability, or PDF
 * via unpdf).
 *
 * Includes SSRF protection, redirect validation, timeout, and
 * size limits.
 */

import { validateUrl } from './url-validation';
import { extractFromHtml } from './html';
import { extractPdfText } from './pdf';
import { extractOgMetadata } from './og-metadata';

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
 * Fetch and extract content from a URL.
 *
 * 1. Validates the URL (SSRF protection)
 * 2. Fetches with timeout and size limits
 * 3. Re-validates the final URL after redirects
 * 4. Routes to PDF or HTML extraction based on content type
 *
 * @param url - The URL to fetch and extract from
 * @returns Extracted content with metadata
 * @throws On validation failure, fetch errors, or extraction failure
 */
export async function extractFromUrl(url: string): Promise<ExtractedContent> {
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

  // 4. Route to appropriate extractor based on content type
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/pdf')) {
    const buffer = await response.arrayBuffer();
    const pdf = await extractPdfText(buffer);
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

  // 5. HTML extraction
  const html = await response.text();
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

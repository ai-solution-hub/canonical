/**
 * Readability-based HTML text extraction.
 *
 * Uses Mozilla's Readability algorithm (via jsdom) to extract the
 * main article content from a web page, then converts the cleaned
 * HTML to markdown via Turndown. Both Readability and jsdom are
 * lazy-imported to keep serverless cold starts fast.
 */

import { turndown } from '@/lib/extraction/turndown';

export interface HtmlExtractionResult {
  title: string;
  content: string;
  author: string;
  excerpt: string;
}

/**
 * Extract readable content from an HTML string.
 *
 * @param html - Raw HTML of the page
 * @param url - The page URL (used by jsdom for relative URL resolution)
 * @returns Extracted text content, title, author, and excerpt
 * @throws If the page cannot be parsed or has no readable content
 */
export async function extractFromHtml(
  html: string,
  url: string,
): Promise<HtmlExtractionResult> {
  // Lazy imports for serverless cold-start performance
  const { JSDOM } = await import('jsdom');
  const { Readability } = await import('@mozilla/readability');

  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.content?.trim()) {
    throw new Error('Could not extract readable content from this page');
  }

  return {
    title: article.title || '',
    content: turndown.turndown(article.content ?? ''),
    author: article.byline || '',
    excerpt: article.excerpt || '',
  };
}

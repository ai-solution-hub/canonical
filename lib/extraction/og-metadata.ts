/**
 * Extract Open Graph and standard metadata from raw HTML.
 *
 * Uses regex extraction rather than DOM parsing to keep the module
 * lightweight — this runs before the full Readability parse.
 */

/**
 * Extract a meta tag content value by property or name attribute.
 * Handles both `property="og:..."` and `name="..."` attributes,
 * and both single and double quotes.
 */
function extractMetaContent(html: string, attribute: string): string {
  // Match property="attribute" or name="attribute"
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${attribute}["'][^>]+content=["']([^"']*)["']`,
      'i',
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${attribute}["']`,
      'i',
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return '';
}

/** @public */
export interface OgMetadata {
  ogImage: string;
  ogDescription: string;
  ogAuthor: string;
  ogDate: string;
}

/**
 * Extract Open Graph metadata from raw HTML string.
 *
 * Looks for:
 * - `og:image` -> ogImage
 * - `og:description` -> ogDescription
 * - `author` or `article:author` -> ogAuthor
 * - `article:published_time` -> ogDate
 *
 * Returns empty strings for any missing values.
 */
export function extractOgMetadata(html: string): OgMetadata {
  return {
    ogImage: extractMetaContent(html, 'og:image'),
    ogDescription: extractMetaContent(html, 'og:description'),
    ogAuthor:
      extractMetaContent(html, 'article:author') ||
      extractMetaContent(html, 'author'),
    ogDate: extractMetaContent(html, 'article:published_time'),
  };
}

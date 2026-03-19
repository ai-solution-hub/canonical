/**
 * Auto-detect content type from URL patterns.
 *
 * Examines the URL path and hostname to make a best-effort guess
 * at the content type. Can be overridden by the user at ingestion time.
 */

interface PatternRule {
  /** Regex tested against the URL path (case-insensitive) */
  pathPattern?: RegExp;
  /** Regex tested against the full URL (case-insensitive) */
  urlPattern?: RegExp;
  /** The content type to return if matched */
  contentType: string;
}

const PATTERN_RULES: PatternRule[] = [
  // File extension checks (highest priority)
  { pathPattern: /\.pdf(\?|$)/i, contentType: 'pdf' },

  // Path-based content type detection
  { pathPattern: /\/(blog|posts|news)\//i, contentType: 'blog' },
  {
    pathPattern: /\/(research|paper|whitepaper|white-paper|publications?)\//i,
    contentType: 'research',
  },
  { pathPattern: /\/(policy|policies|governance)\//i, contentType: 'policy' },
  {
    pathPattern: /\/(pricing|features|products?|solutions?)\//i,
    contentType: 'product_description',
  },
  {
    pathPattern: /\/(case-stud|case_stud|casestud)/i,
    contentType: 'case_study',
  },
];

/**
 * Detect the likely content type from a URL.
 *
 * @param url - The URL to analyse
 * @returns A content_type value matching `VALID_CONTENT_TYPES`
 */
export function detectContentType(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'article';
  }

  const path = parsed.pathname;

  // Check pattern rules in priority order
  for (const rule of PATTERN_RULES) {
    if (rule.pathPattern && rule.pathPattern.test(path)) {
      return rule.contentType;
    }
    if (rule.urlPattern && rule.urlPattern.test(url)) {
      return rule.contentType;
    }
  }

  // Root domain (no meaningful path) — likely a product/company page
  if (path === '/' || path === '') {
    return 'product_description';
  }

  // Default
  return 'article';
}

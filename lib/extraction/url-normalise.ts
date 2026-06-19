// lib/extraction/url-normalise.ts

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

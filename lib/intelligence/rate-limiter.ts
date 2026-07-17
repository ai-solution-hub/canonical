// lib/intelligence/rate-limiter.ts

/** Minimum delay between requests to the same domain (ms) */
export const MIN_DOMAIN_DELAY_MS = 1_500;

/** Maximum backoff delay after 429 responses (ms) */
export const MAX_BACKOFF_DELAY_MS = 60_000;

/** Base delay for exponential backoff after 429 (ms) */
export const BASE_BACKOFF_DELAY_MS = 3_000;

/** Custom error class for rate-limit (429) responses */
export class RateLimitError extends Error {
  readonly statusCode = 429;
  readonly hostname: string;
  readonly retryAfterMs: number;

  constructor(hostname: string, retryAfterMs: number) {
    super(`Rate limited by ${hostname} — retry after ${retryAfterMs}ms`);
    this.name = 'RateLimitError';
    this.hostname = hostname;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Per-domain rate limiter.
 *
 * Tracks the last request time per hostname and enforces a minimum delay
 * between requests. Also tracks 429 responses and applies exponential
 * backoff to affected domains.
 */
export class DomainRateLimiter {
  private lastRequestTime = new Map<string, number>();
  private backoffCounts = new Map<string, number>();
  private minDelayMs: number;

  constructor(minDelayMs: number = MIN_DOMAIN_DELAY_MS) {
    this.minDelayMs = minDelayMs;
  }

  /** Extract hostname from a URL */
  static getHostname(url: string): string {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return url;
    }
  }

  /** Calculate the required delay before the next request to this domain */
  getRequiredDelay(hostname: string): number {
    const now = Date.now();
    const lastTime = this.lastRequestTime.get(hostname);
    const backoffCount = this.backoffCounts.get(hostname) ?? 0;

    // Calculate the effective delay: base delay + exponential backoff if 429'd
    let effectiveDelay = this.minDelayMs;
    if (backoffCount > 0) {
      const backoffDelay = Math.min(
        BASE_BACKOFF_DELAY_MS * Math.pow(2, backoffCount - 1),
        MAX_BACKOFF_DELAY_MS,
      );
      effectiveDelay = Math.max(effectiveDelay, backoffDelay);
    }

    if (!lastTime) return 0;

    const elapsed = now - lastTime;
    return Math.max(0, effectiveDelay - elapsed);
  }

  /** Wait for the required delay before making a request to this domain */
  async waitForDomain(url: string): Promise<void> {
    const hostname = DomainRateLimiter.getHostname(url);
    const delay = this.getRequiredDelay(hostname);

    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    this.lastRequestTime.set(hostname, Date.now());
  }

  /** Record a successful request — resets backoff for this domain */
  recordSuccess(url: string): void {
    const hostname = DomainRateLimiter.getHostname(url);
    this.backoffCounts.delete(hostname);
  }

  /** Record a 429 response — increases backoff for this domain */
  recordRateLimit(url: string): void {
    const hostname = DomainRateLimiter.getHostname(url);
    const current = this.backoffCounts.get(hostname) ?? 0;
    this.backoffCounts.set(hostname, current + 1);
    this.lastRequestTime.set(hostname, Date.now());
  }

  /** Get the current backoff count for a domain (for testing/diagnostics) */
  getBackoffCount(url: string): number {
    const hostname = DomainRateLimiter.getHostname(url);
    return this.backoffCounts.get(hostname) ?? 0;
  }

  /** Reset all state (useful for testing) */
  reset(): void {
    this.lastRequestTime.clear();
    this.backoffCounts.clear();
  }
}

/** Singleton rate limiter instance shared across pipeline runs */
let globalRateLimiter: DomainRateLimiter | null = null;

export function getGlobalRateLimiter(): DomainRateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new DomainRateLimiter();
  }
  return globalRateLimiter;
}

/**
 * In-memory sliding-window rate limiter.
 *
 * Counters are per-serverless-instance and reset on deploy. This is acceptable
 * for a single-user system where auth gates all routes. The primary purpose is
 * preventing accidental request loops, not adversarial abuse.
 *
 * If multi-user support is added, replace with Supabase-based or Redis-based
 * rate limiting.
 */

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of requests remaining in the current window */
  remaining: number;
  /** Timestamp (ms) when the current window resets */
  resetAt: number;
}

const store = new Map<string, { count: number; resetTime: number }>();

/**
 * Clean up expired entries to prevent unbounded memory growth.
 * Runs every 60 seconds via setInterval (non-blocking, unref'd so it
 * does not keep the process alive).
 */
let cleanupScheduled = false;

function scheduleCleanup(): void {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store) {
      if (now > record.resetTime) {
        store.delete(key);
      }
    }
  }, 60_000);
  // Ensure the timer does not prevent the process from exiting
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref();
  }
}

/**
 * Check whether a request identified by `key` is within the rate limit.
 *
 * @param key     - Unique identifier, typically `routeName:userId`
 * @param limit   - Maximum number of requests allowed in the window
 * @param windowMs - Window duration in milliseconds
 * @returns Result with allowed flag, remaining count, and reset timestamp
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  scheduleCleanup();

  const now = Date.now();
  const record = store.get(key);

  if (!record || now > record.resetTime) {
    const resetTime = now + windowMs;
    store.set(key, { count: 1, resetTime });
    return { allowed: true, remaining: limit - 1, resetAt: resetTime };
  }

  if (record.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: record.resetTime };
  }

  record.count++;
  return {
    allowed: true,
    remaining: limit - record.count,
    resetAt: record.resetTime,
  };
}

/**
 * Reset all rate limit state. Intended for testing only.
 * @internal
 */
export function _resetRateLimitStore(): void {
  store.clear();
}

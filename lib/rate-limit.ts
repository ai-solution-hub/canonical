/**
 * In-memory rate limiter. Counters are per-serverless-instance and reset on deploy.
 * This is acceptable for a single-user system where auth gates all routes.
 * The primary purpose is preventing accidental request loops, not adversarial abuse.
 *
 * If multi-user support is added, replace with Supabase-based or Redis-based rate limiting.
 */
const rateLimit = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = rateLimit.get(key);

  if (!record || now > record.resetTime) {
    rateLimit.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  if (record.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: limit - record.count };
}

import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, _resetRateLimitStore } from '@/lib/rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    _resetRateLimitStore();
  });

  it('allows requests within the limit', () => {
    const result = checkRateLimit('test:user1', 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('tracks remaining count correctly', () => {
    checkRateLimit('test:user1', 3, 60_000);
    checkRateLimit('test:user1', 3, 60_000);
    const result = checkRateLimit('test:user1', 3, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('blocks requests exceeding the limit', () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit('test:user1', 3, 60_000);
    }
    const result = checkRateLimit('test:user1', 3, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('returns resetAt timestamp in the future', () => {
    const before = Date.now();
    const result = checkRateLimit('test:user1', 5, 60_000);
    expect(result.resetAt).toBeGreaterThanOrEqual(before + 60_000);
  });

  it('isolates keys from each other', () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit('route-a:user1', 3, 60_000);
    }
    const blockedA = checkRateLimit('route-a:user1', 3, 60_000);
    const allowedB = checkRateLimit('route-b:user1', 3, 60_000);

    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });

  it('resets after window expires', async () => {
    const result1 = checkRateLimit('test:expire', 1, 10);
    expect(result1.allowed).toBe(true);

    // Wait for the 10ms window to expire
    await new Promise((r) => setTimeout(r, 15));

    const result2 = checkRateLimit('test:expire', 1, 10);
    expect(result2.allowed).toBe(true);
  });

  it('handles concurrent users independently', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit('classify:user-a', 5, 60_000);
    }
    const userA = checkRateLimit('classify:user-a', 5, 60_000);
    const userB = checkRateLimit('classify:user-b', 5, 60_000);

    expect(userA.allowed).toBe(false);
    expect(userB.allowed).toBe(true);
    expect(userB.remaining).toBe(4);
  });
});

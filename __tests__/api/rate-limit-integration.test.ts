/**
 * WP3: Rate Limiting Integration Tests
 *
 * Tests the in-memory rate limiter via checkRateLimit().
 * Verifies that requests are allowed up to the limit, then blocked with 429.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit } from '@/lib/rate-limit';

// ---------------------------------------------------------------------------
// The rate limiter uses a module-level Map. We need to ensure isolation by
// using unique keys per test or by exploiting the time-window reset.
// ---------------------------------------------------------------------------

describe('Rate limiter (checkRateLimit)', () => {
  // Use unique keys per test to avoid cross-test contamination
  let testKey: string;

  beforeEach(() => {
    testKey = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });

  it('allows first request and returns correct remaining count', () => {
    const result = checkRateLimit(testKey, 30, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(29);
  });

  it('allows requests up to the limit', () => {
    const limit = 5;
    for (let i = 0; i < limit; i++) {
      const result = checkRateLimit(testKey, limit, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(limit - i - 1);
    }
  });

  it('blocks request after limit is exceeded', () => {
    const limit = 5;
    // Exhaust the limit
    for (let i = 0; i < limit; i++) {
      checkRateLimit(testKey, limit, 60_000);
    }
    // Next request should be blocked
    const result = checkRateLimit(testKey, limit, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('blocks all subsequent requests after limit exceeded', () => {
    const limit = 3;
    for (let i = 0; i < limit; i++) {
      checkRateLimit(testKey, limit, 60_000);
    }
    // Multiple blocked requests
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(testKey, limit, 60_000);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    }
  });

  it('resets after the time window expires', () => {
    const limit = 2;
    // Use a very short window (1ms) so it expires immediately
    checkRateLimit(testKey, limit, 1);
    checkRateLimit(testKey, limit, 1);

    // Wait a tiny bit for the window to expire
    const waitStart = Date.now();
    while (Date.now() - waitStart < 5) {
      // busy-wait
    }

    // Should be allowed again after window reset
    const result = checkRateLimit(testKey, limit, 1);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(limit - 1);
  });

  it('tracks different keys independently', () => {
    const keyA = `${testKey}-a`;
    const keyB = `${testKey}-b`;

    // Exhaust key A
    checkRateLimit(keyA, 1, 60_000);
    const resultA = checkRateLimit(keyA, 1, 60_000);
    expect(resultA.allowed).toBe(false);

    // Key B should still be allowed
    const resultB = checkRateLimit(keyB, 1, 60_000);
    expect(resultB.allowed).toBe(true);
  });

  it('returns remaining 0 at exactly the limit', () => {
    const limit = 3;
    // Use all 3 requests
    checkRateLimit(testKey, limit, 60_000);
    checkRateLimit(testKey, limit, 60_000);
    const lastAllowed = checkRateLimit(testKey, limit, 60_000);
    expect(lastAllowed.allowed).toBe(true);
    expect(lastAllowed.remaining).toBe(0);
  });

  it('simulates realistic API rate limit (30 requests)', () => {
    const limit = 30;
    // All 30 should succeed
    for (let i = 0; i < limit; i++) {
      const result = checkRateLimit(testKey, limit, 60_000);
      expect(result.allowed).toBe(true);
    }
    // 31st should fail
    const blocked = checkRateLimit(testKey, limit, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });
});

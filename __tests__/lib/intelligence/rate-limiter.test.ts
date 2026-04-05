// __tests__/lib/intelligence/rate-limiter.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DomainRateLimiter,
  RateLimitError,
  MIN_DOMAIN_DELAY_MS,
  BASE_BACKOFF_DELAY_MS,
  MAX_BACKOFF_DELAY_MS,
} from '@/lib/intelligence/rate-limiter';

describe('DomainRateLimiter', () => {
  let limiter: DomainRateLimiter;

  beforeEach(() => {
    limiter = new DomainRateLimiter();
  });

  describe('getHostname', () => {
    it('extracts hostname from a full URL', () => {
      expect(DomainRateLimiter.getHostname('https://www.gov.uk/publications/foo')).toBe('www.gov.uk');
    });

    it('lowercases the hostname', () => {
      expect(DomainRateLimiter.getHostname('https://WWW.GOV.UK/path')).toBe('www.gov.uk');
    });

    it('returns input for invalid URLs', () => {
      expect(DomainRateLimiter.getHostname('not-a-url')).toBe('not-a-url');
    });
  });

  describe('getRequiredDelay', () => {
    it('returns 0 for a domain with no prior requests', () => {
      expect(limiter.getRequiredDelay('www.gov.uk')).toBe(0);
    });

    it('returns remaining delay when last request was recent', async () => {
      // Simulate a recent request
      await limiter.waitForDomain('https://www.gov.uk/feed');
      const delay = limiter.getRequiredDelay('www.gov.uk');
      // Should be close to MIN_DOMAIN_DELAY_MS (minus tiny elapsed time)
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(MIN_DOMAIN_DELAY_MS);
    });

    it('returns 0 when enough time has passed', () => {
      // Manually set last request time to the past
      const limiterAny = limiter as unknown as { lastRequestTime: Map<string, number> };
      limiterAny.lastRequestTime.set('www.gov.uk', Date.now() - MIN_DOMAIN_DELAY_MS - 100);
      expect(limiter.getRequiredDelay('www.gov.uk')).toBe(0);
    });
  });

  describe('waitForDomain', () => {
    it('does not delay for the first request to a domain', async () => {
      const start = Date.now();
      await limiter.waitForDomain('https://www.gov.uk/feed');
      const elapsed = Date.now() - start;
      // First request should be near-instant
      expect(elapsed).toBeLessThan(100);
    });

    it('delays subsequent requests to the same domain', async () => {
      // Use a short delay for test speed
      const fastLimiter = new DomainRateLimiter(50);
      await fastLimiter.waitForDomain('https://www.gov.uk/feed');
      const start = Date.now();
      await fastLimiter.waitForDomain('https://www.gov.uk/other');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(30); // Allow small timing variance
    });

    it('does not delay requests to different domains', async () => {
      const fastLimiter = new DomainRateLimiter(200);
      await fastLimiter.waitForDomain('https://www.gov.uk/feed');
      const start = Date.now();
      await fastLimiter.waitForDomain('https://www.example.com/feed');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('backoff tracking', () => {
    it('increases backoff count on recordRateLimit', () => {
      expect(limiter.getBackoffCount('https://www.gov.uk/feed')).toBe(0);
      limiter.recordRateLimit('https://www.gov.uk/feed');
      expect(limiter.getBackoffCount('https://www.gov.uk/feed')).toBe(1);
      limiter.recordRateLimit('https://www.gov.uk/feed');
      expect(limiter.getBackoffCount('https://www.gov.uk/feed')).toBe(2);
    });

    it('resets backoff count on recordSuccess', () => {
      limiter.recordRateLimit('https://www.gov.uk/feed');
      limiter.recordRateLimit('https://www.gov.uk/feed');
      expect(limiter.getBackoffCount('https://www.gov.uk/feed')).toBe(2);
      limiter.recordSuccess('https://www.gov.uk/feed');
      expect(limiter.getBackoffCount('https://www.gov.uk/feed')).toBe(0);
    });

    it('calculates exponential backoff delay', () => {
      // After 1 rate limit: BASE_BACKOFF_DELAY_MS * 2^0 = 3000ms
      limiter.recordRateLimit('https://www.gov.uk/feed');
      // Set lastRequestTime to past so only backoff matters
      const limiterAny = limiter as unknown as { lastRequestTime: Map<string, number> };
      limiterAny.lastRequestTime.set('www.gov.uk', Date.now() - 2000);
      const delay1 = limiter.getRequiredDelay('www.gov.uk');
      expect(delay1).toBeGreaterThan(0);
      expect(delay1).toBeLessThanOrEqual(BASE_BACKOFF_DELAY_MS);

      // After 2 rate limits: BASE_BACKOFF_DELAY_MS * 2^1 = 6000ms
      limiter.recordRateLimit('https://www.gov.uk/feed');
      limiterAny.lastRequestTime.set('www.gov.uk', Date.now() - 2000);
      const delay2 = limiter.getRequiredDelay('www.gov.uk');
      expect(delay2).toBeGreaterThan(delay1);
    });

    it('caps backoff at MAX_BACKOFF_DELAY_MS', () => {
      // Simulate many rate limits
      for (let i = 0; i < 20; i++) {
        limiter.recordRateLimit('https://www.gov.uk/feed');
      }
      const limiterAny = limiter as unknown as { lastRequestTime: Map<string, number> };
      limiterAny.lastRequestTime.set('www.gov.uk', Date.now() - 1);
      const delay = limiter.getRequiredDelay('www.gov.uk');
      expect(delay).toBeLessThanOrEqual(MAX_BACKOFF_DELAY_MS);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      limiter.recordRateLimit('https://www.gov.uk/feed');
      limiter.reset();
      expect(limiter.getBackoffCount('https://www.gov.uk/feed')).toBe(0);
      expect(limiter.getRequiredDelay('www.gov.uk')).toBe(0);
    });
  });
});

describe('RateLimitError', () => {
  it('creates an error with correct properties', () => {
    const err = new RateLimitError('www.gov.uk', 5000);
    expect(err.name).toBe('RateLimitError');
    expect(err.hostname).toBe('www.gov.uk');
    expect(err.retryAfterMs).toBe(5000);
    expect(err.statusCode).toBe(429);
    expect(err.message).toContain('www.gov.uk');
  });

  it('is an instance of Error', () => {
    const err = new RateLimitError('example.com', 0);
    expect(err).toBeInstanceOf(Error);
  });
});

// __tests__/lib/intelligence/content-extractor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock rate limiter to avoid delays in tests
vi.mock('@/lib/intelligence/rate-limiter', () => ({
  getGlobalRateLimiter: () => ({
    waitForDomain: vi.fn().mockResolvedValue(undefined),
    recordSuccess: vi.fn(),
    recordRateLimit: vi.fn(),
    getRequiredDelay: vi.fn().mockReturnValue(0),
  }),
  RateLimitError: class RateLimitError extends Error {
    statusCode = 429;
    hostname: string;
    retryAfterMs: number;
    constructor(hostname: string, retryAfterMs: number) {
      super(`Rate limited by ${hostname}`);
      this.name = 'RateLimitError';
      this.hostname = hostname;
      this.retryAfterMs = retryAfterMs;
    }
  },
}));

import {
  extractContent,
  normaliseUrl,
} from '@/lib/intelligence/content-extractor';
import type { ParsedFeedItem } from '@/lib/intelligence/types';

// Mock Firecrawl — use function keyword for vi.fn() with new (CLAUDE.md gotcha)
vi.mock('@mendable/firecrawl-js', () => ({
  default: vi.fn().mockImplementation(function () {
    return { scrape: vi.fn() };
  }),
}));

// Mock fetch for direct extraction
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const baseItem: ParsedFeedItem = {
  title: 'Test Article',
  url: 'https://example.com/article',
  guid: 'guid-1',
  publishedAt: '2026-04-01T10:00:00Z',
  summary: 'A brief summary of the article.',
  contentEncoded: null,
  categories: [],
};

describe('extractContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses RSS content:encoded when available and sufficient', async () => {
    const item = { ...baseItem, contentEncoded: 'Word '.repeat(150) };
    const result = await extractContent(item);
    expect(result.method).toBe('rss_content');
    expect(result.wordCount).toBeGreaterThanOrEqual(100);
  });

  it('falls back to fetch when RSS content is too short', async () => {
    const item = { ...baseItem, contentEncoded: 'Too short' };

    // Mock a successful direct fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: () =>
        Promise.resolve(
          `<html><body><article><p>${'Long content word. '.repeat(200)}</p></article></body></html>`,
        ),
    });

    const result = await extractContent(item);
    expect(result.method).toBe('fetch');
    expect(result.wordCount).toBeGreaterThanOrEqual(100);
  });

  it('uses summary as title fallback', async () => {
    const item = { ...baseItem, contentEncoded: 'Word '.repeat(150) };
    const result = await extractContent(item);
    expect(result.title).toBe('Test Article');
  });

  it('returns summary_fallback method when all extraction fails', async () => {
    const item = {
      ...baseItem,
      contentEncoded: null,
      summary: 'Fallback summary text',
    };

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await extractContent(item);
    expect(result.method).toBe('summary_fallback');
  });
});

describe('normaliseUrl', () => {
  it('lowercases hostname', () => {
    expect(normaliseUrl('https://WWW.GOV.UK/page')).toBe(
      'https://www.gov.uk/page',
    );
  });

  it('strips tracking params', () => {
    expect(
      normaliseUrl('https://example.com/page?utm_source=twitter&key=val'),
    ).toBe('https://example.com/page?key=val');
  });

  it('removes trailing slash', () => {
    expect(normaliseUrl('https://example.com/page/')).toBe(
      'https://example.com/page',
    );
  });

  it('preserves root slash', () => {
    expect(normaliseUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('returns invalid URLs unchanged', () => {
    expect(normaliseUrl('not-a-url')).toBe('not-a-url');
  });
});

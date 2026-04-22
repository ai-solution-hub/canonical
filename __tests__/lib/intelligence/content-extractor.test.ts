// __tests__/lib/intelligence/content-extractor.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- Firecrawl mock surface requires flexible typing */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

    // Tier 2 (fetch) fails
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    // Tier 2.5 (Jina) fails
    mockFetch.mockRejectedValueOnce(new Error('Jina error'));

    const result = await extractContent(item);
    expect(result.method).toBe('summary_fallback');
  });

  it('logs errors when fetch extraction fails (P0: no silent failures)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const item = { ...baseItem, contentEncoded: null, summary: 'Fallback' };

    // Tier 2 (fetch) fails
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
    // Tier 2.5 (Jina) fails
    mockFetch.mockRejectedValueOnce(new Error('Jina timeout'));

    await extractContent(item);

    // Should log errors for both failed tiers
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Tier 2 (fetch) failed'),
      expect.stringContaining('Connection refused'),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Tier 2.5 (jina_reader) failed'),
      expect.stringContaining('Jina timeout'),
    );

    consoleSpy.mockRestore();
  });

  it('logs which extraction tier was used (P0: tier logging)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const item = { ...baseItem, contentEncoded: 'Word '.repeat(150) };

    await extractContent(item);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Tier 1 (rss_content)'),
      // No need to check exact word count
    );

    consoleSpy.mockRestore();
  });

  it('uses Jina Reader when fetch returns insufficient content', async () => {
    const item = { ...baseItem, contentEncoded: null };

    // Tier 2 (fetch) returns too little content
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: () => Promise.resolve('<html><body><p>Short</p></body></html>'),
    });

    // Tier 2.5 (Jina Reader) returns good content
    const jinaContent = 'Jina extracted content. '.repeat(60);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(jinaContent),
    });

    const result = await extractContent(item);
    expect(result.method).toBe('jina_reader');
    expect(result.wordCount).toBeGreaterThanOrEqual(100);
    expect(result.content).toBe(jinaContent);
  });

  it('calls Jina Reader with correct URL format', async () => {
    const item = {
      ...baseItem,
      url: 'https://www.gov.uk/some-page',
      contentEncoded: null,
    };

    // Tier 2 (fetch) fails
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    // Tier 2.5 (Jina Reader) returns good content
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('Content '.repeat(150)),
    });

    await extractContent(item);

    // Check the Jina fetch call
    expect(mockFetch).toHaveBeenCalledWith(
      'https://r.jina.ai/https://www.gov.uk/some-page',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'text/markdown',
        }),
      }),
    );
  });

  it('falls through from Jina to Firecrawl when Jina returns short content', async () => {
    const item = { ...baseItem, contentEncoded: null };

    // Tier 2 (fetch) fails
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    // Tier 2.5 (Jina) returns too little
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('Too short'),
    });

    // Firecrawl mock returns HTML content (F-1 fix: html format, not markdown)
    const { default: Firecrawl } = await import('@mendable/firecrawl-js');
    const htmlContent = '<p>' + 'Firecrawl content. '.repeat(100) + '</p>';
    const mockScrape = vi.fn().mockResolvedValue({
      html: htmlContent,
      metadata: { title: 'FC Title' },
    });
    vi.mocked(Firecrawl).mockImplementation(function () {
      return { scrape: mockScrape } as any;
    });

    const result = await extractContent(item);
    expect(result.method).toBe('firecrawl');
  });

  // T14: F-1 regression — Firecrawl HTML output converted via Turndown must
  // NOT contain backslash-escaped heading markers (\#). The fix is requesting
  // html format (not markdown) from Firecrawl and running Turndown locally.
  it('Firecrawl tier produces markdown without \\# escape (F-1 regression, T14)', async () => {
    const item = { ...baseItem, contentEncoded: null };

    // Tier 2 (fetch) fails
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    // Tier 2.5 (Jina) returns too little
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('Too short'),
    });

    // Firecrawl returns HTML with a heading
    const { default: Firecrawl } = await import('@mendable/firecrawl-js');
    const htmlWithHeading =
      '<h1>Important Heading</h1><p>' + 'Substantial body. '.repeat(100) + '</p>';
    const mockScrape = vi.fn().mockResolvedValue({
      html: htmlWithHeading,
      metadata: { title: 'F-1 Test' },
    });
    vi.mocked(Firecrawl).mockImplementation(function () {
      return { scrape: mockScrape } as any;
    });

    const result = await extractContent(item);
    expect(result.method).toBe('firecrawl');
    // Verify clean heading — no backslash escape
    expect(result.content).toContain('# Important Heading');
    expect(result.content).not.toContain('\\#');
    // Verify Firecrawl was called with html format (not markdown)
    expect(mockScrape).toHaveBeenCalledWith(
      item.url,
      expect.objectContaining({ formats: ['html'] }),
    );
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

describe('checkFirecrawlApiKey (SI-H4)', () => {
  // Capture and restore env state before/after each test so tests are
  // independent (the warning flag and missing flag are module-level state).
  const originalKey = process.env.FIRECRAWL_API_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.FIRECRAWL_API_KEY;
    } else {
      process.env.FIRECRAWL_API_KEY = originalKey;
    }
    if (originalNodeEnv === undefined) {
      delete (process.env as Record<string, string | undefined>).NODE_ENV;
    } else {
      (process.env as Record<string, string | undefined>).NODE_ENV =
        originalNodeEnv;
    }
  });

  it('throws an Error in production when FIRECRAWL_API_KEY is missing', async () => {
    // Re-import after vi.resetModules() so module state (firecrawlWarningLogged,
    // firecrawlKeyMissing) starts fresh.
    const mod = await import('@/lib/intelligence/content-extractor');
    delete process.env.FIRECRAWL_API_KEY;
    (process.env as Record<string, string | undefined>).NODE_ENV =
      'production';

    expect(() => mod.checkFirecrawlApiKey()).toThrow(
      /FIRECRAWL_API_KEY is not set/,
    );
    expect(() => mod.checkFirecrawlApiKey()).toThrow(
      /refusing to start pipeline in production/,
    );
  });

  it('logs a prominent warning in non-production when FIRECRAWL_API_KEY is missing', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/intelligence/content-extractor');
    delete process.env.FIRECRAWL_API_KEY;
    (process.env as Record<string, string | undefined>).NODE_ENV =
      'development';

    expect(() => mod.checkFirecrawlApiKey()).not.toThrow();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('WARNING: FIRECRAWL_API_KEY is not set'),
    );
    // Also confirm the prominent message about prod failing fast is included
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('would FAIL FAST in production'),
    );

    consoleSpy.mockRestore();
  });

  it('does not throw or warn when FIRECRAWL_API_KEY is set', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/intelligence/content-extractor');
    process.env.FIRECRAWL_API_KEY = 'fc-test-key';
    (process.env as Record<string, string | undefined>).NODE_ENV =
      'production';

    expect(() => mod.checkFirecrawlApiKey()).not.toThrow();
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(mod.isFirecrawlConfigured()).toBe(true);

    consoleSpy.mockRestore();
  });

  it('isFirecrawlConfigured() reports false after a missing-key check in dev', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/intelligence/content-extractor');
    delete process.env.FIRECRAWL_API_KEY;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';

    mod.checkFirecrawlApiKey();
    expect(mod.isFirecrawlConfigured()).toBe(false);

    consoleSpy.mockRestore();
  });

  it('warning is logged only once per process', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/intelligence/content-extractor');
    delete process.env.FIRECRAWL_API_KEY;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';

    mod.checkFirecrawlApiKey();
    mod.checkFirecrawlApiKey();
    mod.checkFirecrawlApiKey();

    const warnCalls = consoleSpy.mock.calls.filter((args) =>
      String(args[0]).includes('WARNING: FIRECRAWL_API_KEY'),
    );
    expect(warnCalls).toHaveLength(1);

    consoleSpy.mockRestore();
  });
});

describe('summary_fallback logging (SI-H4)', () => {
  const originalKey = process.env.FIRECRAWL_API_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.FIRECRAWL_API_KEY;
    } else {
      process.env.FIRECRAWL_API_KEY = originalKey;
    }
    if (originalNodeEnv === undefined) {
      delete (process.env as Record<string, string | undefined>).NODE_ENV;
    } else {
      (process.env as Record<string, string | undefined>).NODE_ENV =
        originalNodeEnv;
    }
  });

  it('logs a WARN with reason when extraction degrades to summary_fallback (all tiers failed)', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    // Re-import to get a fresh module with FIRECRAWL_API_KEY set so the
    // "all tiers failed" branch (not the "missing key" branch) is exercised.
    vi.resetModules();
    process.env.FIRECRAWL_API_KEY = 'fc-test-key';
    const mod = await import('@/lib/intelligence/content-extractor');
    // Mark the key as configured (note: firecrawlKeyMissing defaults to false)
    mod.checkFirecrawlApiKey();

    const item: ParsedFeedItem = {
      ...baseItem,
      contentEncoded: null,
      summary: 'Brief fallback summary content',
    };

    // All real fetches fail
    mockFetch.mockRejectedValueOnce(new Error('fetch tier 2 failed'));
    mockFetch.mockRejectedValueOnce(new Error('jina tier 2.5 failed'));

    // Force Firecrawl tier to fail too
    const { default: Firecrawl } = await import('@mendable/firecrawl-js');
    vi.mocked(Firecrawl).mockImplementation(function () {
      return {
        scrape: vi.fn().mockRejectedValue(new Error('firecrawl boom')),
      } as any;
    });

    const result = await mod.extractContent(item);
    expect(result.method).toBe('summary_fallback');

    const warnMessages = consoleWarnSpy.mock.calls
      .map((args) => args.join(' '))
      .join('\n');
    expect(warnMessages).toContain('WARN');
    expect(warnMessages).toContain('summary_fallback');
    expect(warnMessages).toContain(item.url);
    expect(warnMessages).toContain('all extraction tiers failed');

    consoleWarnSpy.mockRestore();
  });

  it('logs a WARN naming the missing Firecrawl key when it is the cause', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    vi.resetModules();
    delete process.env.FIRECRAWL_API_KEY;
    (process.env as Record<string, string | undefined>).NODE_ENV =
      'development';
    const mod = await import('@/lib/intelligence/content-extractor');
    mod.checkFirecrawlApiKey(); // Sets firecrawlKeyMissing = true

    const item: ParsedFeedItem = {
      ...baseItem,
      contentEncoded: null,
      summary: 'Brief fallback summary content',
    };

    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));
    mockFetch.mockRejectedValueOnce(new Error('jina failed'));

    // Firecrawl will throw because no key — but our mock module avoids that;
    // override to simulate the empty markdown path or rejection.
    const { default: Firecrawl } = await import('@mendable/firecrawl-js');
    vi.mocked(Firecrawl).mockImplementation(function () {
      return {
        scrape: vi.fn().mockRejectedValue(new Error('no api key')),
      } as any;
    });

    const result = await mod.extractContent(item);
    expect(result.method).toBe('summary_fallback');

    const warnMessages = consoleWarnSpy.mock.calls
      .map((args) => args.join(' '))
      .join('\n');
    expect(warnMessages).toContain('FIRECRAWL_API_KEY missing');

    consoleWarnSpy.mockRestore();
  });
});

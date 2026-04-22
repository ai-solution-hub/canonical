// __tests__/lib/intelligence/web-source-poller.test.ts
/**
 * Unit tests for web source polling (P0-WEB / WP3B).
 *
 * Tests pollWebSource() and validateWebUrl() — the web-source extensions
 * added to lib/intelligence/feed-poller.ts.
 */
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

// Mock Firecrawl — use function keyword for vi.fn() with new (CLAUDE.md gotcha)
const mockScrape = vi.fn();
vi.mock('@mendable/firecrawl-js', () => ({
  default: vi.fn().mockImplementation(function () {
    return { scrape: mockScrape };
  }),
}));

import { pollWebSource, validateWebUrl } from '@/lib/intelligence/feed-poller';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// pollWebSource
// ---------------------------------------------------------------------------

describe('pollWebSource', () => {
  const webSource = {
    id: 'web-source-1',
    url: 'https://example.com/page',
    name: 'Example Page',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: validateWebUrl succeeds (HEAD returns 200 + text/html)
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });
  });

  // T1: Happy path — Firecrawl returns HTML with metadata
  it('returns a ParsedFeedItem with raw HTML in contentEncoded (Option C: poller produces HTML)', async () => {
    mockScrape.mockResolvedValueOnce({
      html: '<h1>Hello</h1><p>World</p>',
      metadata: {
        title: 'Example',
        publishedTime: '2026-04-01',
      },
    });

    const result = await pollWebSource(webSource);

    expect(result.status).toBe('success');
    expect(result.items).toHaveLength(1);

    const item = result.items[0];
    expect(item.title).toBe('Example');
    expect(item.guid).toBe('https://example.com/page');
    expect(item.publishedAt).toBe('2026-04-01');
    // Option C: contentEncoded is raw HTML (extractContent does the Turndown)
    expect(item.contentEncoded).toContain('<h1>Hello</h1>');
    expect(item.contentEncoded).toContain('World');

    // Verify Firecrawl was called with correct args
    expect(mockScrape).toHaveBeenCalledWith(
      'https://example.com/page',
      expect.objectContaining({ formats: ['html'] }),
    );
  });

  // T2: Metadata missing title -> fallback to source.name
  it('falls back to source name when metadata title is missing', async () => {
    mockScrape.mockResolvedValueOnce({
      html: '<p>Some content</p>',
      metadata: {
        // title intentionally missing
        publishedTime: '2026-04-01',
      },
    });

    const result = await pollWebSource(webSource);
    expect(result.status).toBe('success');
    expect(result.items[0].title).toBe('Example Page');
  });

  // T2b: Metadata missing title AND no source.name -> fallback to URL
  it('falls back to source URL when both metadata title and source name are absent', async () => {
    mockScrape.mockResolvedValueOnce({
      html: '<p>Some content</p>',
      metadata: {},
    });

    const sourceNoName = { id: 'web-source-2', url: 'https://example.com/page' };
    const result = await pollWebSource(sourceNoName);
    expect(result.status).toBe('success');
    expect(result.items[0].title).toBe('https://example.com/page');
  });

  // T3: Metadata missing publishedTime -> fallback to current date
  it('falls back to current ISO date when publishedTime is missing', async () => {
    const beforeTest = new Date().toISOString();
    mockScrape.mockResolvedValueOnce({
      html: '<p>Content</p>',
      metadata: { title: 'Test' },
    });

    const result = await pollWebSource(webSource);
    expect(result.status).toBe('success');

    const publishedAt = result.items[0].publishedAt!;
    // Should be a valid ISO string generated at or after the test started
    expect(new Date(publishedAt).toISOString()).toBe(publishedAt);
    expect(publishedAt >= beforeTest).toBe(true);
  });

  // T4: Firecrawl returns null HTML -> error status
  it('returns error status when Firecrawl returns null HTML', async () => {
    mockScrape.mockResolvedValueOnce({
      html: null,
      metadata: { title: 'Empty' },
    });

    const result = await pollWebSource(webSource);
    expect(result.status).toBe('error');
    expect(result.error).toContain('Firecrawl returned no HTML body');
    expect(result.items).toHaveLength(0);
  });

  // T5: validateWebUrl throws -> pollWebSource returns error
  it('returns error status when URL validation fails', async () => {
    // Make the HEAD request return 404 (triggers validateWebUrl throw)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'text/html' }),
    });

    const result = await pollWebSource(webSource);
    expect(result.status).toBe('error');
    expect(result.error).toContain('Web URL validation failed');
    expect(result.error).toContain('404');
    expect(result.items).toHaveLength(0);
  });

  // T6: F-1 regression — Option C stores raw HTML; no Turndown in poller means no escape risk
  it('stores raw HTML in contentEncoded (F-1 prevention via Option C: no Turndown in poller)', async () => {
    mockScrape.mockResolvedValueOnce({
      html: '<h1>Heading</h1><a href="/x">link</a>',
      metadata: { title: 'F-1 Test' },
    });

    const result = await pollWebSource(webSource);
    expect(result.status).toBe('success');

    const content = result.items[0].contentEncoded!;
    // Option C: raw HTML is passed through — extractContent does the single Turndown
    expect(content).toContain('<h1>Heading</h1>');
    expect(content).toContain('<a href="/x">link</a>');
    // Must NOT contain any markdown (Turndown is NOT called in pollWebSource)
    expect(content).not.toContain('# Heading');
    expect(content).not.toContain('\\#');
  });
});

// ---------------------------------------------------------------------------
// validateWebUrl
// ---------------------------------------------------------------------------

describe('validateWebUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // T7: 200 + text/html + non-empty body -> resolves
  it('resolves for 200 + text/html response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });

    await expect(validateWebUrl('https://example.com')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  // T8: 404 -> throws with descriptive error
  it('throws for HTTP 404', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'text/html' }),
    });

    await expect(validateWebUrl('https://example.com/missing')).rejects.toThrow(
      /Web URL validation failed.*HTTP 404/,
    );
  });

  // T9: 200 + application/json -> throws
  it('throws for non-HTML content type (application/json)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    await expect(
      validateWebUrl('https://api.example.com/data'),
    ).rejects.toThrow(/expected HTML content-type.*application\/json/);
  });

  // T10: 200 + empty content-type -> throws
  it('throws when content-type header is empty (not HTML)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({}), // no content-type
    });

    await expect(
      validateWebUrl('https://example.com/binary'),
    ).rejects.toThrow(/expected HTML content-type/);
  });

  // T11-L1a: 501 on HEAD -> falls back to ranged GET
  it('falls back to ranged GET when HEAD returns 501 (Not Implemented)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 501,
      headers: new Headers({}),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });

    await expect(validateWebUrl('https://example.com/page')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: 'HEAD' });
    expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: 'GET' });
  });

  // T11-L1b: 403 on HEAD -> falls back to ranged GET
  it('falls back to ranged GET when HEAD returns 403 (Forbidden)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers({}),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });

    await expect(validateWebUrl('https://example.com/page')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: 'HEAD' });
    expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: 'GET' });
  });

  // T11-M3a: Content-Length: 0 -> throws empty body error
  it('throws when Content-Length is explicitly 0 (empty body, M-3)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'text/html; charset=utf-8',
        'content-length': '0',
      }),
    });

    await expect(validateWebUrl('https://example.com/empty')).rejects.toThrow(
      /Content-Length is 0/,
    );
  });

  // T11-M3b: Missing Content-Length header does NOT reject (streaming)
  it('does not reject when Content-Length header is missing (streaming response)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
    });

    await expect(validateWebUrl('https://example.com/stream')).resolves.toBeUndefined();
  });

  // T11: 405 on HEAD -> falls back to ranged GET, succeeds if GET path works
  it('falls back to ranged GET when HEAD returns 405, and succeeds', async () => {
    // First call: HEAD -> 405
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 405,
      headers: new Headers({ 'content-type': 'text/html' }),
    });
    // Second call: ranged GET -> 200 or 206 (partial content)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });

    await expect(validateWebUrl('https://example.com/page')).resolves.toBeUndefined();

    // Verify two fetch calls: HEAD then GET with Range header
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: 'HEAD' });
    expect(mockFetch.mock.calls[1][1]).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({ Range: 'bytes=0-1023' }),
    });
  });

  // T11b: 206 (partial content) is also accepted
  it('accepts HTTP 206 (partial content) from ranged GET fallback', async () => {
    // HEAD -> 405
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 405,
      headers: new Headers({}),
    });
    // Ranged GET -> 206
    mockFetch.mockResolvedValueOnce({
      ok: false, // 206 is not "ok" per fetch spec
      status: 206,
      headers: new Headers({ 'content-type': 'text/html' }),
    });

    await expect(validateWebUrl('https://example.com')).resolves.toBeUndefined();
  });
});

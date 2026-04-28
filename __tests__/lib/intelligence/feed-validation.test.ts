// __tests__/lib/intelligence/feed-validation.test.ts
// Tests for SI-M5: Feed URL validation before adding a source
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock rss-parser
vi.mock('rss-parser', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        parseString: vi.fn().mockImplementation(async (xml: string) => {
          if (xml.includes('<rss') || xml.includes('<feed')) {
            return {
              title: 'Test Feed',
              items: [{ title: 'Article 1' }, { title: 'Article 2' }],
            };
          }
          throw new Error('Not a valid feed');
        }),
      };
    }),
  };
});

describe('SI-M5: validateFeedUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates a valid RSS feed URL', async () => {
    const { validateFeedUrl } = await import('@/lib/intelligence/feed-poller');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/rss+xml' }),
      text: () =>
        Promise.resolve(
          '<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title></channel></rss>',
        ),
    });

    const result = await validateFeedUrl('https://example.com/feed.rss');
    expect(result.valid).toBe(true);
    expect(result.title).toBe('Test Feed');
    expect(result.articleCount).toBe(2);
  });

  it('validates a valid Atom feed URL', async () => {
    const { validateFeedUrl } = await import('@/lib/intelligence/feed-poller');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/atom+xml' }),
      text: () =>
        Promise.resolve(
          '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Feed</title></feed>',
        ),
    });

    const result = await validateFeedUrl('https://example.com/feed.atom');
    expect(result.valid).toBe(true);
    expect(result.title).toBe('Test Feed');
  });

  it('rejects a URL that returns non-RSS content', async () => {
    const { validateFeedUrl } = await import('@/lib/intelligence/feed-poller');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: () => Promise.resolve('<html><body>Not a feed</body></html>'),
    });

    const result = await validateFeedUrl('https://example.com/page');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('does not return RSS or Atom');
  });

  it('rejects a URL that returns HTTP error', async () => {
    const { validateFeedUrl } = await import('@/lib/intelligence/feed-poller');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
    });

    const result = await validateFeedUrl('https://example.com/missing');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('HTTP 404');
  });

  it('handles timeout gracefully', async () => {
    const { validateFeedUrl } = await import('@/lib/intelligence/feed-poller');

    const abortError = new DOMException('Aborted', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortError);

    const result = await validateFeedUrl('https://example.com/slow');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('handles network errors gracefully', async () => {
    const { validateFeedUrl } = await import('@/lib/intelligence/feed-poller');

    mockFetch.mockRejectedValueOnce(new Error('DNS resolution failed'));

    const result = await validateFeedUrl(
      'https://nonexistent.example.com/feed',
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('DNS resolution failed');
  });

  it('accepts XML content with xml content-type', async () => {
    const { validateFeedUrl } = await import('@/lib/intelligence/feed-poller');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/xml; charset=utf-8' }),
      text: () =>
        Promise.resolve(
          '<rss version="2.0"><channel><title>XML Feed</title></channel></rss>',
        ),
    });

    const result = await validateFeedUrl('https://example.com/feed.xml');
    expect(result.valid).toBe(true);
  });
});

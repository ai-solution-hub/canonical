// __tests__/lib/intelligence/feed-poller.test.ts
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
  pollFeed,
  parseFeedItems,
  normaliseFeedTitle,
} from '@/lib/intelligence/feed-poller';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>GOV.UK - Department for Education</title>
  <entry>
    <id>tag:www.gov.uk,2005:/government/publications/kcsie-2026</id>
    <updated>2026-04-01T10:00:00+01:00</updated>
    <link rel="alternate" type="text/html" href="https://www.gov.uk/government/publications/kcsie-2026"/>
    <title>Keeping children safe in education 2026</title>
    <summary type="html">&lt;p&gt;Updated statutory guidance for schools.&lt;/p&gt;</summary>
    <category term="Education"/>
  </entry>
  <entry>
    <id>tag:www.gov.uk,2005:/government/publications/pupil-premium</id>
    <updated>2026-03-30T09:00:00+01:00</updated>
    <link rel="alternate" type="text/html" href="https://www.gov.uk/government/publications/pupil-premium"/>
    <title>Pupil premium: allocations and conditions of grant 2026 to 2027</title>
    <summary type="html">&lt;p&gt;Pupil premium allocations.&lt;/p&gt;</summary>
  </entry>
</feed>`;

describe('normaliseFeedTitle', () => {
  it('collapses literal newlines to single spaces', () => {
    expect(normaliseFeedTitle('Diocese of\nPortsmouth')).toBe(
      'Diocese of Portsmouth',
    );
  });

  it('handles CRLF (\\r\\n) whitespace', () => {
    expect(normaliseFeedTitle('Diocese of\r\nPortsmouth')).toBe(
      'Diocese of Portsmouth',
    );
  });

  it('collapses multiple spaces to one', () => {
    expect(normaliseFeedTitle('Diocese    of   Portsmouth')).toBe(
      'Diocese of Portsmouth',
    );
  });

  it('trims leading and trailing whitespace', () => {
    expect(normaliseFeedTitle('  Diocese of Portsmouth  ')).toBe(
      'Diocese of Portsmouth',
    );
  });

  it('collapses mixed tabs, newlines and spaces', () => {
    expect(normaliseFeedTitle('\t Diocese \n of \r\n Portsmouth \t')).toBe(
      'Diocese of Portsmouth',
    );
  });

  it('returns empty string for null/undefined', () => {
    expect(normaliseFeedTitle(null)).toBe('');
    expect(normaliseFeedTitle(undefined)).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normaliseFeedTitle('   \n\t  ')).toBe('');
  });
});

describe('parseFeedItems', () => {
  it('parses Atom feed items into ParsedFeedItem shape', async () => {
    const items = await parseFeedItems(ATOM_FEED);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Keeping children safe in education 2026',
      url: 'https://www.gov.uk/government/publications/kcsie-2026',
      guid: 'tag:www.gov.uk,2005:/government/publications/kcsie-2026',
    });
    expect(items[0].publishedAt).toBeTruthy();
    expect(items[0].categories).toContain('Education');
  });

  it('returns empty array for empty feed', async () => {
    const emptyFeed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Empty</title></feed>`;
    const items = await parseFeedItems(emptyFeed);
    expect(items).toHaveLength(0);
  });
});

describe('pollFeed', () => {
  const mockSource = {
    id: 'source-1',
    url: 'https://www.gov.uk/search/all.atom?organisations[]=department-for-education',
    etag: null as string | null,
    last_modified: null as string | null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns items on successful poll with etag and lastModified', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        ETag: '"abc123"',
        'Last-Modified': 'Tue, 01 Apr 2026 10:00:00 GMT',
      }),
      text: () => Promise.resolve(ATOM_FEED),
    });

    const result = await pollFeed(mockSource);
    expect(result.status).toBe('success');
    expect(result.items).toHaveLength(2);
    expect(result.etag).toBe('"abc123"');
    expect(result.lastModified).toBe('Tue, 01 Apr 2026 10:00:00 GMT');
  });

  it('returns not_modified on 304', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 304,
      headers: new Headers(),
      text: () => Promise.resolve(''),
    });

    const result = await pollFeed({ ...mockSource, etag: '"abc123"' });
    expect(result.status).toBe('not_modified');
    expect(result.items).toHaveLength(0);
  });

  it('sends conditional request headers when etag is present', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve(ATOM_FEED),
    });

    await pollFeed({ ...mockSource, etag: '"abc123"' });
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['If-None-Match']).toBe('"abc123"');
  });

  it('returns error on HTTP failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers(),
      text: () => Promise.resolve('Server Error'),
    });

    const result = await pollFeed(mockSource);
    expect(result.status).toBe('error');
    expect(result.error).toContain('500');
  });

  it('returns timeout on fetch timeout', async () => {
    mockFetch.mockRejectedValueOnce(
      new DOMException('The operation was aborted', 'AbortError'),
    );

    const result = await pollFeed(mockSource);
    expect(result.status).toBe('timeout');
  });
});

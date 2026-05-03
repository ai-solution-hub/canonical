// __tests__/lib/intelligence/feed-poller-web.test.ts
/**
 * S222 W3-A §2.3.4: native website scraping — IMPL tests for the four
 * residual gaps closed by this wave (HEAD pre-flight + ETag/IMS +
 * per-domain rate-limit parity + Firecrawl-credit telemetry).
 *
 * AC mapping (spec §6):
 *   - AC-1: First-ever poll → HEAD 200 + new ETag → Firecrawl runs.
 *   - AC-2: Firecrawl 4xx → status='error', no Jina at poll layer.
 *   - AC-3: Firecrawl 503 once → next-tick retry (assert eligibility).
 *   - AC-4: Re-poll same URL same content → HEAD 304 → not_modified.
 *   - AC-5: Re-poll same URL changed content (server with ETag).
 *   - AC-6: Re-poll same URL changed content (no ETag).
 *   - AC-7: Different URL same content → both feed_articles inserts.
 *   - AC-8: Two web sources same hostname → rate-limit serialises.
 *   - AC-9: HEAD 304 → last_polled_status routing eligibility.
 *   - AC-12: Counter increments only on actual `.scrape()` calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (must precede the feed-poller import) ──

// Mock Sentry to capture breadcrumbs deterministically (AC-12 verification)
const mockAddBreadcrumb = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

// Mock rate limiter — but verify waitForDomain is called (AC-8 parity)
const mockWaitForDomain = vi.fn().mockResolvedValue(undefined);
const mockRecordSuccess = vi.fn();
vi.mock('@/lib/intelligence/rate-limiter', () => ({
  getGlobalRateLimiter: () => ({
    waitForDomain: mockWaitForDomain,
    recordSuccess: mockRecordSuccess,
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

// Mock Firecrawl — function keyword required for `new` per CLAUDE.md gotcha
const mockScrape = vi.fn();
vi.mock('@mendable/firecrawl-js', () => ({
  default: vi.fn().mockImplementation(function () {
    return { scrape: mockScrape };
  }),
}));

// Mock global fetch (covers both validateWebUrl + HEAD pre-flight)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { pollWebSource } from '@/lib/intelligence/feed-poller';

// ── Fixtures ──

const FIXED_NOW = new Date('2026-05-03T12:00:00.000Z').getTime();

beforeEach(() => {
  vi.clearAllMocks();
  // Pin time per CLAUDE.md gotcha: date-sensitive tests need pinned time.
  vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
});

// Default: validateWebUrl HEAD returns 200+text/html; HEAD pre-flight
// returns 200 with new ETag/Last-Modified. Tests override per scenario.
function defaultFetchMocks() {
  // First call (validateWebUrl HEAD): 200 + text/html
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
  });
  // Second call (HEAD pre-flight): 200 with new ETag/Last-Modified
  mockFetch.mockResolvedValueOnce({
    status: 200,
    headers: new Headers({
      ETag: '"new-etag-1"',
      'Last-Modified': 'Sat, 03 May 2026 11:00:00 GMT',
    }),
  });
}

const baseSource = {
  id: 'web-1',
  url: 'https://example.com/page',
  name: 'Example',
  etag: null,
  last_modified: null,
};

// ── AC-1: Happy path — first-ever poll ──

describe('AC-1 first-ever poll: HEAD 200 + new ETag → Firecrawl runs → counter=1', () => {
  it('returns success with populated etag/lastModified and firecrawlCalled=true', async () => {
    defaultFetchMocks();
    mockScrape.mockResolvedValueOnce({
      html: '<h1>Hello</h1>',
      metadata: { title: 'Example', publishedTime: '2026-05-03T11:00:00Z' },
    });

    const result = await pollWebSource(baseSource);

    expect(result.status).toBe('success');
    expect(result.items).toHaveLength(1);
    expect(result.etag).toBe('"new-etag-1"');
    expect(result.lastModified).toBe('Sat, 03 May 2026 11:00:00 GMT');
    expect(result.headPreflightStatus).toBe(200);
    expect(result.firecrawlCalled).toBe(true);

    // Rate-limit gate must have run (AC-8 parity).
    expect(mockWaitForDomain).toHaveBeenCalledWith(
      'https://example.com/page',
    );
    expect(mockRecordSuccess).toHaveBeenCalledWith(
      'https://example.com/page',
    );

    // Telemetry breadcrumb fired with status='modified' (D-5).
    const credBreadcrumb = mockAddBreadcrumb.mock.calls.find(
      ([arg]) =>
        (arg as { category?: string }).category ===
        'intelligence.web-source.firecrawl-call',
    );
    expect(credBreadcrumb).toBeDefined();
    expect(credBreadcrumb![0]).toMatchObject({
      category: 'intelligence.web-source.firecrawl-call',
      data: expect.objectContaining({
        sourceId: 'web-1',
        success: true,
        status: 'modified',
        firecrawlCalled: true,
      }),
    });
  });
});

// ── AC-2: Firecrawl 4xx → no Jina at poll layer ──

describe('AC-2 Firecrawl 4xx → status=error, no Jina at poll layer', () => {
  it('returns error status; firecrawlCalled=true (call attempted but failed); items empty', async () => {
    defaultFetchMocks();
    mockScrape.mockRejectedValueOnce(
      new Error('Firecrawl API error: 400 Bad Request'),
    );

    const result = await pollWebSource(baseSource);

    expect(result.status).toBe('error');
    expect(result.error).toContain('400');
    expect(result.items).toHaveLength(0);
    // Per D-5: SDK has hit the network even on non-2xx; firecrawlCalled
    // tracks attempts (matches Firecrawl billing). AC-12 still requires
    // we DON'T count error in `firecrawl_credits_consumed` aggregation;
    // the route handler / aggregator filters by status. The flag itself
    // is a raw attempt counter.
    expect(result.firecrawlCalled).toBe(true);

    // No second SDK invocation (no Jina poll-layer fallback).
    expect(mockScrape).toHaveBeenCalledTimes(1);

    // Telemetry breadcrumb with status='error'.
    const errBreadcrumb = mockAddBreadcrumb.mock.calls.find(
      ([arg]) =>
        (arg as { data?: { status?: string } }).data?.status === 'error',
    );
    expect(errBreadcrumb).toBeDefined();
  });
});

// ── AC-3: transient retry eligibility ──

describe('AC-3 Firecrawl 503 once → next-tick retry would be eligible', () => {
  it('returns error; downstream retry is the cron-tick responsibility (proven by error not throwing)', async () => {
    defaultFetchMocks();
    mockScrape.mockRejectedValueOnce(
      new Error('Firecrawl API error: 503 Service Unavailable'),
    );

    const result = await pollWebSource(baseSource);

    // pollWebSource returns; consecutive_failures increments via
    // updateSourceAfterPoll in pipeline.ts. The next cron tick is
    // eligible per get_due_feed_sources exponential backoff
    // (polling_interval_minutes * 2^min(consecutive_failures, 6)).
    expect(result.status).toBe('error');
    expect(result.error).toContain('503');
  });
});

// ── AC-4: re-poll same URL same content (HEAD 304) ──

describe('AC-4 re-poll same URL same content → HEAD 304 → not_modified', () => {
  it('short-circuits with status=not_modified, zero items, firecrawlCalled=false', async () => {
    // validateWebUrl HEAD: 200
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });
    // HEAD pre-flight returns 304 (server respects If-None-Match)
    mockFetch.mockResolvedValueOnce({
      status: 304,
      headers: new Headers({}),
    });

    const result = await pollWebSource({
      ...baseSource,
      etag: '"existing-etag"',
      last_modified: 'Fri, 02 May 2026 10:00:00 GMT',
    });

    expect(result.status).toBe('not_modified');
    expect(result.items).toHaveLength(0);
    expect(result.headPreflightStatus).toBe(304);
    expect(result.firecrawlCalled).toBe(false);
    // Stored etag is preserved on 304 (passes through).
    expect(result.etag).toBe('"existing-etag"');
    expect(result.lastModified).toBe('Fri, 02 May 2026 10:00:00 GMT');

    // Firecrawl SDK NOT invoked (zero credit).
    expect(mockScrape).not.toHaveBeenCalled();

    // HEAD pre-flight included conditional-request headers.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][1]).toMatchObject({
      method: 'HEAD',
      headers: expect.objectContaining({
        'If-None-Match': '"existing-etag"',
        'If-Modified-Since': 'Fri, 02 May 2026 10:00:00 GMT',
      }),
    });

    // Telemetry breadcrumb fired with firecrawlCalled=false + status='unchanged'.
    const credBreadcrumb = mockAddBreadcrumb.mock.calls.find(
      ([arg]) =>
        (arg as { category?: string }).category ===
        'intelligence.web-source.firecrawl-call',
    );
    expect(credBreadcrumb![0]).toMatchObject({
      data: expect.objectContaining({
        success: true,
        status: 'unchanged',
        firecrawlCalled: false,
      }),
    });
  });
});

// ── AC-5: re-poll same URL changed content, server respects ETag ──

describe('AC-5 re-poll same URL changed content (server with ETag) → HEAD 200 + Firecrawl runs', () => {
  it('proceeds to Firecrawl; new ETag captured for next cycle', async () => {
    // validateWebUrl HEAD: 200
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });
    // HEAD pre-flight: 200 with NEW ETag (content has changed)
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: new Headers({
        ETag: '"changed-etag-2"',
        'Last-Modified': 'Sat, 03 May 2026 12:00:00 GMT',
      }),
    });
    mockScrape.mockResolvedValueOnce({
      html: '<p>Updated content</p>',
      metadata: { title: 'Updated Page' },
    });

    const result = await pollWebSource({
      ...baseSource,
      etag: '"old-etag"',
      last_modified: 'Fri, 02 May 2026 10:00:00 GMT',
    });

    expect(result.status).toBe('success');
    expect(result.firecrawlCalled).toBe(true);
    expect(result.etag).toBe('"changed-etag-2"');
    expect(result.lastModified).toBe('Sat, 03 May 2026 12:00:00 GMT');

    // Pipeline.ts isDuplicate() will catch URL match — that path is
    // covered by pipeline.test.ts; here we just verify the pollWebSource
    // contract returns the new ETag so the next pre-flight starts fresh.
  });
});

// ── AC-6: re-poll same URL changed content, server with NO ETag ──

describe('AC-6 re-poll same URL changed content (server NO ETag) → Firecrawl runs (1 credit)', () => {
  it('falls through to Firecrawl when origin omits ETag — canonical wasted-credit case', async () => {
    // validateWebUrl HEAD: 200
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });
    // HEAD pre-flight: 200, no ETag/Last-Modified headers (poorly-behaved origin)
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: new Headers({}),
    });
    mockScrape.mockResolvedValueOnce({
      html: '<p>Same body, different ETag absent</p>',
      metadata: {},
    });

    const result = await pollWebSource(baseSource);

    expect(result.status).toBe('success');
    expect(result.firecrawlCalled).toBe(true);
    expect(result.etag).toBe(null);
    expect(result.lastModified).toBe(null);

    // The "wasted credit" telemetry breadcrumb still fires with status='modified'.
    const credBreadcrumb = mockAddBreadcrumb.mock.calls.find(
      ([arg]) =>
        (arg as { data?: { firecrawlCalled?: boolean } }).data
          ?.firecrawlCalled === true,
    );
    expect(credBreadcrumb).toBeDefined();
  });
});

// ── AC-7: different URL same content (covered by pipeline.test.ts dedup) ──

describe('AC-7 different URL same content → poll layer succeeds for each (dedup is downstream)', () => {
  it('two distinct sources both succeed at poll layer; content_items dedup is pipeline.ts concern', async () => {
    // First source poll
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ ETag: '"a"' }),
    });
    mockScrape.mockResolvedValueOnce({
      html: '<p>Identical body</p>',
      metadata: { title: 'Source A' },
    });

    const resultA = await pollWebSource({
      id: 'web-A',
      url: 'https://example.com/a',
      name: 'A',
      etag: null,
      last_modified: null,
    });

    // Second source poll (different URL, identical body)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ ETag: '"b"' }),
    });
    mockScrape.mockResolvedValueOnce({
      html: '<p>Identical body</p>',
      metadata: { title: 'Source B' },
    });

    const resultB = await pollWebSource({
      id: 'web-B',
      url: 'https://example.com/b',
      name: 'B',
      etag: null,
      last_modified: null,
    });

    expect(resultA.status).toBe('success');
    expect(resultB.status).toBe('success');
    // Both produced the same payload — the soft-block at content_items
    // is a pipeline.ts concern (checkExactDuplicate) not poll-layer.
    expect(resultA.items[0].contentEncoded).toBe(resultB.items[0].contentEncoded);
  });
});

// ── AC-8: two web sources same hostname → rate-limit serialises ──

describe('AC-8 two web sources same hostname → rate-limit serialises (waitForDomain called per source)', () => {
  it('invokes waitForDomain twice (once per source) — actual delay is rate-limiter internal', async () => {
    // Source 1
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ ETag: '"1"' }),
    });
    mockScrape.mockResolvedValueOnce({
      html: '<p>page 1</p>',
      metadata: {},
    });
    // Source 2
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ ETag: '"2"' }),
    });
    mockScrape.mockResolvedValueOnce({
      html: '<p>page 2</p>',
      metadata: {},
    });

    const source1 = {
      id: 'web-1',
      url: 'https://shared.example.com/a',
      name: 'a',
      etag: null,
      last_modified: null,
    };
    const source2 = {
      id: 'web-2',
      url: 'https://shared.example.com/b',
      name: 'b',
      etag: null,
      last_modified: null,
    };

    await pollWebSource(source1);
    await pollWebSource(source2);

    expect(mockWaitForDomain).toHaveBeenCalledTimes(2);
    expect(mockWaitForDomain).toHaveBeenNthCalledWith(
      1,
      'https://shared.example.com/a',
    );
    expect(mockWaitForDomain).toHaveBeenNthCalledWith(
      2,
      'https://shared.example.com/b',
    );
    // Both calls share the same hostname — the rate-limiter (real
    // implementation) enforces MIN_DOMAIN_DELAY_MS=1500 between them.
    // We rely on the rate-limiter's own unit tests for the delay
    // assertion; here we prove the gate is invoked.
  });
});

// ── AC-9: HEAD 304 short-circuit → status='not_modified' (routes to last_polled_status) ──

describe('AC-9 HEAD 304 → status=not_modified (pipeline writes last_polled_status=not_modified)', () => {
  it('produces a PollResult with status=not_modified that pipeline.updateSourceAfterPoll writes verbatim', async () => {
    // validateWebUrl HEAD: 200
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });
    // HEAD pre-flight: 304
    mockFetch.mockResolvedValueOnce({
      status: 304,
      headers: new Headers({}),
    });

    const result = await pollWebSource({
      ...baseSource,
      etag: '"stable"',
    });

    expect(result.status).toBe('not_modified');
    // pipeline.ts updateSourceAfterPoll passes `status` directly into
    // `last_polled_status` — the CHECK constraint
    // (feed_sources_last_polled_status_check) permits 'not_modified'.
  });
});

// ── AC-12: counter increments only on actual .scrape() calls ──

describe('AC-12 firecrawlCalled counter discipline: HEAD-304 = false; HEAD-200+success = true; validateWebUrl-fail = false', () => {
  it('HEAD-304 → firecrawlCalled=false (zero credit attempt)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });
    mockFetch.mockResolvedValueOnce({
      status: 304,
      headers: new Headers({}),
    });

    const result = await pollWebSource({
      ...baseSource,
      etag: '"e"',
    });

    expect(result.firecrawlCalled).toBe(false);
    expect(mockScrape).not.toHaveBeenCalled();
  });

  it('HEAD-200 + Firecrawl success → firecrawlCalled=true (1 credit)', async () => {
    defaultFetchMocks();
    mockScrape.mockResolvedValueOnce({
      html: '<p>x</p>',
      metadata: {},
    });

    const result = await pollWebSource(baseSource);

    expect(result.firecrawlCalled).toBe(true);
    expect(mockScrape).toHaveBeenCalledTimes(1);
  });

  it('validateWebUrl failure → firecrawlCalled=false (no HEAD pre-flight either)', async () => {
    // validateWebUrl HEAD: 404
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'text/html' }),
    });

    const result = await pollWebSource(baseSource);

    expect(result.status).toBe('error');
    expect(result.firecrawlCalled).toBe(false);
    expect(result.headPreflightStatus).toBe(null);
    expect(mockScrape).not.toHaveBeenCalled();
    expect(mockWaitForDomain).not.toHaveBeenCalled();
  });
});

// ── HEAD pre-flight fault tolerance (servers that reject HEAD outright) ──

describe('HEAD pre-flight network error → falls through to Firecrawl', () => {
  it('captures null headPreflightStatus and proceeds to Firecrawl when HEAD throws', async () => {
    // validateWebUrl HEAD: 200
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });
    // HEAD pre-flight: throws (e.g. AbortError)
    mockFetch.mockRejectedValueOnce(new Error('network timeout'));

    mockScrape.mockResolvedValueOnce({
      html: '<p>fallback</p>',
      metadata: {},
    });

    const result = await pollWebSource(baseSource);

    expect(result.status).toBe('success');
    expect(result.firecrawlCalled).toBe(true);
    expect(result.headPreflightStatus).toBe(null);
  });
});

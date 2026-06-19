/**
 * Tests for fetchForExtraction + extractHtmlMetadata — the reusable fetch
 * portion of the manual URL-import path (Task ID-112 {112.10}).
 *
 * {112.10} splits lib/extraction/url.ts so the route owns the SSRF-gated fetch
 * (validate → fetch → 20MB cap → redirect re-validate → PDF-vs-HTML detection)
 * and then hands HTML to the B1 /extract cleaner via cleanViaWorker. The PDF
 * branch still detects-and-returns the buffer so the route runs unpdf
 * in-process. extractHtmlMetadata derives title/author/excerpt/og locally from
 * the fetched HTML WITHOUT Readability (Readability is removed from the live
 * path; {112.13} deletes the dependency).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/extraction/url-validation', () => ({
  validateUrl: vi.fn(() => ({ valid: true })),
}));

import { fetchForExtraction, extractHtmlMetadata } from '@/lib/extraction/url';
import { validateUrl } from '@/lib/extraction/url-validation';

const fetchMock = vi.hoisted(() => vi.fn());
const validateUrlMock = vi.mocked(validateUrl);

function htmlResponse(html: string, finalUrl = 'https://example.com/a') {
  return {
    ok: true,
    status: 200,
    url: finalUrl,
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    text: async () => html,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function pdfResponse(finalUrl = 'https://example.com/a.pdf') {
  return {
    ok: true,
    status: 200,
    url: finalUrl,
    headers: new Headers({ 'content-type': 'application/pdf' }),
    text: async () => '',
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as unknown as Response;
}

describe('fetchForExtraction', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    validateUrlMock.mockReset();
    validateUrlMock.mockReturnValue({ valid: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the HTML body and final URL for an HTML content-type', async () => {
    const html = '<html><body><article>Hi</article></body></html>';
    fetchMock.mockResolvedValueOnce(
      htmlResponse(html, 'https://example.com/final'),
    );

    const result = await fetchForExtraction('https://example.com/a');

    expect(result.kind).toBe('html');
    if (result.kind === 'html') {
      expect(result.html).toBe(html);
      expect(result.finalUrl).toBe('https://example.com/final');
    }
  });

  it('returns the PDF buffer for an application/pdf content-type', async () => {
    fetchMock.mockResolvedValueOnce(pdfResponse());

    const result = await fetchForExtraction('https://example.com/a.pdf');

    expect(result.kind).toBe('pdf');
    if (result.kind === 'pdf') {
      expect(result.buffer.byteLength).toBe(3);
    }
  });

  it('throws on an initial SSRF-rejected URL (does not fetch)', async () => {
    validateUrlMock.mockReturnValueOnce({
      valid: false,
      error: 'Blocked host',
    });
    await expect(fetchForExtraction('http://169.254.169.254/')).rejects.toThrow(
      'Blocked host',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when a redirect lands on a blocked final URL (re-validates)', async () => {
    // First validateUrl call (initial) passes, second (final URL) rejects.
    validateUrlMock
      .mockReturnValueOnce({ valid: true })
      .mockReturnValueOnce({ valid: false, error: 'Blocked host' });
    fetchMock.mockResolvedValueOnce(
      htmlResponse('<html></html>', 'http://10.0.0.1/'),
    );
    await expect(fetchForExtraction('https://example.com/a')).rejects.toThrow(
      /Redirect to blocked URL/,
    );
  });

  it('throws when the declared content-length exceeds the 20 MB cap', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: 'https://example.com/a',
      headers: new Headers({
        'content-type': 'text/html',
        'content-length': String(21 * 1024 * 1024),
      }),
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);
    await expect(fetchForExtraction('https://example.com/a')).rejects.toThrow(
      /20 MB/,
    );
  });

  it('throws on a non-ok fetch response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      url: 'https://example.com/a',
      headers: new Headers(),
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);
    await expect(fetchForExtraction('https://example.com/a')).rejects.toThrow(
      /status 404/,
    );
  });
});

describe('extractHtmlMetadata', () => {
  it('extracts the title from og:title', () => {
    const html =
      '<html><head><meta property="og:title" content="OG Title"><title>Doc Title</title></head></html>';
    const meta = extractHtmlMetadata(html);
    expect(meta.title).toBe('OG Title');
  });

  it('falls back to <title> when og:title is absent', () => {
    const html =
      '<html><head><title>Document Title</title></head><body></body></html>';
    const meta = extractHtmlMetadata(html);
    expect(meta.title).toBe('Document Title');
  });

  it('surfaces og:description and author locally (no Readability)', () => {
    const html = `
      <meta property="og:description" content="A summary.">
      <meta property="article:author" content="Jane Doe">
    `;
    const meta = extractHtmlMetadata(html);
    expect(meta.ogDescription).toBe('A summary.');
    expect(meta.author).toBe('Jane Doe');
  });

  it('returns empty strings when no metadata is present', () => {
    const meta = extractHtmlMetadata('<html><body>no head</body></html>');
    expect(meta.title).toBe('');
    expect(meta.ogDescription).toBe('');
    expect(meta.author).toBe('');
  });
});

/**
 * Tests for cleanViaWorker — the server-side seam onto the B1 /extract
 * pure-cleaner endpoint (Task ID-112 {112.10}, PI-1/PI-2/PI-9).
 *
 * cleanViaWorker POSTs already-fetched HTML (the manual route keeps its own
 * SSRF-gated fetch; /extract is a pure cleaner, no fetch on B1) to
 * `${COCOINDEX_WORKER_URL}/extract?url=<finalUrl>` with a dedicated
 * `Bearer ${EXTRACT_API_TOKEN}` and returns the endpoint's `{text, verdict,
 * warnings}` (contract: scripts/cocoindex_pipeline/server.py::_extract_handler).
 *
 * Behaviour under test:
 *   - request contract: URL (with encoded ?url=), method, headers, body match
 *     server.py exactly;
 *   - happy path returns the parsed {text, verdict, warnings};
 *   - unreachable endpoint / non-2xx / unset config throw the typed
 *     `ExtractEndpointError` the route maps to a recoverable 503 (NOT a 500).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cleanViaWorker,
  ExtractEndpointError,
} from '@/lib/extraction/clean-via-worker';

const fetchMock = vi.hoisted(() => vi.fn());

const HTML = '<html><body><article>Some real content.</article></body></html>';
const FINAL_URL = 'https://example.com/path?q=1&x=2';

describe('cleanViaWorker', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('COCOINDEX_WORKER_URL', 'https://cocoindex-worker.example.com');
    vi.stubEnv('EXTRACT_API_TOKEN', 'test-extract-token');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        text: 'cleaned text',
        verdict: 'ok',
        warnings: [],
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('POSTs the HTML body to /extract with the encoded url query param and the dedicated bearer', async () => {
    await cleanViaWorker(HTML, FINAL_URL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    // URL: {COCOINDEX_WORKER_URL}/extract?url=<encoded finalUrl> (no double slash).
    expect(calledUrl).toBe(
      `https://cocoindex-worker.example.com/extract?url=${encodeURIComponent(
        FINAL_URL,
      )}`,
    );
    expect(init.method).toBe('POST');
    // Dedicated EXTRACT_API_TOKEN bearer — NOT CRON_SECRET.
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer test-extract-token',
    );
    // The raw HTML is the body the pure cleaner reads (server.py reads the body).
    expect(init.body).toBe(HTML);
  });

  it('returns the parsed {text, verdict, warnings} from the endpoint', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        text: 'the cleaned article',
        verdict: 'warn',
        warnings: ['Limited text extracted from this page.'],
      }),
    });

    const result = await cleanViaWorker(HTML, FINAL_URL);

    expect(result).toEqual({
      text: 'the cleaned article',
      verdict: 'warn',
      warnings: ['Limited text extracted from this page.'],
    });
  });

  it('trims a single trailing slash on COCOINDEX_WORKER_URL so the path never doubles up', async () => {
    vi.stubEnv('COCOINDEX_WORKER_URL', 'https://cocoindex-worker.example.com/');
    await cleanViaWorker(HTML, FINAL_URL);
    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toBe(
      `https://cocoindex-worker.example.com/extract?url=${encodeURIComponent(
        FINAL_URL,
      )}`,
    );
  });

  it('throws ExtractEndpointError when COCOINDEX_WORKER_URL is unset', async () => {
    vi.stubEnv('COCOINDEX_WORKER_URL', '');
    await expect(cleanViaWorker(HTML, FINAL_URL)).rejects.toBeInstanceOf(
      ExtractEndpointError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws ExtractEndpointError when EXTRACT_API_TOKEN is unset', async () => {
    vi.stubEnv('EXTRACT_API_TOKEN', '');
    await expect(cleanViaWorker(HTML, FINAL_URL)).rejects.toBeInstanceOf(
      ExtractEndpointError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws ExtractEndpointError when the endpoint is unreachable (fetch rejects)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await expect(cleanViaWorker(HTML, FINAL_URL)).rejects.toBeInstanceOf(
      ExtractEndpointError,
    );
  });

  it('throws ExtractEndpointError on a non-2xx response (e.g. 401/429/500 from B1)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'service unavailable' }),
    });
    await expect(cleanViaWorker(HTML, FINAL_URL)).rejects.toBeInstanceOf(
      ExtractEndpointError,
    );
  });
});

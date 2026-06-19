/**
 * TS mirror parity test for the shared cleaner (ID-112.12, PRODUCT PI-6 /
 * TECH Hand-off #3 "Fixtures").
 *
 * The manual URL-import route reaches the ONE in-house Trafilatura cleaner over HTTP via
 * `cleanViaWorker` → `POST /extract` ({112.10} seam, {112.6} endpoint). The Python
 * parity test (scripts/tests/test_extract_parity.py) already proves the in-process clean
 * (`clean_html`) is BYTE-IDENTICAL to the over-HTTP `/extract` body, and that both equal
 * a checked-in golden `.expected.txt`.
 *
 * This test is the TS half of that proof — the "mirror reference" (TECH Hand-off #3):
 * it asserts that the clean text the manual route RECEIVES from `cleanViaWorker` is the
 * SAME golden expected output. The golden `.expected.txt` files are the single source of
 * truth both the Python over-HTTP test and this TS test assert against, so a drift in
 * the shared cleaner is caught on both sides of the seam.
 *
 * The B1 `/extract` fetch is MOCKED (no real network): the realistic over-HTTP behaviour
 * is already covered by the Python test against the live endpoint handler; here we feed
 * `cleanViaWorker` the golden text exactly as a faithful B1 endpoint would return it and
 * assert the seam surfaces it unchanged to the route. Were `cleanViaWorker` to mangle
 * the body (re-encode, trim, re-serialise), the manual route would diverge from the
 * worker path — this test fails loudly if it does.
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cleanViaWorker,
  type ExtractVerdict,
} from '@/lib/extraction/clean-via-worker';

const fetchMock = vi.hoisted(() => vi.fn());

const FIXTURE_DIR = join(
  __dirname,
  '../../../scripts/tests/fixtures/extraction',
);

/**
 * The golden references — the SAME `.expected.txt` files the Python over-HTTP parity
 * test asserts against (scripts/tests/test_extract_parity.py::_GOLDEN_CASES). The `url`
 * matches the canonical document URL each seam passes Trafilatura, so this TS assertion
 * mirrors the same configured clean.
 */
const GOLDEN_CASES: ReadonlyArray<{
  name: string;
  goldenFile: string;
  finalUrl: string;
}> = [
  {
    name: 'procurement_guide',
    goldenFile: 'procurement_guide.expected.txt',
    finalUrl: 'https://example.com/guides/procurement',
  },
  {
    name: 'news_article',
    goldenFile: 'news_article.expected.txt',
    finalUrl: 'https://example.com/local-government/shared-platforms',
  },
];

function readGolden(file: string): string {
  return readFileSync(join(FIXTURE_DIR, file), 'utf8');
}

describe('cleanViaWorker golden-fixture parity (TS mirror reference)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('COCOINDEX_WORKER_URL', 'https://cocoindex-worker.example.com');
    vi.stubEnv('EXTRACT_API_TOKEN', 'test-extract-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(GOLDEN_CASES)(
    'surfaces the golden clean text from /extract unchanged for $name',
    async ({ goldenFile, finalUrl }) => {
      const golden = readGolden(goldenFile);

      // A faithful B1 `/extract` 200 response carrying the golden clean text — the same
      // bytes the Python over-HTTP test proves the live endpoint produces.
      const verdict: ExtractVerdict = 'ok';
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ text: golden, verdict, warnings: [] }),
      });

      const result = await cleanViaWorker(
        '<html><body>raw fetched bytes</body></html>',
        finalUrl,
      );

      // The clean text the manual route receives equals the golden reference — the same
      // source of truth the Python in-process == over-HTTP test asserts against.
      expect(result.text).toBe(golden);
      expect(result.verdict).toBe('ok');
      expect(result.warnings).toEqual([]);
    },
  );

  it('passes the post-redirect finalUrl through as the encoded ?url= query param (same url as the in-process seam)', async () => {
    const { finalUrl } = GOLDEN_CASES[0];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        text: readGolden(GOLDEN_CASES[0].goldenFile),
        verdict: 'ok',
        warnings: [],
      }),
    });

    await cleanViaWorker('<html><body>x</body></html>', finalUrl);

    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    // The url the over-HTTP seam hands Trafilatura must match the url the Python
    // in-process seam uses, or the byte-parity comparison would not be fair.
    expect(calledUrl).toBe(
      `https://cocoindex-worker.example.com/extract?url=${encodeURIComponent(
        finalUrl,
      )}`,
    );
  });
});

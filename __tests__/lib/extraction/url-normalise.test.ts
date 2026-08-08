// __tests__/lib/extraction/url-normalise.test.ts
/**
 * The single test file for `lib/extraction/url-normalise.ts`.
 *
 * Merged from two files. `url-normalisation-parity.test.ts` was proposed for
 * `__tests__/guards/` on the strength of its name and its "guard" framing, and
 * that was measured and rejected: it imports `normaliseUrl` and EXECUTES it,
 * so its subject is a production module and the mirror rule wins. Its own
 * docblock had already said so — "this one executes behaviour through a shared
 * fixture rather than reading sources" — which is the reading that decided it.
 *
 * That put it on this path, occupied. The two files' assertions were compared
 * rather than their filenames: the 25 fixture cases are a strict SUPERSET of
 * the five hand-written cases below on the properties they prove (hostname
 * lowercasing, tracking-param stripping, trailing-slash handling, root-slash
 * preservation, parse-failure pass-through), but they exercise DIFFERENT
 * inputs — `WWW.GOV.UK` is a real-world uppercase-TLD host the fixture does not
 * carry, and adding it to the fixture would change what pytest runs on the
 * other side of the parity seam. So both sets are retained in full: 56 tests
 * before this merge, 56 after. Nothing was de-duplicated.
 *
 * D-8 (ID-75.7) PARITY SEAM — the second block runs every case in
 * `scripts/tests/fixtures/url_normalisation_parity.json`. The SAME fixture is
 * consumed by `scripts/tests/test_url_normalise.py` against the Python port
 * `normalise_url` (`scripts/cocoindex_pipeline/url_normalise.py`). The fixture
 * is the single source of truth for both sides, so drift on either side breaks
 * tests on both sides (BI-2/BI-8 parity seam). Both Python files cite this file
 * by path — keep those citations in step with any future move.
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import { normaliseUrl } from '@/lib/extraction/url-normalise';

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

// ──────────────────────────────────────────
// D-8 cross-language parity (was __tests__/validation/url-normalisation-parity.test.ts)
// ──────────────────────────────────────────
//
// The incoming file mocked `@/lib/logger` and `@/lib/intelligence/rate-limiter`
// "so the import stays light". Those mocks are dropped, not carried: they date
// from when `normaliseUrl` lived in `lib/intelligence/content-extractor.ts`,
// and `lib/extraction/url-normalise.ts` has ZERO imports of its own — measured,
// not assumed, and confirmed by this file passing without them. Keeping an
// inert `vi.mock()` in a merged file is worse than noise, because `vi.mock()`
// hoists to the top of whatever file it lands in and would silently have
// applied to the block above as well.

const FIXTURE_PATH = join(
  __dirname,
  '../../../scripts/tests/fixtures/url_normalisation_parity.json',
);

interface ParityCase {
  name: string;
  input: string;
  expected: string;
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
  cases: ParityCase[];
};

describe('URL normalisation parity (D-8 shared fixture)', () => {
  it('fixture has cases (guard against an emptied fixture)', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  for (const parityCase of fixture.cases) {
    it(`normaliseUrl: ${parityCase.name}`, () => {
      expect(normaliseUrl(parityCase.input)).toBe(parityCase.expected);
    });

    it(`idempotent: ${parityCase.name}`, () => {
      const once = normaliseUrl(parityCase.input);
      expect(normaliseUrl(once)).toBe(once);
    });
  }
});

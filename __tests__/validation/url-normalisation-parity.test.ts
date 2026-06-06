/**
 * URL-Normalisation Parity Guard (D-8, ID-75.7)
 *
 * Runs every case in scripts/tests/fixtures/url_normalisation_parity.json
 * against the TS `normaliseUrl` (lib/intelligence/content-extractor.ts).
 * The SAME fixture is consumed by scripts/tests/test_url_normalise.py
 * against the Python port `normalise_url`
 * (scripts/cocoindex_pipeline/url_normalise.py) — the fixture is the single
 * source of truth for both sides, so drift on either side breaks tests on
 * both sides (BI-2/BI-8 parity seam).
 *
 * Sibling of __tests__/validation/pipeline-parity.test.ts (same guard-test
 * family; this one executes behaviour through a shared fixture rather than
 * reading sources).
 */

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';

// content-extractor routes telemetry through @/lib/logger and constructs a
// global rate limiter at import time — mock both so the import stays light
// (same pattern as __tests__/lib/intelligence/content-extractor.test.ts).
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  },
}));
vi.mock('@/lib/intelligence/rate-limiter', () => ({
  getGlobalRateLimiter: () => ({}),
  RateLimitError: class RateLimitError extends Error {},
}));

import { normaliseUrl } from '@/lib/intelligence/content-extractor';

const FIXTURE_PATH = join(
  __dirname,
  '../../scripts/tests/fixtures/url_normalisation_parity.json',
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

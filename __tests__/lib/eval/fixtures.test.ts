/**
 * ID-68.17 — eval gold-standard fixture resolver contract (TECH PC-7 step 3).
 *
 * Public fixture names resolve in-repo to `__tests__/fixtures/eval-gold/`;
 * private names (verbatim client bid prose) resolve through the single
 * `KH_PRIVATE_DOCS_DIR` bridge knob to `<docs-site>/eval-fixtures/`,
 * failing loudly per Inv 29 when the knob is unset. No second knob, no
 * per-space matrix (Inv 25/27).
 */
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveEvalFixture } from '@/lib/eval/fixtures';

const KNOB = 'KH_PRIVATE_DOCS_DIR';
const REPO_ROOT = resolve(__dirname, '../../..');
const PUBLIC_DIR = resolve(REPO_ROOT, '__tests__/fixtures/eval-gold');

describe('resolveEvalFixture (PC-7 step 3)', () => {
  let savedValue: string | undefined;

  beforeEach(() => {
    savedValue = process.env[KNOB];
    delete process.env[KNOB];
  });

  afterEach(() => {
    if (savedValue === undefined) {
      delete process.env[KNOB];
    } else {
      process.env[KNOB] = savedValue;
    }
  });

  it('resolves the classification fixture to the public eval-gold path', () => {
    expect(resolveEvalFixture('classification')).toBe(
      resolve(PUBLIC_DIR, 'classification-eval-gold-standard.json'),
    );
  });

  it('resolves the entity fixture to the public eval-gold path', () => {
    expect(resolveEvalFixture('entity')).toBe(
      resolve(PUBLIC_DIR, 'entity-eval-gold-standard.json'),
    );
  });

  it('resolves public fixtures without the bridge knob set', () => {
    expect(() => resolveEvalFixture('classification')).not.toThrow();
    expect(() => resolveEvalFixture('entity')).not.toThrow();
  });

  it('resolves the summarisation fixture to the public eval-gold path', () => {
    expect(resolveEvalFixture('summarisation')).toBe(
      resolve(PUBLIC_DIR, 'summarisation-eval-gold-standard.json'),
    );
  });

  it('resolves the procurement-drafting fixture to the public eval-gold path', () => {
    expect(resolveEvalFixture('procurement-drafting')).toBe(
      resolve(PUBLIC_DIR, 'procurement-drafting-eval-gold-standard.json'),
    );
  });

  it('resolves public fixtures without the bridge knob set', () => {
    expect(() => resolveEvalFixture('summarisation')).not.toThrow();
    expect(() => resolveEvalFixture('procurement-drafting')).not.toThrow();
  });

  it('throws on an unknown fixture name, listing the known names', () => {
    expect(() =>
      // @ts-expect-error — deliberately exercising the runtime guard
      resolveEvalFixture('bid-drafting'),
    ).toThrowError(/bid-drafting.*classification/s);
  });
});

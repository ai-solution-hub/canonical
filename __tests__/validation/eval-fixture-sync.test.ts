/**
 * Eval Fixture Guards (ID-68.17 — TECH PC-7 step 4)
 *
 * Runs as part of normal `bun run test` to verify that gold standard
 * fixtures exist and have the expected minimum item counts. Catches
 * accidental deletion or truncation of eval data.
 *
 * The eval lane is split (PRODUCT Inv 7): only the 2 public name-swapped
 * fixtures (classification, entity — `__tests__/fixtures/eval-gold/`) are
 * asserted by default. The 2 private fixtures (summarisation,
 * procurement-drafting) live in the docs-site repo and are asserted only
 * when the `KH_PRIVATE_DOCS_DIR` bridge knob is set — keeping the default
 * suite green with no knob (AC-C3).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

import { resolveEvalFixture } from '@/lib/eval/fixtures';

describe('Eval fixture sync', () => {
  it('entity eval gold standard has 60+ items', () => {
    const path = resolveEvalFixture('entity');
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    expect(data.length).toBeGreaterThanOrEqual(60);
  });

  it('classification eval gold standard has 50+ items', () => {
    const path = resolveEvalFixture('classification');
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    expect(data.length).toBeGreaterThanOrEqual(50);
  });

  it('search evaluation has 24+ test cases', () => {
    const path = resolve(__dirname, '../../scripts/search-evaluation.json');
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    expect(data.test_cases.length).toBeGreaterThanOrEqual(24);
  });

  describe.skipIf(!process.env.KH_PRIVATE_DOCS_DIR?.trim())(
    'private fixtures (docs-site repo via KH_PRIVATE_DOCS_DIR)',
    () => {
      it('summarisation eval gold standard has 30+ items', () => {
        const path = resolveEvalFixture('summarisation');
        expect(existsSync(path)).toBe(true);
        const data = JSON.parse(readFileSync(path, 'utf-8'));
        // Filter out the _metadata entry
        const items = data.filter(
          (item: Record<string, unknown>) => !('_metadata' in item),
        );
        expect(items.length).toBeGreaterThanOrEqual(30);
      });

      it('procurement drafting eval gold standard has 20+ items', () => {
        const path = resolveEvalFixture('procurement-drafting');
        expect(existsSync(path)).toBe(true);
        const data = JSON.parse(readFileSync(path, 'utf-8'));
        expect(data.length).toBeGreaterThanOrEqual(20);
      });
    },
  );
});

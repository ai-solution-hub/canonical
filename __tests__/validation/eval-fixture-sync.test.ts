/**
 * Eval Fixture Guards (ID-68.17 — TECH PC-7 step 4;
 * updated ID-114.14 — PI-5 step-2 public flip)
 *
 * Runs as part of normal `bun run test` to verify that gold standard
 * fixtures exist and have the expected minimum item counts. Catches
 * accidental deletion or truncation of eval data.
 *
 * All four canonical fixtures (classification, entity, summarisation,
 * procurement-drafting) are now in-repo public fixtures at
 * `__tests__/fixtures/eval-gold/` following the de-ID pass in {114.8}
 * and the PRIVATE→PUBLIC flip in {114.14}. All four are asserted by
 * default with no KH_PRIVATE_DOCS_DIR guard required (AC-C3 satisfied).
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

  it('search evaluation has 24+ test cases', () => {
    const path = resolve(__dirname, '../../scripts/search-evaluation.json');
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    expect(data.test_cases.length).toBeGreaterThanOrEqual(24);
  });
});

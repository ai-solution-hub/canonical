/**
 * Eval Fixture Guards (ID-68.17 — TECH PC-7 step 4;
 * updated ID-114.14 — PI-5 step-2 public flip)
 *
 * Runs as part of normal `bun run test` to verify that gold standard
 * fixtures exist and have the expected minimum item counts. Catches
 * accidental deletion or truncation of eval data.
 *
 * The surviving canonical fixture (procurement-drafting) is an in-repo
 * public fixture at `__tests__/fixtures/eval-gold/` following the de-ID
 * pass in {114.8} and the PRIVATE→PUBLIC flip in {114.14}. The
 * classification/entity/summarisation fixtures were retired in S531
 * (id-419 census) — stale content_items-keyed gold IDs, no consumer lane.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

import { resolveEvalFixture } from '@/lib/eval/fixtures';

describe('Eval fixture sync', () => {
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

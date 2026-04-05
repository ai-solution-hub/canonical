/**
 * Eval Fixture Guards
 *
 * Runs as part of normal `bun run test` to verify that gold standard
 * fixtures exist and have the expected minimum item counts. Catches
 * accidental deletion or truncation of eval data.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('Eval fixture sync', () => {
  const fixtureDir = resolve(__dirname, '../fixtures');

  it('entity eval gold standard has 60+ items', () => {
    const path = resolve(fixtureDir, 'entity-eval-gold-standard.json');
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    expect(data.length).toBeGreaterThanOrEqual(60);
  });

  it('classification eval gold standard has 50+ items', () => {
    const path = resolve(fixtureDir, 'classification-eval-gold-standard.json');
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    expect(data.length).toBeGreaterThanOrEqual(50);
  });

  it('summarisation eval gold standard has 30+ items', () => {
    const path = resolve(fixtureDir, 'summarisation-eval-gold-standard.json');
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    // Filter out the _metadata entry
    const items = data.filter(
      (item: Record<string, unknown>) => !('_metadata' in item),
    );
    expect(items.length).toBeGreaterThanOrEqual(30);
  });

  it('bid drafting eval gold standard has 20+ items', () => {
    const path = resolve(fixtureDir, 'bid-drafting-eval-gold-standard.json');
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    expect(data.length).toBeGreaterThanOrEqual(20);
  });

  it('search evaluation has 24+ test cases', () => {
    const path = resolve(fixtureDir, '../../scripts/search-evaluation.json');
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    expect(data.test_cases.length).toBeGreaterThanOrEqual(24);
  });
});

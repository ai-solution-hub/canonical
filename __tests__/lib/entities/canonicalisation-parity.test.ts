/**
 * Cross-language parity test for the relationship canonicaliser ({101.5}).
 *
 * The R1 HARD GATE before the ID-45 re-ingest: the TS writer chain
 * `resolveAlias(canonicalise(name)).toLowerCase()` (the call shape used by
 * the legacy relationship writer at lib/ai/classify.ts:1785-1819) MUST agree
 * byte-for-byte with the Python port `canonicalise_for_relationship`.
 *
 * This Vitest and the Python pytest at
 * `scripts/tests/test_canonicalisation_parity.py` read the SAME shared
 * fixture `scripts/tests/fixtures/canonicalisation_parity.json`. The
 * fixture's `expected` values are derived from THIS oracle.
 *
 * Covers PRODUCT §PC-3 (cross-language canonicaliser agreement) and §PC-6
 * lane 1 (golden parity fixture).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Direct file imports (no barrels) — the read-only TS oracle.
import { canonicalise } from '@/lib/entities/entity-dedup';
import { resolveAlias } from '@/lib/entities/entity-aliases';

interface ParityPair {
  raw: string;
  expected: string;
}

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  'scripts/tests/fixtures/canonicalisation_parity.json',
);

const pairs = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as ParityPair[];

/**
 * The relationship-writer canonical chain. Mirrors classify.ts:1788 exactly:
 * NO entity-type arg passed to canonicalise(), and resolveAlias() runs on the
 * sync baseline path (no DB cache loaded under test).
 */
function canonicaliseForRelationship(name: string): string {
  return resolveAlias(canonicalise(name)).toLowerCase();
}

describe('canonicalise relationship parity (PC-3 / PC-6 lane 1)', () => {
  it('fixture is a non-empty list of {raw, expected} pairs', () => {
    expect(Array.isArray(pairs)).toBe(true);
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) {
      expect(Object.keys(pair).sort()).toEqual(['expected', 'raw']);
    }
  });

  it.each(pairs)(
    'resolveAlias(canonicalise($raw)).toLowerCase() === $expected',
    ({ raw, expected }) => {
      expect(canonicaliseForRelationship(raw)).toBe(expected);
    },
  );

  it('includes the documented R1 divergence cases', () => {
    const byRaw = new Map(pairs.map((p) => [p.raw, p.expected]));
    // Ltd → Limited (relationship path applies it; ISO-only mention path does not).
    expect(byRaw.get('Acme Ltd')).toBe('acme limited');
    // WCAG version normalisation.
    expect(byRaw.get('Wcag 2 1 Aa')).toBe('wcag 2.1 aa');
    // Abbreviation-map upcase → final lowercase.
    expect(byRaw.get('gdpr')).toBe('gdpr');
  });
});

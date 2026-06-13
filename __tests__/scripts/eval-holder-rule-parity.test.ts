/**
 * Unit tests for the cross-path parity comparator (ID-101 §{101.9}, PC-6 lane 3).
 *
 * Pins the four PURE comparator functions the parity eval owns — `tripleKey`,
 * `compareTripleSets` (Inv-2 order-tolerant set equality), `aggregateRunComparisons`
 * (the N≥3 recurrence rule), and `classifyHolderDivergence` (Inv-9 holder-state
 * match + the bl-288 expected-class bucketing) — with fixture JSON. No DB, no
 * LLM, no subprocess: the comparator operates on already-canonicalised triples
 * and holder states, so these assertions are deterministic.
 *
 * The script entry (`main()`) is guarded by `import.meta.main`, so importing the
 * module here does NOT trigger a live run.
 */
import { describe, it, expect } from 'vitest';
import {
  tripleKey,
  compareTripleSets,
  aggregateRunComparisons,
  classifyHolderDivergence,
} from '@/scripts/eval-holder-rule-ts';

type Triple = {
  source_entity: string;
  relationship_type: string;
  target_entity: string;
};

const T = (s: string, r: string, t: string): Triple => ({
  source_entity: s,
  relationship_type: r,
  target_entity: t,
});

describe('tripleKey', () => {
  it('produces identical keys for identical triples', () => {
    expect(tripleKey(T('acme', 'holds', 'iso 27001'))).toBe(
      tripleKey(T('acme', 'holds', 'iso 27001')),
    );
  });

  it('distinguishes on each of the three fields', () => {
    const base = tripleKey(T('acme', 'holds', 'iso 27001'));
    expect(tripleKey(T('globex', 'holds', 'iso 27001'))).not.toBe(base);
    expect(tripleKey(T('acme', 'uses', 'iso 27001'))).not.toBe(base);
    expect(tripleKey(T('acme', 'holds', 'iso 9001'))).not.toBe(base);
  });
});

describe('compareTripleSets', () => {
  it('reports full intersection when the sets are equal (order-tolerant)', () => {
    const legacy = [T('acme', 'holds', 'iso 27001'), T('acme', 'uses', 'aws')];
    // Same triples, reversed order.
    const coco = [T('acme', 'uses', 'aws'), T('acme', 'holds', 'iso 27001')];
    const cmp = compareTripleSets(legacy, coco);
    expect(cmp.both).toHaveLength(2);
    expect(cmp.legacyOnly).toHaveLength(0);
    expect(cmp.cocoOnly).toHaveLength(0);
  });

  it('isolates legacy-only and coco-only triples', () => {
    const legacy = [T('acme', 'holds', 'iso 27001'), T('a', 'uses', 'b')];
    const coco = [T('acme', 'holds', 'iso 27001'), T('c', 'requires', 'd')];
    const cmp = compareTripleSets(legacy, coco);
    expect(cmp.both.map(tripleKey)).toEqual([
      tripleKey(T('acme', 'holds', 'iso 27001')),
    ]);
    expect(cmp.legacyOnly.map(tripleKey)).toEqual([
      tripleKey(T('a', 'uses', 'b')),
    ]);
    expect(cmp.cocoOnly.map(tripleKey)).toEqual([
      tripleKey(T('c', 'requires', 'd')),
    ]);
  });

  it('collapses duplicates within a single list (set semantics)', () => {
    const legacy = [T('a', 'holds', 'b'), T('a', 'holds', 'b')];
    const coco = [T('a', 'holds', 'b')];
    const cmp = compareTripleSets(legacy, coco);
    expect(cmp.both).toHaveLength(1);
    expect(cmp.legacyOnly).toHaveLength(0);
    expect(cmp.cocoOnly).toHaveLength(0);
  });

  it('handles two empty sets', () => {
    const cmp = compareTripleSets([], []);
    expect(cmp.both).toHaveLength(0);
    expect(cmp.legacyOnly).toHaveLength(0);
    expect(cmp.cocoOnly).toHaveLength(0);
  });
});

describe('aggregateRunComparisons (N≥3 recurrence rule)', () => {
  const equalCmp = (): ReturnType<typeof compareTripleSets> =>
    compareTripleSets([T('a', 'holds', 'b')], [T('a', 'holds', 'b')]);

  it('parity HOLDS when every run agrees across N=3', () => {
    const agg = aggregateRunComparisons([equalCmp(), equalCmp(), equalCmp()]);
    expect(agg.parityHolds).toBe(true);
    expect(agg.recurringLegacyOnly).toHaveLength(0);
    expect(agg.recurringCocoOnly).toHaveLength(0);
  });

  it('treats a triple one-path-only in ALL N runs as a recurring (real) miss', () => {
    // Legacy always has an extra triple the coco path never emits.
    const cmp = compareTripleSets(
      [T('a', 'holds', 'b'), T('x', 'uses', 'y')],
      [T('a', 'holds', 'b')],
    );
    const agg = aggregateRunComparisons([cmp, cmp, cmp]);
    expect(agg.parityHolds).toBe(false);
    expect(agg.recurringLegacyOnly.map(tripleKey)).toEqual([
      tripleKey(T('x', 'uses', 'y')),
    ]);
  });

  it('treats a triple one-path-only in SOME but not all runs as transient (logged, not failed)', () => {
    const withExtra = compareTripleSets(
      [T('a', 'holds', 'b'), T('x', 'uses', 'y')],
      [T('a', 'holds', 'b')],
    );
    const clean = equalCmp();
    // Extra triple appears in 2 of 3 runs → transient, parity still holds.
    const agg = aggregateRunComparisons([withExtra, withExtra, clean]);
    expect(agg.parityHolds).toBe(true);
    expect(agg.recurringLegacyOnly).toHaveLength(0);
    expect(agg.transientLegacyOnly.map(tripleKey)).toEqual([
      tripleKey(T('x', 'uses', 'y')),
    ]);
  });

  it('recurrence is gated on the actual run count (N=5)', () => {
    const withExtra = compareTripleSets(
      [T('a', 'holds', 'b'), T('x', 'uses', 'y')],
      [T('a', 'holds', 'b')],
    );
    // 4 of 5 runs have the extra → transient (not all 5).
    const agg = aggregateRunComparisons([
      withExtra,
      withExtra,
      withExtra,
      withExtra,
      equalCmp(),
    ]);
    expect(agg.parityHolds).toBe(true);
    expect(agg.transientLegacyOnly).toHaveLength(1);
  });
});

describe('classifyHolderDivergence (Inv-9 + bl-288 expected-class)', () => {
  const noMismatch = {
    cert_space_mismatch: false,
    client_org_space_mismatch: false,
  };

  it('buckets identical holder states as match', () => {
    const r = classifyHolderDivergence(
      { holder: 'self' },
      { holder: 'self' },
      noMismatch,
    );
    expect(r.bucket).toBe('match');
  });

  it('buckets identical supplier states (with name) as match', () => {
    const r = classifyHolderDivergence(
      { holder: 'supplier', supplier_name: 'globex inc' },
      { holder: 'supplier', supplier_name: 'globex inc' },
      noMismatch,
    );
    expect(r.bucket).toBe('match');
  });

  it('buckets a genuine mismatch with no known-bug signature as parity_failure', () => {
    const r = classifyHolderDivergence(
      { holder: 'self' },
      { holder: 'supplier', supplier_name: 'globex inc' },
      noMismatch,
    );
    expect(r.bucket).toBe('parity_failure');
  });

  it('buckets a cert-space-mismatch divergence as expected_ts_space_mismatch (bug A)', () => {
    // TS oracle missed the cert (absent) but Python derived self.
    const r = classifyHolderDivergence(
      null,
      { holder: 'self' },
      {
        cert_space_mismatch: true,
        client_org_space_mismatch: false,
      },
    );
    expect(r.bucket).toBe('expected_ts_space_mismatch');
    expect(r.reason).toContain('bug A');
  });

  it('buckets a client-org-space-mismatch divergence as expected_ts_space_mismatch (bug B)', () => {
    // TS mis-attributed self-held cert as supplier; Python correctly says self.
    const r = classifyHolderDivergence(
      { holder: 'supplier', supplier_name: 'knowledge hub ltd' },
      { holder: 'self' },
      { cert_space_mismatch: false, client_org_space_mismatch: true },
    );
    expect(r.bucket).toBe('expected_ts_space_mismatch');
    expect(r.reason).toContain('bug B');
  });

  it('does NOT mask a real mismatch when diagnostics are absent', () => {
    const r = classifyHolderDivergence(
      { holder: 'self' },
      { holder: 'supplier', supplier_name: 'x' },
      null,
    );
    expect(r.bucket).toBe('parity_failure');
  });

  it('an identical state is match even when a space-mismatch flag is set', () => {
    // Precedence: match wins over expected-class when states actually agree.
    const r = classifyHolderDivergence(
      { holder: 'self' },
      { holder: 'self' },
      {
        cert_space_mismatch: true,
        client_org_space_mismatch: true,
      },
    );
    expect(r.bucket).toBe('match');
  });
});

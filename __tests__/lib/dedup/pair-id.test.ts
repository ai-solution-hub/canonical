/**
 * §1.9 Near-Duplicate Merge Dashboard — pair-id encoding/decoding tests
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §3.5
 * AC12: round-tripping any pair through `parsePairId(buildPairId(a, b))`
 * yields the same `{leftId, rightId}` regardless of input order.
 */
import { describe, it, expect } from 'vitest';
import { buildPairId, parsePairId } from '@/lib/dedup/pair-id';

const A = '9c79f5b0-3a2e-4f1c-8b3d-1234567890ab';
const B = 'cf54e944-5c2e-4d1a-9f3b-abcdef012345';
const C = '00000000-0000-4000-8000-000000000001'; // valid v4

describe('buildPairId', () => {
  it('produces a `<smaller>__<larger>` segment in lex order', () => {
    expect(buildPairId(A, B)).toBe(`${A}__${B}`);
  });

  it('order-invariant — same output regardless of arg order', () => {
    expect(buildPairId(A, B)).toBe(buildPairId(B, A));
  });

  it('lowercases inputs before sorting', () => {
    const upper = A.toUpperCase();
    expect(buildPairId(upper, B)).toBe(`${A}__${B}`);
  });

  it('throws on invalid UUID a', () => {
    expect(() => buildPairId('not-a-uuid', B)).toThrow(/not a valid UUID/);
  });

  it('throws on invalid UUID b', () => {
    expect(() => buildPairId(A, 'not-a-uuid')).toThrow(/not a valid UUID/);
  });

  it('throws on equal inputs (no self-pair)', () => {
    expect(() => buildPairId(A, A)).toThrow(/must differ/);
  });
});

describe('parsePairId', () => {
  it('round-trips a built pair-id', () => {
    const pid = buildPairId(A, B);
    expect(parsePairId(pid)).toEqual({ leftId: A, rightId: B });
  });

  it('round-trips regardless of original arg order (AC12)', () => {
    const pid1 = buildPairId(A, B);
    const pid2 = buildPairId(B, A);
    expect(parsePairId(pid1)).toEqual(parsePairId(pid2));
    expect(parsePairId(pid1)?.leftId).toBe(A); // smaller of A vs B
    expect(parsePairId(pid1)?.rightId).toBe(B);
  });

  it('returns null for empty string', () => {
    expect(parsePairId('')).toBeNull();
  });

  it('returns null for missing separator', () => {
    expect(parsePairId(A)).toBeNull();
  });

  it('returns null for triple separator', () => {
    expect(parsePairId(`${A}__${B}__${C}`)).toBeNull();
  });

  it('returns null for non-UUID left half', () => {
    expect(parsePairId(`not-a-uuid__${B}`)).toBeNull();
  });

  it('returns null for non-UUID right half', () => {
    expect(parsePairId(`${A}__not-a-uuid`)).toBeNull();
  });

  it('returns null when leftId === rightId (self-pair rejected)', () => {
    expect(parsePairId(`${A}__${A}`)).toBeNull();
  });

  it('returns null when leftId > rightId (must be sorted)', () => {
    expect(parsePairId(`${B}__${A}`)).toBeNull();
  });

  it('lowercases the round-tripped halves', () => {
    const pid = `${A.toUpperCase()}__${B}`;
    // Upper-case is technically a valid UUID per RFC-4122; parser
    // normalises to lowercase before comparison, so the round-trip
    // yields lowercase halves.
    expect(parsePairId(pid)?.leftId).toBe(A);
    expect(parsePairId(pid)?.rightId).toBe(B);
  });
});

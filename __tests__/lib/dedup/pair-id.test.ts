/**
 * Pair-id helpers unit tests (§1.9 AC12).
 *
 * Verifies:
 *  - buildPairId always returns lex-sorted UUIDs joined with `__`.
 *  - parsePairId rejects malformed input (wrong count, bad UUID, wrong order).
 *  - Round-trip parsePairId(buildPairId(a, b)) yields the same {leftId, rightId}
 *    regardless of input order.
 */
import { describe, expect, it } from 'vitest';

import { buildPairId, parsePairId } from '@/lib/dedup/pair-id';

// v4-compliant UUIDs (RFC-4122 strict — required per CLAUDE.md Zod gotcha).
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('buildPairId', () => {
  it('returns smaller UUID first regardless of input order', () => {
    expect(buildPairId(UUID_A, UUID_B)).toBe(`${UUID_A}__${UUID_B}`);
    expect(buildPairId(UUID_B, UUID_A)).toBe(`${UUID_A}__${UUID_B}`);
  });

  it('lexically sorts hex characters past digits', () => {
    // 'a' > '2', so UUID_C ('aa…') > UUID_B ('22…')
    expect(buildPairId(UUID_C, UUID_B)).toBe(`${UUID_B}__${UUID_C}`);
  });

  it('throws when the two ids are identical', () => {
    expect(() => buildPairId(UUID_A, UUID_A)).toThrow(/must differ/);
  });

  it('throws when either UUID is malformed', () => {
    expect(() => buildPairId('not-a-uuid', UUID_B)).toThrow(/invalid UUID/);
    expect(() => buildPairId(UUID_A, '00000000')).toThrow(/invalid UUID/);
  });
});

describe('parsePairId', () => {
  it('parses a well-formed lex-sorted pair-id', () => {
    expect(parsePairId(`${UUID_A}__${UUID_B}`)).toEqual({
      leftId: UUID_A,
      rightId: UUID_B,
    });
  });

  it('returns null when the segment is not separated by `__`', () => {
    expect(parsePairId(`${UUID_A}-${UUID_B}`)).toBeNull();
    expect(parsePairId(UUID_A)).toBeNull();
  });

  it('returns null when there are more than two parts', () => {
    expect(parsePairId(`${UUID_A}__${UUID_B}__${UUID_C}`)).toBeNull();
  });

  it('returns null when either half is not a UUID', () => {
    expect(parsePairId(`not-a-uuid__${UUID_B}`)).toBeNull();
    expect(parsePairId(`${UUID_A}__nope`)).toBeNull();
  });

  it('returns null when halves are NOT in lexical order', () => {
    // Reverse-order segment must be rejected even though both halves are
    // valid — the canonical form is always smaller-first.
    expect(parsePairId(`${UUID_B}__${UUID_A}`)).toBeNull();
  });

  it('returns null when the two halves are identical', () => {
    expect(parsePairId(`${UUID_A}__${UUID_A}`)).toBeNull();
  });
});

describe('round-trip (AC12)', () => {
  it('yields the same {leftId, rightId} regardless of input order', () => {
    const fromForward = parsePairId(buildPairId(UUID_A, UUID_B));
    const fromReverse = parsePairId(buildPairId(UUID_B, UUID_A));

    expect(fromForward).toEqual({ leftId: UUID_A, rightId: UUID_B });
    expect(fromReverse).toEqual({ leftId: UUID_A, rightId: UUID_B });
    expect(fromForward).toEqual(fromReverse);
  });

  it('always satisfies leftId < rightId', () => {
    for (const [a, b] of [
      [UUID_A, UUID_B],
      [UUID_B, UUID_A],
      [UUID_A, UUID_C],
      [UUID_C, UUID_B],
    ]) {
      const parsed = parsePairId(buildPairId(a, b));
      expect(parsed).not.toBeNull();
      expect(parsed!.leftId < parsed!.rightId).toBe(true);
    }
  });
});

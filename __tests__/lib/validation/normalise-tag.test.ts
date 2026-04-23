import { describe, it, expect } from 'vitest';
import { normaliseTag } from '@/lib/validation/schemas';
import cases from '../../fixtures/keyword-normalisation-cases.json';

/**
 * Shared parity test for normaliseTag() (TS side).
 *
 * Reads the same fixture corpus as the Python test_keyword_normalise.py
 * to ensure both normalisers produce identical output for identical input.
 * Spec: docs/specs/p0-tag-canonicalisation-classify-time-spec.md ss10.1.
 */

interface NormalisationCase {
  input: string;
  expected: string;
  description: string;
}

describe('normaliseTag — shared parity fixture corpus', () => {
  const typedCases = cases as NormalisationCase[];

  it('fixture corpus has >= 20 cases', () => {
    expect(typedCases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(typedCases)(
    '$description: "$input" -> "$expected"',
    ({ input, expected }) => {
      expect(normaliseTag(input)).toBe(expected);
    },
  );
});

describe('normaliseTag — additional edge cases', () => {
  it('does not match Unicode NBSP (U+00A0) as whitespace', () => {
    // U+00A0 is non-breaking space — should NOT be collapsed by the
    // ASCII-only whitespace regex. This verifies parity with Python re.ASCII.
    const input = 'data protection';
    const result = normaliseTag(input);
    // NBSP should be preserved — the tag lowercases but keeps NBSP
    expect(result).toBe('data protection');
  });

  it('collapses mixed ASCII whitespace types', () => {
    expect(normaliseTag('risk\t\n management')).toBe('risk management');
  });

  it('handles whitespace-only input', () => {
    expect(normaliseTag('   ')).toBe('');
  });
});

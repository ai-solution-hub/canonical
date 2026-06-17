/**
 * Tests for scripts/generate-classification-prompt-taxonomy.ts — ID-68.36
 * de-ID safety hardening: the generator must FAIL LOUD when no client-name
 * denylist source is reachable at write time, rather than emit the artefact
 * with only a warning and exit 0 (the silent de-ID hole curated from ID-114).
 *
 * All fixtures use a SYNTHETIC client stem ('acme') — real denylist token
 * values must never appear in this repo (PC-31 placement constraint). These
 * tests exercise the pure decision/redaction functions only; the generator's
 * main() still reads the canonical denylist at runtime from env / the private
 * docs-site checkout.
 */
import { describe, expect, it } from 'vitest';

import {
  assertDenylistReachable,
  redactClientTerms,
  type DenylistToken,
} from '@/scripts/generate-classification-prompt-taxonomy';

const SYNTHETIC_TOKENS: DenylistToken[] = [
  {
    value: 'acme',
    case_insensitive: true,
    class: 'client-name stem + derived identifiers',
  },
  {
    value: 'Acme Widgets Limited',
    case_insensitive: true,
    class: 'legal name',
  },
];

describe('assertDenylistReachable (fail-loud guard — ID-68.36)', () => {
  it('throws when no denylist source is reachable (tokens null)', () => {
    // Reproduces the de-ID hole: a hermetic env where loadDenylistTokens()
    // returns null must NOT proceed to write the artefact.
    expect(() => assertDenylistReachable(null)).toThrow(/denylist/i);
  });

  it('throws when the denylist resolved but is empty (no protection)', () => {
    // An empty token list provides zero redaction — equally unsafe to write.
    expect(() => assertDenylistReachable([])).toThrow(/denylist/i);
  });

  it('does not throw when a non-empty denylist is reachable', () => {
    expect(() => assertDenylistReachable(SYNTHETIC_TOKENS)).not.toThrow();
  });

  it('narrows the token type for the caller after asserting', () => {
    // The guard is an assertion function: after it returns, the caller may
    // treat tokens as a non-null DenylistToken[] without a further null check.
    const maybeTokens: DenylistToken[] | null = SYNTHETIC_TOKENS;
    assertDenylistReachable(maybeTokens);
    // If the assertion signature is correct this compiles without a guard.
    expect(maybeTokens.length).toBe(2);
  });
});

describe('redactClientTerms (de-ID redaction — regression guard)', () => {
  it('replaces an org/name-class token with the organisation placeholder', () => {
    const out = redactClientTerms('We serve Acme Widgets Limited daily.', [
      {
        value: 'Acme Widgets Limited',
        case_insensitive: true,
        class: 'legal name',
      },
    ]);
    expect(out).toBe('We serve {CLIENT_ORGANISATION_NAME} daily.');
  });

  it('replaces a product-class token with the product placeholder', () => {
    const out = redactClientTerms('The AcmeWidget portal is live.', [
      { value: 'AcmeWidget', case_insensitive: true, class: 'product name' },
    ]);
    expect(out).toBe('The {CLIENT_PRODUCT_NAME} portal is live.');
  });

  it('is a no-op when tokens is null', () => {
    expect(redactClientTerms('untouched acme text', null)).toBe(
      'untouched acme text',
    );
  });
});

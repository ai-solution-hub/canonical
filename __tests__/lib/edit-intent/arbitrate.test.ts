import { describe, it, expect } from 'vitest';

import {
  arbitrate,
  arbitrateMany,
  type EditIntent,
} from '@/lib/edit-intent/arbitrate';

// {59.6} — pure, mock-free, time-independent unit. No DB, route, or schema.
// Arbitration semantics (PRODUCT INV-2/9/10, TECH PC-2/9/10):
//   - cosmetic is the unit element;
//   - any data/structural on either side ⇒ 'data'.

const ALL_INTENTS: EditIntent[] = ['cosmetic', 'data', 'structural'];

describe('arbitrate — exhaustive truth table over the 3-value CV', () => {
  // The 9 ordered pairs; only cosmetic+cosmetic yields 'cosmetic'.
  const cases: Array<[EditIntent, EditIntent, EditIntent]> = [
    ['cosmetic', 'cosmetic', 'cosmetic'],
    ['cosmetic', 'data', 'data'],
    ['cosmetic', 'structural', 'data'],
    ['data', 'cosmetic', 'data'],
    ['data', 'data', 'data'],
    ['data', 'structural', 'data'],
    ['structural', 'cosmetic', 'data'],
    ['structural', 'data', 'data'],
    ['structural', 'structural', 'data'],
  ];

  it.each(cases)('arbitrate(%s, %s) === %s', (a, b, expected) => {
    expect(arbitrate(a, b)).toBe(expected);
  });

  it('only cosmetic+cosmetic returns cosmetic', () => {
    expect(arbitrate('cosmetic', 'cosmetic')).toBe('cosmetic');
  });

  it('any data on either side returns data', () => {
    expect(arbitrate('data', 'cosmetic')).toBe('data');
    expect(arbitrate('cosmetic', 'data')).toBe('data');
  });

  it('any structural on either side returns data', () => {
    expect(arbitrate('structural', 'cosmetic')).toBe('data');
    expect(arbitrate('cosmetic', 'structural')).toBe('data');
  });
});

describe('arbitrate — commutativity property', () => {
  it('arbitrate(a, b) === arbitrate(b, a) across all pairs', () => {
    for (const a of ALL_INTENTS) {
      for (const b of ALL_INTENTS) {
        expect(arbitrate(a, b)).toBe(arbitrate(b, a));
      }
    }
  });
});

describe('arbitrateMany', () => {
  it('cosmetic is the identity: arbitrateMany([]) === cosmetic', () => {
    expect(arbitrateMany([])).toBe('cosmetic');
  });

  it('folds a mixed list to data', () => {
    expect(arbitrateMany(['cosmetic', 'data', 'cosmetic'])).toBe('data');
  });

  it('is order-independent', () => {
    expect(arbitrateMany(['cosmetic', 'data', 'cosmetic'])).toBe('data');
    expect(arbitrateMany(['data', 'cosmetic', 'cosmetic'])).toBe('data');
    expect(arbitrateMany(['cosmetic', 'cosmetic', 'data'])).toBe('data');
  });

  it('all-cosmetic stays cosmetic', () => {
    expect(arbitrateMany(['cosmetic', 'cosmetic', 'cosmetic'])).toBe(
      'cosmetic',
    );
  });

  it('any structural in the list promotes to data', () => {
    expect(arbitrateMany(['cosmetic', 'structural'])).toBe('data');
    expect(arbitrateMany(['structural', 'cosmetic', 'cosmetic'])).toBe('data');
  });

  it('a single-element list returns the element-arbitrated value', () => {
    expect(arbitrateMany(['cosmetic'])).toBe('cosmetic');
    expect(arbitrateMany(['data'])).toBe('data');
    // structural alone arbitrates against the cosmetic seed ⇒ 'data'.
    expect(arbitrateMany(['structural'])).toBe('data');
  });
});

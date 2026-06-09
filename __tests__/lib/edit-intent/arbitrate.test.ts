import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  arbitrate,
  arbitrateMany,
  coerceIntent,
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

// {59.7} — coerceIntent null/unknown fallback (PRODUCT PC-12 / INV-12).
//
// Mock-free: the real `logBestEffortWarn` runs. Its sanctioned sink is the
// client logger, which routes `warn` to `console.warn(message, payload)`. We
// observe the structured fallback log by spying on `console.warn` — a spy on a
// global method, NOT a module/Supabase mock — so the OBSERVABLE side effect the
// spec asserts is exercised end-to-end through the production logger.
describe('coerceIntent — null/unknown fallback + structured log', () => {
  const ctx = {
    userId: 'b1111111-1111-4111-8111-111111111111',
    contentItemId: 'c2222222-2222-4222-8222-222222222222',
    opId: 'd3333333-3333-4333-8333-333333333333',
  };

  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // The structured fallback line is `console.warn(message, payload)`. Locate
  // the call whose message is `edit_intent_arbitration_fallback` and return its
  // structured payload object.
  function fallbackPayload(): Record<string, unknown> | undefined {
    const call = warnSpy.mock.calls.find(
      (args: unknown[]) => args[0] === 'edit_intent_arbitration_fallback',
    );
    return call?.[1] as Record<string, unknown> | undefined;
  }

  it('returns cosmetic for null', () => {
    expect(coerceIntent(null, ctx)).toBe('cosmetic');
  });

  it('returns cosmetic for undefined', () => {
    expect(coerceIntent(undefined, ctx)).toBe('cosmetic');
  });

  it('returns cosmetic for an out-of-CV string ("foo")', () => {
    expect(coerceIntent('foo', ctx)).toBe('cosmetic');
  });

  it('returns the valid value verbatim for "data"', () => {
    expect(coerceIntent('data', ctx)).toBe('data');
  });

  it('returns valid CV members verbatim', () => {
    expect(coerceIntent('cosmetic', ctx)).toBe('cosmetic');
    expect(coerceIntent('data', ctx)).toBe('data');
    expect(coerceIntent('structural', ctx)).toBe('structural');
  });

  it.each([null, undefined, 'foo'])(
    'emits edit_intent_arbitration_fallback with received + treated_as:cosmetic + ctx ids for %s',
    (received) => {
      coerceIntent(received, ctx);

      const payload = fallbackPayload();
      expect(payload).toBeDefined();
      expect(payload).toMatchObject({
        received,
        treated_as: 'cosmetic',
        userId: ctx.userId,
        contentItemId: ctx.contentItemId,
        opId: ctx.opId,
      });
    },
  );

  it.each<EditIntent>(['cosmetic', 'data', 'structural'])(
    'does NOT emit edit_intent_arbitration_fallback for the valid value %s',
    (valid) => {
      coerceIntent(valid, ctx);
      expect(fallbackPayload()).toBeUndefined();
    },
  );

  it('treats non-string out-of-CV values (number) as cosmetic + logs', () => {
    expect(coerceIntent(42, ctx)).toBe('cosmetic');
    expect(fallbackPayload()).toMatchObject({
      received: 42,
      treated_as: 'cosmetic',
    });
  });

  it('never throws regardless of input shape', () => {
    expect(() => coerceIntent(Symbol('x'), ctx)).not.toThrow();
    expect(() => coerceIntent({ nested: true }, ctx)).not.toThrow();
    expect(() => coerceIntent([], ctx)).not.toThrow();
  });
});

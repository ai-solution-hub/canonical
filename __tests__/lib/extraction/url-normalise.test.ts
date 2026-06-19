// __tests__/lib/extraction/url-normalise.test.ts
import { describe, it, expect } from 'vitest';

import { normaliseUrl } from '@/lib/extraction/url-normalise';

describe('normaliseUrl', () => {
  it('lowercases hostname', () => {
    expect(normaliseUrl('https://WWW.GOV.UK/page')).toBe(
      'https://www.gov.uk/page',
    );
  });

  it('strips tracking params', () => {
    expect(
      normaliseUrl('https://example.com/page?utm_source=twitter&key=val'),
    ).toBe('https://example.com/page?key=val');
  });

  it('removes trailing slash', () => {
    expect(normaliseUrl('https://example.com/page/')).toBe(
      'https://example.com/page',
    );
  });

  it('preserves root slash', () => {
    expect(normaliseUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('returns invalid URLs unchanged', () => {
    expect(normaliseUrl('not-a-url')).toBe('not-a-url');
  });
});

import { describe, it, expect } from 'vitest';
import { slugifyDomain, validateDomain } from '@/lib/ai/classify';

describe('slugifyDomain', () => {
  it('lowercases uppercase input', () => {
    expect(slugifyDomain('CORPORATE')).toBe('corporate');
  });

  it('converts spaces and mixed separators to single hyphens', () => {
    expect(slugifyDomain('Market Intelligence')).toBe('market-intelligence');
    expect(slugifyDomain('sector_news')).toBe('sector-news');
    expect(slugifyDomain('Legislation & Policy')).toBe('legislation-policy');
  });

  it('trims leading and trailing non-alphanumeric', () => {
    expect(slugifyDomain('  Security  ')).toBe('security');
    expect(slugifyDomain('--corporate--')).toBe('corporate');
  });

  it('preserves already-canonical slugs', () => {
    expect(slugifyDomain('product-feature')).toBe('product-feature');
  });

  it('collapses repeated separators', () => {
    expect(slugifyDomain('AI / Machine Learning')).toBe('ai-machine-learning');
  });
});

describe('validateDomain uses slugifyDomain', () => {
  // Order matters for the regression guards below: 'security' first mirrors
  // the staging display_order the old silent fallback coerced misses onto.
  const validDomains = ['security', 'compliance', 'corporate'];

  it('matches an uppercase input against a lowercase taxonomy slug', () => {
    expect(validateDomain('CORPORATE', validDomains)).toBe('corporate');
  });

  it('matches a human-form input after slugification', () => {
    expect(validateDomain('Compliance ', validDomains)).toBe('compliance');
  });

  // id-419 regression guards — the silent-coercion defect. An
  // out-of-taxonomy domain must surface as a miss (null), NEVER become a
  // plausible in-taxonomy value. Both of the old behaviours are asserted
  // dead: the validDomains[0] fallback and the substring-fuzzy branch.
  it('returns null on a taxonomy miss instead of the first valid domain', () => {
    expect(validateDomain('quantum-weather', validDomains)).toBeNull();
  });

  it('does not substring-fuzzy-match a compound miss onto a real domain', () => {
    // Old behaviour: 'security-compliance' ⊇ 'security' → coerced to
    // 'security' at full LLM confidence. It must be a miss.
    expect(validateDomain('security-compliance', validDomains)).toBeNull();
    // And the containment in the other direction ('sec' ⊂ 'security').
    expect(validateDomain('sec', validDomains)).toBeNull();
  });

  it('returns null when the taxonomy list is empty', () => {
    expect(validateDomain('security', [])).toBeNull();
  });
});

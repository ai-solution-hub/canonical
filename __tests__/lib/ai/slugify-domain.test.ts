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
  const validDomains = ['corporate', 'compliance', 'security'];

  it('matches an uppercase input against a lowercase taxonomy slug', () => {
    expect(validateDomain('CORPORATE', validDomains)).toBe('corporate');
  });

  it('matches a human-form input via slug fuzzy match', () => {
    expect(validateDomain('Compliance ', validDomains)).toBe('compliance');
  });

  it('falls back to first valid domain when nothing matches', () => {
    expect(validateDomain('quantum-weather', validDomains)).toBe('corporate');
  });
});

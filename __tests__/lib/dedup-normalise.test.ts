import { describe, it, expect } from 'vitest';
import { normaliseTitleForDedup } from '@/lib/dedup-normalise';

describe('normaliseTitleForDedup', () => {
  it('lowercases the input', () => {
    expect(normaliseTitleForDedup('FOO BAR')).toBe('foo bar');
  });

  it('strips leading "the "', () => {
    expect(normaliseTitleForDedup('The principle of least privilege')).toBe(
      'principle of least privilege',
    );
  });

  it('strips leading "a "', () => {
    expect(normaliseTitleForDedup('A quick brown fox')).toBe('quick brown fox');
  });

  it('strips leading "an "', () => {
    expect(normaliseTitleForDedup('An audit trail')).toBe('audit trail');
  });

  it('strips every standalone article, not only the first', () => {
    expect(normaliseTitleForDedup('The dog and the cat')).toBe('dog and cat');
  });

  it('strips trailing question mark', () => {
    expect(normaliseTitleForDedup('Do you comply?')).toBe('do you comply');
  });

  it('strips trailing full stop', () => {
    expect(normaliseTitleForDedup('We comply.')).toBe('we comply');
  });

  it('strips multiple trailing punctuation', () => {
    expect(normaliseTitleForDedup('Really??  ')).toBe('really');
  });

  it('collapses internal whitespace to single spaces', () => {
    expect(normaliseTitleForDedup('  foo    bar    baz  ')).toBe('foo bar baz');
  });

  it('returns empty string on empty input', () => {
    expect(normaliseTitleForDedup('')).toBe('');
  });

  it('catches the S182 regression pair — mid-sentence article difference', () => {
    const a =
      'Are access levels granted according to the principle of least privilege?';
    const b =
      'Are access levels granted according to principle of least privilege';
    expect(normaliseTitleForDedup(a)).toBe(normaliseTitleForDedup(b));
  });

  it('handles prefixed articles with surrounding casing differences', () => {
    const a = 'The GDPR applies?';
    const b = 'gdpr applies';
    expect(normaliseTitleForDedup(a)).toBe(normaliseTitleForDedup(b));
  });
});

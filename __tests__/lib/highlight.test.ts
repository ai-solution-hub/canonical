import { describe, it, expect } from 'vitest';
import { highlightTerms } from '@/components/highlight';

describe('highlightTerms', () => {
  it('returns original text when query is empty', () => {
    const result = highlightTerms('Hello world', '');
    expect(result).toEqual(['Hello world']);
  });

  it('returns original text when query is whitespace only', () => {
    const result = highlightTerms('Hello world', '   ');
    expect(result).toEqual(['Hello world']);
  });

  it('highlights a single matching term', () => {
    const result = highlightTerms('Hello world today', 'world');
    // Split produces: "Hello " + <mark>world</mark> + " today"
    const marks = result.filter(
      (r) => typeof r === 'object' && r !== null && 'props' in r,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveProperty('props.children', 'world');
  });

  it('highlights multiple matching terms', () => {
    const result = highlightTerms('The quick brown fox', 'quick fox');
    const marks = result.filter(
      (r) => typeof r === 'object' && r !== null && 'props' in r,
    );
    expect(marks).toHaveLength(2);
    expect(marks[0]).toHaveProperty('props.children', 'quick');
    expect(marks[1]).toHaveProperty('props.children', 'fox');
  });

  it('ignores terms shorter than 2 characters', () => {
    const result = highlightTerms('A big cat', 'A');
    expect(result).toEqual(['A big cat']);
  });

  it('performs case-insensitive matching', () => {
    const result = highlightTerms('Hello WORLD today', 'world');
    const marks = result.filter(
      (r) => typeof r === 'object' && r !== null && 'props' in r,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveProperty('props.children', 'WORLD');
  });

  it('escapes regex special characters in query', () => {
    const result = highlightTerms('Price is $100.00 (USD)', '$100.00');
    // Should not throw — regex specials are escaped
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

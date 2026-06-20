import { describe, it, expect } from 'vitest';
import {
  escapePostgrestValue,
  escapePostgrestQuotedValue,
} from '@/lib/supabase/escape';

describe('escapePostgrestValue', () => {
  it('escapes each PostgREST metacharacter exactly once', () => {
    expect(escapePostgrestValue('A.B')).toBe('A\\.B');
    expect(escapePostgrestValue('a,b')).toBe('a\\,b');
    expect(escapePostgrestValue('50% off')).toBe('50\\% off');
    expect(escapePostgrestValue('a(b)')).toBe('a\\(b\\)');
    expect(escapePostgrestValue('a_b*c')).toBe('a\\_b\\*c');
  });

  it('escapes a literal backslash once', () => {
    // input is the 4 chars  C : \ x
    expect(escapePostgrestValue('C:\\x')).toBe('C:\\\\x');
  });

  it('leaves non-metacharacters untouched', () => {
    expect(escapePostgrestValue('Acme')).toBe('Acme');
  });
});

describe('escapePostgrestQuotedValue', () => {
  // Regression guard: a CodeQL "incomplete string escaping" autofix once added a
  // second backslash-doubling pass to the entities route's .eq."..." escaping,
  // double-escaping the value so PostgREST matched a literal backslash and
  // relationship lookups silently returned zero rows for ANY name containing a
  // metacharacter ("Acme Ltd.", "A.B", "50% off"). Lock the single-escape
  // contract so neither an autofix nor a human can reintroduce the double pass.
  it('does not double-escape metacharacters', () => {
    expect(escapePostgrestQuotedValue('A.B')).toBe('A\\.B');
    expect(escapePostgrestQuotedValue('Acme Ltd.')).toBe('Acme Ltd\\.');
    expect(escapePostgrestQuotedValue('50% off')).toBe('50\\% off');
    expect(escapePostgrestQuotedValue('Smith, John')).toBe('Smith\\, John');
  });

  it('escapes the double-quote that delimits the .eq."..." operand', () => {
    expect(escapePostgrestQuotedValue('a"b')).toBe('a\\"b');
  });

  it('escapes a literal backslash exactly once (no quadrupling)', () => {
    expect(escapePostgrestQuotedValue('C:\\x')).toBe('C:\\\\x');
  });
});

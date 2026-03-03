import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn (class name merge utility)', () => {
  it('should merge simple class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('should handle conditional classes via clsx', () => {
    expect(cn('base', false && 'hidden', 'active')).toBe('base active');
  });

  it('should resolve Tailwind conflicts (last wins)', () => {
    // tailwind-merge should resolve px-4 vs px-2 (last wins)
    expect(cn('px-4', 'px-2')).toBe('px-2');
  });

  it('should resolve conflicting background colours', () => {
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
  });

  it('should keep non-conflicting Tailwind classes', () => {
    const result = cn('p-4', 'text-sm', 'font-bold');
    expect(result).toContain('p-4');
    expect(result).toContain('text-sm');
    expect(result).toContain('font-bold');
  });

  it('should handle undefined and null inputs', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
  });

  it('should handle empty string input', () => {
    expect(cn('')).toBe('');
  });

  it('should handle no arguments', () => {
    expect(cn()).toBe('');
  });

  it('should handle array inputs', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar');
  });

  it('should handle object inputs from clsx', () => {
    expect(cn({ hidden: true, visible: false })).toBe('hidden');
  });

  it('should merge complex Tailwind padding overrides', () => {
    // p-4 sets all padding; px-2 should override horizontal padding
    const result = cn('p-4', 'px-2');
    expect(result).toContain('px-2');
  });
});

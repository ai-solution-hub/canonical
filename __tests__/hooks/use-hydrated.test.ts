import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHydrated } from '@/hooks/use-hydrated';

describe('useHydrated', () => {
  it('returns true on client after hydration', () => {
    const { result } = renderHook(() => useHydrated());

    // In test environment (client-side), getSnapshot returns true
    expect(result.current).toBe(true);
  });

  it('returns a boolean value', () => {
    const { result } = renderHook(() => useHydrated());

    expect(typeof result.current).toBe('boolean');
  });
});

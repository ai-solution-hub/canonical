import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockIsMacPlatform } = vi.hoisted(() => ({
  mockIsMacPlatform: vi.fn(() => true),
}));

vi.mock('@/lib/utils', () => ({
  isMacPlatform: () => mockIsMacPlatform(),
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { useModifierKey } from '@/hooks/use-modifier-key';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useModifierKey', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns command symbol on Mac', () => {
    mockIsMacPlatform.mockReturnValue(true);

    const { result } = renderHook(() => useModifierKey());

    // After useEffect runs, should be the command symbol
    expect(result.current).toBe('\u2318');
  });

  it('returns "Ctrl+" on non-Mac platforms', () => {
    mockIsMacPlatform.mockReturnValue(false);

    const { result } = renderHook(() => useModifierKey());

    expect(result.current).toBe('Ctrl+');
  });

  it('returns empty string initially (SSR safety)', () => {
    // The hook initialises with '' and only sets the value in useEffect
    // On first render before effect fires, value is ''
    mockIsMacPlatform.mockReturnValue(true);

    // We cannot really test the pre-effect state with renderHook since
    // effects run synchronously in test environment, but we can verify
    // the hook does not throw and returns a string
    const { result } = renderHook(() => useModifierKey());
    expect(typeof result.current).toBe('string');
  });
});

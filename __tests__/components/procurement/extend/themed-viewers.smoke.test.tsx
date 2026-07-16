/**
 * Extend v1 vendor-in smoke test — app-theme binding for the DOCX/XLSX
 * viewers (ID-147.6, PRODUCT §B4: "the DOCX/XLSX viewers' required isDark +
 * onIsDarkChange props bind to the app theme context"). Proves
 * `useExtendTheme()` derives `isDark` from the app's `next-themes`
 * `resolvedTheme` and that the themed wrapper components mount.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, render } from '@testing-library/react';

const { mockUseThemeMode } = vi.hoisted(() => ({
  mockUseThemeMode: vi.fn(),
}));

vi.mock('@/hooks/ui/use-theme-mode', () => ({
  useThemeMode: mockUseThemeMode,
}));

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';
import { useExtendTheme } from '@/components/procurement/extend/use-extend-theme';
import {
  ThemedDocxViewer,
  ThemedXlsxViewer,
} from '@/components/procurement/extend/themed-viewers';
import { renderHook } from '@testing-library/react';

beforeEach(() => {
  installRadixPointerShims();
  mockUseThemeMode.mockReset();
  // jsdom has no layout engine — see viewers.smoke.test.tsx for the same
  // `Element.prototype.scrollTo` stub rationale (ID-147.6).
  Element.prototype.scrollTo = vi.fn();
});

describe('useExtendTheme — vendor-in smoke test (ID-147.6, PRODUCT §B4)', () => {
  it('derives isDark=true from resolvedTheme="dark"', () => {
    const setTheme = vi.fn();
    mockUseThemeMode.mockReturnValue({
      theme: 'dark',
      resolvedTheme: 'dark',
      setTheme,
    });

    const { result } = renderHook(() => useExtendTheme());
    expect(result.current.isDark).toBe(true);

    result.current.onIsDarkChange(false);
    expect(setTheme).toHaveBeenCalledWith('light');
  });

  it('derives isDark=false from resolvedTheme="light"', () => {
    mockUseThemeMode.mockReturnValue({
      theme: 'light',
      resolvedTheme: 'light',
      setTheme: vi.fn(),
    });

    const { result } = renderHook(() => useExtendTheme());
    expect(result.current.isDark).toBe(false);
  });
});

describe('Themed DOCX/XLSX viewer shells — vendor-in smoke test (ID-147.6)', () => {
  beforeEach(() => {
    mockUseThemeMode.mockReturnValue({
      theme: 'light',
      resolvedTheme: 'light',
      setTheme: vi.fn(),
    });
  });

  it('ThemedDocxViewer imports and renders, bound to the app theme', async () => {
    const { container } = render(<ThemedDocxViewer />);
    await act(async () => {});
    expect(container.firstChild).not.toBeNull();
  });

  it('ThemedXlsxViewer imports and renders, bound to the app theme', async () => {
    const { container } = render(<ThemedXlsxViewer />);
    await act(async () => {});
    expect(container.firstChild).not.toBeNull();
  });
});

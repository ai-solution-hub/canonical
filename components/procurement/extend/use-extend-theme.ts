'use client';

import { useCallback } from 'react';

import { useThemeMode } from '@/hooks/ui/use-theme-mode';

/**
 * Binds the app's light/dark theme context to the `isDark` + `onIsDarkChange`
 * prop pair the vendored Extend DOCX/XLSX viewers require (PRODUCT.md §B4,
 * ID-147.6). Never diverges the viewer's dark-mode state from the app theme.
 *
 * `resolvedTheme` (not `theme`) is used so a `theme: 'system'` preference
 * resolves to the actual light/dark value the app is currently rendering.
 */
export function useExtendTheme(): {
  isDark: boolean;
  onIsDarkChange: (nextIsDark: boolean) => void;
} {
  const { resolvedTheme, setTheme } = useThemeMode();
  const isDark = resolvedTheme === 'dark';

  const onIsDarkChange = useCallback(
    (nextIsDark: boolean) => {
      setTheme(nextIsDark ? 'dark' : 'light');
    },
    [setTheme],
  );

  return { isDark, onIsDarkChange };
}

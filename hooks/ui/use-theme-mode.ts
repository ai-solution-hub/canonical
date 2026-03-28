'use client';

import { useTheme } from 'next-themes';

function applyWithTransition(callback: () => void) {
  if (typeof window === 'undefined') {
    callback();
    return;
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    callback();
    return;
  }
  if (!document.startViewTransition) {
    callback();
    return;
  }
  document.startViewTransition(() => callback());
}

export function useThemeMode() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const setThemeWithTransition = (newTheme: string) => {
    applyWithTransition(() => setTheme(newTheme));
  };

  return { theme, setTheme: setThemeWithTransition, resolvedTheme };
}

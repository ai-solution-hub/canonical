'use client';

import { useState, useEffect, useCallback } from 'react';

export type A11yMode = 'dyslexia' | 'high-contrast' | 'large-text';
export type A11yFont = 'atkinson' | 'opendyslexic';

const STORAGE_PREFIX = 'kh';

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

// Font loading is handled by @font-face declarations in a11y.css.
// The browser downloads fonts on demand when font-family is referenced
// via the CSS custom property --font-sans.

function getInitialA11yMode(): A11yMode | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(`${STORAGE_PREFIX}-a11y-mode`);
  if (stored) return stored as A11yMode;
  if (window.matchMedia('(prefers-contrast: more)').matches) return 'high-contrast';
  return null;
}

function getInitialA11yFont(): A11yFont | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(`${STORAGE_PREFIX}-a11y-font`);
  return stored ? (stored as A11yFont) : null;
}

export function useAccessibility() {
  const [a11yMode, setA11yModeState] = useState<A11yMode | null>(getInitialA11yMode);
  const [a11yFont, setA11yFontState] = useState<A11yFont | null>(getInitialA11yFont);

  // Apply DOM attributes on mount and listen for system contrast changes
  useEffect(() => {
    // Sync DOM attributes with initial state
    if (a11yMode) {
      document.documentElement.setAttribute('data-a11y-mode', a11yMode);
    }
    if (a11yFont) {
      document.documentElement.setAttribute('data-a11y-font', a11yFont);
    }

    // Listen for system contrast changes
    const mq = window.matchMedia('(prefers-contrast: more)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches && !localStorage.getItem(`${STORAGE_PREFIX}-a11y-mode`)) {
        setA11yModeState('high-contrast');
        document.documentElement.setAttribute(
          'data-a11y-mode',
          'high-contrast',
        );
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run on mount; a11yMode/a11yFont used for initial DOM sync only
  }, []);

  const setA11yMode = useCallback((mode: A11yMode | null) => {
    applyWithTransition(() => {
      setA11yModeState(mode);
      if (mode) {
        localStorage.setItem(`${STORAGE_PREFIX}-a11y-mode`, mode);
        document.documentElement.setAttribute('data-a11y-mode', mode);
      } else {
        localStorage.removeItem(`${STORAGE_PREFIX}-a11y-mode`);
        document.documentElement.removeAttribute('data-a11y-mode');
        setA11yFontState(null);
        localStorage.removeItem(`${STORAGE_PREFIX}-a11y-font`);
        document.documentElement.removeAttribute('data-a11y-font');
      }
    });
  }, []);

  const setA11yFont = useCallback((font: A11yFont | null) => {
    setA11yFontState(font);
    if (font) {
      localStorage.setItem(`${STORAGE_PREFIX}-a11y-font`, font);
      document.documentElement.setAttribute('data-a11y-font', font);
    } else {
      localStorage.removeItem(`${STORAGE_PREFIX}-a11y-font`);
      document.documentElement.removeAttribute('data-a11y-font');
    }
  }, []);

  const hasNonDefaultSettings = a11yMode !== null;

  return {
    a11yMode,
    setA11yMode,
    a11yFont,
    setA11yFont,
    hasNonDefaultSettings,
  };
}

'use client';

import { useState, useCallback, useEffect } from 'react';

export type ReaderFontSize = 'small' | 'medium' | 'large';
export type ReaderMaxWidth = 'narrow' | 'medium' | 'wide';

/** Layout map: Panel id to percentage (0..100) */
export type PanelLayout = { [panelId: string]: number };

interface ReaderPreferences {
  fontSize: ReaderFontSize;
  maxWidth: ReaderMaxWidth;
  panelLayout: PanelLayout;
  readerOpen: boolean;
}

const STORAGE_KEY = 'kb-reader-preferences';

const DEFAULT_LAYOUT: PanelLayout = { detail: 55, reader: 45 };

const DEFAULTS: ReaderPreferences = {
  fontSize: 'medium',
  maxWidth: 'medium',
  panelLayout: DEFAULT_LAYOUT,
  readerOpen: false,
};

function loadPreferences(): ReaderPreferences {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ReaderPreferences>;
    return {
      fontSize: parsed.fontSize ?? DEFAULTS.fontSize,
      maxWidth: parsed.maxWidth ?? DEFAULTS.maxWidth,
      panelLayout:
        parsed.panelLayout &&
        typeof parsed.panelLayout === 'object' &&
        typeof parsed.panelLayout.detail === 'number' &&
        typeof parsed.panelLayout.reader === 'number'
          ? parsed.panelLayout
          : DEFAULTS.panelLayout,
      readerOpen:
        typeof parsed.readerOpen === 'boolean'
          ? parsed.readerOpen
          : DEFAULTS.readerOpen,
    };
  } catch {
    return DEFAULTS;
  }
}

function savePreferences(prefs: ReaderPreferences) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may be full or unavailable -- silently ignore
  }
}

export function useReaderPreferences() {
  const [prefs, setPrefs] = useState<ReaderPreferences>(loadPreferences);

  // Sync to localStorage whenever prefs change
  useEffect(() => {
    savePreferences(prefs);
  }, [prefs]);

  const setFontSize = useCallback((fontSize: ReaderFontSize) => {
    setPrefs((prev) => ({ ...prev, fontSize }));
  }, []);

  const setMaxWidth = useCallback((maxWidth: ReaderMaxWidth) => {
    setPrefs((prev) => ({ ...prev, maxWidth }));
  }, []);

  const setPanelLayout = useCallback((panelLayout: PanelLayout) => {
    setPrefs((prev) => ({ ...prev, panelLayout }));
  }, []);

  const setReaderOpen = useCallback((readerOpen: boolean) => {
    setPrefs((prev) => ({
      ...prev,
      readerOpen,
    }));
  }, []);

  const toggleReader = useCallback(() => {
    setPrefs((prev) => ({
      ...prev,
      readerOpen: !prev.readerOpen,
    }));
  }, []);

  return {
    fontSize: prefs.fontSize,
    maxWidth: prefs.maxWidth,
    panelLayout: prefs.panelLayout,
    readerOpen: prefs.readerOpen,
    setFontSize,
    setMaxWidth,
    setPanelLayout,
    setReaderOpen,
    toggleReader,
  };
}

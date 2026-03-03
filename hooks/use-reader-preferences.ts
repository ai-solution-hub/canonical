'use client';

import { useState, useCallback, useEffect } from 'react';

export type ReaderFontSize = 'small' | 'medium' | 'large';
export type ReaderMaxWidth = 'narrow' | 'medium' | 'wide';

/** Layout map: Panel id to percentage (0..100) */
export type PanelLayout = { [panelId: string]: number };

/** Position for the floating reader window */
export interface FloatingPosition {
  x: number;
  y: number;
}

/** Size for the floating reader window */
export interface FloatingSize {
  width: number;
  height: number;
}

interface ReaderPreferences {
  fontSize: ReaderFontSize;
  maxWidth: ReaderMaxWidth;
  panelLayout: PanelLayout;
  readerOpen: boolean;
  isDetached: boolean;
  detachedPosition: FloatingPosition | null;
  detachedSize: FloatingSize | null;
}

const STORAGE_KEY = 'ims-reader-preferences';

const DEFAULT_LAYOUT: PanelLayout = { detail: 55, reader: 45 };

const DEFAULT_FLOATING_SIZE: FloatingSize = { width: 600, height: 500 };

const DEFAULTS: ReaderPreferences = {
  fontSize: 'medium',
  maxWidth: 'medium',
  panelLayout: DEFAULT_LAYOUT,
  readerOpen: false,
  isDetached: false,
  detachedPosition: null,
  detachedSize: null,
};

function isValidPosition(pos: unknown): pos is FloatingPosition {
  return (
    typeof pos === 'object' &&
    pos !== null &&
    typeof (pos as FloatingPosition).x === 'number' &&
    typeof (pos as FloatingPosition).y === 'number'
  );
}

function isValidSize(size: unknown): size is FloatingSize {
  return (
    typeof size === 'object' &&
    size !== null &&
    typeof (size as FloatingSize).width === 'number' &&
    typeof (size as FloatingSize).height === 'number' &&
    (size as FloatingSize).width >= 400 &&
    (size as FloatingSize).height >= 300
  );
}

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
      readerOpen: typeof parsed.readerOpen === 'boolean'
        ? parsed.readerOpen
        : DEFAULTS.readerOpen,
      isDetached: typeof parsed.isDetached === 'boolean'
        ? parsed.isDetached
        : DEFAULTS.isDetached,
      detachedPosition: isValidPosition(parsed.detachedPosition)
        ? parsed.detachedPosition
        : DEFAULTS.detachedPosition,
      detachedSize: isValidSize(parsed.detachedSize)
        ? parsed.detachedSize
        : DEFAULTS.detachedSize,
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

/** Get the default floating position (right side of viewport) */
export function getDefaultFloatingPosition(): FloatingPosition {
  if (typeof window === 'undefined') return { x: 100, y: 80 };
  return {
    x: Math.max(0, window.innerWidth - 650),
    y: 80,
  };
}

/** Get the default floating size */
export function getDefaultFloatingSize(): FloatingSize {
  return { ...DEFAULT_FLOATING_SIZE };
}

export function useReaderPreferences() {
  const [prefs, setPrefs] = useState<ReaderPreferences>(loadPreferences);

  // Sync to localStorage whenever prefs change
  useEffect(() => {
    savePreferences(prefs);
  }, [prefs]);

  // Auto-reattach on small screens
  useEffect(() => {
    if (!prefs.isDetached) return;

    function handleResize() {
      if (window.innerWidth < 768) {
        setPrefs((prev) => ({ ...prev, isDetached: false }));
      }
    }

    window.addEventListener('resize', handleResize);
    // Check immediately in case already on small screen
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [prefs.isDetached]);

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
      // If closing reader, also un-detach
      ...(readerOpen ? {} : { isDetached: false }),
    }));
  }, []);

  const toggleReader = useCallback(() => {
    setPrefs((prev) => ({
      ...prev,
      readerOpen: !prev.readerOpen,
      // If closing reader, also un-detach
      ...(!prev.readerOpen ? {} : { isDetached: false }),
    }));
  }, []);

  const setIsDetached = useCallback((isDetached: boolean) => {
    setPrefs((prev) => ({ ...prev, isDetached }));
  }, []);

  const toggleDetached = useCallback(() => {
    setPrefs((prev) => {
      // Can only detach when reader is open
      if (!prev.readerOpen) return prev;
      return { ...prev, isDetached: !prev.isDetached };
    });
  }, []);

  const setDetachedPosition = useCallback((position: FloatingPosition) => {
    setPrefs((prev) => ({ ...prev, detachedPosition: position }));
  }, []);

  const setDetachedSize = useCallback((size: FloatingSize) => {
    setPrefs((prev) => ({ ...prev, detachedSize: size }));
  }, []);

  return {
    fontSize: prefs.fontSize,
    maxWidth: prefs.maxWidth,
    panelLayout: prefs.panelLayout,
    readerOpen: prefs.readerOpen,
    isDetached: prefs.isDetached,
    detachedPosition: prefs.detachedPosition,
    detachedSize: prefs.detachedSize,
    setFontSize,
    setMaxWidth,
    setPanelLayout,
    setReaderOpen,
    toggleReader,
    setIsDetached,
    toggleDetached,
    setDetachedPosition,
    setDetachedSize,
  };
}

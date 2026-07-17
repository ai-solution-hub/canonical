'use client';

import type { ComponentProps } from 'react';

import { DocxViewerPreview } from '@/components/procurement/extend/docx-viewer';
import { useExtendTheme } from '@/components/procurement/extend/use-extend-theme';
import { XlsxViewerPreview } from '@/components/procurement/extend/xlsx-viewer';

type ThemedDocxViewerProps = Omit<
  ComponentProps<typeof DocxViewerPreview>,
  'isDark' | 'onIsDarkChange'
>;

type ThemedXlsxViewerProps = Omit<
  ComponentProps<typeof XlsxViewerPreview>,
  'isDark' | 'onIsDarkChange'
>;

/**
 * `DocxViewerPreview` bound to the app theme context (PRODUCT.md §B4 — the
 * viewer's required `isDark` + `onIsDarkChange` props must follow the app
 * theme, never diverge from it). Shell only — src/data-fetching wiring is
 * ID-147.18's state-contract work.
 */
export function ThemedDocxViewer(props: ThemedDocxViewerProps) {
  const { isDark, onIsDarkChange } = useExtendTheme();
  return (
    <DocxViewerPreview
      {...props}
      isDark={isDark}
      onIsDarkChange={onIsDarkChange}
    />
  );
}

/**
 * `XlsxViewerPreview` bound to the app theme context (PRODUCT.md §B4). Shell
 * only — src/data-fetching wiring is ID-147.18's state-contract work.
 */
export function ThemedXlsxViewer(props: ThemedXlsxViewerProps) {
  const { isDark, onIsDarkChange } = useExtendTheme();
  return (
    <XlsxViewerPreview
      {...props}
      isDark={isDark}
      onIsDarkChange={onIsDarkChange}
    />
  );
}

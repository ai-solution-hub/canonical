'use client';

import { PdfDocument } from '@/components/reader/pdf-document';

interface PdfReaderViewProps {
  /** External URL (existing items) */
  sourceUrl?: string | null;
  /** Supabase Storage path (uploaded items) */
  filePath?: string | null;
  /** Title for error fallback */
  title?: string;
}

/**
 * Inline PDF reader used by `ReaderPanel`. Thin wrapper over the shared
 * `<PdfDocument>` engine — renders the engine directly with keyboard navigation
 * always enabled (the reader panel owns the full pane, so it should respond to
 * arrow/zoom keys without a modal gate).
 */
export function PdfReaderView({ sourceUrl, filePath }: PdfReaderViewProps) {
  return <PdfDocument sourceUrl={sourceUrl} filePath={filePath} />;
}

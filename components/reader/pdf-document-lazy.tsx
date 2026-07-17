'use client';

/**
 * SSR-safe entry point for `PdfDocument` (ID-145 {145.49}).
 *
 * `react-pdf` evaluates pdfjs at module scope, and pdfjs needs browser
 * globals (`DOMMatrix`) that do not exist in the Node SSR pass — so a
 * static import of `./pdf-document` from any component that server-renders
 * throws `DOMMatrix is not defined` on every SSR attempt and forces the
 * whole page to client-render. `next/dynamic` with `ssr: false` keeps the
 * react-pdf chain out of the server bundle entirely; the loading fallback
 * mirrors `PdfDocument`'s own initial spinner so the host panel's shell
 * still SSRs with an honest loading state (spec §C: honest degrade).
 *
 * Consumers outside `components/reader/` MUST import `PdfDocumentLazy`
 * from this module, never `./pdf-document` directly.
 */
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

export const PdfDocumentLazy = dynamic(
  () =>
    import('@/components/reader/pdf-document').then((mod) => mod.PdfDocument),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

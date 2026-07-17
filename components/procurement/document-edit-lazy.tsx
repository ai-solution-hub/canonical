'use client';

/**
 * SSR-safe entry points for the §F edit-mode components (ID-147.19).
 *
 * `DocumentEditorPanel` statically imports the experimental
 * `@extend-ai/react-docx` / `@extend-ai/react-xlsx` editor chains, and
 * `ESignatureFork` the @embedpdf viewer + pdf-lib signing chain — neither
 * is proven in the Node SSR pass (the `components/reader/pdf-document-lazy`
 * {145.49} precedent: browser-global evaluation at module scope forces the
 * whole page to client-render). `next/dynamic` with `ssr: false` keeps both
 * chains out of the server bundle entirely — and out of the initial client
 * chunk until edit mode is actually entered. The loading fallback reuses
 * the §B6 viewer loading state so the edit pane never renders blank while
 * the chunk loads.
 *
 * Consumers MUST import these lazy entry points, never
 * `document-editor-panel` / `e-signature-fork` directly from a
 * server-renderable path.
 */
import dynamic from 'next/dynamic';

import { ViewerLoadingState } from '@/components/procurement/extend/viewer-states';

export const DocumentEditorPanelLazy = dynamic(
  () =>
    import('@/components/procurement/extend/document-editor-panel').then(
      (mod) => mod.DocumentEditorPanel,
    ),
  {
    ssr: false,
    loading: () => <ViewerLoadingState label="Loading editor…" />,
  },
);

export const ESignatureForkLazy = dynamic(
  () =>
    import('@/components/procurement/extend/e-signature-fork').then(
      (mod) => mod.ESignatureFork,
    ),
  {
    ssr: false,
    loading: () => <ViewerLoadingState label="Loading signature view…" />,
  },
);

'use client';

import * as React from 'react';
import { AlertTriangle, Download, FileX, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Viewer + upload STATE contracts (ID-147.18, PRODUCT.md §B6/§B7).
 *
 * This is the STATE layer over the ID-147.6 vendored PDF/DOCX/XLSX/CSV
 * viewers — it owns:
 *  - §B6: a loading state while a document's `src` resolves, and a soft
 *    error state with a retry affordance if that resolution fails —
 *    never a blank pane.
 *  - §B7: an explicit "cannot preview" message + download fallback for a
 *    document type with no viewer, or for a viewer that throws while
 *    rendering a corrupt file — also never a blank/broken render.
 *
 * Distinct from the item-page BI-19 empty/loading/error states (145W-3
 * owns those) — this operates purely at the individual-viewer level.
 */

// ---------------------------------------------------------------------------
// §B1/§B7 — viewer-kind resolution
// ---------------------------------------------------------------------------

/** The four document viewers vendored under ID-147.6. */
export type ViewerKind = 'pdf' | 'docx' | 'xlsx' | 'csv';

export interface ResolveViewerKindInput {
  mimeType?: string | null;
  fileName?: string | null;
}

const MIME_TO_VIEWER_KIND: Record<string, ViewerKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
};

const EXTENSION_TO_VIEWER_KIND: Record<string, ViewerKind> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.csv': 'csv',
};

/**
 * Resolves which vendored viewer (if any) can render a document, from its
 * mime type (preferred) with a filename-extension fallback — mirrors the
 * mime-then-extension precedence already established by
 * `components/shared/file-dropzone.tsx`. Returns `null` when no viewer
 * matches (§B7 — "a document whose type has no viewer").
 */
export function resolveViewerKind({
  mimeType,
  fileName,
}: ResolveViewerKindInput): ViewerKind | null {
  if (mimeType) {
    const byMime = MIME_TO_VIEWER_KIND[mimeType.toLowerCase()];
    if (byMime) return byMime;
  }

  if (fileName) {
    const lower = fileName.toLowerCase();
    const extension = Object.keys(EXTENSION_TO_VIEWER_KIND).find((ext) =>
      lower.endsWith(ext),
    );
    if (extension) return EXTENSION_TO_VIEWER_KIND[extension];
  }

  return null;
}

// ---------------------------------------------------------------------------
// §B6 — loading + soft error/retry
// ---------------------------------------------------------------------------

export function ViewerLoadingState({
  label = 'Loading document…',
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border bg-background py-16 text-center"
    >
      <Loader2
        className="size-6 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function ViewerErrorState({
  message,
  onRetry,
  retryLabel = 'Try again',
}: {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-6 py-16 text-center"
    >
      <AlertTriangle
        className="size-8 text-destructive/70"
        aria-hidden="true"
      />
      <div>
        <h3 className="text-sm font-medium text-foreground">
          Couldn&apos;t load this document
        </h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

/** Default, deliberately generic §B6 error copy — never a raw exception message. */
const DEFAULT_LOAD_ERROR_MESSAGE =
  'Something went wrong while loading this document. This is usually temporary.';

// ---------------------------------------------------------------------------
// §B7 — unsupported type / corrupt file -> cannot preview + download
// ---------------------------------------------------------------------------

export function ViewerUnsupportedState({
  fileName,
  downloadHref,
  reason = "This file type can't be previewed here.",
}: {
  fileName: string;
  downloadHref: string;
  reason?: string;
}) {
  return (
    <div
      role="status"
      className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/30 px-6 py-16 text-center"
    >
      <FileX className="size-8 text-muted-foreground" aria-hidden="true" />
      <div>
        <h3 className="text-sm font-medium text-foreground">
          Cannot preview this document
        </h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{reason}</p>
      </div>
      <Button asChild variant="outline" size="sm">
        <a href={downloadHref} download={fileName}>
          <Download className="mr-2 size-4" aria-hidden="true" />
          Download {fileName}
        </a>
      </Button>
    </div>
  );
}

const CORRUPT_FILE_REASON =
  "This document appears to be damaged, so it can't be shown here.";

interface ViewerRenderBoundaryProps {
  fileName: string;
  downloadHref: string;
  children: React.ReactNode;
}

interface ViewerRenderBoundaryState {
  hasError: boolean;
}

/**
 * Catches a render-time failure from a vendored viewer (a corrupt file the
 * viewer cannot parse) and falls back to the same "cannot preview" +
 * download affordance as an unsupported type (§B7) — never a broken/blank
 * render. A dedicated boundary rather than the generic
 * `components/shared/error-boundary.tsx` because its recovery affordance is
 * "try again" (appropriate for a transient render glitch), whereas a
 * genuinely corrupt file cannot be fixed by re-rendering — download is the
 * real escape hatch here.
 */
class ViewerRenderBoundary extends React.Component<
  ViewerRenderBoundaryProps,
  ViewerRenderBoundaryState
> {
  constructor(props: ViewerRenderBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ViewerRenderBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error(
      'ViewerRenderBoundary caught a viewer render failure:',
      error,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <ViewerUnsupportedState
          fileName={this.props.fileName}
          downloadHref={this.props.downloadHref}
          reason={CORRUPT_FILE_REASON}
        />
      );
    }

    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface DocumentViewerStateProps {
  /** Display name — used in the download affordance and alt text. */
  fileName: string;
  /** The document's mime type, when known (preferred for viewer-kind resolution). */
  mimeType?: string | null;
  /** Where the download fallback affordance points. */
  downloadHref: string;
  /** Resolves the viewer-ready `src` (e.g. a signed URL) — retried on demand. */
  loadSrc: () => Promise<string>;
  /** Renders the resolved vendored viewer for the given `src`. */
  renderViewer: (src: string) => React.ReactNode;
  /** Loading-state copy override. */
  loadingLabel?: string;
}

/**
 * The STATE layer wrapping a single vendored viewer instance: resolves
 * `loadSrc()` behind a loading state, retries on failure via a soft error
 * state (§B6), gates on `resolveViewerKind` before ever attempting to load
 * an unsupported type (§B7), and wraps the rendered viewer in
 * `ViewerRenderBoundary` to catch a corrupt-file render failure (also §B7).
 */
export function DocumentViewerState({
  fileName,
  mimeType,
  downloadHref,
  loadSrc,
  renderViewer,
  loadingLabel,
}: DocumentViewerStateProps) {
  const [status, setStatus] = React.useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [src, setSrc] = React.useState<string | null>(null);
  const viewerKind = resolveViewerKind({ mimeType, fileName });

  // Callers are expected to memoise `loadSrc` per document identity (e.g.
  // `useCallback` keyed on the document id) — this effect re-attempts the
  // load whenever `loadSrc`'s identity changes, which is the correct signal
  // that the target document changed, not merely a stale closure to avoid.
  const attemptLoad = React.useCallback(() => {
    if (!viewerKind) return;

    setStatus('loading');
    loadSrc().then(
      (resolvedSrc) => {
        setSrc(resolvedSrc);
        setStatus('ready');
      },
      () => {
        setStatus('error');
      },
    );
  }, [viewerKind, loadSrc]);

  React.useEffect(() => {
    attemptLoad();
  }, [attemptLoad]);

  if (!viewerKind) {
    return (
      <ViewerUnsupportedState fileName={fileName} downloadHref={downloadHref} />
    );
  }

  if (status === 'loading') {
    return <ViewerLoadingState label={loadingLabel} />;
  }

  if (status === 'error') {
    return (
      <ViewerErrorState
        message={DEFAULT_LOAD_ERROR_MESSAGE}
        onRetry={attemptLoad}
      />
    );
  }

  return (
    <ViewerRenderBoundary fileName={fileName} downloadHref={downloadHref}>
      {renderViewer(src as string)}
    </ViewerRenderBoundary>
  );
}

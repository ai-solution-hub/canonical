'use client';

/**
 * DocxViewer — renders a DOCX document from a signed URL.
 *
 * ID-117.8 (Option D): uses docx-preview's `renderAsync` to convert DOCX
 * bytes into styled HTML injected into a container div. Loading skeleton +
 * error-signal contract (onError callback + inline alert) for the parent
 * pane's INV-6 text fallback.
 */

import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocxViewerProps {
  /** Short-lived signed URL pointing to the DOCX binary. */
  url: string;
  /** Called with the error when fetch or parse fails; for INV-6 fallback. */
  onError?: (error: Error) => void;
}

type ViewerState = 'loading' | 'success' | 'error';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DocxViewer({ url, onError }: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ViewerState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState('loading');
      setErrorMessage(null);

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch document: HTTP ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        const blob = new Blob([buffer]);

        if (cancelled || !containerRef.current) return;

        await renderAsync(blob, containerRef.current, undefined, {
          className: 'docx-preview',
          inWrapper: false,
        });

        if (!cancelled) {
          setState('success');
        }
      } catch (err) {
        if (cancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState('error');
        setErrorMessage(error.message);
        onError?.(error);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [url, onError]);

  return (
    <div className="relative h-full w-full overflow-auto">
      {/* Loading skeleton */}
      {state === 'loading' && (
        <div
          role="status"
          aria-label="Loading document"
          className="flex flex-col gap-3 p-4"
        >
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <span className="sr-only">Loading document…</span>
        </div>
      )}

      {/* Inline error — shown when no onError prop provided */}
      {state === 'error' && (
        <div
          role="alert"
          className="m-4 rounded border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Unable to render document</p>
          {errorMessage && (
            <p className="mt-1 text-muted-foreground">{errorMessage}</p>
          )}
        </div>
      )}

      {/* docx-preview injects its HTML here */}
      <div
        ref={containerRef}
        className={state === 'loading' || state === 'error' ? 'hidden' : 'p-4'}
        aria-hidden={state !== 'success'}
      />
    </div>
  );
}

'use client';

/**
 * XlsxViewer — renders an XLSX/XLS spreadsheet from a signed URL.
 *
 * ID-117.8 (Option D): uses SheetJS (`xlsx`) to parse the file buffer,
 * then converts each sheet to HTML via `sheet_to_html` and renders it in a
 * scrollable container. Multi-sheet files get tab buttons. Same loading +
 * error-signal contract as DocxViewer for INV-6 fallback compatibility.
 */

import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface XlsxViewerProps {
  /** Short-lived signed URL pointing to the XLSX/XLS binary. */
  url: string;
  /** Called with the error when fetch or parse fails; for INV-6 fallback. */
  onError?: (error: Error) => void;
}

type ViewerState = 'loading' | 'success' | 'error';

interface SheetData {
  name: string;
  html: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function XlsxViewer({ url, onError }: XlsxViewerProps) {
  const [state, setState] = useState<ViewerState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState('loading');
      setErrorMessage(null);
      setSheets([]);

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch spreadsheet: HTTP ${response.status}`,
          );
        }

        const buffer = await response.arrayBuffer();

        // XLSX.read is synchronous; errors bubble to our catch block
        const workbook = XLSX.read(buffer, { type: 'array' });

        const parsed: SheetData[] = workbook.SheetNames.map((name) => ({
          name,
          // Sanitise SheetJS HTML output before injection — user-uploaded
          // spreadsheets may contain malicious content. DOMPurify strips all
          // script/event-handler attributes while preserving table markup.
          html: DOMPurify.sanitize(
            XLSX.utils.sheet_to_html(workbook.Sheets[name] ?? {}),
            { USE_PROFILES: { html: true } },
          ),
        }));

        if (!cancelled) {
          setSheets(parsed);
          setActiveSheet(parsed[0]?.name ?? '');
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

  const currentSheet = sheets.find((s) => s.name === activeSheet);
  const isMultiSheet = sheets.length > 1;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Loading skeleton */}
      {state === 'loading' && (
        <div
          role="status"
          aria-label="Loading spreadsheet"
          className="flex flex-col gap-2 p-4"
        >
          <div className="flex gap-2">
            <div className="h-6 w-16 animate-pulse rounded bg-muted" />
            <div className="h-6 w-16 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
          <span className="sr-only">Loading spreadsheet…</span>
        </div>
      )}

      {/* Inline error */}
      {state === 'error' && (
        <div
          role="alert"
          className="m-4 rounded border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Unable to render spreadsheet</p>
          {errorMessage && (
            <p className="mt-1 text-muted-foreground">{errorMessage}</p>
          )}
        </div>
      )}

      {/* Success state */}
      {state === 'success' && (
        <>
          {/* Sheet tabs — only shown for multi-sheet workbooks */}
          {isMultiSheet && (
            <div
              role="tablist"
              aria-label="Spreadsheet sheets"
              className="flex shrink-0 gap-1 border-b border-border bg-muted/30 px-2 pt-2"
            >
              {sheets.map((sheet) => (
                <button
                  key={sheet.name}
                  role="tab"
                  aria-selected={sheet.name === activeSheet}
                  onClick={() => setActiveSheet(sheet.name)}
                  className={[
                    'rounded-t px-3 py-1.5 text-sm transition-colors',
                    sheet.name === activeSheet
                      ? 'bg-card font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  ].join(' ')}
                >
                  {sheet.name}
                </button>
              ))}
            </div>
          )}

          {/* Sheet content — rendered HTML from sheet_to_html */}
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {currentSheet && (
              <div
                /* HTML is sanitised via DOMPurify.sanitize before being stored
                   in state — safe to inject via dangerouslySetInnerHTML. */
                dangerouslySetInnerHTML={{ __html: currentSheet.html }}
                className="xlsx-table-container text-sm [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:font-medium"
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

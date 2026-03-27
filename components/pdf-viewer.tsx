'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Document, Page } from 'react-pdf';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ExternalLink,
  FileText,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import '@/lib/pdf-worker';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
const SCALE_STEP = 0.25;
const DEFAULT_SCALE = 1.0;

interface PdfViewerProps {
  /** External URL (existing items) */
  sourceUrl?: string;
  /** Supabase Storage path (uploaded items) */
  filePath?: string;
  title: string;
}

export function PdfViewer({ sourceUrl, filePath, title }: PdfViewerProps) {
  // Initialise pdfUrl from sourceUrl prop (avoids setState-in-effect lint warning).
  // When filePath is provided instead, it starts null and gets resolved below.
  const [pdfUrl, setPdfUrl] = useState<string | null>(sourceUrl ?? null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [pageInputValue, setPageInputValue] = useState('1');
  const [hasError, setHasError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageWidthRef = useRef<number | null>(null);

  // Resolve signed URL for Supabase Storage files
  useEffect(() => {
    if (filePath && !sourceUrl) {
      const supabase = createClient();
      supabase.storage
        .from('documents')
        .createSignedUrl(filePath, 3600)
        .then(({ data }) => {
          if (data?.signedUrl) {
            setPdfUrl(data.signedUrl);
          } else {
            setHasError(true);
          }
        })
        .catch((err) => {
          console.error('Failed to get signed URL:', err);
          setHasError(true);
        });
    }
  }, [filePath, sourceUrl]);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setDialogOpen(open);
    if (open) {
      // Reset state when dialog opens
      setHasError(false);
      setCurrentPage(1);
      setPageInputValue('1');
      setScale(DEFAULT_SCALE);
      pageWidthRef.current = null;
    }
  }, []);

  const onDocumentLoadSuccess = useCallback(({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    setHasError(false);
  }, []);

  const onDocumentLoadError = useCallback(() => {
    setHasError(true);
  }, []);

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, numPages ?? 1));
      setCurrentPage(clamped);
      setPageInputValue(String(clamped));
    },
    [numPages],
  );

  const handlePageInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInputValue(e.target.value);
  }, []);

  const handlePageInputSubmit = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        const parsed = parseInt(pageInputValue, 10);
        if (!isNaN(parsed)) {
          goToPage(parsed);
        }
      }
    },
    [pageInputValue, goToPage],
  );

  const handlePageInputBlur = useCallback(() => {
    const parsed = parseInt(pageInputValue, 10);
    if (!isNaN(parsed)) {
      goToPage(parsed);
    } else {
      setPageInputValue(String(currentPage));
    }
  }, [pageInputValue, currentPage, goToPage]);

  const zoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + SCALE_STEP, MAX_SCALE));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - SCALE_STEP, MIN_SCALE));
  }, []);

  const fitWidth = useCallback(() => {
    if (containerRef.current && pageWidthRef.current) {
      const containerWidth = containerRef.current.clientWidth - 48;
      const newScale = containerWidth / pageWidthRef.current;
      setScale(Math.max(MIN_SCALE, Math.min(newScale, MAX_SCALE)));
    }
  }, []);

  const onPageLoadSuccess = useCallback(
    (page: { originalWidth: number }) => {
      if (!pageWidthRef.current) {
        pageWidthRef.current = page.originalWidth;
        // Auto fit-width on first page load
        if (containerRef.current) {
          const containerWidth = containerRef.current.clientWidth - 48;
          const newScale = containerWidth / page.originalWidth;
          setScale(Math.max(MIN_SCALE, Math.min(newScale, MAX_SCALE)));
        }
      }
    },
    [],
  );

  // Keyboard navigation (only when dialog is open)
  useEffect(() => {
    if (!dialogOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )
        return;

      if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        goToPage(currentPage - 1);
      }
      if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        goToPage(currentPage + 1);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomIn();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        zoomOut();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialogOpen, currentPage, goToPage, zoomIn, zoomOut]);

  const fallbackUrl = sourceUrl || undefined;

  return (
    <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" data-pdf-trigger>
          <FileText className="size-3.5" />
          View PDF
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-5xl" aria-describedby="pdf-viewer-description">
        <DialogHeader>
          <DialogTitle className="truncate">{title}</DialogTitle>
          <DialogDescription id="pdf-viewer-description" className="sr-only">
            Embedded PDF viewer for {title}
          </DialogDescription>
        </DialogHeader>
        <div ref={containerRef} className="h-[80vh] w-full">
          {hasError ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 rounded border border-dashed p-8 text-center">
              <AlertCircle className="size-10 text-muted-foreground" />
              <div className="space-y-1">
                <p className="font-medium">Unable to display PDF</p>
                <p className="text-sm text-muted-foreground">
                  The PDF could not be loaded in the embedded viewer.
                </p>
              </div>
              {fallbackUrl && (
                <Button variant="outline" size="sm" className="gap-1.5" asChild>
                  <a href={fallbackUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-3.5" />
                    Open in new tab
                  </a>
                </Button>
              )}
            </div>
          ) : !pdfUrl ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex h-full flex-col">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1.5">
                {/* Page navigation */}
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage <= 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <div className="flex items-center gap-1 text-sm">
                    <Input
                      value={pageInputValue}
                      onChange={handlePageInputChange}
                      onKeyDown={handlePageInputSubmit}
                      onBlur={handlePageInputBlur}
                      className="h-6 w-12 text-center text-xs"
                      aria-label="Page number"
                    />
                    <span className="text-muted-foreground">
                      of {numPages ?? '...'}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage >= (numPages ?? 1)}
                    aria-label="Next page"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>

                <Separator orientation="vertical" className="mx-1 h-5" />

                {/* Zoom controls */}
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={zoomOut}
                    disabled={scale <= MIN_SCALE}
                    aria-label="Zoom out"
                  >
                    <ZoomOut className="size-4" />
                  </Button>
                  <span className="min-w-[3rem] text-center text-xs text-muted-foreground">
                    {Math.round(scale * 100)}%
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={zoomIn}
                    disabled={scale >= MAX_SCALE}
                    aria-label="Zoom in"
                  >
                    <ZoomIn className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={fitWidth}
                    className="gap-1 text-xs"
                    aria-label="Fit width"
                  >
                    <Maximize2 className="size-3.5" />
                    Fit
                  </Button>
                </div>

                {/* External link */}
                {fallbackUrl && (
                  <>
                    <Separator orientation="vertical" className="mx-1 h-5" />
                    <Button variant="ghost" size="icon-sm" asChild>
                      <a
                        href={fallbackUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open in new tab"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                  </>
                )}
              </div>

              {/* PDF content */}
              <div className="flex-1 overflow-auto bg-muted/30 p-4">
                <div className="mx-auto flex justify-center">
                  <Document
                    file={pdfUrl}
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={onDocumentLoadError}
                    loading={
                      <div className="flex flex-col items-center gap-4 py-12">
                        <Skeleton className="h-[600px] w-[450px] rounded" />
                      </div>
                    }
                  >
                    <Page
                      pageNumber={currentPage}
                      scale={scale}
                      onLoadSuccess={onPageLoadSuccess}
                      loading={
                        <Skeleton className="h-[600px] w-[450px] rounded" />
                      }
                      renderTextLayer={true}
                      renderAnnotationLayer={true}
                    />
                  </Document>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

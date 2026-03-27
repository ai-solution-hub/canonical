'use client';

import { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GitCompareArrows,
} from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDateUK, formatFileSize } from '@/lib/format';
import { SourceDocumentHistory } from '@/components/source-document-history';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceDocumentDetail {
  id: string;
  filename: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  content_hash: string;
  version: number;
  parent_id: string | null;
  storage_path: string;
  status: string;
  uploaded_by: string;
  created_at: string;
}

export interface SourceDocumentInfoProps {
  /** The source document ID. If null, renders nothing. */
  sourceDocumentId: string | null;
  /** Additional CSS class names */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Compact display of a source document's metadata.
 *
 * Shows filename, version number, upload date, and file size.
 * Contains an expandable "View version history" section that renders
 * the full SourceDocumentHistory timeline.
 *
 * Designed for use in a sidebar or metadata section.
 */
export function SourceDocumentInfo({
  sourceDocumentId,
  className,
}: SourceDocumentInfoProps) {
  const [document, setDocument] = useState<SourceDocumentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sourceDocumentId) return;
    if (fetchedRef.current === sourceDocumentId) return;
    fetchedRef.current = sourceDocumentId;

    let cancelled = false;

    async function fetchDocument() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/source-documents/${encodeURIComponent(sourceDocumentId!)}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body.error || `Failed to fetch document details (${res.status})`,
          );
        }
        const data = await res.json();
        if (!cancelled) setDocument(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load source document',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchDocument();
    return () => {
      cancelled = true;
    };
  }, [sourceDocumentId]);

  // Render nothing if no ID is provided
  if (!sourceDocumentId) return null;

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className={cn('space-y-2', className)}
        role="status"
        aria-label="Loading source document details"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>Loading document details...</span>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className={cn('space-y-2', className)} role="alert">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle
            className="size-4 text-freshness-aging"
            aria-hidden="true"
          />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!document) return null;

  return (
    <div className={cn('space-y-3', className)}>
      {/* ── Document summary ── */}
      <div className="flex items-start gap-2.5">
        <FileText
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {document.original_filename || document.filename}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant="outline" className="text-[10px]">
              v{document.version}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatDateUK(document.created_at)}
            </span>
            <span
              className="text-xs text-muted-foreground"
              aria-hidden="true"
            >
              &middot;
            </span>
            <span className="text-xs text-muted-foreground">
              {formatFileSize(document.file_size)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Diff link (shown when document has a parent version) ── */}
      {document.parent_id && (
        <Link
          href={`/documents/${document.id}/diff`}
          className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
        >
          <GitCompareArrows className="size-3.5" aria-hidden="true" />
          View changes from previous version
        </Link>
      )}

      {/* ── Expandable version history ── */}
      <div className="rounded-md border border-border">
        <button
          type="button"
          onClick={() => setHistoryOpen(!historyOpen)}
          aria-expanded={historyOpen}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          {historyOpen ? (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden="true" />
          )}
          View version history
        </button>
        {historyOpen && (
          <div className="border-t border-border px-3 py-3">
            <SourceDocumentHistory sourceDocumentId={sourceDocumentId} />
          </div>
        )}
      </div>
    </div>
  );
}

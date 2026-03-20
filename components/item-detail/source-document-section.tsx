'use client';

import { useState, useEffect, useRef } from 'react';
import { FileText, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SourceDocumentInfo } from '@/components/source-document-info';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceDocumentSectionProps {
  /** The content item ID to look up the source document for */
  contentItemId: string;
  /** Additional CSS class names */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Wrapper component for the item detail sidebar.
 *
 * Fetches the content item's `source_document_id` and renders
 * SourceDocumentInfo if a source document is linked, or a quiet
 * "No source document linked" message if not.
 *
 * Suitable for inclusion in the item detail page metadata sidebar.
 */
export function SourceDocumentSection({
  contentItemId,
  className,
}: SourceDocumentSectionProps) {
  const [sourceDocumentId, setSourceDocumentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!contentItemId) return;
    if (fetchedRef.current === contentItemId) return;
    fetchedRef.current = contentItemId;

    let cancelled = false;

    async function fetchSourceDocumentId() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/items/${encodeURIComponent(contentItemId)}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body.error || `Failed to fetch item details (${res.status})`,
          );
        }
        const data = await res.json();
        if (!cancelled) {
          setSourceDocumentId(data.source_document_id ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load item details',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSourceDocumentId();
    return () => {
      cancelled = true;
    };
  }, [contentItemId]);

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className={cn('py-2', className)}
        role="status"
        aria-label="Loading source document information"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          <span>Checking source document...</span>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className={cn('py-2', className)} role="alert">
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

  // ── No source document linked ──────────────────────────────────────────
  if (!sourceDocumentId) {
    return (
      <div className={cn('py-2', className)}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="size-4 shrink-0" aria-hidden="true" />
          <span>No source document linked</span>
        </div>
      </div>
    );
  }

  // ── Source document info ────────────────────────────────────────────────
  return (
    <div className={cn('py-2', className)}>
      <SourceDocumentInfo sourceDocumentId={sourceDocumentId} />
    </div>
  );
}

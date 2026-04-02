'use client';

import { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Loader2,
  AlertTriangle,
  Check,
  GitCompareArrows,
} from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDateUK, formatFileSize } from '@/lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceDocumentVersion {
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
  content_item_count: number;
}

export interface SourceDocumentHistoryProps {
  /** The source document ID (any version in the chain) */
  sourceDocumentId: string;
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
 * Displays a vertical timeline of source document versions.
 *
 * Fetches the version chain from the API and renders each version
 * with filename, upload date, file size, and content item count.
 * The current version (matching sourceDocumentId) is highlighted.
 */
export function SourceDocumentHistory({
  sourceDocumentId,
  className,
}: SourceDocumentHistoryProps) {
  const [versions, setVersions] = useState<SourceDocumentVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!sourceDocumentId || fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;

    async function fetchVersions() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/source-documents/${encodeURIComponent(sourceDocumentId)}/versions`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body.error || `Failed to fetch version history (${res.status})`,
          );
        }
        const data = await res.json();
        if (!cancelled) {
          setVersions(data.versions ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load version history',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchVersions();
    return () => {
      cancelled = true;
    };
  }, [sourceDocumentId]);

  // Reset fetch guard when sourceDocumentId changes
  useEffect(() => {
    fetchedRef.current = false;
  }, [sourceDocumentId]);

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className={cn('flex items-center justify-center py-6', className)}
        role="status"
        aria-label="Loading version history"
      >
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading version history...</span>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (error) {
    return (
      <div
        className={cn(
          'flex flex-col items-center gap-2 py-6 text-center',
          className,
        )}
        role="alert"
      >
        <AlertTriangle
          className="size-5 text-freshness-aging"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (versions.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center gap-2 py-6 text-center',
          className,
        )}
      >
        <FileText className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          No version history available.
        </p>
      </div>
    );
  }

  // Sort versions ascending (v1 at top, latest at bottom)
  const sorted = [...versions].sort((a, b) => a.version - b.version);

  return (
    <div
      className={cn('space-y-0', className)}
      role="list"
      aria-label="Source document version history"
    >
      {sorted.map((version, index) => {
        const isCurrent = version.id === sourceDocumentId;
        const isLast = index === sorted.length - 1;

        return (
          <div
            key={version.id}
            role="listitem"
            className="relative flex gap-3 pb-4"
          >
            {/* ── Timeline connector ── */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border-2',
                  isCurrent
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-muted/50',
                )}
                aria-hidden="true"
              >
                {isCurrent ? (
                  <Check className="size-3.5 text-primary" />
                ) : (
                  <FileText className="size-3 text-muted-foreground" />
                )}
              </div>
              {!isLast && (
                <div className="w-0.5 flex-1 bg-border" aria-hidden="true" />
              )}
            </div>

            {/* ── Version details ── */}
            <div
              className={cn(
                'min-w-0 flex-1 rounded-md border px-3 py-2',
                isCurrent
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-border bg-card',
              )}
            >
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    'shrink-0 text-[10px]',
                    isCurrent && 'border-primary/40 text-primary',
                  )}
                >
                  v{version.version}
                </Badge>
                {isCurrent && (
                  <Badge variant="secondary" className="text-[10px]">
                    Current
                  </Badge>
                )}
              </div>
              <p className="mt-1 truncate text-sm font-medium text-foreground">
                {version.original_filename || version.filename}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span>
                  <span className="sr-only">Uploaded on </span>
                  {formatDateUK(version.created_at)}
                </span>
                <span aria-hidden="true">&middot;</span>
                <span>
                  <span className="sr-only">File size: </span>
                  {formatFileSize(version.file_size)}
                </span>
                {version.content_item_count > 0 && (
                  <>
                    <span aria-hidden="true">&middot;</span>
                    <span>
                      {version.content_item_count}{' '}
                      {version.content_item_count === 1 ? 'item' : 'items'}
                    </span>
                  </>
                )}
              </div>
              {version.parent_id && (
                <Link
                  href={`/documents/${version.id}/diff`}
                  className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <GitCompareArrows className="size-3" aria-hidden="true" />
                  View changes from v{version.version - 1}
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

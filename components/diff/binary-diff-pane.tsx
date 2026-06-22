'use client';

/**
 * BinaryDiffPane — the binary view-depth pane for the unified diff surface
 * (ID-117 {117.10}, cluster B).
 *
 * Composes the already-landed binary leg into a side-by-side visual compare of
 * two source_documents versions, plus the text line-diff summary alongside
 * (Option C / OQ-117-2': visual-compare + text summary for v1; NO binary inline
 * change-marking — overlay is v1.1, out of scope).
 *
 * For each side (older, newer) the pane mints a short-lived signed URL via
 * `GET /api/source-documents/{docId}/binary-url` and picks a leaf viewer by mime
 * type: application/pdf → PdfDocument; DOCX → DocxViewer; XLSX → XlsxViewer.
 *
 * INV-6 fallback (never a blank panel): if a side has no binary leg, the
 * binary-url fetch returns non-200, the mime type is unsupported, or a viewer
 * signals onError, that side degrades to the text comparison with a clear inline
 * notice. The text line-diff summary (the extracted_text comparison) is the
 * fallback substrate and is ALWAYS rendered regardless.
 *
 * Read-only (INV-17/18): NO apply / dismiss / accept affordances (the legacy
 * re-ingest review workflow is RETIRED). No AI labelling (INV-20). Workspace
 * scoping is enforced upstream by the page's RLS client and the binary-url
 * route's RLS check (INV-19) — this component adds no client-side trust.
 */

import { useEffect, useState, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import {
  RevisionDiffView,
  type RevisionBlob,
} from '@/components/item-detail/revision-diff-view';
import { DocxViewer } from '@/components/diff/viewers/docx-viewer';
import { XlsxViewer } from '@/components/diff/viewers/xlsx-viewer';
import { PdfDocument } from '@/components/reader/pdf-document';
import type { UnifiedDiff, UnifiedRevision } from '@/lib/diff/unified-revision';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BinaryDiffPaneProps {
  /** The binary-depth diff: two source_document revisions of one chain. */
  diff: UnifiedDiff;
  /** The source_documents.id for the older side (mints its signed URL). */
  olderDocId: string;
  /** The source_documents.id for the newer side (mints its signed URL). */
  newerDocId: string;
  className?: string;
}

/** Which leaf viewer a mime type resolves to (null = unsupported → fallback). */
type ViewerKind = 'pdf' | 'docx' | 'xlsx' | null;

/** The async state of one side's binary fetch + render. */
type SideStatus =
  | { phase: 'loading' }
  | { phase: 'ready'; url: string; viewer: Exclude<ViewerKind, null> }
  | { phase: 'fallback'; reason: string };

// ---------------------------------------------------------------------------
// Mime-type → viewer mapping (INV-5 format coverage)
// ---------------------------------------------------------------------------

const DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

const XLSX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

function resolveViewer(mimeType: string): ViewerKind {
  if (mimeType === 'application/pdf') return 'pdf';
  if (DOCX_MIMES.has(mimeType)) return 'docx';
  if (XLSX_MIMES.has(mimeType)) return 'xlsx';
  return null;
}

// ---------------------------------------------------------------------------
// UnifiedRevision → RevisionBlob (structural subset for the text engine)
// ---------------------------------------------------------------------------

function toRevisionBlob(rev: UnifiedRevision): RevisionBlob {
  return {
    version: rev.version,
    text: rev.text,
    changeType: rev.changeType,
    changeSummary: rev.changeSummary,
    createdAt: rev.createdAt,
    createdByLabel: rev.createdByLabel,
    editIntent: rev.editIntent,
  };
}

// ---------------------------------------------------------------------------
// Single-side binary viewer (with its own INV-6 fallback handling)
// ---------------------------------------------------------------------------

interface BinarySideProps {
  sideLabel: string;
  docId: string;
  revision: UnifiedRevision;
}

function BinarySide({ sideLabel, docId, revision }: BinarySideProps) {
  const [status, setStatus] = useState<SideStatus>(
    revision.binary
      ? { phase: 'loading' }
      : {
          phase: 'fallback',
          reason: 'No binary original is stored for this version.',
        },
  );

  // Fetch the signed URL for this side's source_documents id.
  useEffect(() => {
    if (!revision.binary) return;

    let cancelled = false;

    async function load() {
      setStatus({ phase: 'loading' });
      try {
        const response = await fetch(
          `/api/source-documents/${docId}/binary-url`,
        );
        if (!response.ok) {
          if (!cancelled) {
            setStatus({
              phase: 'fallback',
              reason: 'The binary original could not be loaded.',
            });
          }
          return;
        }
        const body: { signed_url?: string; mime_type?: string } =
          await response.json();
        const mimeType = body.mime_type ?? revision.binary?.mimeType ?? '';
        const viewer = resolveViewer(mimeType);
        if (!body.signed_url || viewer === null) {
          if (!cancelled) {
            setStatus({
              phase: 'fallback',
              reason: 'This file type cannot be previewed.',
            });
          }
          return;
        }
        if (!cancelled) {
          setStatus({ phase: 'ready', url: body.signed_url, viewer });
        }
      } catch {
        if (!cancelled) {
          setStatus({
            phase: 'fallback',
            reason: 'The binary original could not be loaded.',
          });
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [docId, revision.binary]);

  // A viewer onError signal degrades this side to the fallback notice (INV-6).
  const handleViewerError = useCallback(() => {
    setStatus({
      phase: 'fallback',
      reason: 'The binary original could not be rendered.',
    });
  }, []);

  return (
    <div className="flex-1 min-w-0">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {sideLabel} <span aria-hidden="true">&middot;</span> v{revision.version}
      </p>
      <div className="h-[60vh] overflow-hidden rounded-md border bg-card">
        {status.phase === 'loading' && (
          <div
            role="status"
            aria-label={`Loading ${sideLabel.toLowerCase()} document`}
            className="flex h-full flex-col gap-3 p-4"
          >
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
            <span className="sr-only">Loading document…</span>
          </div>
        )}

        {status.phase === 'ready' && status.viewer === 'pdf' && (
          <PdfDocument sourceUrl={status.url} />
        )}
        {status.phase === 'ready' && status.viewer === 'docx' && (
          <DocxViewer url={status.url} onError={handleViewerError} />
        )}
        {status.phase === 'ready' && status.viewer === 'xlsx' && (
          <XlsxViewer url={status.url} onError={handleViewerError} />
        )}

        {status.phase === 'fallback' && (
          <div
            role="alert"
            className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
          >
            <AlertCircle className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              Preview unavailable
            </p>
            <p className="text-xs text-muted-foreground">
              {status.reason} The text comparison below still shows what
              changed.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function BinaryDiffPane({
  diff,
  olderDocId,
  newerDocId,
  className,
}: BinaryDiffPaneProps) {
  const { older, newer } = diff;

  return (
    <div className={className}>
      {/* Visual compare — older | newer, side by side (INV-5/7). */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <BinarySide sideLabel="Older" docId={olderDocId} revision={older} />
        <BinarySide sideLabel="Newer" docId={newerDocId} revision={newer} />
      </div>

      {/* Text line-diff summary, always alongside (Option C / OQ-117-2'). */}
      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Text comparison
        </h3>
        <RevisionDiffView
          older={toRevisionBlob(older)}
          newer={toRevisionBlob(newer)}
        />
      </div>
    </div>
  );
}

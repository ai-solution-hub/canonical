'use client';

import * as React from 'react';
import { Download, FileText, Upload } from 'lucide-react';

import { TenderUpload } from '@/components/procurement/tender-upload';
import {
  DocumentViewerThumbnailSidebar,
  useElementWidth,
  useInlineThumbnailSidebar,
} from '@/components/procurement/extend/document-viewer-sidebar';
import { FileThumbnail } from '@/components/procurement/extend/file-thumbnail';
import { PDFViewer } from '@/components/procurement/extend/pdf-viewer';
import { CsvViewer } from '@/components/procurement/extend/csv-viewer';
import {
  ThemedDocxViewer,
  ThemedXlsxViewer,
} from '@/components/procurement/extend/themed-viewers';
import {
  DocumentViewerState,
  ViewerErrorState,
  ViewerLoadingState,
} from '@/components/procurement/extend/viewer-states';
import { cn } from '@/lib/utils';
import { formatDateUK } from '@/lib/format';
import type { FormAttachmentSummary } from '@/lib/domains/procurement/procurement-detail-shape';
import type { ExtractionResult, TenderDocument } from '@/types/procurement';

/**
 * The §A Documents tab (ID-145 {145.42}, PRODUCT §A5/§A8/§A9). Splits the
 * item's documents into FORM SOURCE vs REFERENCE/EVIDENCE by TEXT LABEL,
 * never colour alone (§A5, §J4). A single ungrouped form with no
 * reference/evidence attachments collapses to today's simple document list
 * (§A8) — the split only appears once there is a reference/evidence
 * attachment to show (the engagement rail is a SEPARATE gate, §A3, owned by
 * `ItemPageFrame`/`page.tsx`, not this component). Selecting a document
 * previews it via the vendored Document-Viewer-Sidebar + File-Thumbnail
 * feeding the matching viewer (§A9, §B) through the {147.18}
 * `DocumentViewerState` state layer.
 */

/** A unified document row — the zero-schema tender documents and the
 * `form_attachments` rows both flatten to this shape for list + preview. */
interface DocumentEntry {
  key: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
  dateLabel: string | null;
  /** The path passed to `tender/download?path=` to resolve a preview src. */
  storagePath: string;
  /** Engagement-scoped attachments live outside this form's own storage
   * prefix — `tender/download`'s path-prefix guard cannot resolve them yet
   * (OOS — see the PR notes), so they list but do not preview. */
  previewable: boolean;
}

function tenderDocumentToEntry(doc: TenderDocument): DocumentEntry {
  return {
    key: `tender:${doc.path}`,
    filename: doc.filename,
    mimeType: doc.mime_type,
    size: doc.size,
    dateLabel: doc.uploaded_at,
    storagePath: doc.path,
    previewable: true,
  };
}

function attachmentToEntry(
  attachment: FormAttachmentSummary,
  procurementId: string,
): DocumentEntry {
  return {
    key: `attachment:${attachment.id}`,
    filename: attachment.filename,
    mimeType: attachment.mime_type,
    size: attachment.file_size,
    dateLabel: attachment.created_at,
    storagePath: attachment.storage_path,
    // Only a form-scoped attachment's storage_path starts with this form's
    // own `${id}/` prefix — the prefix `tender/download` requires.
    previewable: attachment.storage_path.startsWith(`${procurementId}/`),
  };
}

export interface ItemDocumentsTabProps {
  procurementId: string;
  tenderDocuments: TenderDocument[];
  formSourceAttachments: FormAttachmentSummary[];
  referenceEvidenceAttachments: FormAttachmentSummary[];
  canEdit: boolean;
  onUploadComplete: (result?: ExtractionResult) => void;
}

export function ItemDocumentsTab({
  procurementId,
  tenderDocuments,
  formSourceAttachments,
  referenceEvidenceAttachments,
  canEdit,
  onUploadComplete,
}: ItemDocumentsTabProps) {
  const formSourceDocs = React.useMemo<DocumentEntry[]>(
    () => [
      ...tenderDocuments.map(tenderDocumentToEntry),
      ...formSourceAttachments.map((a) => attachmentToEntry(a, procurementId)),
    ],
    [tenderDocuments, formSourceAttachments, procurementId],
  );

  const referenceEvidenceDocs = React.useMemo<DocumentEntry[]>(
    () =>
      referenceEvidenceAttachments.map((a) =>
        attachmentToEntry(a, procurementId),
      ),
    [referenceEvidenceAttachments, procurementId],
  );

  // §A8 progressive disclosure: the two-group split (and its labels) appear
  // ONLY once there is a reference/evidence attachment to show — otherwise
  // this collapses to today's single, unlabelled-group simple list.
  const hasReferenceEvidence = referenceEvidenceDocs.length > 0;

  const allDocs = React.useMemo(
    () => [...formSourceDocs, ...referenceEvidenceDocs],
    [formSourceDocs, referenceEvidenceDocs],
  );

  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const selectedDoc = allDocs.find((d) => d.key === selectedKey) ?? null;

  const [sidebarRef, sidebarWidth] = useElementWidth<HTMLDivElement>();
  const inlineSidebar = useInlineThumbnailSidebar(sidebarWidth);

  const isEmpty = allDocs.length === 0;

  return (
    <div className="space-y-6">
      {canEdit && (
        <TenderUpload
          procurementId={procurementId}
          onUploadComplete={onUploadComplete}
        />
      )}

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <Upload
            className="size-8 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="mt-2 text-sm text-muted-foreground">
            No tender documents uploaded yet.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            {hasReferenceEvidence ? (
              <>
                <DocumentGroup
                  label="Form source"
                  docs={formSourceDocs}
                  selectedKey={selectedKey}
                  onSelect={setSelectedKey}
                />
                <DocumentGroup
                  label="Reference / evidence"
                  docs={referenceEvidenceDocs}
                  selectedKey={selectedKey}
                  onSelect={setSelectedKey}
                />
              </>
            ) : (
              <DocumentGroup
                label={null}
                heading={`Uploaded Documents (${formSourceDocs.length})`}
                docs={formSourceDocs}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
              />
            )}
          </div>

          {/* §A9 — selecting a document previews it via the thumbnail sidebar
              + the matching viewer. */}
          <div
            ref={sidebarRef}
            className="relative min-h-64 overflow-hidden rounded-lg border"
          >
            <DocumentViewerThumbnailSidebar
              inline={inlineSidebar}
              open={selectedDoc !== null}
              widthClassName="w-24"
            >
              <div className="flex flex-col gap-2 overflow-y-auto p-2">
                {allDocs.map((doc) => (
                  <button
                    key={doc.key}
                    type="button"
                    onClick={() => setSelectedKey(doc.key)}
                    aria-current={doc.key === selectedKey}
                    aria-label={`Preview ${doc.filename}`}
                    className={cn(
                      'rounded-md p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      doc.key === selectedKey && 'ring-2 ring-primary',
                    )}
                  >
                    <FileThumbnail
                      file={{
                        name: doc.filename,
                        type: doc.mimeType ?? 'application/octet-stream',
                      }}
                    />
                  </button>
                ))}
              </div>
            </DocumentViewerThumbnailSidebar>

            <div className={cn(inlineSidebar && selectedDoc && 'ml-24')}>
              {selectedDoc ? (
                <DocumentPreviewPane
                  procurementId={procurementId}
                  doc={selectedDoc}
                />
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                  <FileText className="size-8" aria-hidden="true" />
                  Select a document to preview it.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentGroup({
  label,
  heading,
  docs,
  selectedKey,
  onSelect,
}: {
  label: string | null;
  heading?: string;
  docs: DocumentEntry[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="rounded-lg border">
      <div className="p-4">
        <h2 className="text-sm font-medium text-foreground">
          {heading ?? `${label} (${docs.length})`}
        </h2>
      </div>
      {docs.length > 0 ? (
        <div className="divide-y">
          {docs.map((doc) => (
            <button
              key={doc.key}
              type="button"
              onClick={() => onSelect(doc.key)}
              aria-current={doc.key === selectedKey}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                doc.key === selectedKey && 'bg-accent',
              )}
            >
              <FileText
                className="size-5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {doc.size != null
                    ? `${Math.round(doc.size / 1024)} KB`
                    : null}
                  {doc.dateLabel &&
                    ` · Uploaded ${formatDateUK(doc.dateLabel)}`}
                  {!doc.previewable && ' · Preview not yet available'}
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          Nothing here yet.
        </p>
      )}
    </div>
  );
}

/** §A9 — resolves the matching viewer (§B1) for the selected document. */
function DocumentPreviewPane({
  procurementId,
  doc,
}: {
  procurementId: string;
  doc: DocumentEntry;
}) {
  const loadSrc = React.useCallback(async () => {
    const res = await fetch(
      `/api/procurement/${procurementId}/tender/download?path=${encodeURIComponent(doc.storagePath)}`,
    );
    if (!res.ok) throw new Error('Failed to get a preview link');
    const { download_url: downloadUrl } = await res.json();
    return downloadUrl as string;
  }, [procurementId, doc.storagePath]);

  if (!doc.previewable) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <Download className="size-8" aria-hidden="true" />
        Preview isn&apos;t available for this document yet — it belongs to the
        engagement, not this form.
      </div>
    );
  }

  return (
    <DocumentViewerState
      key={doc.key}
      fileName={doc.filename}
      mimeType={doc.mimeType}
      downloadHref={`/api/procurement/${procurementId}/tender/download?path=${encodeURIComponent(doc.storagePath)}`}
      loadSrc={loadSrc}
      renderViewer={(src) => (
        <ResolvedViewer
          fileName={doc.filename}
          mimeType={doc.mimeType}
          src={src}
        />
      )}
    />
  );
}

/** §B1 — the correct viewer is selected from the document's type. */
function ResolvedViewer({
  fileName,
  mimeType,
  src,
}: {
  fileName: string;
  mimeType: string | null;
  src: string;
}) {
  const lower = fileName.toLowerCase();
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    return <PDFViewer src={src} fileName={fileName} />;
  }
  if (
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    return <ThemedDocxViewer src={src} fileName={fileName} />;
  }
  if (
    mimeType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    lower.endsWith('.xlsx')
  ) {
    return <ThemedXlsxViewer src={src} fileName={fileName} />;
  }
  if (mimeType === 'text/csv' || lower.endsWith('.csv')) {
    return <CsvViewerFromSrc src={src} />;
  }
  // §B7 — resolveViewerKind already gates DocumentViewerState before this
  // renders, so this branch is a defensive fallback, not the normal path.
  return (
    <ViewerErrorState
      message="This file type can't be previewed here."
      onRetry={() => {
        /* no-op — resolveViewerKind already routed unsupported types to §B7 upstream */
      }}
    />
  );
}

/** CSV viewer takes raw `data` text, not a `src` URL — fetch it once resolved. */
function CsvViewerFromSrc({ src }: { src: string }) {
  const [state, setState] = React.useState<
    | { status: 'loading' }
    | { status: 'ready'; data: string }
    | { status: 'error' }
  >({ status: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch CSV content');
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setState({ status: 'ready', data: text });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (state.status === 'loading') return <ViewerLoadingState />;
  if (state.status === 'error') {
    return (
      <ViewerErrorState
        message="Something went wrong while loading this document. This is usually temporary."
        onRetry={() => setState({ status: 'loading' })}
      />
    );
  }
  return <CsvViewer data={state.data} search />;
}

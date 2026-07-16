/**
 * ItemDocumentsTab — the §A Documents tab (ID-145 {145.42}).
 *
 * Behaviour under test: the §A5 role split (by text label), §A8 progressive
 * disclosure (collapses to today's simple list when there is nothing to
 * split), and §A9 select-to-preview (wired through the real
 * `DocumentViewerState` + `resolveViewerKind`, with the actual vendored
 * viewer components mocked out — those have their own smoke tests).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('@/components/procurement/tender-upload', () => ({
  TenderUpload: () => <div data-testid="tender-upload">TenderUpload</div>,
}));

vi.mock('@/components/procurement/extend/pdf-viewer', () => ({
  PDFViewer: ({ fileName }: { fileName?: string }) => (
    <div data-testid="mock-pdf-viewer">{fileName}</div>
  ),
}));

vi.mock('@/components/procurement/extend/themed-viewers', () => ({
  ThemedDocxViewer: ({ fileName }: { fileName?: string }) => (
    <div data-testid="mock-docx-viewer">{fileName}</div>
  ),
  ThemedXlsxViewer: ({ fileName }: { fileName?: string }) => (
    <div data-testid="mock-xlsx-viewer">{fileName}</div>
  ),
}));

vi.mock('@/components/procurement/extend/csv-viewer', () => ({
  CsvViewer: ({ data }: { data?: string }) => (
    <div data-testid="mock-csv-viewer">{data}</div>
  ),
}));

vi.mock('@/lib/format', () => ({
  formatDateUK: (d: string) => d,
}));

import { ItemDocumentsTab } from '@/components/procurement/item-documents-tab';
import type { FormAttachmentSummary } from '@/lib/domains/procurement/procurement-detail-shape';
import type { TenderDocument } from '@/types/procurement';

const PROCUREMENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function makeTenderDoc(
  overrides: Partial<TenderDocument> = {},
): TenderDocument {
  return {
    path: `${PROCUREMENT_ID}/tender.pdf`,
    filename: 'tender.pdf',
    size: 2048,
    mime_type: 'application/pdf',
    uploaded_at: '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

function makeAttachment(
  overrides: Partial<FormAttachmentSummary> = {},
): FormAttachmentSummary {
  return {
    id: 'att-1',
    filename: 'cv.pdf',
    storage_path: `${PROCUREMENT_ID}/attachments/att-1-cv.pdf`,
    mime_type: 'application/pdf',
    file_size: 1024,
    role: 'reference_evidence',
    form_instance_id: PROCUREMENT_ID,
    engagement_group_id: null,
    created_at: '2026-01-20T00:00:00Z',
    ...overrides,
  };
}

describe('ItemDocumentsTab', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ download_url: 'https://example.com/signed.pdf' }),
        text: async () => 'a,b\n1,2',
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the upload affordance for an editor, hides it for a viewer', () => {
    const { rerender } = render(
      <ItemDocumentsTab
        procurementId={PROCUREMENT_ID}
        tenderDocuments={[]}
        formSourceAttachments={[]}
        referenceEvidenceAttachments={[]}
        canEdit={true}
        onUploadComplete={() => {}}
      />,
    );
    expect(screen.getByTestId('tender-upload')).toBeInTheDocument();

    rerender(
      <ItemDocumentsTab
        procurementId={PROCUREMENT_ID}
        tenderDocuments={[]}
        formSourceAttachments={[]}
        referenceEvidenceAttachments={[]}
        canEdit={false}
        onUploadComplete={() => {}}
      />,
    );
    expect(screen.queryByTestId('tender-upload')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no documents at all', () => {
    render(
      <ItemDocumentsTab
        procurementId={PROCUREMENT_ID}
        tenderDocuments={[]}
        formSourceAttachments={[]}
        referenceEvidenceAttachments={[]}
        canEdit={false}
        onUploadComplete={() => {}}
      />,
    );
    expect(
      screen.getByText('No tender documents uploaded yet.'),
    ).toBeInTheDocument();
  });

  it('§A8 collapses to a single "Uploaded Documents" list when ungrouped with no reference/evidence attachments', () => {
    render(
      <ItemDocumentsTab
        procurementId={PROCUREMENT_ID}
        tenderDocuments={[makeTenderDoc()]}
        formSourceAttachments={[]}
        referenceEvidenceAttachments={[]}
        canEdit={false}
        onUploadComplete={() => {}}
      />,
    );
    expect(screen.getByText('Uploaded Documents (1)')).toBeInTheDocument();
    expect(screen.queryByText(/^Form source/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/^Reference \/ evidence/),
    ).not.toBeInTheDocument();
  });

  it('§A5 splits into FORM SOURCE / REFERENCE-EVIDENCE labelled groups once there is a reference/evidence attachment', () => {
    render(
      <ItemDocumentsTab
        procurementId={PROCUREMENT_ID}
        tenderDocuments={[makeTenderDoc()]}
        formSourceAttachments={[]}
        referenceEvidenceAttachments={[makeAttachment()]}
        canEdit={false}
        onUploadComplete={() => {}}
      />,
    );
    expect(screen.getByText('Form source (1)')).toBeInTheDocument();
    expect(screen.getByText('Reference / evidence (1)')).toBeInTheDocument();
    expect(screen.queryByText(/^Uploaded Documents/)).not.toBeInTheDocument();
  });

  it('selecting a PDF document previews it via the matching viewer (§A9/§B1)', async () => {
    const user = userEvent.setup();
    render(
      <ItemDocumentsTab
        procurementId={PROCUREMENT_ID}
        tenderDocuments={[makeTenderDoc()]}
        formSourceAttachments={[]}
        referenceEvidenceAttachments={[]}
        canEdit={false}
        onUploadComplete={() => {}}
      />,
    );

    await user.click(screen.getByText('tender.pdf'));

    const viewer = await screen.findByTestId('mock-pdf-viewer');
    expect(viewer).toHaveTextContent('tender.pdf');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/procurement/${PROCUREMENT_ID}/tender/download?path=`,
      ),
    );
  });

  it('selecting a DOCX attachment previews it via the themed DOCX viewer', async () => {
    const user = userEvent.setup();
    const docxAttachment = makeAttachment({
      id: 'att-2',
      filename: 'sq.docx',
      storage_path: `${PROCUREMENT_ID}/attachments/att-2-sq.docx`,
      mime_type:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      role: 'form_source',
    });
    render(
      <ItemDocumentsTab
        procurementId={PROCUREMENT_ID}
        tenderDocuments={[]}
        formSourceAttachments={[docxAttachment]}
        referenceEvidenceAttachments={[makeAttachment()]}
        canEdit={false}
        onUploadComplete={() => {}}
      />,
    );

    await user.click(screen.getByText('sq.docx'));
    const viewer = await screen.findByTestId('mock-docx-viewer');
    expect(viewer).toHaveTextContent('sq.docx');
  });

  it('previews an engagement-scoped attachment (ID-145 {145.19} folded-in gap fix)', async () => {
    const user = userEvent.setup();
    const engagementAttachment = makeAttachment({
      id: 'att-3',
      filename: 'engagement-cv.pdf',
      storage_path: 'engagement/eg-1/att-3-cv.pdf',
      form_instance_id: null,
      engagement_group_id: 'eg-1',
    });
    render(
      <ItemDocumentsTab
        procurementId={PROCUREMENT_ID}
        tenderDocuments={[makeTenderDoc()]}
        formSourceAttachments={[]}
        referenceEvidenceAttachments={[engagementAttachment]}
        canEdit={false}
        onUploadComplete={() => {}}
      />,
    );

    // No longer disabled — `tender/download` now resolves engagement-scoped
    // paths too (server-side verified against this form's own
    // engagement_group_id).
    expect(
      screen.queryByText(/Preview not yet available/),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText('engagement-cv.pdf'));
    const viewer = await screen.findByTestId('mock-pdf-viewer');
    expect(viewer).toHaveTextContent('engagement-cv.pdf');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/procurement/${PROCUREMENT_ID}/tender/download?path=`,
      ),
    );
  });
});

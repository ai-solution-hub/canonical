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
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

// The §F1/§F3 edit-mode components mount through their ssr:false lazy entry
// point (the `pdf-document-lazy` precedent) — mocked HERE, at that entry
// point, exactly as the fill-slot/citation tests mock `pdf-document-lazy`.
// The e-signature stub deliberately consumes the REAL
// `usePersistSignedDocument` hook so the round-trip test exercises the
// hardened attachments-route persistence lane rather than re-stubbing it.
vi.mock('@/components/procurement/document-edit-lazy', async () => {
  const { usePersistSignedDocument } = await vi.importActual<
    typeof import('@/components/procurement/extend/use-persist-signed-document')
  >('@/components/procurement/extend/use-persist-signed-document');

  function DocumentEditorPanelLazy(props: {
    procurementId: string;
    kind: string;
    documentPath: string;
    fileName?: string;
    src?: string;
  }) {
    return (
      <div
        data-testid="mock-document-editor-panel"
        data-kind={props.kind}
        data-document-path={props.documentPath}
        data-src={props.src}
      />
    );
  }

  function ESignatureForkLazy(props: {
    formId: string;
    file?: string;
    fields: unknown[];
    canSign: boolean;
    onSigned?: (result: unknown) => void;
  }) {
    const { mutateAsync } = usePersistSignedDocument();
    return (
      <div
        data-testid="mock-e-signature-fork"
        data-form-id={props.formId}
        data-file={props.file}
        data-can-sign={String(props.canSign)}
        data-field-count={props.fields.length}
      >
        <button
          type="button"
          onClick={() => {
            void mutateAsync({
              formId: props.formId,
              pdfBytes: new Uint8Array([1, 2, 3]),
            }).then((result) => props.onSigned?.(result));
          }}
        >
          Save signed document (stub)
        </button>
      </div>
    );
  }

  return { DocumentEditorPanelLazy, ESignatureForkLazy };
});

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

  describe('edit mode (§F1/§F3/§F4 — ID-147.19)', () => {
    const docxAttachment = () =>
      makeAttachment({
        id: 'att-docx',
        filename: 'sq.docx',
        storage_path: `${PROCUREMENT_ID}/attachments/att-docx-sq.docx`,
        mime_type:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        role: 'form_source',
      });

    /** The e-signature stub consumes the real `usePersistSignedDocument`,
     * so signing-lane renders need a QueryClientProvider. */
    function renderWithQueryClient(ui: React.ReactElement) {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      return render(
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
      );
    }

    it('§F4 shows the edit toggle for an admin/editor on a DOCX document, never for a viewer', async () => {
      const user = userEvent.setup();
      const attachment = docxAttachment();
      const { rerender } = render(
        <ItemDocumentsTab
          procurementId={PROCUREMENT_ID}
          tenderDocuments={[]}
          formSourceAttachments={[attachment]}
          referenceEvidenceAttachments={[]}
          canEdit={true}
          onUploadComplete={() => {}}
        />,
      );

      await user.click(screen.getByText('sq.docx'));
      expect(
        await screen.findByRole('button', { name: 'Edit document' }),
      ).toBeInTheDocument();

      // Same selection, viewer role: no toggle, read-only viewer unchanged.
      rerender(
        <ItemDocumentsTab
          procurementId={PROCUREMENT_ID}
          tenderDocuments={[]}
          formSourceAttachments={[attachment]}
          referenceEvidenceAttachments={[]}
          canEdit={false}
          onUploadComplete={() => {}}
        />,
      );
      expect(
        screen.queryByRole('button', { name: 'Edit document' }),
      ).not.toBeInTheDocument();
      expect(await screen.findByTestId('mock-docx-viewer')).toBeInTheDocument();
    });

    it('§F1 entering edit mode mounts DocumentEditorPanel for a DOCX document, and exiting returns to the preview', async () => {
      const user = userEvent.setup();
      const attachment = docxAttachment();
      render(
        <ItemDocumentsTab
          procurementId={PROCUREMENT_ID}
          tenderDocuments={[]}
          formSourceAttachments={[attachment]}
          referenceEvidenceAttachments={[]}
          canEdit={true}
          onUploadComplete={() => {}}
        />,
      );

      await user.click(screen.getByText('sq.docx'));
      await user.click(
        await screen.findByRole('button', { name: 'Edit document' }),
      );

      const panel = await screen.findByTestId('mock-document-editor-panel');
      expect(panel).toHaveAttribute('data-kind', 'docx');
      expect(panel).toHaveAttribute(
        'data-document-path',
        attachment.storage_path,
      );
      // src resolved through the same §B6 tender/download lane as previews.
      expect(panel).toHaveAttribute(
        'data-src',
        'https://example.com/signed.pdf',
      );

      await user.click(screen.getByRole('button', { name: 'Back to preview' }));
      expect(
        screen.queryByTestId('mock-document-editor-panel'),
      ).not.toBeInTheDocument();
      expect(await screen.findByTestId('mock-docx-viewer')).toBeInTheDocument();
    });

    it('§F1 offers the editor with kind=xlsx for an XLSX document', async () => {
      const user = userEvent.setup();
      const xlsx = makeAttachment({
        id: 'att-xlsx',
        filename: 'prices.xlsx',
        storage_path: `${PROCUREMENT_ID}/attachments/att-xlsx-prices.xlsx`,
        mime_type:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        role: 'form_source',
      });
      render(
        <ItemDocumentsTab
          procurementId={PROCUREMENT_ID}
          tenderDocuments={[]}
          formSourceAttachments={[xlsx]}
          referenceEvidenceAttachments={[]}
          canEdit={true}
          onUploadComplete={() => {}}
        />,
      );

      await user.click(screen.getByText('prices.xlsx'));
      await user.click(
        await screen.findByRole('button', { name: 'Edit document' }),
      );
      expect(
        await screen.findByTestId('mock-document-editor-panel'),
      ).toHaveAttribute('data-kind', 'xlsx');
    });

    it('§F3 offers the signing lane for a PDF document and mounts the e-signature fork', async () => {
      const user = userEvent.setup();
      renderWithQueryClient(
        <ItemDocumentsTab
          procurementId={PROCUREMENT_ID}
          tenderDocuments={[makeTenderDoc()]}
          formSourceAttachments={[]}
          referenceEvidenceAttachments={[]}
          canEdit={true}
          onUploadComplete={() => {}}
        />,
      );

      await user.click(screen.getByText('tender.pdf'));
      await user.click(
        await screen.findByRole('button', { name: 'Sign document' }),
      );

      const fork = await screen.findByTestId('mock-e-signature-fork');
      expect(fork).toHaveAttribute('data-form-id', PROCUREMENT_ID);
      expect(fork).toHaveAttribute('data-can-sign', 'true');
      expect(fork).toHaveAttribute(
        'data-file',
        'https://example.com/signed.pdf',
      );
      // No signature-placement data source exists in production yet — the
      // fork receives an empty field set and renders its own honest empty
      // state ("no signature fields are configured").
      expect(fork).toHaveAttribute('data-field-count', '0');
    });

    it('§F3 persisted-signature round-trip: saves through the attachments route and triggers the document-list refresh', async () => {
      const user = userEvent.setup();
      const onUploadComplete = vi.fn();
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/attachments')) {
          return {
            ok: true,
            json: async () => ({
              id: 'att-signed',
              form_instance_id: PROCUREMENT_ID,
              engagement_group_id: null,
              role: 'form_source',
              filename: 'signed-document.pdf',
              storage_path: `${PROCUREMENT_ID}/attachments/att-signed.pdf`,
              mime_type: 'application/pdf',
              file_size: 3,
              created_by: null,
              created_at: '2026-07-17T00:00:00Z',
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            download_url: 'https://example.com/signed.pdf',
          }),
          text: async () => '',
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      renderWithQueryClient(
        <ItemDocumentsTab
          procurementId={PROCUREMENT_ID}
          tenderDocuments={[makeTenderDoc()]}
          formSourceAttachments={[]}
          referenceEvidenceAttachments={[]}
          canEdit={true}
          onUploadComplete={onUploadComplete}
        />,
      );

      await user.click(screen.getByText('tender.pdf'));
      await user.click(
        await screen.findByRole('button', { name: 'Sign document' }),
      );
      await user.click(
        await screen.findByRole('button', {
          name: 'Save signed document (stub)',
        }),
      );

      await waitFor(() => expect(onUploadComplete).toHaveBeenCalledTimes(1));
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/procurement/${PROCUREMENT_ID}/attachments`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('offers no edit or sign toggle for a CSV document (outside EditableDocumentKind, not a PDF)', async () => {
      const user = userEvent.setup();
      const csv = makeAttachment({
        id: 'att-csv',
        filename: 'rates.csv',
        storage_path: `${PROCUREMENT_ID}/attachments/att-csv-rates.csv`,
        mime_type: 'text/csv',
        role: 'form_source',
      });
      render(
        <ItemDocumentsTab
          procurementId={PROCUREMENT_ID}
          tenderDocuments={[]}
          formSourceAttachments={[csv]}
          referenceEvidenceAttachments={[]}
          canEdit={true}
          onUploadComplete={() => {}}
        />,
      );

      await user.click(screen.getByText('rates.csv'));
      expect(await screen.findByTestId('mock-csv-viewer')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Edit document' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Sign document' }),
      ).not.toBeInTheDocument();
    });
  });
});

/**
 * Tests for BinaryDiffPane (components/diff/binary-diff-pane.tsx)
 *
 * ID-117.10 — UnifiedDiffContainer + entry-point wiring (binary depth pane).
 *
 * Test philosophy (test-philosophy.md): assert observable behaviour, not
 * implementation. The behaviours under contract:
 *  - per mime type, the correct leaf viewer is mounted (PDF / DOCX / XLSX);
 *  - INV-6 fallback: a non-200 binary-url response, an unsupported mime type,
 *    or a viewer onError signal all degrade to the text line-diff fallback with
 *    a clear notice — NEVER a blank panel;
 *  - Option C (OQ-117-2'): the text line-diff summary is ALWAYS rendered
 *    alongside the visual viewers (visual-compare + text summary for v1).
 *
 * The leaf viewers and the PDF engine are mocked to sentinels so the tests
 * observe "which viewer was chosen" without pulling in browser-only deps.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BinaryDiffPane } from '@/components/diff/binary-diff-pane';
import type { UnifiedDiff } from '@/lib/diff/unified-revision';

// ---------------------------------------------------------------------------
// Mocks — leaf viewers + PDF engine replaced with identifiable sentinels
// ---------------------------------------------------------------------------

vi.mock('@/components/diff/viewers/docx-viewer', () => ({
  DocxViewer: ({
    url,
    onError,
  }: {
    url: string;
    onError?: (e: Error) => void;
  }) => (
    <div data-testid="docx-viewer">
      {url}
      <button
        type="button"
        data-testid="docx-error-trigger"
        onClick={() => onError?.(new Error('docx render failed'))}
      >
        trigger error
      </button>
    </div>
  ),
}));

vi.mock('@/components/diff/viewers/xlsx-viewer', () => ({
  XlsxViewer: ({ url }: { url: string; onError?: (e: Error) => void }) => (
    <div data-testid="xlsx-viewer">{url}</div>
  ),
}));

vi.mock('@/components/reader/pdf-document-lazy', () => ({
  PdfDocumentLazy: ({ sourceUrl }: { sourceUrl?: string | null }) => (
    <div data-testid="pdf-viewer">{sourceUrl}</div>
  ),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const OLDER_DOC_ID = '11111111-1111-4111-8111-111111111111';
const NEWER_DOC_ID = '22222222-2222-4222-8222-222222222222';

const PDF_MIME = 'application/pdf';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function makeDiff(
  mimeType: string,
  overrides: Partial<UnifiedDiff> = {},
): UnifiedDiff {
  return {
    older: {
      recordKind: 'source_document',
      recordId: OLDER_DOC_ID,
      version: 1,
      text: 'original line one\noriginal line two',
      changeType: 'initial_ingest',
      changeSummary: null,
      createdAt: '2026-01-01T10:00:00.000Z',
      createdByLabel: 'Alice',
      editIntent: null,
      binary: { storagePath: `${OLDER_DOC_ID}/old.bin`, mimeType },
    },
    newer: {
      recordKind: 'source_document',
      recordId: NEWER_DOC_ID,
      version: 2,
      text: 'changed line one\noriginal line two',
      changeType: 'reingest',
      changeSummary: null,
      createdAt: '2026-02-01T10:00:00.000Z',
      createdByLabel: 'Bob',
      editIntent: null,
      binary: { storagePath: `${NEWER_DOC_ID}/new.bin`, mimeType },
    },
    ...overrides,
  };
}

/** Both binary-url fetches succeed with a signed URL + the given mime type. */
function mockSignedUrlSuccess(mimeType: string) {
  mockFetch.mockImplementation((input: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          signed_url: `https://signed.example/${encodeURIComponent(input)}`,
          expires_in: 300,
          mime_type: mimeType,
        }),
    }),
  );
}

/** Every binary-url fetch returns a non-200 structured error. */
function mockSignedUrlFailure(status = 404) {
  mockFetch.mockImplementation(() =>
    Promise.resolve({
      ok: false,
      status,
      json: () => Promise.resolve({ error: 'Source document not found' }),
    }),
  );
}

function renderPane(diff: UnifiedDiff) {
  return render(
    <BinaryDiffPane
      diff={diff}
      olderDocId={OLDER_DOC_ID}
      newerDocId={NEWER_DOC_ID}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BinaryDiffPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('viewer selection by mime type', () => {
    it('renders the PDF viewer for both sides when mime type is application/pdf', async () => {
      mockSignedUrlSuccess(PDF_MIME);
      renderPane(makeDiff(PDF_MIME));

      await waitFor(() => {
        expect(screen.getAllByTestId('pdf-viewer')).toHaveLength(2);
      });
      expect(screen.queryByTestId('docx-viewer')).not.toBeInTheDocument();
      expect(screen.queryByTestId('xlsx-viewer')).not.toBeInTheDocument();
    });

    it('renders the DOCX viewer for both sides for a wordprocessingml mime type', async () => {
      mockSignedUrlSuccess(DOCX_MIME);
      renderPane(makeDiff(DOCX_MIME));

      await waitFor(() => {
        expect(screen.getAllByTestId('docx-viewer')).toHaveLength(2);
      });
    });

    it('renders the XLSX viewer for both sides for a spreadsheetml mime type', async () => {
      mockSignedUrlSuccess(XLSX_MIME);
      renderPane(makeDiff(XLSX_MIME));

      await waitFor(() => {
        expect(screen.getAllByTestId('xlsx-viewer')).toHaveLength(2);
      });
    });

    it('mints two distinct signed URLs — one per source-document id', async () => {
      mockSignedUrlSuccess(PDF_MIME);
      renderPane(makeDiff(PDF_MIME));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
      const calledUrls = mockFetch.mock.calls.map((c) => c[0]);
      expect(calledUrls).toContain(
        `/api/source-documents/${OLDER_DOC_ID}/binary-url`,
      );
      expect(calledUrls).toContain(
        `/api/source-documents/${NEWER_DOC_ID}/binary-url`,
      );
    });
  });

  describe('Option C — text summary always rendered alongside', () => {
    it('renders the text line-diff summary even on a successful binary render', async () => {
      mockSignedUrlSuccess(PDF_MIME);
      renderPane(makeDiff(PDF_MIME));

      await waitFor(() =>
        expect(screen.getAllByTestId('pdf-viewer')).toHaveLength(2),
      );
      // The RevisionDiffView text engine renders a log region for the diff.
      expect(screen.getByLabelText('Revision text diff')).toBeInTheDocument();
    });
  });

  describe('INV-6 fallback — never a blank panel', () => {
    it('falls back to the text comparison when the binary-url fetch is non-200', async () => {
      mockSignedUrlFailure(404);
      renderPane(makeDiff(PDF_MIME));

      await waitFor(() =>
        expect(screen.getByLabelText('Revision text diff')).toBeInTheDocument(),
      );
      expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument();
      // Both sides degrade — each shows its own fallback notice (never blank).
      expect(screen.getAllByRole('alert')).toHaveLength(2);
    });

    it('falls back to the text comparison for an unsupported mime type (no viewer)', async () => {
      const unsupported = 'image/png';
      mockSignedUrlSuccess(unsupported);
      renderPane(makeDiff(unsupported));

      await waitFor(() =>
        expect(screen.getByLabelText('Revision text diff')).toBeInTheDocument(),
      );
      expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument();
      expect(screen.queryByTestId('docx-viewer')).not.toBeInTheDocument();
      expect(screen.queryByTestId('xlsx-viewer')).not.toBeInTheDocument();
      expect(screen.getAllByRole('alert')).toHaveLength(2);
    });

    it('falls back to the text comparison when a side has no binary leg at all', async () => {
      mockSignedUrlSuccess(PDF_MIME);
      const diff = makeDiff(PDF_MIME);
      const noBinary: UnifiedDiff = {
        older: { ...diff.older, binary: undefined },
        newer: { ...diff.newer, binary: undefined },
      };
      renderPane(noBinary);

      await waitFor(() =>
        expect(screen.getByLabelText('Revision text diff')).toBeInTheDocument(),
      );
      expect(screen.getAllByRole('alert')).toHaveLength(2);
    });

    it('degrades a side to the text-comparison fallback when its DOCX viewer signals onError', async () => {
      mockSignedUrlSuccess(DOCX_MIME);
      renderPane(makeDiff(DOCX_MIME));

      // Both viewers render successfully — no fallback notices yet.
      await waitFor(() =>
        expect(screen.getAllByTestId('docx-viewer')).toHaveLength(2),
      );
      expect(screen.queryAllByRole('alert')).toHaveLength(0);

      // The older side's viewer signals a render failure (INV-6 onError path).
      fireEvent.click(screen.getAllByTestId('docx-error-trigger')[0]);

      // That side degrades to a fallback notice; the other keeps its viewer
      // (never a blank panel), and the text summary remains alongside (Option C).
      await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
      expect(screen.getAllByTestId('docx-viewer')).toHaveLength(1);
      expect(screen.getByLabelText('Revision text diff')).toBeInTheDocument();
    });
  });
});

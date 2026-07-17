/**
 * ItemCitationOverlay (components/procurement/item-citation-overlay.tsx)
 * — ID-145 {145.47} (TECH §3/§4, PRODUCT §D1-D5, DR-064), Checker F1 fix.
 *
 * Behaviour under contract (test-philosophy.md — observable behaviour, not
 * implementation):
 *  - AXIS FIX: citations are read via `GET /api/procurement/[id]/citations`
 *    (the form's own citing-side citations), NEVER the
 *    `cited_source_document_id = formId` axis; a resolved citation's
 *    spatial-overlay target is `resolved_source_document_id` (the citation's
 *    OWN q_a_pair's backing document), NOT `formId`.
 *  - §D5: no citations at all -> the panel's own honest empty state, no
 *    overlay pane, never a blank/error panel.
 *  - §D4: a resolved DOCX/XLSX target document stays text-anchored (no
 *    overlay pane) even when citations exist.
 *  - §D1/§D3: a q_a_pair citation whose text is found in the rendered
 *    TextLayer resolves to an overlay box and gains an "On page" hint in
 *    the (real, wired) citations panel; one that isn't found stays a plain
 *    text-anchored row, never a misplaced box.
 *  - Bidirectional select: choosing the citation row selects/scrolls the
 *    box; choosing the box selects the row.
 *
 * `CitationsPanelView` is used FOR REAL (not mocked) — it renders exactly
 * the data this component's own `useProcurementFormCitations` query
 * resolves, so this test exercises the actual end-to-end wiring rather than
 * a stubbed contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/__tests__/helpers/query-wrapper';
import { ItemCitationOverlay } from '@/components/procurement/item-citation-overlay';

vi.mock('@/components/reader/pdf-document', () => ({
  PdfDocument: ({
    currentPage,
    onPageChange,
    onTextLayerRenderSuccess,
    renderPageOverlay,
  }: {
    currentPage: number;
    onPageChange: (page: number) => void;
    onTextLayerRenderSuccess?: (page: number, root: Element) => void;
    renderPageOverlay?: (page: number) => React.ReactNode;
  }) => {
    return (
      <div data-testid="pdf-document-mock">
        <span data-testid="current-page">{currentPage}</span>
        <button
          type="button"
          data-testid="next-page"
          onClick={() => onPageChange(currentPage + 1)}
        >
          next page
        </button>
        <button
          type="button"
          data-testid="fire-text-layer"
          onClick={() => {
            const root = document.createElement('div');
            root.textContent =
              'The tender deadline is 5pm on the closing date.';
            onTextLayerRenderSuccess?.(currentPage, root);
          }}
        >
          fire text layer
        </button>
        {renderPageOverlay?.(currentPage)}
      </div>
    );
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const FORM_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';

function emptyCitationsByKind() {
  return {
    q_a_pair: [],
    reference_item: [],
    source_document: [],
    concept: [],
  };
}

function mockCitationsAndBinary({
  qaPair = [] as Array<Record<string, unknown>>,
  mimeType = 'application/pdf',
  documentId = DOCUMENT_ID,
}: {
  qaPair?: Array<Record<string, unknown>>;
  mimeType?: string;
  documentId?: string;
} = {}) {
  mockFetch.mockImplementation((input: string) => {
    // AXIS FIX: only the procurement-scoped citations route is ever read —
    // the (wrong) source-documents axis must never be requested.
    if (
      input.includes('/api/source-documents/') &&
      input.includes('/citations')
    ) {
      return Promise.reject(
        new Error(`must not read the wrong citations axis: ${input}`),
      );
    }
    if (input === `/api/procurement/${FORM_ID}/citations`) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            form_instance_id: FORM_ID,
            citations: { ...emptyCitationsByKind(), q_a_pair: qaPair },
          }),
      });
    }
    if (input === `/api/source-documents/${documentId}/binary-url`) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            signed_url: `https://signed.example/${documentId}`,
            expires_in: 300,
            mime_type: mimeType,
          }),
      });
    }
    return Promise.reject(new Error(`unexpected fetch: ${input}`));
  });
}

function citationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cite-1',
    cited_kind: 'q_a_pair',
    citing_kind: 'form_response',
    citation_type: 'reference',
    cited_text: 'tender deadline',
    cited_start: null,
    cited_end: null,
    cited_location_kind: null,
    cited_q_a_pair_id: 'qa-1',
    cited_reference_item_id: null,
    // Always null on the citing axis (Checker F1) — never the overlay target.
    cited_source_document_id: null,
    cited_concept_path: null,
    created_at: '2026-03-14T09:00:00.000Z',
    resolved_source_document_id: DOCUMENT_ID,
    ...overrides,
  };
}

function renderComponent() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ItemCitationOverlay formId={FORM_ID} />
    </QueryClientProvider>,
  );
}

/** The (real, wired) citations panel — distinguishes panel rows from overlay boxes, which can share the same accessible name. */
function panelScope() {
  return within(screen.getByRole('region', { name: /citations/i }));
}

/** The mocked PdfDocument + its rendered overlay boxes. */
function overlayScope() {
  return within(screen.getByTestId('pdf-document-mock'));
}

describe('ItemCitationOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom implements no layout engine — `Range.getClientRects` doesn't
    // exist at all (per citation-highlight-derivation.ts's own test-file
    // doc). B1's real (non-test) call path reads these DOM measurement APIs
    // directly, so stub both globally to exercise that real path against
    // the fake TextLayer root fixtures below, rather than mocking the
    // derivation module itself.
    Range.prototype.getClientRects = vi.fn(
      () =>
        [
          { left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20 },
        ] as unknown as DOMRectList,
    );
    Element.prototype.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 0,
          top: 0,
          right: 400,
          bottom: 600,
          width: 400,
          height: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );
  });

  it('reads the form-scoped citing-axis route, never the wrong source-documents axis', async () => {
    mockCitationsAndBinary({
      qaPair: [citationRow()],
      mimeType: 'application/pdf',
    });
    renderComponent();

    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(
          ([url]) => url === `/api/procurement/${FORM_ID}/citations`,
        ),
      ).toBe(true),
    );
    expect(
      mockFetch.mock.calls.some(
        ([url]) =>
          String(url).includes('/api/source-documents/') &&
          String(url).includes('/citations'),
      ),
    ).toBe(false);
  });

  it("resolves a citation's spatial-overlay target from its OWN resolved_source_document_id, never formId", async () => {
    mockCitationsAndBinary({ qaPair: [citationRow()] });
    renderComponent();

    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(
          ([url]) => url === `/api/source-documents/${DOCUMENT_ID}/binary-url`,
        ),
      ).toBe(true),
    );
    expect(
      mockFetch.mock.calls.some(
        ([url]) => url === `/api/source-documents/${FORM_ID}/binary-url`,
      ),
    ).toBe(false);
  });

  it("§D5 — renders the panel's honest empty state and no overlay pane when there are no citations", async () => {
    mockCitationsAndBinary({ qaPair: [] });
    renderComponent();

    await waitFor(() =>
      expect(screen.getByText(/no citations yet/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('pdf-document-mock')).not.toBeInTheDocument();
    // Nothing to resolve spatially -> no needless binary-url network call.
    expect(
      mockFetch.mock.calls.some(([url]) => String(url).includes('/binary-url')),
    ).toBe(false);
  });

  it('§D1 scope — a citation with no resolved backing document stays text-anchored, no pane', async () => {
    mockCitationsAndBinary({
      qaPair: [
        citationRow({
          cited_text: 'no evidence document on this answer',
          resolved_source_document_id: null,
        }),
      ],
    });
    renderComponent();

    await waitFor(() =>
      expect(
        screen.getByText('no evidence document on this answer'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('pdf-document-mock')).not.toBeInTheDocument();
  });

  it('§D4 — a resolved DOCX/XLSX-backed citation stays text-anchored, no overlay pane', async () => {
    mockCitationsAndBinary({
      qaPair: [citationRow({ cited_text: 'The tender deadline is 5pm.' })],
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    renderComponent();

    await waitFor(() =>
      expect(
        screen.getByText('The tender deadline is 5pm.'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('pdf-document-mock')).not.toBeInTheDocument();
  });

  describe('§D1/§D3 — PDF spatial overlay + bidirectional selection', () => {
    function mockOneCitation() {
      mockCitationsAndBinary({
        qaPair: [citationRow()],
        mimeType: 'application/pdf',
      });
    }

    it('resolves a citation whose text is found in the rendered TextLayer to an overlay box, and marks it "On page" in the panel', async () => {
      mockOneCitation();
      renderComponent();

      await waitFor(() =>
        expect(screen.getByTestId('pdf-document-mock')).toBeInTheDocument(),
      );

      // Before the text layer renders, the citation is text-anchored only.
      expect(screen.queryByText(/on page/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('fire-text-layer'));

      await waitFor(() =>
        expect(panelScope().getByText(/on page/i)).toBeInTheDocument(),
      );
      // The resolved citation now also renders as a clickable overlay box.
      expect(
        overlayScope().getByRole('button', { name: /tender deadline/i }),
      ).toBeInTheDocument();
    });

    it('an unresolved citation (text not found on the rendered page) stays a plain text-anchored row, never a box', async () => {
      mockCitationsAndBinary({
        qaPair: [
          citationRow({
            cited_text: 'this exact phrase never appears on the page',
          }),
        ],
        mimeType: 'application/pdf',
      });
      renderComponent();

      await waitFor(() =>
        expect(screen.getByTestId('pdf-document-mock')).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByTestId('fire-text-layer'));

      await waitFor(() =>
        expect(
          screen.getByText('this exact phrase never appears on the page'),
        ).toBeInTheDocument(),
      );
      expect(screen.queryByText(/on page/i)).not.toBeInTheDocument();
    });

    it('selecting the citation row in the panel selects/scrolls its box (row -> box)', async () => {
      mockOneCitation();
      renderComponent();

      await waitFor(() =>
        expect(screen.getByTestId('pdf-document-mock')).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByTestId('fire-text-layer'));
      await waitFor(() =>
        expect(panelScope().getByText(/on page/i)).toBeInTheDocument(),
      );

      const panelRow = panelScope().getByRole('button', {
        name: /tender deadline/i,
      });
      fireEvent.click(panelRow);

      expect(panelRow).toHaveAttribute('aria-pressed', 'true');
    });

    it('selecting the box on the page selects the citation row (box -> row)', async () => {
      mockOneCitation();
      renderComponent();

      await waitFor(() =>
        expect(screen.getByTestId('pdf-document-mock')).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByTestId('fire-text-layer'));
      await waitFor(() =>
        expect(panelScope().getByText(/on page/i)).toBeInTheDocument(),
      );

      const overlayBoxButton = overlayScope().getByRole('button', {
        name: /tender deadline/i,
      });
      fireEvent.click(overlayBoxButton);

      const panelRow = panelScope().getByRole('button', {
        name: /tender deadline/i,
      });
      expect(panelRow).toHaveAttribute('aria-pressed', 'true');
    });
  });
});

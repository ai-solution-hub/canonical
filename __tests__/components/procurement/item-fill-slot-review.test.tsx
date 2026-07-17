/**
 * ItemFillSlotReview (components/procurement/item-fill-slot-review.tsx)
 * — ID-145 {145.47} (TECH §3/§4, PRODUCT §C1-C4, DR-064).
 *
 * Behaviour under contract (test-philosophy.md — observable behaviour, not
 * implementation):
 *  - §C1/§C2: a PDF form with geometry-bearing slots overlays boxes
 *    page-accurately and slot<->box selection is bidirectional.
 *  - §C3: each slot's `fill_status` renders as a text+icon label.
 *  - §C4: a DOCX/XLSX form, or a PDF form where no field has resolvable
 *    geometry, degrades to a plain list with an honest note — never a box.
 *  - Loading / error / empty states never render a blank panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/__tests__/helpers/query-wrapper';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import { ItemFillSlotReview } from '@/components/procurement/item-fill-slot-review';

// PdfDocument (mocked at its `pdf-document-lazy` ssr:false entry point,
// {145.49}) is stubbed to a minimal controlled-page stand-in — its own
// controlled-mode/overlay-slot contract is covered directly by
// __tests__/components/reader/pdf-document.test.tsx. Here it exposes just
// enough (`currentPage`, a page-change control, and the real
// `renderPageOverlay` slot) to prove ItemFillSlotReview drives it correctly
// and that the REAL `SpatialOverlay` (147-H) it renders into that slot
// completes the bidirectional loop.
vi.mock('@/components/reader/pdf-document-lazy', () => ({
  PdfDocumentLazy: ({
    currentPage,
    onPageChange,
    renderPageOverlay,
  }: {
    currentPage: number;
    onPageChange: (page: number) => void;
    renderPageOverlay?: (page: number) => React.ReactNode;
  }) => (
    <div data-testid="pdf-document-mock">
      <span data-testid="current-page">{currentPage}</span>
      <button
        type="button"
        data-testid="next-page"
        onClick={() => onPageChange(currentPage + 1)}
      >
        next page
      </button>
      {renderPageOverlay?.(currentPage)}
    </div>
  ),
}));

const { mockCreateClient, mockLogBestEffortWarn } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockLogBestEffortWarn: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/telemetry', () => ({
  logBestEffortWarn: mockLogBestEffortWarn,
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const FORM_ID = '11111111-1111-4111-8111-111111111111';
const FORM_STORAGE_PATH = `${FORM_ID}/original.pdf`;

function mockFormFieldsResponse(overrides: Record<string, unknown> = {}) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        id: FORM_ID,
        name: 'Tender form',
        mime_type: 'application/pdf',
        storage_path: FORM_STORAGE_PATH,
        fields: [],
        summary: {},
        completions: [],
        ...overrides,
      }),
  });
}

/** Shared Supabase client mock (__tests__/CLAUDE.md — never hand-roll). Its `documents` bucket's `createSignedUrl` defaults to success; override per-test for failure-path assertions. */
let mockSupabaseClient: ReturnType<typeof createMockSupabaseClient>;

function mockSignedUrlSuccess() {
  mockSupabaseClient = createMockSupabaseClient();
  mockCreateClient.mockReturnValue(mockSupabaseClient);
}

/** The shape `createMockSupabaseClient()` wires `storage.from()` to resolve to. */
function documentsBucket(client: MockSupabaseClient) {
  const from = client.storage.from as unknown as (name: string) => {
    createSignedUrl: ReturnType<typeof vi.fn>;
  };
  return from('documents');
}

function renderComponent() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ItemFillSlotReview formId={FORM_ID} />
    </QueryClientProvider>,
  );
}

describe('ItemFillSlotReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignedUrlSuccess();
  });

  it('shows a loading state, never a blank panel, while fetching', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    renderComponent();

    expect(screen.getByRole('status')).toHaveTextContent(
      /loading fill-slot review/i,
    );
  });

  it('shows an honest error state with retry on a fetch failure, never a blank panel', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'boom' }),
    });
    renderComponent();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(
      screen.getByText(/couldn't load the fill-slot review/i),
    ).toBeInTheDocument();
  });

  it('shows an honest empty state when no fields are detected', async () => {
    mockFormFieldsResponse({ fields: [] });
    renderComponent();

    await waitFor(() =>
      expect(
        screen.getByText(/no fill-slots detected for this form/i),
      ).toBeInTheDocument(),
    );
  });

  describe('§C4 — degrade to list, never a misaligned box', () => {
    it('degrades to a list with a PDF-only note for a DOCX form', async () => {
      mockFormFieldsResponse({
        mime_type:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fields: [
          {
            id: 'f1',
            question_text: 'Company name',
            fill_status: 'pending',
            geometry: null,
          },
        ],
      });
      renderComponent();

      await waitFor(() =>
        expect(screen.getByText('Company name')).toBeInTheDocument(),
      );
      expect(
        screen.getByText(/spatial review is available for pdf forms only/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('pdf-document-mock')).not.toBeInTheDocument();
    });

    it('degrades to a list when a PDF form has no resolvable geometry on any field', async () => {
      mockFormFieldsResponse({
        fields: [
          {
            id: 'f1',
            question_text: 'Company name',
            fill_status: 'pending',
            geometry: null,
          },
          {
            id: 'f2',
            question_text: 'Company address',
            fill_status: 'filled',
            geometry: { left: 2, top: 2 }, // malformed — fails geometrySchema
          },
        ],
      });
      renderComponent();

      await waitFor(() =>
        expect(screen.getByText('Company address')).toBeInTheDocument(),
      );
      expect(
        screen.getByText(/no mapped page positions yet for this form/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('pdf-document-mock')).not.toBeInTheDocument();
    });
  });

  describe('§C1/§C2/§C3 — PDF spatial overlay + bidirectional selection', () => {
    function mockFieldsWithGeometry() {
      mockFormFieldsResponse({
        fields: [
          {
            id: 'f1',
            question_text: 'Company name',
            fill_status: 'filled',
            geometry: {
              left: 0.1,
              top: 0.2,
              width: 0.3,
              height: 0.05,
              page: 1,
              rotation: 0,
            },
          },
          {
            id: 'f2',
            question_text: 'Company address',
            fill_status: 'pending',
            geometry: {
              left: 0.15,
              top: 0.4,
              width: 0.4,
              height: 0.05,
              page: 2,
              rotation: 0,
            },
          },
        ],
      });
    }

    it('shows fill_status as a text+icon label per slot (§C3, never colour-only)', async () => {
      mockFieldsWithGeometry();
      renderComponent();

      await waitFor(() =>
        expect(screen.getByText('Filled')).toBeInTheDocument(),
      );
      expect(screen.getByText('Not filled')).toBeInTheDocument();
    });

    it('selecting a slot on a different page navigates the PDF (select slot -> scroll)', async () => {
      mockFieldsWithGeometry();
      renderComponent();

      await waitFor(() =>
        expect(screen.getByTestId('current-page')).toHaveTextContent('1'),
      );

      fireEvent.click(screen.getByText('Company address').closest('button')!);

      await waitFor(() =>
        expect(screen.getByTestId('current-page')).toHaveTextContent('2'),
      );
    });

    it('selecting a box on the page selects the corresponding slot (select box -> select slot)', async () => {
      mockFieldsWithGeometry();
      renderComponent();

      await waitFor(() =>
        expect(screen.getByTestId('pdf-document-mock')).toBeInTheDocument(),
      );

      // Page 1's box is field f1 ("Company name") — click its overlay box.
      const overlayBoxButton = screen.getByRole('button', {
        name: /company name — filled/i,
      });
      fireEvent.click(overlayBoxButton);

      // The slot list's "Company name" row now reflects the shared selection.
      const slotButton = screen.getByText('Company name').closest('button')!;
      expect(slotButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('signed-URL failure path (Checker F2 — never a silent swallow)', () => {
    it('logs a best-effort warning when createSignedUrl resolves with an error', async () => {
      mockFormFieldsResponse({ fields: [] });
      documentsBucket(mockSupabaseClient).createSignedUrl.mockResolvedValueOnce(
        {
          data: null,
          error: { message: 'Storage bucket not found' },
        },
      );
      renderComponent();

      await waitFor(() =>
        expect(mockLogBestEffortWarn).toHaveBeenCalledWith(
          'procurement.fill-slot.signed-url',
          'Failed to create a signed URL for the form PDF',
          expect.objectContaining({
            storagePath: FORM_STORAGE_PATH,
            error: 'Storage bucket not found',
          }),
        ),
      );
    });

    it('logs a best-effort warning when the createSignedUrl request rejects', async () => {
      mockFormFieldsResponse({ fields: [] });
      documentsBucket(mockSupabaseClient).createSignedUrl.mockRejectedValueOnce(
        new Error('network down'),
      );
      renderComponent();

      await waitFor(() =>
        expect(mockLogBestEffortWarn).toHaveBeenCalledWith(
          'procurement.fill-slot.signed-url',
          'Signed URL request threw',
          expect.objectContaining({
            storagePath: FORM_STORAGE_PATH,
            error: 'network down',
          }),
        ),
      );
    });
  });
});

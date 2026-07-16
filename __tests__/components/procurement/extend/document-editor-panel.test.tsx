/**
 * DocumentEditorPanel — DOCX/XLSX editor wiring + fill mechanism
 * (ID-147.13, TECH §5 DR-066, PRODUCT §F1/§F2/§F4/§F5).
 *
 * Behaviour-first: proves the WIRING, not the vendored editor/viewer
 * internals (those are ID-147.6's own smoke tests). §F2 (ruled): "fill a
 * missing answer" dispatches the EXISTING Claude-side draft lane
 * (`useDraftStream`, SSE draft-stream, `form_responses` write) — never a
 * second write path. Manual edits persist via the editor's own save bound
 * to the document's storage_path, reusing the EXISTING admin/editor-gated
 * `POST /api/procurement/[id]/tender` endpoint (no new backend). §F4 —
 * edit/fill gated admin/editor (`useUserRole`, belt + braces on top of the
 * server-side `getAuthorisedClient(['admin','editor'])` already enforced by
 * both routes this component calls). §F5 — an editor that fails to
 * initialise falls back to the read-only viewer, never a blank pane.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockToast, mockUseUserRole, mockUseDraftStream, mockStartDraft } =
  vi.hoisted(() => ({
    mockToast: { success: vi.fn(), error: vi.fn() },
    mockUseUserRole: vi.fn(),
    mockUseDraftStream: vi.fn(),
    mockStartDraft: vi.fn(),
  }));

vi.mock('sonner', () => ({ toast: mockToast }));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: mockUseUserRole,
}));

vi.mock('@/hooks/streaming/use-draft-stream', () => ({
  useDraftStream: mockUseDraftStream,
}));

// The vendored editor shells (ID-147.6) are covered by their own smoke
// tests — mock them here to test THIS component's wiring in isolation.
// `docx-throw` is a magic src value one test uses to force a render-time
// throw, proving the §F5 error-boundary fallback.
vi.mock('@/components/procurement/extend/docx-editor', () => ({
  DocxEditorPreview: (props: { src?: string }) => {
    if (props.src === 'docx-throw') {
      throw new Error('Simulated docx-editor init failure');
    }
    return <div data-testid="docx-editor-preview" />;
  },
}));

vi.mock('@/components/procurement/extend/xlsx-editor', () => ({
  XlsxEditorPreview: (props: { src?: string }) => {
    if (props.src === 'xlsx-throw') {
      throw new Error('Simulated xlsx-editor init failure');
    }
    return <div data-testid="xlsx-editor-preview" />;
  },
}));

vi.mock('@/components/procurement/extend/themed-viewers', () => ({
  ThemedDocxViewer: () => <div data-testid="themed-docx-viewer" />,
  ThemedXlsxViewer: () => <div data-testid="themed-xlsx-viewer" />,
}));

// Import AFTER mocks
import { DocumentEditorPanel } from '@/components/procurement/extend/document-editor-panel';
import type { DocumentEditorPanelProps } from '@/components/procurement/extend/document-editor-panel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROCUREMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const QUESTION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const DRAFT_STREAM_IDLE = {
  phase: 'idle' as const,
  text: '',
  citations: [],
  qualityScore: null,
  responseId: null,
  totalCost: null,
  error: null,
  startDraft: mockStartDraft,
  cancel: vi.fn(),
};

function panelProps(
  overrides: Partial<DocumentEditorPanelProps> = {},
): DocumentEditorPanelProps {
  return {
    procurementId: PROCUREMENT_ID,
    kind: 'docx',
    documentPath: `${PROCUREMENT_ID}/tender.docx`,
    fileName: 'tender.docx',
    src: 'https://example.com/signed/tender.docx',
    ...overrides,
  };
}

function renderPanel(overrides: Partial<DocumentEditorPanelProps> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DocumentEditorPanel {...panelProps(overrides)} />
    </QueryClientProvider>,
  );
}

/** Re-render the SAME panel tree (e.g. after a mocked hook's return value changes). */
function rerenderPanel(
  rerender: (ui: ReactElement) => void,
  overrides: Partial<DocumentEditorPanelProps> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  rerender(
    <QueryClientProvider client={queryClient}>
      <DocumentEditorPanel {...panelProps(overrides)} />
    </QueryClientProvider>,
  );
}

// Suppress React's expected error-boundary console.error noise for the
// deliberate-throw tests only.
function suppressErrorBoundaryLogging(): () => void {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  return () => spy.mockRestore();
}

describe('DocumentEditorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDraftStream.mockReturnValue(DRAFT_STREAM_IDLE);
    mockUseUserRole.mockReturnValue({
      role: 'admin',
      loading: false,
      canEdit: true,
      canAdmin: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---- §F4: reviewer/viewer is read-only ----

  it('renders only the read-only viewer for a reviewer/viewer caller, never the editor', () => {
    mockUseUserRole.mockReturnValue({
      role: 'viewer',
      loading: false,
      canEdit: false,
      canAdmin: false,
    });

    renderPanel();

    expect(screen.getByTestId('themed-docx-viewer')).toBeInTheDocument();
    expect(screen.queryByTestId('docx-editor-preview')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /save edited document/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /fill/i }),
    ).not.toBeInTheDocument();
  });

  it('renders the vendored editor for an admin/editor caller', () => {
    renderPanel();

    expect(screen.getByTestId('docx-editor-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('themed-docx-viewer')).not.toBeInTheDocument();
  });

  it('renders the xlsx editor for kind="xlsx"', () => {
    renderPanel({
      kind: 'xlsx',
      documentPath: `${PROCUREMENT_ID}/prices.xlsx`,
    });

    expect(screen.getByTestId('xlsx-editor-preview')).toBeInTheDocument();
  });

  // ---- §F2: fill dispatches the existing draft lane, no second write path ----

  it('dispatches the existing draft lane (useDraftStream.startDraft) when Fill is clicked, not a bespoke write', async () => {
    const user = userEvent.setup();
    renderPanel({
      missingAnswers: [
        { questionId: QUESTION_ID, questionText: 'Describe your approach.' },
      ],
    });

    await user.click(screen.getByRole('button', { name: /fill/i }));

    expect(mockStartDraft).toHaveBeenCalledWith(QUESTION_ID);
    expect(mockStartDraft).toHaveBeenCalledTimes(1);
  });

  it('shows a success toast once the draft stream reports done for the fill just requested', async () => {
    const user = userEvent.setup();
    mockUseDraftStream.mockReturnValue(DRAFT_STREAM_IDLE);

    const { rerender } = renderPanel({
      missingAnswers: [
        { questionId: QUESTION_ID, questionText: 'Describe your approach.' },
      ],
    });

    await user.click(screen.getByRole('button', { name: /fill/i }));

    // Simulate the SSE stream reaching its terminal 'done' phase — the
    // EXISTING draft lane's own result, not a write this component makes.
    mockUseDraftStream.mockReturnValue({
      ...DRAFT_STREAM_IDLE,
      phase: 'done',
      responseId: 'resp-1',
    });
    rerenderPanel(rerender, {
      missingAnswers: [
        { questionId: QUESTION_ID, questionText: 'Describe your approach.' },
      ],
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('surfaces a draft-stream error via toast rather than a silent failure', async () => {
    const user = userEvent.setup();
    mockUseDraftStream.mockReturnValue(DRAFT_STREAM_IDLE);

    const { rerender } = renderPanel({
      missingAnswers: [
        { questionId: QUESTION_ID, questionText: 'Describe your approach.' },
      ],
    });

    await user.click(screen.getByRole('button', { name: /fill/i }));

    mockUseDraftStream.mockReturnValue({
      ...DRAFT_STREAM_IDLE,
      phase: 'error',
      error: 'Model unavailable',
    });
    rerenderPanel(rerender, {
      missingAnswers: [
        { questionId: QUESTION_ID, questionText: 'Describe your approach.' },
      ],
    });

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Model unavailable');
    });
  });

  it('does not render a missing-answers panel when there are no missing answers', () => {
    renderPanel({ missingAnswers: [] });

    expect(
      screen.queryByRole('button', { name: /fill/i }),
    ).not.toBeInTheDocument();
  });

  // ---- §F1: manual edits persist via the editor's own save, bound to storage_path ----

  it('rejects a re-uploaded file whose name does not match this document, without calling the save endpoint', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderPanel({ fileName: 'tender.docx' });

    const wrongFile = new File(['other bytes'], 'unrelated.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const input = screen.getByLabelText(/save edited document/i, {
      selector: 'input',
    }) as HTMLInputElement;
    await user.upload(input, wrongFile);

    expect(mockToast.error).toHaveBeenCalledWith(
      'To save edits to this document, upload a file named "tender.docx".',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the picked file to the existing tender upload endpoint when saving an edited document', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            path: `${PROCUREMENT_ID}/tender.docx`,
            filename: 'tender.docx',
          }),
      }),
    );

    renderPanel();

    const file = new File(['edited bytes'], 'tender.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const input = screen.getByLabelText(/save edited document/i, {
      selector: 'input',
    }) as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `/api/procurement/${PROCUREMENT_ID}/tender`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBe(file);

    expect(mockToast.success).toHaveBeenCalled();
  });

  it('surfaces a failed save via toast without pretending success', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 415,
        json: () =>
          Promise.resolve({
            error:
              'File content does not match its declared type. Ensure the file is a genuine PDF or DOCX.',
          }),
      }),
    );

    renderPanel();

    const file = new File(['not really a docx'], 'tender.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const input = screen.getByLabelText(/save edited document/i, {
      selector: 'input',
    }) as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'File content does not match its declared type. Ensure the file is a genuine PDF or DOCX.',
      );
    });
  });

  // ---- §F5: a failed editor init falls back to the read-only viewer, never blank ----

  it('falls back to the read-only viewer with a soft error when the docx editor throws on init', () => {
    const restore = suppressErrorBoundaryLogging();
    try {
      const { container } = renderPanel({ src: 'docx-throw' });

      expect(container.firstChild).not.toBeNull();
      expect(screen.getByTestId('themed-docx-viewer')).toBeInTheDocument();
      expect(
        screen.queryByTestId('docx-editor-preview'),
      ).not.toBeInTheDocument();
      // Non-colour-only signalling — a readable message, not just styling.
      expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('falls back to the read-only viewer with a soft error when the xlsx editor throws on init', () => {
    const restore = suppressErrorBoundaryLogging();
    try {
      const { container } = renderPanel({
        kind: 'xlsx',
        src: 'xlsx-throw',
      });

      expect(container.firstChild).not.toBeNull();
      expect(screen.getByTestId('themed-xlsx-viewer')).toBeInTheDocument();
      expect(
        screen.queryByTestId('xlsx-editor-preview'),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});

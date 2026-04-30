/**
 * UploadTabContent Component Tests
 *
 * Tests the upload tab content including phase transitions (select, uploading,
 * review), cross-method links, skip-review preference, and review step
 * integration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/create-content/file-upload', () => ({
  FileUpload: ({ files }: { files: unknown[] }) => (
    <div data-testid="file-upload">FileUpload ({files.length} files)</div>
  ),
}));

vi.mock('@/components/create-content/ingestion-progress', () => ({
  IngestionProgress: () => (
    <div data-testid="ingestion-progress">IngestionProgress</div>
  ),
}));

vi.mock('@/components/shared/dedup-warning', () => ({
  DedupWarning: () => <div data-testid="dedup-warning">DedupWarning</div>,
}));

vi.mock('@/components/source-document/reupload-banner', () => ({
  ReuploadBanner: () => <div data-testid="reupload-banner">ReuploadBanner</div>,
}));

vi.mock('@/components/create-content/upload-review-step', () => ({
  UploadReviewStep: ({
    items,
    onDismiss,
  }: {
    items: unknown[];
    onDismiss: () => void;
  }) => (
    <div data-testid="upload-review-step">
      UploadReviewStep ({(items as unknown[]).length} items)
      <button data-testid="mock-dismiss-review" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  ),
}));

vi.mock('@/components/qa/qa-preview-list', () => ({
  QAPreviewList: () => <div data-testid="qa-preview-list">QAPreviewList</div>,
}));

// Stub markdown-batch surface children — we test their rendering separately
vi.mock('@/components/ingest/markdown-analysis-table', () => ({
  MarkdownAnalysisTable: ({ analyses }: { analyses: unknown[] }) => (
    <div data-testid="markdown-analysis-table">
      AnalysisTable ({analyses.length} rows)
    </div>
  ),
}));

vi.mock('@/components/ingest/import-summary-card', () => ({
  ImportSummaryCard: ({ pipelineRunId }: { pipelineRunId: string }) => (
    <div data-testid="import-summary-card">SummaryCard ({pipelineRunId})</div>
  ),
}));

// Stub the markdown-batch fetchers so tests can drive analyse + import.
const mockAnalyseMarkdownBatch = vi.fn();
const mockImportMarkdownBatch = vi.fn();
const mockFetchPipelineRun = vi.fn();
vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return {
    ...actual,
    analyseMarkdownBatch: (...args: unknown[]) =>
      mockAnalyseMarkdownBatch(...args),
    importMarkdownBatch: (...args: unknown[]) =>
      mockImportMarkdownBatch(...args),
    fetchPipelineRun: (...args: unknown[]) => mockFetchPipelineRun(...args),
  };
});

vi.mock('@/components/content/claude-prompt-button', () => ({
  ClaudePromptButton: ({ label }: { label: string }) => (
    <button data-testid="claude-prompt-button">{label}</button>
  ),
}));

vi.mock('@/lib/claude-prompts', () => ({
  generateIngestDocumentPrompt: () => ({
    prompt: 'Test prompt',
    label: 'Import document',
    description: 'Import a document',
    category: 'ingestion',
  }),
}));

vi.mock('@/contexts/layer-vocabulary-context', () => ({
  useLayerVocabulary: () => ({
    layers: [
      {
        id: '1',
        key: 'reference',
        label: 'Reference',
        description: null,
        display_order: 1,
        is_active: true,
      },
    ],
    loading: false,
    error: null,
    getLayerKeys: () => ['reference'],
    getLayerLabel: (key: string) => (key === 'reference' ? 'Reference' : key),
    getLayerDescription: () => null,
    refresh: vi.fn(),
  }),
}));

// Mock the shared upload pipeline hook with controllable state
const mockHandleUpload = vi.fn();
const mockReset = vi.fn();
const mockSetPhase = vi.fn();
const mockSetReviewItems = vi.fn();
const mockHandleFilesAdded = vi.fn();
const mockHandleFileRemoved = vi.fn();
const mockHandleSetLayerMode = vi.fn();
const mockHandleSetSelectedLayer = vi.fn();
const mockHandleDismissDedupWarning = vi.fn();
const mockGetSkipReview = vi.fn().mockReturnValue(false);

// Mutable hook return value that tests can modify
const hookReturn = {
  phase: 'select' as 'select' | 'uploading' | 'review',
  files: [] as Array<{
    id: string;
    file: File;
    status: string;
    progress: number;
    resultId?: string;
  }>,
  fileStates: {} as Record<string, unknown>,
  isUploading: false,
  reviewItems: [] as Array<{
    id: string;
    title: string;
    contentType: string;
    warnings: string[];
    dedupMatches: unknown[];
  }>,
  handleFilesAdded: mockHandleFilesAdded,
  handleFileRemoved: mockHandleFileRemoved,
  handleUpload: mockHandleUpload,
  reset: mockReset,
  setPhase: mockSetPhase,
  setReviewItems: mockSetReviewItems,
  handleSetLayerMode: mockHandleSetLayerMode,
  handleSetSelectedLayer: mockHandleSetSelectedLayer,
  handleDismissDedupWarning: mockHandleDismissDedupWarning,
  pendingCount: 0,
  hasResults: false,
  hasActiveUploads: false,
  getSkipReview: mockGetSkipReview,
};

vi.mock('@/hooks/use-file-upload-pipeline', () => ({
  useFileUploadPipeline: () => hookReturn,
}));

import { UploadTabContent } from '@/components/create-content/upload-tab-content';
import { toast } from 'sonner';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render UploadTabContent inside a QueryClientProvider so that the
 * markdown-batch surface's `useMutation` hooks have a client. We create
 * a fresh wrapper per render to keep cache state isolated.
 */
function renderTab(props: Parameters<typeof UploadTabContent>[0] = {}) {
  const { Wrapper } = createQueryWrapper();
  return render(<UploadTabContent {...props} />, { wrapper: Wrapper });
}

/** Build a fake UploadFile entry for the pipeline mock. */
function makeFile(name: string): {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'extracting' | 'done' | 'error';
  progress: number;
  resultId?: string;
} {
  return {
    id: name,
    file: new File(['hello'], name, { type: 'text/plain' }),
    status: 'pending',
    progress: 0,
  };
}

function resetHookReturn() {
  hookReturn.phase = 'select';
  hookReturn.files = [];
  hookReturn.fileStates = {};
  hookReturn.isUploading = false;
  hookReturn.reviewItems = [];
  hookReturn.pendingCount = 0;
  hookReturn.hasResults = false;
  hookReturn.hasActiveUploads = false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UploadTabContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetHookReturn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  // =========================================================================
  // Initial select phase
  // =========================================================================

  describe('select phase', () => {
    it('renders the FileUpload dropzone in the initial select phase', () => {
      renderTab();

      expect(screen.getByTestId('file-upload')).toBeInTheDocument();
      expect(screen.getByText('Upload Documents')).toBeInTheDocument();
    });

    it('renders the Upload button', () => {
      renderTab();

      const uploadBtn = screen.getByRole('button', { name: /upload/i });
      expect(uploadBtn).toBeInTheDocument();
    });

    it('upload button is disabled when no pending files', () => {
      hookReturn.pendingCount = 0;

      renderTab();

      const uploadBtn = screen.getByRole('button', { name: /upload/i });
      expect(uploadBtn).toBeDisabled();
    });

    it('upload button is enabled when files are pending', () => {
      hookReturn.pendingCount = 2;

      renderTab();

      const uploadBtn = screen.getByRole('button', { name: /upload/i });
      expect(uploadBtn).not.toBeDisabled();
    });

    it('shows file count in upload button when pending files exist', () => {
      hookReturn.pendingCount = 3;

      renderTab();

      expect(screen.getByText(/Upload \(3\)/)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Cross-method links
  // =========================================================================

  describe('cross-method links', () => {
    it('renders cross-method links when onSwitchTab is provided', () => {
      const onSwitchTab = vi.fn();
      renderTab({ onSwitchTab });

      expect(screen.getByText('import from a URL')).toBeInTheDocument();
      expect(screen.getByText('write it manually')).toBeInTheDocument();
    });

    it('calls onSwitchTab with "url" when URL link is clicked', () => {
      const onSwitchTab = vi.fn();
      renderTab({ onSwitchTab });

      fireEvent.click(screen.getByText('import from a URL'));
      expect(onSwitchTab).toHaveBeenCalledWith('url');
    });

    it('calls onSwitchTab with "write" when write link is clicked', () => {
      const onSwitchTab = vi.fn();
      renderTab({ onSwitchTab });

      fireEvent.click(screen.getByText('write it manually'));
      expect(onSwitchTab).toHaveBeenCalledWith('write');
    });

    it('does not render cross-method links when onSwitchTab is not provided', () => {
      renderTab();

      expect(screen.queryByText('import from a URL')).not.toBeInTheDocument();
      expect(screen.queryByText('write it manually')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // Upload phase transitions
  // =========================================================================

  describe('upload phase transitions', () => {
    it('shows Processing text when uploading', () => {
      hookReturn.isUploading = true;

      renderTab();

      expect(screen.getByText(/Processing/)).toBeInTheDocument();
    });

    it('transitions to review phase after successful uploads (draft mode)', async () => {
      hookReturn.pendingCount = 1;
      const reviewItem = {
        id: 'item-1',
        title: 'Test Document',
        contentType: 'pdf',
        warnings: [] as string[],
        dedupMatches: [],
      };

      mockHandleUpload.mockResolvedValue({
        successfulItems: [reviewItem],
        errorCount: 0,
        skipReview: false,
      });

      renderTab();

      const uploadBtn = screen.getByRole('button', { name: /upload/i });
      await act(async () => {
        fireEvent.click(uploadBtn);
      });

      expect(mockSetReviewItems).toHaveBeenCalledWith([reviewItem]);
      expect(mockSetPhase).toHaveBeenCalledWith('review');
    });

    it('skips review phase when skipReview is true in upload result', async () => {
      hookReturn.pendingCount = 1;

      mockHandleUpload.mockResolvedValue({
        successfulItems: [{ id: 'item-1', title: 'Test' }],
        errorCount: 0,
        skipReview: true,
      });

      renderTab();

      const uploadBtn = screen.getByRole('button', { name: /upload/i });
      await act(async () => {
        fireEvent.click(uploadBtn);
      });

      expect(mockSetPhase).toHaveBeenCalledWith('select');
      expect(mockSetReviewItems).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith(
        '1 file uploaded and published',
      );
    });

    it('shows warning toast for mixed success/failure', async () => {
      hookReturn.pendingCount = 3;

      mockHandleUpload.mockResolvedValue({
        successfulItems: [{ id: 'item-1', title: 'Test' }],
        errorCount: 2,
        skipReview: true,
      });

      renderTab();

      const uploadBtn = screen.getByRole('button', { name: /upload/i });
      await act(async () => {
        fireEvent.click(uploadBtn);
      });

      expect(toast.warning).toHaveBeenCalledWith('1 uploaded, 2 failed');
    });

    it('shows error toast when all uploads fail', async () => {
      hookReturn.pendingCount = 2;

      mockHandleUpload.mockResolvedValue({
        successfulItems: [],
        errorCount: 2,
        skipReview: false,
      });

      renderTab();

      const uploadBtn = screen.getByRole('button', { name: /upload/i });
      await act(async () => {
        fireEvent.click(uploadBtn);
      });

      expect(toast.error).toHaveBeenCalledWith('2 files failed to upload');
      expect(mockSetPhase).toHaveBeenCalledWith('select');
    });
  });

  // =========================================================================
  // Review phase rendering
  // =========================================================================

  describe('review phase', () => {
    it('renders UploadReviewStep when phase is review with items', () => {
      hookReturn.phase = 'review';
      hookReturn.reviewItems = [
        {
          id: 'item-1',
          title: 'Test Document',
          contentType: 'pdf',
          warnings: [],
          dedupMatches: [],
        },
      ];

      renderTab();

      expect(screen.getByTestId('upload-review-step')).toBeInTheDocument();
      expect(
        screen.getByText(/UploadReviewStep \(1 items\)/),
      ).toBeInTheDocument();
    });

    it('does not render FileUpload during review phase', () => {
      hookReturn.phase = 'review';
      hookReturn.reviewItems = [
        {
          id: 'item-1',
          title: 'Test Document',
          contentType: 'pdf',
          warnings: [],
          dedupMatches: [],
        },
      ];

      renderTab();

      expect(screen.queryByTestId('file-upload')).not.toBeInTheDocument();
    });

    it('transitions back to select phase when review is dismissed', () => {
      hookReturn.phase = 'review';
      hookReturn.reviewItems = [
        {
          id: 'item-1',
          title: 'Test Document',
          contentType: 'pdf',
          warnings: [],
          dedupMatches: [],
        },
      ];

      renderTab();

      fireEvent.click(screen.getByTestId('mock-dismiss-review'));

      expect(mockReset).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Clear button
  // =========================================================================

  describe('clear button', () => {
    it('shows Clear button when results exist and not uploading', () => {
      hookReturn.hasResults = true;
      hookReturn.isUploading = false;

      renderTab();

      expect(
        screen.getByRole('button', { name: /clear/i }),
      ).toBeInTheDocument();
    });

    it('hides Clear button when no results', () => {
      hookReturn.hasResults = false;

      renderTab();

      expect(
        screen.queryByRole('button', { name: /clear/i }),
      ).not.toBeInTheDocument();
    });

    it('calls reset when Clear is clicked', () => {
      hookReturn.hasResults = true;
      hookReturn.isUploading = false;

      renderTab();

      fireEvent.click(screen.getByRole('button', { name: /clear/i }));
      expect(mockReset).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Claude prompt button
  // =========================================================================

  it('renders Claude suggestion button', () => {
    renderTab();

    expect(screen.getByTestId('claude-prompt-button')).toBeInTheDocument();
    expect(screen.getByTestId('claude-prompt-button')).toHaveTextContent(
      'Open in Claude',
    );
  });

  // =========================================================================
  // EP2 §1.11 Phase 2 — Markdown-batch sub-mode
  // =========================================================================

  describe('markdown-batch sub-mode', () => {
    it('does NOT enter markdown-batch mode by default with no files', () => {
      renderTab();

      expect(
        screen.queryByTestId('markdown-batch-idle-banner'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('markdown-batch-mixed-banner'),
      ).not.toBeInTheDocument();
    });

    it('renders the markdown-batch idle banner on .md-only multi-file drop', () => {
      hookReturn.files = [makeFile('foo.md'), makeFile('bar.md')];

      renderTab();

      expect(
        screen.getByTestId('markdown-batch-idle-banner'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('markdown-batch-analyse-button'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('markdown-batch-mixed-banner'),
      ).not.toBeInTheDocument();
    });

    it('renders mixed-batch fallback banner when types are mixed', () => {
      hookReturn.files = [makeFile('foo.md'), makeFile('bar.pdf')];

      renderTab();

      expect(
        screen.getByTestId('markdown-batch-mixed-banner'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('markdown-batch-idle-banner'),
      ).not.toBeInTheDocument();
    });

    it('does NOT enter markdown-batch mode for a single .md file', () => {
      hookReturn.files = [makeFile('only.md')];

      renderTab();

      expect(
        screen.queryByTestId('markdown-batch-idle-banner'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('markdown-batch-mixed-banner'),
      ).not.toBeInTheDocument();
    });

    it('calls analyseMarkdownBatch on Analyse-files click', async () => {
      hookReturn.files = [makeFile('foo.md'), makeFile('bar.md')];

      // Resolve to a one-row analysis so the surface transitions to reviewing
      mockAnalyseMarkdownBatch.mockResolvedValue({
        analysis: [
          {
            filename: 'foo.md',
            sizeBytes: 12,
            encodingOk: true,
            empty: false,
            frontMatter: { present: false, parsedOk: true, fields: {} },
            title: 'Foo',
            titleProvenance: 'filename',
            contentHash: 'abc',
            hasConflictMarkers: false,
            diffMarkers: {
              gitConflictCount: 0,
              plusMinusLineCount: 0,
              warning: false,
            },
            draftOrFinalHeuristic: 'draft',
            dedupVerdict: { isDuplicate: false },
            sourceFileMatch: null,
          },
        ],
      });

      renderTab();

      const btn = screen.getByTestId('markdown-batch-analyse-button');
      await act(async () => {
        fireEvent.click(btn);
      });

      expect(mockAnalyseMarkdownBatch).toHaveBeenCalledTimes(1);
      const callArg = mockAnalyseMarkdownBatch.mock.calls[0][0] as File[];
      expect(callArg).toHaveLength(2);
      expect(callArg[0].name).toBe('foo.md');
    });
  });

  // ===========================================================================
  // EP2 §1.11 Phase 4 — Pattern E (S212 W2): client UUID + polling
  // ===========================================================================

  describe('markdown-batch — Pattern E client UUID + polling', () => {
    beforeEach(() => {
      // Ensure crypto.randomUUID is available in jsdom (it is in modern
      // Node/jsdom builds, but stub deterministically for assertion).
      vi.stubGlobal('crypto', {
        ...(globalThis.crypto ?? {}),
        randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /**
     * Helper to drive the surface into the 'reviewing' phase so the
     * Import button is visible. Uses the existing analyse mutation flow.
     */
    async function transitionToReviewing(
      analyses: ReturnType<typeof analysesFixture>,
    ) {
      mockAnalyseMarkdownBatch.mockResolvedValue({ analysis: analyses });
      const btn = screen.getByTestId('markdown-batch-analyse-button');
      await act(async () => {
        fireEvent.click(btn);
      });
    }

    function analysesFixture() {
      return [
        {
          filename: 'foo.md',
          sizeBytes: 12,
          encodingOk: true,
          empty: false,
          frontMatter: { present: false, parsedOk: true, fields: {} },
          title: 'Foo',
          titleProvenance: 'filename' as const,
          contentHash: 'abc',
          hasConflictMarkers: false,
          diffMarkers: {
            gitConflictCount: 0,
            plusMinusLineCount: 0,
            warning: false,
          },
          draftOrFinalHeuristic: 'draft' as const,
          dedupVerdict: { isDuplicate: false },
          sourceFileMatch: null,
        },
      ];
    }

    it('Import click forwards a client-generated pipeline_run_id to importMarkdownBatch', async () => {
      hookReturn.files = [makeFile('foo.md'), makeFile('bar.md')];

      renderTab();
      await transitionToReviewing(analysesFixture());

      // Make import never resolve so we can inspect the in-flight wire payload.
      mockImportMarkdownBatch.mockImplementation(() => new Promise(() => {}));
      mockFetchPipelineRun.mockResolvedValue(null);

      const importBtn = screen.getByTestId('markdown-batch-import');
      await act(async () => {
        fireEvent.click(importBtn);
      });

      expect(mockImportMarkdownBatch).toHaveBeenCalledTimes(1);
      const args = mockImportMarkdownBatch.mock.calls[0][0] as {
        files: File[];
        options: { pipeline_run_id: string };
      };
      expect(args.options.pipeline_run_id).toBe(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      );
    });

    it('renders poll-driven detail string + counts when polling returns progress', async () => {
      hookReturn.files = [makeFile('foo.md'), makeFile('bar.md')];

      renderTab();
      await transitionToReviewing(analysesFixture());

      // Hold the import open + return a meaningful poll response.
      mockImportMarkdownBatch.mockImplementation(() => new Promise(() => {}));
      mockFetchPipelineRun.mockResolvedValue({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        pipeline_name: 'upload_markdown_batch',
        status: 'running',
        progress: {
          step: 'importing',
          files_completed: 1,
          files_total: 3,
          detail: 'Processing foo.md…',
        },
        source_filename: null,
        items_created: ['item-1'],
        items_processed: null,
        workspace_id: null,
        error_message: null,
        started_at: '2026-04-29T22:00:00Z',
        completed_at: null,
        created_at: '2026-04-29T22:00:00Z',
        created_by: 'user-1',
        result: null,
      });

      const importBtn = screen.getByTestId('markdown-batch-import');
      await act(async () => {
        fireEvent.click(importBtn);
      });

      // Allow the poll to fire at least once (refetchInterval=1500 — but
      // useQuery fires immediately on mount with enabled=true).
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // The importing surface should have rendered the detail line.
      expect(
        screen.getByTestId('markdown-batch-importing'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('markdown-batch-importing-detail'),
      ).toHaveTextContent('Processing foo.md');
      expect(
        screen.getByTestId('markdown-batch-importing-counts'),
      ).toHaveTextContent('1 / 3 files');
    });
  });
});

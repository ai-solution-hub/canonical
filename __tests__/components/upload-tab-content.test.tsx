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

vi.mock('@/components/file-upload', () => ({
  FileUpload: ({ files }: { files: unknown[] }) => (
    <div data-testid="file-upload">FileUpload ({files.length} files)</div>
  ),
}));

vi.mock('@/components/ingestion-progress', () => ({
  IngestionProgress: () => <div data-testid="ingestion-progress">IngestionProgress</div>,
}));

vi.mock('@/components/dedup-warning', () => ({
  DedupWarning: () => <div data-testid="dedup-warning">DedupWarning</div>,
}));

vi.mock('@/components/reupload-banner', () => ({
  ReuploadBanner: () => <div data-testid="reupload-banner">ReuploadBanner</div>,
}));

vi.mock('@/components/upload-review-step', () => ({
  UploadReviewStep: ({ items, onDismiss }: { items: unknown[]; onDismiss: () => void }) => (
    <div data-testid="upload-review-step">
      UploadReviewStep ({(items as unknown[]).length} items)
      <button data-testid="mock-dismiss-review" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  ),
}));

vi.mock('@/components/qa-preview-list', () => ({
  QAPreviewList: () => <div data-testid="qa-preview-list">QAPreviewList</div>,
}));

vi.mock('@/components/claude-prompt-button', () => ({
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
      { id: '1', key: 'reference', label: 'Reference', description: null, display_order: 1, is_active: true },
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
  files: [] as Array<{ id: string; file: File; status: string; progress: number; resultId?: string }>,
  fileStates: {} as Record<string, unknown>,
  isUploading: false,
  reviewItems: [] as Array<{ id: string; title: string; contentType: string; warnings: string[]; dedupMatches: unknown[] }>,
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

import { UploadTabContent } from '@/components/upload-tab-content';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      render(<UploadTabContent />);

      expect(screen.getByTestId('file-upload')).toBeInTheDocument();
      expect(screen.getByText('Upload Documents')).toBeInTheDocument();
    });

    it('renders the Upload button', () => {
      render(<UploadTabContent />);

      const uploadBtn = screen.getByRole('button', { name: /upload/i });
      expect(uploadBtn).toBeInTheDocument();
    });

    it('upload button is disabled when no pending files', () => {
      hookReturn.pendingCount = 0;

      render(<UploadTabContent />);

      const uploadBtn = screen.getByRole('button', { name: /upload/i });
      expect(uploadBtn).toBeDisabled();
    });

    it('upload button is enabled when files are pending', () => {
      hookReturn.pendingCount = 2;

      render(<UploadTabContent />);

      const uploadBtn = screen.getByRole('button', { name: /upload/i });
      expect(uploadBtn).not.toBeDisabled();
    });

    it('shows file count in upload button when pending files exist', () => {
      hookReturn.pendingCount = 3;

      render(<UploadTabContent />);

      expect(screen.getByText(/Upload \(3\)/)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Cross-method links
  // =========================================================================

  describe('cross-method links', () => {
    it('renders cross-method links when onSwitchTab is provided', () => {
      const onSwitchTab = vi.fn();
      render(<UploadTabContent onSwitchTab={onSwitchTab} />);

      expect(screen.getByText('import from a URL')).toBeInTheDocument();
      expect(screen.getByText('write it manually')).toBeInTheDocument();
    });

    it('calls onSwitchTab with "url" when URL link is clicked', () => {
      const onSwitchTab = vi.fn();
      render(<UploadTabContent onSwitchTab={onSwitchTab} />);

      fireEvent.click(screen.getByText('import from a URL'));
      expect(onSwitchTab).toHaveBeenCalledWith('url');
    });

    it('calls onSwitchTab with "write" when write link is clicked', () => {
      const onSwitchTab = vi.fn();
      render(<UploadTabContent onSwitchTab={onSwitchTab} />);

      fireEvent.click(screen.getByText('write it manually'));
      expect(onSwitchTab).toHaveBeenCalledWith('write');
    });

    it('does not render cross-method links when onSwitchTab is not provided', () => {
      render(<UploadTabContent />);

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

      render(<UploadTabContent />);

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

      render(<UploadTabContent />);

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

      render(<UploadTabContent />);

      const uploadBtn = screen.getByRole('button', { name: /upload/i });
      await act(async () => {
        fireEvent.click(uploadBtn);
      });

      expect(mockSetPhase).toHaveBeenCalledWith('select');
      expect(mockSetReviewItems).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('1 file uploaded and published');
    });

    it('shows warning toast for mixed success/failure', async () => {
      hookReturn.pendingCount = 3;

      mockHandleUpload.mockResolvedValue({
        successfulItems: [{ id: 'item-1', title: 'Test' }],
        errorCount: 2,
        skipReview: true,
      });

      render(<UploadTabContent />);

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

      render(<UploadTabContent />);

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
        { id: 'item-1', title: 'Test Document', contentType: 'pdf', warnings: [], dedupMatches: [] },
      ];

      render(<UploadTabContent />);

      expect(screen.getByTestId('upload-review-step')).toBeInTheDocument();
      expect(screen.getByText(/UploadReviewStep \(1 items\)/)).toBeInTheDocument();
    });

    it('does not render FileUpload during review phase', () => {
      hookReturn.phase = 'review';
      hookReturn.reviewItems = [
        { id: 'item-1', title: 'Test Document', contentType: 'pdf', warnings: [], dedupMatches: [] },
      ];

      render(<UploadTabContent />);

      expect(screen.queryByTestId('file-upload')).not.toBeInTheDocument();
    });

    it('transitions back to select phase when review is dismissed', () => {
      hookReturn.phase = 'review';
      hookReturn.reviewItems = [
        { id: 'item-1', title: 'Test Document', contentType: 'pdf', warnings: [], dedupMatches: [] },
      ];

      render(<UploadTabContent />);

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

      render(<UploadTabContent />);

      expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    });

    it('hides Clear button when no results', () => {
      hookReturn.hasResults = false;

      render(<UploadTabContent />);

      expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
    });

    it('calls reset when Clear is clicked', () => {
      hookReturn.hasResults = true;
      hookReturn.isUploading = false;

      render(<UploadTabContent />);

      fireEvent.click(screen.getByRole('button', { name: /clear/i }));
      expect(mockReset).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Claude prompt button
  // =========================================================================

  it('renders Claude suggestion button', () => {
    render(<UploadTabContent />);

    expect(screen.getByTestId('claude-prompt-button')).toBeInTheDocument();
    expect(screen.getByTestId('claude-prompt-button')).toHaveTextContent(
      'Open in Claude for complex documents',
    );
  });
});

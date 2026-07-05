/**
 * UploadTabContent Component Tests
 *
 * ID-131.24 (G-UPLOAD-GATE, DR-025) rework: the tab now drives ONE
 * binding-admission gate (no content_items row, no folder-drop stage/poll
 * transport, no review/layer/classification UI — that whole surface was
 * retired alongside the content_items pipeline). Covers: the retention-class
 * picker, the connect action + admission-result rendering, cross-method
 * links (including the {131.18}-orphaned "write it manually" link removal),
 * and the Q&A preview/batch sub-flow (unchanged, still fed by
 * `detectedQAPairs`/`sourceDocumentId` props).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

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

vi.mock('@/components/qa/qa-preview-list', () => ({
  QAPreviewList: () => <div data-testid="qa-preview-list">QAPreviewList</div>,
}));

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

// Mock the shared upload pipeline hook with controllable state
const mockHandleUpload = vi.fn();
const mockReset = vi.fn();
const mockHandleFilesAdded = vi.fn();
const mockHandleFileRemoved = vi.fn();

interface MockFileState {
  status: 'admitted' | 'error';
  sourceDocumentId?: string;
  wasMinted?: boolean;
  retentionClass?: 'keep_and_watch' | 'ingest_once';
  error?: string;
}

// Mutable hook return value that tests can modify
const hookReturn = {
  phase: 'select' as 'select' | 'uploading',
  files: [] as Array<{
    id: string;
    file: File;
    status: string;
    progress: number;
    resultId?: string;
  }>,
  fileStates: {} as Record<string, MockFileState>,
  isUploading: false,
  handleFilesAdded: mockHandleFilesAdded,
  handleFileRemoved: mockHandleFileRemoved,
  handleUpload: mockHandleUpload,
  reset: mockReset,
  pendingCount: 0,
  hasResults: false,
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

function renderTab(props: Parameters<typeof UploadTabContent>[0] = {}) {
  const { Wrapper } = createQueryWrapper();
  return render(<UploadTabContent {...props} />, { wrapper: Wrapper });
}

function resetHookReturn() {
  hookReturn.phase = 'select';
  hookReturn.files = [];
  hookReturn.fileStates = {};
  hookReturn.isUploading = false;
  hookReturn.pendingCount = 0;
  hookReturn.hasResults = false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UploadTabContent', () => {
  beforeEach(() => {
    installRadixPointerShims();
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
    it('renders the FileUpload dropzone with connect-a-source copy', () => {
      renderTab();

      expect(screen.getByTestId('file-upload')).toBeInTheDocument();
      expect(screen.getByText('Connect a source')).toBeInTheDocument();
    });

    it('renders the Connect button', () => {
      renderTab();

      expect(
        screen.getByRole('button', { name: /connect/i }),
      ).toBeInTheDocument();
    });

    it('Connect button is disabled when no pending files', () => {
      hookReturn.pendingCount = 0;
      renderTab();

      expect(screen.getByRole('button', { name: /connect/i })).toBeDisabled();
    });

    it('Connect button is enabled when files are pending', () => {
      hookReturn.pendingCount = 2;
      renderTab();

      expect(
        screen.getByRole('button', { name: /connect/i }),
      ).not.toBeDisabled();
    });

    it('shows file count in the Connect button when pending files exist', () => {
      hookReturn.pendingCount = 3;
      renderTab();

      expect(screen.getByText(/Connect \(3\)/)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Retention class picker (DR-025)
  // =========================================================================

  describe('retention class picker', () => {
    it('defaults to Keep & watch', () => {
      renderTab();

      expect(screen.getByRole('combobox')).toHaveTextContent('Keep & watch');
    });

    it('calls handleUpload with the selected retention class', async () => {
      const user = userEvent.setup();
      hookReturn.pendingCount = 1;
      mockHandleUpload.mockResolvedValue({ admittedCount: 1, errorCount: 0 });

      renderTab();

      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getByRole('option', { name: /ingest once/i }));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /connect/i }));
      });

      expect(mockHandleUpload).toHaveBeenCalledWith('ingest_once');
    });

    it('calls handleUpload with the default keep_and_watch class when untouched', async () => {
      hookReturn.pendingCount = 1;
      mockHandleUpload.mockResolvedValue({ admittedCount: 1, errorCount: 0 });

      renderTab();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /connect/i }));
      });

      expect(mockHandleUpload).toHaveBeenCalledWith('keep_and_watch');
    });
  });

  // =========================================================================
  // Cross-method links — {131.18} dangling onSwitchTab('write') cleanup
  // =========================================================================

  describe('cross-method links', () => {
    it('renders the URL cross-method link when onSwitchTab is provided', () => {
      const onSwitchTab = vi.fn();
      renderTab({ onSwitchTab });

      expect(screen.getByText('import from a URL')).toBeInTheDocument();
    });

    it('calls onSwitchTab with "url" when the URL link is clicked', () => {
      const onSwitchTab = vi.fn();
      renderTab({ onSwitchTab });

      fireEvent.click(screen.getByText('import from a URL'));
      expect(onSwitchTab).toHaveBeenCalledWith('url');
    });

    it('does not render a "write it manually" link — the Write tab no longer exists', () => {
      const onSwitchTab = vi.fn();
      renderTab({ onSwitchTab });

      expect(screen.queryByText('write it manually')).not.toBeInTheDocument();
    });

    it('does not render cross-method links when onSwitchTab is not provided', () => {
      renderTab();

      expect(screen.queryByText('import from a URL')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // Connect action — toasts + admission-result rendering
  // =========================================================================

  describe('connect action', () => {
    it('shows Connecting… while uploading', () => {
      hookReturn.isUploading = true;
      renderTab();

      expect(screen.getByText(/Connecting/)).toBeInTheDocument();
    });

    it('shows a success toast when all files are admitted', async () => {
      hookReturn.pendingCount = 1;
      mockHandleUpload.mockResolvedValue({ admittedCount: 1, errorCount: 0 });

      renderTab();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /connect/i }));
      });

      expect(toast.success).toHaveBeenCalledWith('1 source connected');
    });

    it('shows a warning toast for mixed success/failure', async () => {
      hookReturn.pendingCount = 3;
      mockHandleUpload.mockResolvedValue({ admittedCount: 1, errorCount: 2 });

      renderTab();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /connect/i }));
      });

      expect(toast.warning).toHaveBeenCalledWith('1 connected, 2 failed');
    });

    it('shows an error toast when all connections fail', async () => {
      hookReturn.pendingCount = 2;
      mockHandleUpload.mockResolvedValue({ admittedCount: 0, errorCount: 2 });

      renderTab();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /connect/i }));
      });

      expect(toast.error).toHaveBeenCalledWith('2 files failed to connect');
    });

    it('renders an admitted result with its retention class label', () => {
      hookReturn.files = [
        {
          id: 'f1',
          file: new File(['x'], 'report.pdf'),
          status: 'done',
          progress: 100,
          resultId: 'sd-1',
        },
      ];
      hookReturn.fileStates = {
        f1: {
          status: 'admitted',
          sourceDocumentId: 'sd-1',
          wasMinted: true,
          retentionClass: 'ingest_once',
        },
      };

      renderTab();

      const result = screen.getByTestId('admission-results');
      expect(result).toHaveTextContent('report.pdf');
      expect(result).toHaveTextContent('Ingest once');
    });

    it('flags an already-connected (idempotent) admission', () => {
      hookReturn.files = [
        {
          id: 'f1',
          file: new File(['x'], 'report.pdf'),
          status: 'done',
          progress: 100,
          resultId: 'sd-1',
        },
      ];
      hookReturn.fileStates = {
        f1: {
          status: 'admitted',
          sourceDocumentId: 'sd-1',
          wasMinted: false,
          retentionClass: 'keep_and_watch',
        },
      };

      renderTab();

      expect(screen.getByTestId('admission-results')).toHaveTextContent(
        'already connected',
      );
    });

    it('renders an error result with its message', () => {
      hookReturn.files = [
        {
          id: 'f1',
          file: new File(['x'], 'bad.pdf'),
          status: 'error',
          progress: 0,
        },
      ];
      hookReturn.fileStates = {
        f1: { status: 'error', error: 'Upload failed' },
      };

      renderTab();

      const result = screen.getByTestId('admission-results');
      expect(result).toHaveTextContent('bad.pdf');
      expect(result).toHaveTextContent('Upload failed');
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
});

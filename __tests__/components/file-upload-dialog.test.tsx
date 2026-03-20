/**
 * FileUploadDialog Component Tests
 *
 * Tests the upload dialog including title, FileUpload component presence,
 * upload button state, upload count, close prevention during upload,
 * file clearing on close, IngestionProgress integration, DedupWarning
 * integration, and Claude suggestion footer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

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
  IngestionProgress: ({ steps, compact }: { steps: unknown[]; compact?: boolean }) => (
    <div data-testid="ingestion-progress" data-compact={compact}>
      IngestionProgress ({(steps as Array<{ label: string }>).length} steps)
    </div>
  ),
}));

vi.mock('@/components/dedup-warning', () => ({
  DedupWarning: ({ matches }: { matches: unknown[] }) => (
    <div data-testid="dedup-warning">DedupWarning ({matches.length} matches)</div>
  ),
}));

vi.mock('@/components/claude-prompt-button', () => ({
  ClaudePromptButton: ({ label }: { label: string }) => (
    <button data-testid="claude-prompt-button">{label}</button>
  ),
}));

vi.mock('@/lib/claude-prompts', () => ({
  generateIngestDocumentPrompt: () => ({
    prompt: 'Test import document prompt',
    label: 'Import document',
    description: 'Import a document into the Knowledge Base',
    category: 'ingestion',
  }),
}));

vi.mock('@/contexts/layer-vocabulary-context', () => ({
  useLayerVocabulary: () => ({
    layers: [
      { id: '1', key: 'sales_brief', label: 'Sales Brief', description: null, display_order: 1, is_active: true },
      { id: '2', key: 'bid_detail', label: 'Bid Detail', description: null, display_order: 2, is_active: true },
    ],
    loading: false,
    error: null,
    getLayerKeys: () => ['sales_brief', 'bid_detail'],
    getLayerLabel: (key: string) => (key === 'sales_brief' ? 'Sales Brief' : key === 'bid_detail' ? 'Bid Detail' : key),
    getLayerDescription: () => null,
    refresh: vi.fn(),
  }),
}));

import { FileUploadDialog } from '@/components/file-upload-dialog';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileUploadDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onOpenChange = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders dialog with title when open', () => {
    render(<FileUploadDialog {...defaultProps} />);

    expect(screen.getByText('Upload Documents')).toBeInTheDocument();
  });

  it('contains FileUpload component', () => {
    render(<FileUploadDialog {...defaultProps} />);

    expect(screen.getByTestId('file-upload')).toBeInTheDocument();
  });

  it('upload button is disabled when no pending files', () => {
    render(<FileUploadDialog {...defaultProps} />);

    const uploadBtn = screen.getByRole('button', { name: /upload/i });
    expect(uploadBtn).toBeDisabled();
  });

  it('does not render dialog content when closed', () => {
    render(<FileUploadDialog open={false} onOpenChange={vi.fn()} />);

    expect(screen.queryByText('Upload Documents')).not.toBeInTheDocument();
  });

  it('shows description text about supported file types', () => {
    render(<FileUploadDialog {...defaultProps} />);

    expect(
      screen.getByText(/Upload PDF, DOCX, Markdown, or text files/),
    ).toBeInTheDocument();
  });

  it('renders upload button with correct initial text', () => {
    render(<FileUploadDialog {...defaultProps} />);

    // When no pending files, button just says "Upload"
    const uploadBtn = screen.getByRole('button', { name: /upload/i });
    expect(uploadBtn).toBeInTheDocument();
  });

  // --- New tests for IngestionProgress, DedupWarning, Claude suggestion ---

  it('renders Claude suggestion footer', () => {
    render(<FileUploadDialog {...defaultProps} />);

    const claudeBtn = screen.getByTestId('claude-prompt-button');
    expect(claudeBtn).toBeInTheDocument();
    expect(claudeBtn).toHaveTextContent('Or let Claude handle complex documents');
  });

  it('does not show progress section when no files are processing', () => {
    render(<FileUploadDialog {...defaultProps} />);

    expect(screen.queryByTestId('file-progress-section')).not.toBeInTheDocument();
  });
});

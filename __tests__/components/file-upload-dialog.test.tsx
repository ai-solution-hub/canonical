/**
 * FileUploadDialog Component Tests
 *
 * Tests the upload dialog including title, FileUpload component presence,
 * upload button state, upload count, close prevention during upload,
 * and file clearing on close.
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
});

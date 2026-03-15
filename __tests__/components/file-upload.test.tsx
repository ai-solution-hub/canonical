/**
 * FileUpload Component Tests
 *
 * Tests the file upload drop zone component including instructions,
 * file type badges, sizes, statuses, remove button, disabled state,
 * and spinner for active uploads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { FileUpload, type UploadFile } from '@/components/file-upload';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createUploadFile(overrides: Partial<UploadFile> = {}): UploadFile {
  return {
    id: overrides.id ?? 'file-1',
    file: overrides.file ?? new File(['content'], 'document.pdf', { type: 'application/pdf' }),
    status: overrides.status ?? 'pending',
    progress: overrides.progress ?? 0,
    error: overrides.error,
    resultId: overrides.resultId,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileUpload', () => {
  const defaultProps = {
    files: [] as UploadFile[],
    onFilesAdded: vi.fn(),
    onFileRemoved: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onFilesAdded = vi.fn();
    defaultProps.onFileRemoved = vi.fn();
  });

  it('renders drop zone with instructions', () => {
    render(<FileUpload {...defaultProps} />);

    expect(
      screen.getByText('Drag and drop files here, or click to browse'),
    ).toBeInTheDocument();
  });

  it('shows file type badge for each file', () => {
    const files = [
      createUploadFile({ id: '1', file: new File([''], 'report.pdf', { type: 'application/pdf' }) }),
      createUploadFile({ id: '2', file: new File([''], 'notes.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }) }),
    ];

    render(<FileUpload {...defaultProps} files={files} />);

    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('DOCX')).toBeInTheDocument();
  });

  it('shows formatted file size', () => {
    const file = new File(['x'.repeat(2048)], 'test.pdf', { type: 'application/pdf' });
    const files = [createUploadFile({ file })];

    render(<FileUpload {...defaultProps} files={files} />);

    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('shows status text for each file status', () => {
    const files = [
      createUploadFile({ id: '1', status: 'done', file: new File([''], 'a.pdf') }),
      createUploadFile({ id: '2', status: 'error', error: 'Upload failed', file: new File([''], 'b.pdf') }),
    ];

    render(<FileUpload {...defaultProps} files={files} />);

    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
  });

  it('shows remove button for pending files', async () => {
    const user = userEvent.setup();
    const files = [createUploadFile({ id: 'f1', status: 'pending', file: new File([''], 'doc.pdf') })];

    render(<FileUpload {...defaultProps} files={files} />);

    const removeBtn = screen.getByLabelText('Remove doc.pdf');
    expect(removeBtn).toBeInTheDocument();

    await user.click(removeBtn);
    expect(defaultProps.onFileRemoved).toHaveBeenCalledWith('f1');
  });

  it('disables drop zone when at MAX_FILES (10)', () => {
    const files = Array.from({ length: 10 }, (_, i) =>
      createUploadFile({
        id: `f${i}`,
        file: new File([''], `file${i}.pdf`),
      }),
    );

    render(<FileUpload {...defaultProps} files={files} />);

    const dropZone = screen.getByLabelText(/upload files drop zone/i);
    expect(dropZone.className).toContain('cursor-not-allowed');
  });

  it('shows spinner for uploading status', () => {
    const files = [createUploadFile({ status: 'uploading' })];

    render(<FileUpload {...defaultProps} files={files} />);

    // Uploading status shows a spinner div with animate-spin class
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });
});

/**
 * TenderUpload Component Tests
 *
 * Tests the tender document upload component — idle state, drag-and-drop,
 * file validation, uploading/extracting/complete/error phases, file type
 * and size restrictions, and accessibility attributes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockToast } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: Record<string, unknown>) => (
    <button
      onClick={onClick as React.MouseEventHandler}
      disabled={disabled as boolean}
      {...props}
    >
      {children as React.ReactNode}
    </button>
  ),
}));

vi.mock('@/components/ui/progress', () => ({
  Progress: (props: Record<string, unknown>) => (
    <div
      role="progressbar"
      aria-label={props['aria-label'] as string}
      data-testid="progress-bar"
    />
  ),
}));

vi.mock('lucide-react', () => ({
  FileUp: (props: Record<string, unknown>) => (
    <span
      data-testid="file-up-icon"
      aria-hidden={
        props['aria-hidden'] as boolean | 'true' | 'false' | undefined
      }
    />
  ),
  Loader2: (props: Record<string, unknown>) => (
    <span
      data-testid="loader-icon"
      aria-hidden={
        props['aria-hidden'] as boolean | 'true' | 'false' | undefined
      }
    />
  ),
  CheckCircle: (props: Record<string, unknown>) => (
    <span
      data-testid="check-icon"
      aria-hidden={
        props['aria-hidden'] as boolean | 'true' | 'false' | undefined
      }
    />
  ),
  AlertTriangle: (props: Record<string, unknown>) => (
    <span
      data-testid="alert-icon"
      aria-hidden={
        props['aria-hidden'] as boolean | 'true' | 'false' | undefined
      }
    />
  ),
}));

// Import AFTER mocks
import { TenderUpload } from '@/components/bid/tender-upload';
import { createMockFile as createMockFileFactory } from '@/__tests__/helpers/factories/file-upload';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(data: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

/**
 * Adapter to match the legacy (name, size, type) signature. Delegates to
 * the canonical factory in `plain` construction mode — TenderUpload is a
 * React component rendered in jsdom, so the plain DOM File constructor
 * works (no cross-realm `instanceof` to satisfy).
 */
function createMockFile(name: string, size: number, type: string): File {
  return createMockFileFactory({ name, size, type, construction: 'plain' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenderUpload', () => {
  const defaultProps = {
    bidId: 'bid-1',
    onUploadComplete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---- Idle state rendering ----

  it('renders idle state by default', () => {
    render(<TenderUpload {...defaultProps} />);
    expect(screen.getByText('Upload Tender Document')).toBeInTheDocument();
    expect(
      screen.getByText(/Drag and drop your tender document here/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Accepts: .docx, .pdf/)).toBeInTheDocument();
  });

  it('renders file upload icon in idle state', () => {
    render(<TenderUpload {...defaultProps} />);
    expect(screen.getByTestId('file-up-icon')).toBeInTheDocument();
  });

  it('renders accessible drop zone', () => {
    render(<TenderUpload {...defaultProps} />);
    const dropZone = screen.getByRole('button', {
      name: 'Upload tender document. Drag and drop or click to browse.',
    });
    expect(dropZone).toBeInTheDocument();
    expect(dropZone).toHaveAttribute('tabindex', '0');
  });

  it('renders hidden file input', () => {
    const { container } = render(<TenderUpload {...defaultProps} />);
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('accept', '.docx,.pdf');
    expect(input).toHaveAttribute('aria-hidden', 'true');
  });

  // ---- File validation ----

  it('rejects files with invalid type via drop', () => {
    render(<TenderUpload {...defaultProps} />);
    const dropZone = screen.getByRole('button', {
      name: /Upload tender document/,
    });

    const invalidFile = createMockFile('data.csv', 1024, 'text/csv');
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [invalidFile] },
    });

    // Validation triggers synchronously via processFile
    expect(screen.getByText(/Invalid file type/)).toBeInTheDocument();
    expect(mockToast.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid file type'),
    );
  });

  it('rejects files exceeding 50MB', async () => {
    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const largeFile = createMockFile(
      'huge.pdf',
      51 * 1024 * 1024,
      'application/pdf',
    );
    await user.upload(input, largeFile);

    await waitFor(() => {
      expect(screen.getByText(/File is too large/)).toBeInTheDocument();
    });
    expect(mockToast.error).toHaveBeenCalledWith(
      expect.stringContaining('too large'),
    );
  });

  it('accepts .pdf files', async () => {
    mockFetch
      .mockReturnValueOnce(mockFetchResponse({ path: '/uploads/tender.pdf' }))
      .mockReturnValueOnce(
        mockFetchResponse({
          sections: [],
          total_questions: 5,
          total_sections: 2,
        }),
      );

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile('tender.pdf', 1024, 'application/pdf');
    await user.upload(input, file);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/bids/bid-1/tender',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('accepts .docx files', async () => {
    mockFetch
      .mockReturnValueOnce(mockFetchResponse({ path: '/uploads/tender.docx' }))
      .mockReturnValueOnce(
        mockFetchResponse({
          sections: [],
          total_questions: 3,
          total_sections: 1,
        }),
      );

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile(
      'tender.docx',
      1024,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    await user.upload(input, file);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/bids/bid-1/tender',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  // ---- Upload + extraction flow ----

  it('shows uploading state during upload', async () => {
    // Make fetch hang to observe the uploading state
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile('tender.pdf', 1024, 'application/pdf');
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText(/Uploading/)).toBeInTheDocument();
      expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    });
  });

  it('shows complete state after successful extraction', async () => {
    mockFetch
      .mockReturnValueOnce(mockFetchResponse({ path: '/uploads/tender.pdf' }))
      .mockReturnValueOnce(
        mockFetchResponse({
          sections: [],
          total_questions: 8,
          total_sections: 3,
        }),
      );

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile('tender.pdf', 1024, 'application/pdf');
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText('Extraction complete')).toBeInTheDocument();
      expect(
        screen.getByText(/Found 8 questions across 3 sections/),
      ).toBeInTheDocument();
      expect(screen.getByTestId('check-icon')).toBeInTheDocument();
    });
  });

  it('shows success toast after extraction', async () => {
    mockFetch
      .mockReturnValueOnce(mockFetchResponse({ path: '/uploads/tender.pdf' }))
      .mockReturnValueOnce(
        mockFetchResponse({
          sections: [],
          total_questions: 8,
          total_sections: 3,
        }),
      );

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile('tender.pdf', 1024, 'application/pdf');
    await user.upload(input, file);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        'Extracted 8 questions from 3 sections',
      );
    });
  });

  it('shows Review Questions and Upload Another buttons after completion', async () => {
    mockFetch
      .mockReturnValueOnce(mockFetchResponse({ path: '/uploads/tender.pdf' }))
      .mockReturnValueOnce(
        mockFetchResponse({
          sections: [],
          total_questions: 5,
          total_sections: 2,
        }),
      );

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile('tender.pdf', 1024, 'application/pdf');
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText('Review Questions')).toBeInTheDocument();
      expect(screen.getByText('Upload Another')).toBeInTheDocument();
    });
  });

  it('calls onUploadComplete when Review Questions is clicked', async () => {
    const extractionResult = {
      sections: [],
      total_questions: 5,
      total_sections: 2,
    };
    mockFetch
      .mockReturnValueOnce(mockFetchResponse({ path: '/uploads/tender.pdf' }))
      .mockReturnValueOnce(mockFetchResponse(extractionResult));

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile('tender.pdf', 1024, 'application/pdf');
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText('Review Questions')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Review Questions'));
    expect(defaultProps.onUploadComplete).toHaveBeenCalledWith(
      extractionResult,
    );
  });

  // ---- Error state ----

  it('shows error state when upload fails', async () => {
    mockFetch.mockReturnValueOnce(
      mockFetchResponse({ error: 'Storage error' }, false, 500),
    );

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile('tender.pdf', 1024, 'application/pdf');
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText("Upload didn't complete")).toBeInTheDocument();
      expect(screen.getByText('Storage error')).toBeInTheDocument();
      expect(screen.getByTestId('alert-icon')).toBeInTheDocument();
    });
  });

  it('shows error state when extraction fails', async () => {
    mockFetch
      .mockReturnValueOnce(mockFetchResponse({ path: '/uploads/tender.pdf' }))
      .mockReturnValueOnce(
        mockFetchResponse({ error: 'Extraction timeout' }, false, 500),
      );

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile('tender.pdf', 1024, 'application/pdf');
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText("Upload didn't complete")).toBeInTheDocument();
      expect(screen.getByText('Extraction timeout')).toBeInTheDocument();
    });
  });

  it('shows Try Again button in error state', async () => {
    mockFetch.mockReturnValueOnce(
      mockFetchResponse({ error: 'Error' }, false, 500),
    );

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile('tender.pdf', 1024, 'application/pdf');
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });
  });

  it('resets to idle state when Try Again is clicked', async () => {
    mockFetch.mockReturnValueOnce(
      mockFetchResponse({ error: 'Error' }, false, 500),
    );

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile('tender.pdf', 1024, 'application/pdf');
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Try Again'));

    await waitFor(() => {
      expect(screen.getByText('Upload Tender Document')).toBeInTheDocument();
    });
  });

  it('shows generic error when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile('tender.pdf', 1024, 'application/pdf');
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText('Network failure')).toBeInTheDocument();
    });
  });

  // ---- Drag and drop ----

  it('shows dragging state on drag enter', () => {
    render(<TenderUpload {...defaultProps} />);
    const dropZone = screen.getByRole('button', {
      name: /Upload tender document/,
    });
    fireEvent.dragEnter(dropZone, { dataTransfer: { files: [] } });
    // The component sets dragging=true which changes border class
    expect(dropZone.className).toContain('border-primary');
  });

  it('removes dragging state on drag leave', () => {
    render(<TenderUpload {...defaultProps} />);
    const dropZone = screen.getByRole('button', {
      name: /Upload tender document/,
    });
    fireEvent.dragEnter(dropZone, { dataTransfer: { files: [] } });
    fireEvent.dragLeave(dropZone, { dataTransfer: { files: [] } });
    expect(dropZone.className).not.toContain('border-primary bg-primary/5');
  });

  it('processes file on drop', async () => {
    mockFetch
      .mockReturnValueOnce(mockFetchResponse({ path: '/uploads/tender.pdf' }))
      .mockReturnValueOnce(
        mockFetchResponse({
          sections: [],
          total_questions: 5,
          total_sections: 2,
        }),
      );

    render(<TenderUpload {...defaultProps} />);
    const dropZone = screen.getByRole('button', {
      name: /Upload tender document/,
    });

    const file = createMockFile('tender.pdf', 1024, 'application/pdf');
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  // ---- Keyboard interaction ----

  it('drop zone is focusable in idle state', () => {
    render(<TenderUpload {...defaultProps} />);
    const dropZone = screen.getByRole('button', {
      name: /Upload tender document/,
    });
    expect(dropZone).toHaveAttribute('tabindex', '0');
  });

  // ---- Upload Another resets to idle ----

  it('resets to idle when Upload Another is clicked', async () => {
    mockFetch
      .mockReturnValueOnce(mockFetchResponse({ path: '/uploads/tender.pdf' }))
      .mockReturnValueOnce(
        mockFetchResponse({
          sections: [],
          total_questions: 5,
          total_sections: 2,
        }),
      );

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile('tender.pdf', 1024, 'application/pdf');
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText('Upload Another')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Upload Another'));

    await waitFor(() => {
      expect(screen.getByText('Upload Tender Document')).toBeInTheDocument();
    });
  });

  // ---- Sends correct format to extraction API ----

  it('detects pdf format from filename', async () => {
    mockFetch
      .mockReturnValueOnce(mockFetchResponse({ path: '/uploads/tender.pdf' }))
      .mockReturnValueOnce(
        mockFetchResponse({
          sections: [],
          total_questions: 1,
          total_sections: 1,
        }),
      );

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile('tender.pdf', 1024, 'application/pdf');
    await user.upload(input, file);

    await waitFor(() => {
      const extractCall = mockFetch.mock.calls[1];
      const body = JSON.parse(extractCall[1].body);
      expect(body.format).toBe('pdf');
    });
  });

  it('detects docx format from filename', async () => {
    mockFetch
      .mockReturnValueOnce(mockFetchResponse({ path: '/uploads/tender.docx' }))
      .mockReturnValueOnce(
        mockFetchResponse({
          sections: [],
          total_questions: 1,
          total_sections: 1,
        }),
      );

    const user = userEvent.setup();
    render(<TenderUpload {...defaultProps} />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = createMockFile(
      'tender.docx',
      1024,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    await user.upload(input, file);

    await waitFor(() => {
      const extractCall = mockFetch.mock.calls[1];
      const body = JSON.parse(extractCall[1].body);
      expect(body.format).toBe('docx');
    });
  });
});

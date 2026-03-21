/**
 * SourceDocumentInfo Component Tests
 *
 * Tests for the compact source document metadata display component.
 *
 * Verifies:
 *  - Null/empty sourceDocumentId renders nothing
 *  - Loading state display
 *  - Error state on fetch failure
 *  - Successful document display with all fields
 *  - Diff link visibility when document has a parent
 *  - Expand/collapse version history section
 *  - Accessibility attributes (role, aria-label, aria-expanded)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

vi.mock('@/lib/format', () => ({
  formatDateUK: (d: string | null) => (d ? '15/03/2026' : ''),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

// Mock the child SourceDocumentHistory to isolate this component
vi.mock('@/components/source-document-history', () => ({
  SourceDocumentHistory: ({ sourceDocumentId }: { sourceDocumentId: string }) => (
    <div data-testid="mock-history" data-source-document-id={sourceDocumentId}>
      Mock history
    </div>
  ),
}));

import { SourceDocumentInfo } from '@/components/source-document-info';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? 'doc-1',
    filename: overrides.filename ?? 'upload-abc123.docx',
    original_filename: overrides.original_filename ?? 'Company-Profile.docx',
    mime_type:
      overrides.mime_type ??
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    file_size: overrides.file_size ?? 245_000,
    content_hash: overrides.content_hash ?? 'abc123hash',
    version: overrides.version ?? 1,
    parent_id: overrides.parent_id ?? null,
    storage_path: overrides.storage_path ?? '/docs/upload-abc123.docx',
    status: overrides.status ?? 'processed',
    uploaded_by: overrides.uploaded_by ?? 'user-1',
    created_at: overrides.created_at ?? '2026-03-10T09:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Null sourceDocumentId
// ---------------------------------------------------------------------------

describe('SourceDocumentInfo — null ID', () => {
  it('renders nothing when sourceDocumentId is null', () => {
    const { container } = render(
      <SourceDocumentInfo sourceDocumentId={null} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('does not call fetch when sourceDocumentId is null', () => {
    mockFetch.mockReset();
    render(<SourceDocumentInfo sourceDocumentId={null} />);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe('SourceDocumentInfo — loading state', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('shows a loading indicator while fetching', () => {
    // Never resolve — keeps in loading state
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    const loadingStatus = screen.getByRole('status', {
      name: /loading source document details/i,
    });
    expect(loadingStatus).toBeInTheDocument();
    expect(screen.getByText('Loading document details...')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('SourceDocumentInfo — error state', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('shows error message from API response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Document not found' }),
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-missing" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Document not found')).toBeInTheDocument();
  });

  it('shows generic error when response body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error('parse error'); },
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-bad" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Failed to fetch document details \(500\)/),
    ).toBeInTheDocument();
  });

  it('shows fallback error for network failures', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network error'));

    render(<SourceDocumentInfo sourceDocumentId="doc-network" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Network error')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Successful fetch — all fields populated
// ---------------------------------------------------------------------------

describe('SourceDocumentInfo — successful display', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('shows the original filename', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDocument({ original_filename: 'Bid-Response.docx' }),
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    await waitFor(() => {
      expect(screen.getByText('Bid-Response.docx')).toBeInTheDocument();
    });
  });

  it('falls back to internal filename if original_filename is empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        makeDocument({ original_filename: '', filename: 'upload-xyz.docx' }),
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    await waitFor(() => {
      expect(screen.getByText('upload-xyz.docx')).toBeInTheDocument();
    });
  });

  it('shows the version badge', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDocument({ version: 3 }),
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    await waitFor(() => {
      expect(screen.getByText('v3')).toBeInTheDocument();
    });
  });

  it('shows the formatted date', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDocument(),
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    await waitFor(() => {
      // formatDateUK is mocked to return '15/03/2026'
      expect(screen.getByText('15/03/2026')).toBeInTheDocument();
    });
  });

  it('shows formatted file size', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDocument({ file_size: 245_000 }),
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    await waitFor(() => {
      expect(screen.getByText('239.3 KB')).toBeInTheDocument();
    });
  });

  it('formats zero bytes correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDocument({ file_size: 0 }),
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    await waitFor(() => {
      expect(screen.getByText('0 B')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Diff link
// ---------------------------------------------------------------------------

describe('SourceDocumentInfo — diff link', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('shows diff link when document has a parent_id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        makeDocument({ id: 'doc-v2', parent_id: 'doc-v1' }),
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      const link = screen.getByRole('link', {
        name: /view changes from previous version/i,
      });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/documents/doc-v2/diff');
    });
  });

  it('does not show diff link when parent_id is null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDocument({ parent_id: null }),
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    await waitFor(() => {
      expect(screen.getByText('Company-Profile.docx')).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/view changes from previous version/i),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Expand/collapse version history
// ---------------------------------------------------------------------------

describe('SourceDocumentInfo — version history toggle', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('has a "View version history" button that starts collapsed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDocument(),
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    await waitFor(() => {
      expect(screen.getByText('Company-Profile.docx')).toBeInTheDocument();
    });

    const toggle = screen.getByRole('button', {
      name: /view version history/i,
    });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands version history on click and sets aria-expanded to true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDocument(),
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    await waitFor(() => {
      expect(screen.getByText('Company-Profile.docx')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    const toggle = screen.getByRole('button', {
      name: /view version history/i,
    });

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Child history component should be rendered
    expect(screen.getByTestId('mock-history')).toBeInTheDocument();
  });

  it('collapses version history on second click', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDocument(),
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    await waitFor(() => {
      expect(screen.getByText('Company-Profile.docx')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    const toggle = screen.getByRole('button', {
      name: /view version history/i,
    });

    // Open
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Close
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('mock-history')).not.toBeInTheDocument();
  });

  it('passes the correct sourceDocumentId to SourceDocumentHistory', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDocument({ id: 'doc-42' }),
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-42" />);

    await waitFor(() => {
      expect(screen.getByText('Company-Profile.docx')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /view version history/i }),
    );

    const historyEl = screen.getByTestId('mock-history');
    expect(historyEl).toHaveAttribute('data-source-document-id', 'doc-42');
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe('SourceDocumentInfo — accessibility', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('loading state has role="status" with aria-label', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute(
      'aria-label',
      'Loading source document details',
    );
  });

  it('error state has role="alert"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('decorative icons have aria-hidden="true"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDocument(),
    });

    const { container } = render(
      <SourceDocumentInfo sourceDocumentId="doc-1" />,
    );

    await waitFor(() => {
      expect(screen.getByText('Company-Profile.docx')).toBeInTheDocument();
    });

    const hiddenIcons = container.querySelectorAll('[aria-hidden="true"]');
    // Should have at least the FileText icon and the middot separator
    expect(hiddenIcons.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// className pass-through
// ---------------------------------------------------------------------------

describe('SourceDocumentInfo — className', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('applies additional className in loading state', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <SourceDocumentInfo sourceDocumentId="doc-1" className="my-class" />,
    );

    expect(container.firstElementChild!.className).toContain('my-class');
  });

  it('applies additional className in loaded state', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDocument(),
    });

    const { container } = render(
      <SourceDocumentInfo sourceDocumentId="doc-1" className="my-class" />,
    );

    await waitFor(() => {
      expect(screen.getByText('Company-Profile.docx')).toBeInTheDocument();
    });

    expect(container.firstElementChild!.className).toContain('my-class');
  });
});

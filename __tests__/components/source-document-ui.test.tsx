/**
 * Source Document UI Component Tests
 *
 * Tests three components:
 * - ReuploadBanner — both matchType variants (identical/new_version)
 * - SourceDocumentHistory — loading, error, version chain rendering
 * - SourceDocumentInfo — null ID, loading, data display, expand/collapse
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock values referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock('@/lib/format', () => ({
  formatDateUK: (d: string) => {
    if (!d) return '';
    return '20/03/2026';
  },
}));

import { ReuploadBanner } from '@/components/reupload-banner';
import { SourceDocumentHistory } from '@/components/source-document-history';
import { SourceDocumentInfo } from '@/components/source-document-info';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createVersionsResponse(versions = defaultVersions()) {
  return {
    ok: true,
    json: () => Promise.resolve({ versions }),
  };
}

function defaultVersions() {
  return [
    {
      id: 'doc-v1',
      filename: 'policy.docx',
      original_filename: 'Security-Policy.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size: 51200,
      content_hash: 'abc123def456',
      version: 1,
      parent_id: null,
      storage_path: '/docs/policy-v1.docx',
      status: 'processed',
      uploaded_by: 'user-1',
      created_at: '2026-01-15T10:00:00Z',
      content_item_count: 3,
    },
    {
      id: 'doc-v2',
      filename: 'policy.docx',
      original_filename: 'Security-Policy-v2.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size: 62000,
      content_hash: 'xyz789abc000',
      version: 2,
      parent_id: 'doc-v1',
      storage_path: '/docs/policy-v2.docx',
      status: 'processed',
      uploaded_by: 'user-1',
      created_at: '2026-03-01T14:30:00Z',
      content_item_count: 5,
    },
  ];
}

function createDocumentDetailResponse(doc = defaultDocumentDetail()) {
  return {
    ok: true,
    json: () => Promise.resolve(doc),
  };
}

function defaultDocumentDetail() {
  return {
    id: 'doc-v2',
    filename: 'policy.docx',
    original_filename: 'Security-Policy-v2.docx',
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    file_size: 62000,
    content_hash: 'xyz789abc000',
    version: 2,
    parent_id: 'doc-v1',
    storage_path: '/docs/policy-v2.docx',
    status: 'processed',
    uploaded_by: 'user-1',
    created_at: '2026-03-01T14:30:00Z',
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// ReuploadBanner
// ===========================================================================

describe('ReuploadBanner', () => {
  const baseProps = {
    previousVersion: 1,
    previousDocumentId: 'doc-v1',
  };

  describe('identical matchType', () => {
    it('shows duplicate file warning text', () => {
      render(<ReuploadBanner {...baseProps} matchType="identical" />);

      expect(screen.getByText('Duplicate file detected')).toBeInTheDocument();
      expect(
        screen.getByText(/this file has already been uploaded/i),
      ).toBeInTheDocument();
    });

    it('mentions the previous version number', () => {
      render(<ReuploadBanner {...baseProps} matchType="identical" />);

      expect(
        screen.getByText(/version 1 was uploaded previously/i),
      ).toBeInTheDocument();
    });

    it('has an alert role for accessibility', () => {
      render(<ReuploadBanner {...baseProps} matchType="identical" />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('stores previousDocumentId as a data attribute', () => {
      render(<ReuploadBanner {...baseProps} matchType="identical" />);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('data-previous-document-id', 'doc-v1');
    });
  });

  describe('new_version matchType', () => {
    it('shows updated document info text', () => {
      render(<ReuploadBanner {...baseProps} matchType="new_version" />);

      expect(
        screen.getByText('Updated document detected'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/creating version 2/i),
      ).toBeInTheDocument();
    });

    it('has an alert role for accessibility', () => {
      render(<ReuploadBanner {...baseProps} matchType="new_version" />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('applies custom className', () => {
    render(
      <ReuploadBanner
        {...baseProps}
        matchType="identical"
        className="my-custom-class"
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('my-custom-class');
  });
});

// ===========================================================================
// SourceDocumentHistory
// ===========================================================================

describe('SourceDocumentHistory', () => {
  it('shows loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SourceDocumentHistory sourceDocumentId="doc-v2" />);

    expect(
      screen.getByRole('status', { name: /loading version history/i }),
    ).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Not found' }),
    });
    render(<SourceDocumentHistory sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Not found')).toBeInTheDocument();
  });

  it('shows error state when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));
    render(<SourceDocumentHistory sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Network failure')).toBeInTheDocument();
  });

  it('shows empty state when no versions returned', async () => {
    mockFetch.mockResolvedValueOnce(createVersionsResponse([]));
    render(<SourceDocumentHistory sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(
        screen.getByText('No version history available.'),
      ).toBeInTheDocument();
    });
  });

  it('renders version chain as a list', async () => {
    mockFetch.mockResolvedValueOnce(createVersionsResponse());
    render(<SourceDocumentHistory sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(
        screen.getByRole('list', { name: /source document version history/i }),
      ).toBeInTheDocument();
    });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
  });

  it('shows version badges', async () => {
    mockFetch.mockResolvedValueOnce(createVersionsResponse());
    render(<SourceDocumentHistory sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(screen.getByText('v1')).toBeInTheDocument();
    });

    expect(screen.getByText('v2')).toBeInTheDocument();
  });

  it('highlights current version with "Current" badge', async () => {
    mockFetch.mockResolvedValueOnce(createVersionsResponse());
    render(<SourceDocumentHistory sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(screen.getByText('Current')).toBeInTheDocument();
    });
  });

  it('shows original filenames', async () => {
    mockFetch.mockResolvedValueOnce(createVersionsResponse());
    render(<SourceDocumentHistory sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(screen.getByText('Security-Policy.docx')).toBeInTheDocument();
    });

    expect(screen.getByText('Security-Policy-v2.docx')).toBeInTheDocument();
  });

  it('shows content item counts', async () => {
    mockFetch.mockResolvedValueOnce(createVersionsResponse());
    render(<SourceDocumentHistory sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(screen.getByText('3 items')).toBeInTheDocument();
    });

    expect(screen.getByText('5 items')).toBeInTheDocument();
  });

  it('fetches from the correct API URL', async () => {
    mockFetch.mockResolvedValueOnce(createVersionsResponse());
    render(<SourceDocumentHistory sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/source-documents/doc-v2/versions',
      );
    });
  });
});

// ===========================================================================
// SourceDocumentInfo
// ===========================================================================

describe('SourceDocumentInfo', () => {
  it('returns null when sourceDocumentId is null', () => {
    const { container } = render(
      <SourceDocumentInfo sourceDocumentId={null} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('shows loading state while fetching', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SourceDocumentInfo sourceDocumentId="doc-v2" />);

    expect(
      screen.getByRole('status', { name: /loading source document details/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Loading document details...'),
    ).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Document not found' }),
    });
    render(<SourceDocumentInfo sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Document not found')).toBeInTheDocument();
  });

  it('shows document metadata after loading', async () => {
    mockFetch.mockResolvedValueOnce(createDocumentDetailResponse());
    render(<SourceDocumentInfo sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(
        screen.getByText('Security-Policy-v2.docx'),
      ).toBeInTheDocument();
    });

    expect(screen.getByText('v2')).toBeInTheDocument();
    // File size: 62000 bytes = 60.5 KB
    expect(screen.getByText('60.5 KB')).toBeInTheDocument();
  });

  it('shows "View version history" button', async () => {
    mockFetch.mockResolvedValueOnce(createDocumentDetailResponse());
    render(<SourceDocumentInfo sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(
        screen.getByText('View version history'),
      ).toBeInTheDocument();
    });
  });

  it('expands version history on click', async () => {
    // First fetch is for the document detail, second for the versions
    mockFetch
      .mockResolvedValueOnce(createDocumentDetailResponse())
      .mockResolvedValueOnce(createVersionsResponse());

    const user = userEvent.setup();
    render(<SourceDocumentInfo sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(
        screen.getByText('View version history'),
      ).toBeInTheDocument();
    });

    const button = screen.getByText('View version history');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('fetches from the correct API URL', async () => {
    mockFetch.mockResolvedValueOnce(createDocumentDetailResponse());
    render(<SourceDocumentInfo sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/source-documents/doc-v2',
      );
    });
  });
});

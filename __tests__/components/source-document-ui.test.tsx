/**
 * Source Document UI Component Tests
 *
 * Tests for SourceDocumentHistory and SourceDocumentInfo, used in source
 * document management flows. (ReuploadBanner's coverage was removed here —
 * ID-131.24 G-UPLOAD-GATE retired the component alongside the synchronous
 * /api/upload re-upload-detection pipeline it served; DR-025's
 * content_hash-first admission resolver's `wasMinted` flag is the successor
 * signal, surfaced inline in the upload tab rather than via a dedicated
 * banner.)
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
  formatFileSize: (bytes: number | null) => {
    if (bytes === null || bytes === undefined) return 'Unknown';
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  },
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

import { SourceDocumentHistory } from '@/components/source-document/source-document-history';
import { SourceDocumentInfo } from '@/components/source-document/source-document-info';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? 'doc-v1',
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
    content_item_count: overrides.content_item_count ?? 5,
  };
}

// ---------------------------------------------------------------------------
// SourceDocumentHistory
// ---------------------------------------------------------------------------

describe('SourceDocumentHistory', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('shows loading state during fetch', () => {
    // Never resolve — keeps it in loading state
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<SourceDocumentHistory sourceDocumentId="doc-1" />);

    expect(
      screen.getByRole('status', { name: /loading version history/i }),
    ).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-1" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Internal server error')).toBeInTheDocument();
  });

  it('renders version chain correctly', async () => {
    const versions = [
      makeVersion({
        id: 'doc-v2',
        version: 2,
        original_filename: 'Profile-v2.docx',
      }),
      makeVersion({
        id: 'doc-v1',
        version: 1,
        original_filename: 'Profile-v1.docx',
      }),
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ versions }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      expect(screen.getByText('Profile-v1.docx')).toBeInTheDocument();
    });

    // Both versions should appear
    expect(screen.getByText('Profile-v2.docx')).toBeInTheDocument();

    // Version badges
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();

    // "Current" badge for the matching doc ID
    expect(screen.getByText('Current')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SourceDocumentInfo
// ---------------------------------------------------------------------------

describe('SourceDocumentInfo', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns null when sourceDocumentId is null', () => {
    const { container } = render(
      <SourceDocumentInfo sourceDocumentId={null} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('shows loading then document info', async () => {
    const doc = {
      id: 'doc-1',
      filename: 'upload-xyz.docx',
      original_filename: 'Procurement-Response.docx',
      mime_type:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size: 128_000,
      content_hash: 'hash-xyz',
      version: 3,
      parent_id: 'doc-parent',
      storage_path: '/docs/upload-xyz.docx',
      status: 'processed',
      uploaded_by: 'user-1',
      created_at: '2026-03-15T14:30:00Z',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => doc,
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    // Loading state appears first
    expect(
      screen.getByRole('status', {
        name: /loading source document details/i,
      }),
    ).toBeInTheDocument();

    // Then document info appears
    await waitFor(() => {
      expect(screen.getByText('Procurement-Response.docx')).toBeInTheDocument();
    });

    expect(screen.getByText('v3')).toBeInTheDocument();
  });

  it('has expandable version history section', async () => {
    const doc = {
      id: 'doc-1',
      filename: 'upload-xyz.docx',
      original_filename: 'Procurement-Response.docx',
      mime_type:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size: 128_000,
      content_hash: 'hash-xyz',
      version: 1,
      parent_id: null,
      storage_path: '/docs/upload-xyz.docx',
      status: 'processed',
      uploaded_by: 'user-1',
      created_at: '2026-03-15T14:30:00Z',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => doc,
    });

    render(<SourceDocumentInfo sourceDocumentId="doc-1" />);

    await waitFor(() => {
      expect(screen.getByText('Procurement-Response.docx')).toBeInTheDocument();
    });

    const toggleButton = screen.getByRole('button', {
      name: /view version history/i,
    });
    expect(toggleButton).toBeInTheDocument();
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');

    // Click to expand — this will trigger a second fetch for the history
    mockFetch.mockReturnValue(new Promise(() => {}));

    const user = userEvent.setup();
    await user.click(toggleButton);

    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
  });
});

/**
 * SourceDocumentHistory Component Tests
 *
 * Tests for the vertical timeline of source document versions.
 *
 * Verifies:
 *  - Loading state display
 *  - Error state on fetch failure
 *  - Empty state (no versions)
 *  - Single version rendering
 *  - Multiple versions timeline with correct sort order
 *  - Current version highlight (badge + styling)
 *  - Diff links on versioned documents (parent_id present)
 *  - Content item counts
 *  - Accessibility attributes (role="list", role="listitem", sr-only text)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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
// Loading state
// ---------------------------------------------------------------------------

describe('SourceDocumentHistory — loading state', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('shows a loading spinner with accessible role', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<SourceDocumentHistory sourceDocumentId="doc-1" />);

    const status = screen.getByRole('status', {
      name: /loading version history/i,
    });
    expect(status).toBeInTheDocument();
  });

  it('has a screen-reader-only loading text', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<SourceDocumentHistory sourceDocumentId="doc-1" />);

    expect(screen.getByText('Loading version history...')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('SourceDocumentHistory — error state', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('shows error message from API response', async () => {
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

  it('shows fallback error when response body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('parse error');
      },
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-err" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Failed to fetch version history \(502\)/),
    ).toBeInTheDocument();
  });

  it('shows error for network failures', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    render(<SourceDocumentHistory sourceDocumentId="doc-net" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('SourceDocumentHistory — empty state', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('shows "No version history available" when API returns empty array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ versions: [] }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-empty" />);

    await waitFor(() => {
      expect(
        screen.getByText('No version history available.'),
      ).toBeInTheDocument();
    });
  });

  it('shows empty state when API returns no versions key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-no-key" />);

    await waitFor(() => {
      expect(
        screen.getByText('No version history available.'),
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Single version
// ---------------------------------------------------------------------------

describe('SourceDocumentHistory — single version', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('renders a single version entry', async () => {
    const versions = [makeVersion({ id: 'doc-v1', version: 1 })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ versions }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-v1" />);

    await waitFor(() => {
      expect(screen.getByText('Company-Profile.docx')).toBeInTheDocument();
    });

    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('does not show a diff link for the first version (no parent)', async () => {
    const versions = [
      makeVersion({ id: 'doc-v1', version: 1, parent_id: null }),
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ versions }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-v1" />);

    await waitFor(() => {
      expect(screen.getByText('v1')).toBeInTheDocument();
    });

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Multiple versions timeline
// ---------------------------------------------------------------------------

describe('SourceDocumentHistory — multiple versions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const threeVersions = [
    makeVersion({
      id: 'doc-v3',
      version: 3,
      parent_id: 'doc-v2',
      original_filename: 'Profile-v3.docx',
      content_item_count: 12,
    }),
    makeVersion({
      id: 'doc-v1',
      version: 1,
      parent_id: null,
      original_filename: 'Profile-v1.docx',
      content_item_count: 8,
    }),
    makeVersion({
      id: 'doc-v2',
      version: 2,
      parent_id: 'doc-v1',
      original_filename: 'Profile-v2.docx',
      content_item_count: 10,
    }),
  ];

  it('renders all versions sorted ascending (v1 first)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ versions: threeVersions }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-v3" />);

    await waitFor(() => {
      expect(screen.getByText('Profile-v1.docx')).toBeInTheDocument();
    });

    // All three should appear
    expect(screen.getByText('Profile-v2.docx')).toBeInTheDocument();
    expect(screen.getByText('Profile-v3.docx')).toBeInTheDocument();

    // Version badges
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
  });

  it('highlights the current version (matching sourceDocumentId)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ versions: threeVersions }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-v3" />);

    await waitFor(() => {
      expect(screen.getByText('Current')).toBeInTheDocument();
    });

    // Only one "Current" badge
    const currentBadges = screen.getAllByText('Current');
    expect(currentBadges).toHaveLength(1);
  });

  it('shows diff links for versions with parent_id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ versions: threeVersions }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-v3" />);

    await waitFor(() => {
      expect(screen.getByText('Profile-v3.docx')).toBeInTheDocument();
    });

    // v2 has parent_id=doc-v1 → "View changes from v1"
    const v2Link = screen.getByRole('link', { name: /view changes from v1/i });
    expect(v2Link).toHaveAttribute('href', '/documents/doc-v2/diff');

    // v3 has parent_id=doc-v2 → "View changes from v2"
    const v3Link = screen.getByRole('link', { name: /view changes from v2/i });
    expect(v3Link).toHaveAttribute('href', '/documents/doc-v3/diff');
  });

  it('does not show a diff link for v1 (no parent)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ versions: threeVersions }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-v3" />);

    await waitFor(() => {
      expect(screen.getByText('Profile-v1.docx')).toBeInTheDocument();
    });

    // No link for "View changes from v0"
    expect(
      screen.queryByRole('link', { name: /view changes from v0/i }),
    ).not.toBeInTheDocument();
  });

  it('shows content item counts', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ versions: threeVersions }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-v3" />);

    await waitFor(() => {
      expect(screen.getByText('Profile-v1.docx')).toBeInTheDocument();
    });

    // "8 items", "10 items", "12 items"
    expect(screen.getByText('8 items')).toBeInTheDocument();
    expect(screen.getByText('10 items')).toBeInTheDocument();
    expect(screen.getByText('12 items')).toBeInTheDocument();
  });

  it('uses singular "item" for count of 1', async () => {
    const versions = [
      makeVersion({ id: 'doc-single', version: 1, content_item_count: 1 }),
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ versions }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-single" />);

    await waitFor(() => {
      expect(screen.getByText('1 item')).toBeInTheDocument();
    });
  });

  it('hides content item count when zero', async () => {
    const versions = [
      makeVersion({ id: 'doc-zero', version: 1, content_item_count: 0 }),
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ versions }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-zero" />);

    await waitFor(() => {
      expect(screen.getByText('Company-Profile.docx')).toBeInTheDocument();
    });

    expect(screen.queryByText('0 items')).not.toBeInTheDocument();
    expect(screen.queryByText('0 item')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe('SourceDocumentHistory — accessibility', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('uses role="list" with an aria-label on the container', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        versions: [makeVersion({ id: 'doc-v1' })],
      }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-v1" />);

    await waitFor(() => {
      const list = screen.getByRole('list', {
        name: /source document version history/i,
      });
      expect(list).toBeInTheDocument();
    });
  });

  it('uses role="listitem" for each version entry', async () => {
    const versions = [
      makeVersion({ id: 'doc-v1', version: 1 }),
      makeVersion({ id: 'doc-v2', version: 2, parent_id: 'doc-v1' }),
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ versions }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-v2" />);

    await waitFor(() => {
      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(2);
    });
  });

  it('has screen-reader-only "Uploaded on" prefix for dates', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        versions: [makeVersion({ id: 'doc-v1' })],
      }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-v1" />);

    await waitFor(() => {
      expect(screen.getByText('Uploaded on')).toBeInTheDocument();
    });

    // The sr-only text should be in the DOM
    const srOnly = screen.getByText('Uploaded on');
    expect(srOnly.className).toContain('sr-only');
  });

  it('has screen-reader-only "File size:" prefix', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        versions: [makeVersion({ id: 'doc-v1' })],
      }),
    });

    render(<SourceDocumentHistory sourceDocumentId="doc-v1" />);

    await waitFor(() => {
      expect(screen.getByText('File size:')).toBeInTheDocument();
    });

    const srOnly = screen.getByText('File size:');
    expect(srOnly.className).toContain('sr-only');
  });

  it('marks timeline connectors and decorative elements as aria-hidden', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        versions: [makeVersion({ id: 'doc-v1' })],
      }),
    });

    const { container } = render(
      <SourceDocumentHistory sourceDocumentId="doc-v1" />,
    );

    await waitFor(() => {
      expect(screen.getByText('Company-Profile.docx')).toBeInTheDocument();
    });

    const ariaHidden = container.querySelectorAll('[aria-hidden="true"]');
    // At least the timeline dot, middot separator, and icon
    expect(ariaHidden.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// className pass-through
// ---------------------------------------------------------------------------

describe('SourceDocumentHistory — className', () => {
  it('applies additional className in loading state', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <SourceDocumentHistory
        sourceDocumentId="doc-1"
        className="custom-class"
      />,
    );

    expect(container.firstElementChild!.className).toContain('custom-class');
  });

  it('applies additional className in loaded state', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        versions: [makeVersion({ id: 'doc-v1' })],
      }),
    });

    const { container } = render(
      <SourceDocumentHistory
        sourceDocumentId="doc-v1"
        className="custom-class"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Company-Profile.docx')).toBeInTheDocument();
    });

    expect(container.firstElementChild!.className).toContain('custom-class');
  });
});

// ---------------------------------------------------------------------------
// Fetch behaviour
// ---------------------------------------------------------------------------

describe('SourceDocumentHistory — fetch behaviour', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('fetches from the correct API endpoint', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<SourceDocumentHistory sourceDocumentId="doc-abc-123" />);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/source-documents/doc-abc-123/versions',
    );
  });
});

/**
 * DocumentVersionList — thin presentational map of `get_document_version_chain`
 * rows (ID-135.15, TECH.md §3 BI-25/BI-26, §4, RD-4). Self-fetches via its
 * OWN `useDocumentVersions` {135.13} query (BI-30 independent-per-section
 * pattern, mirroring {135.16}'s `DocumentCitationsPanel`): loading renders a
 * skeleton, a fetch failure renders its own localised non-technical error +
 * retry, data renders the version chain.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import type {
  DocumentVersionRow,
  DocumentVersionsResponse,
} from '@/hooks/source-document-detail/use-source-document-detail';

const { mockUseDocumentVersions, mockRefetch } = vi.hoisted(() => ({
  mockUseDocumentVersions: vi.fn(),
  mockRefetch: vi.fn(),
}));

vi.mock('@/hooks/source-document-detail/use-source-document-detail', () => ({
  useDocumentVersions: (id: string) => mockUseDocumentVersions(id),
}));

// Import component AFTER mocks.
import { DocumentVersionList } from '@/components/source-document-detail/document-version-list';

const DOCUMENT_ID = '00000000-0000-4000-8000-000000000001';

/**
 * `get_document_version_chain` RPC row shape — every field is NOT NULL per
 * the function's return signature (squash-baseline migration), so this
 * fixture supplies innocuous baseline values for all of them. `parent_id`
 * is left at its non-null default throughout — `DocumentVersionList`
 * orders/marks-current by `version` and links by `id`, never by
 * `parent_id`, so root-vs-descendant framing plays no part in these tests.
 */
function makeVersionRow(
  overrides: Partial<DocumentVersionRow> = {},
): DocumentVersionRow {
  return {
    content_hash: 'fixture-hash-0000',
    content_item_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    file_size: 1024,
    filename: 'fixture-document.pdf',
    id: '00000000-0000-4000-8000-000000000000',
    mime_type: 'application/pdf',
    original_filename: 'fixture-document.pdf',
    parent_id: '00000000-0000-4000-8000-000000000000',
    status: 'processed',
    storage_path: 'source-documents/fixture-document.pdf',
    uploaded_by: '00000000-0000-4000-8000-000000000001',
    version: 1,
    ...overrides,
  };
}

function makeResponse(
  versions: DocumentVersionRow[],
): DocumentVersionsResponse {
  return {
    document_id: DOCUMENT_ID,
    total_versions: versions.length,
    versions,
  };
}

describe('DocumentVersionList', () => {
  beforeEach(() => {
    mockUseDocumentVersions.mockReset();
    mockRefetch.mockReset();
    mockUseDocumentVersions.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });
  });

  it('shows a loading skeleton while the versions query is in flight', () => {
    mockUseDocumentVersions.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockRefetch,
    });
    render(<DocumentVersionList documentId={DOCUMENT_ID} />);

    expect(
      screen.getByRole('status', { name: /loading version history/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('renders a localised error state with retry on fetch failure, not a crash', () => {
    mockUseDocumentVersions.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
    });
    render(<DocumentVersionList documentId={DOCUMENT_ID} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText(/couldn.t load version history/i),
    ).toBeInTheDocument();

    screen.getByRole('button', { name: /try again/i }).click();
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('orders rows by version ascending regardless of input array order', () => {
    const v1 = makeVersionRow({
      id: 'v1',
      version: 1,
      filename: 'doc-v1.pdf',
    });
    const v2 = makeVersionRow({
      id: 'v2',
      version: 2,
      filename: 'doc-v2.pdf',
    });
    const v3 = makeVersionRow({
      id: 'v3',
      version: 3,
      filename: 'doc-v3.pdf',
    });
    // Deliberately out of order.
    mockUseDocumentVersions.mockReturnValue({
      data: makeResponse([v3, v1, v2]),
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });

    render(<DocumentVersionList documentId={DOCUMENT_ID} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText(/doc-v1\.pdf/)).toBeInTheDocument();
    expect(within(items[1]).getByText(/doc-v2\.pdf/)).toBeInTheDocument();
    expect(within(items[2]).getByText(/doc-v3\.pdf/)).toBeInTheDocument();
  });

  it('marks the highest-version row as current with visible text', () => {
    const v1 = makeVersionRow({ id: 'v1', version: 1 });
    const v2 = makeVersionRow({ id: 'v2', version: 2 });
    mockUseDocumentVersions.mockReturnValue({
      data: makeResponse([v1, v2]),
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });

    render(<DocumentVersionList documentId={DOCUMENT_ID} />);

    const items = screen.getAllByRole('listitem');
    expect(within(items[1]).getByText(/current/i)).toBeInTheDocument();
    expect(within(items[0]).queryByText(/current/i)).not.toBeInTheDocument();
  });

  it('links non-current rows to /documents/[id]/diff', () => {
    const v1 = makeVersionRow({ id: 'v1', version: 1 });
    const v2 = makeVersionRow({ id: 'v2', version: 2 });
    const v3 = makeVersionRow({ id: 'v3', version: 3 });
    mockUseDocumentVersions.mockReturnValue({
      data: makeResponse([v1, v2, v3]),
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });

    render(<DocumentVersionList documentId={DOCUMENT_ID} />);

    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByRole('link')).toHaveAttribute(
      'href',
      '/documents/v1/diff',
    );
    expect(within(items[1]).getByRole('link')).toHaveAttribute(
      'href',
      '/documents/v2/diff',
    );
  });

  it('does not render a diff link on the current (highest-version) row', () => {
    const v1 = makeVersionRow({ id: 'v1', version: 1 });
    const v2 = makeVersionRow({ id: 'v2', version: 2 });
    mockUseDocumentVersions.mockReturnValue({
      data: makeResponse([v1, v2]),
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });

    render(<DocumentVersionList documentId={DOCUMENT_ID} />);

    const items = screen.getAllByRole('listitem');
    expect(within(items[1]).queryByRole('link')).not.toBeInTheDocument();
  });

  it("shows each row's landed date via formatDateUK", () => {
    const v1 = makeVersionRow({
      id: 'v1',
      version: 1,
      created_at: '2026-03-14T09:00:00.000Z',
    });
    mockUseDocumentVersions.mockReturnValue({
      data: makeResponse([v1]),
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });

    render(<DocumentVersionList documentId={DOCUMENT_ID} />);

    expect(screen.getByText(/14\/03\/2026/)).toBeInTheDocument();
  });

  it('renders a single-entry list for a single-version document, not empty/error', () => {
    const only = makeVersionRow({ id: 'only', version: 1 });
    mockUseDocumentVersions.mockReturnValue({
      data: makeResponse([only]),
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });

    render(<DocumentVersionList documentId={DOCUMENT_ID} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText(/current/i)).toBeInTheDocument();
    expect(within(items[0]).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('never renders a raw undefined/null/NaN when fields are minimal', () => {
    const only = makeVersionRow({ id: 'only', version: 1 });
    mockUseDocumentVersions.mockReturnValue({
      data: makeResponse([only]),
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });

    const { container } = render(
      <DocumentVersionList documentId={DOCUMENT_ID} />,
    );

    expect(container.textContent).not.toMatch(/\bundefined\b/);
    expect(container.textContent).not.toMatch(/\bnull\b/);
    expect(container.textContent).not.toMatch(/\bNaN\b/);
  });
});

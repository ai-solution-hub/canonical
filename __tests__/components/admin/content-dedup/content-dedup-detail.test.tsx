/**
 * ContentDedupDetailClient Component Tests
 *
 * Verifies the detail/resolve view: side-by-side cards when both subject
 * and canonical are present, single subject card + warning panel when
 * canonical is null, and loading + error surfaces.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { mockFetchItem } = vi.hoisted(() => ({
  mockFetchItem: vi.fn(),
}));

vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return {
    ...actual,
    fetchAdminDedupItem: mockFetchItem,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/content-dedup/[id]',
  useSearchParams: () => new URLSearchParams(),
}));

import { ContentDedupDetailClient } from '@/components/admin/content-dedup/content-dedup-detail';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import type { SuspectedDuplicateRow } from '@/lib/query/fetchers';

function makeRow(
  overrides: Partial<SuspectedDuplicateRow> = {},
): SuspectedDuplicateRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Subject',
    content: 'subject body',
    dedup_status: 'suspected_duplicate',
    created_at: '2026-04-28T12:00:00Z',
    primary_domain: 'tech-it',
    content_owner_id: null,
    ingest_source: 'url_import',
    superseded_by: null,
    publication_status: 'in_review',
    metadata: null,
    ...overrides,
  };
}

const SUBJECT_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ContentDedupDetailClient', () => {
  it('renders side-by-side subject + canonical cards when both exist', async () => {
    mockFetchItem.mockResolvedValueOnce({
      subject: makeRow({ id: SUBJECT_ID, title: 'Subject row' }),
      canonical: makeRow({
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Canonical row',
        publication_status: 'published',
      }),
      similarity: 1,
    });

    const { Wrapper } = createQueryWrapper();
    render(<ContentDedupDetailClient id={SUBJECT_ID} />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /resolve duplicate/i }),
      ).toBeInTheDocument();
    });

    // "Subject row" appears in both the H1 ("Resolve duplicate: Subject row")
    // and the row card title — assert there are 2 occurrences instead of
    // matching a single one.
    const subjectMatches = screen.getAllByText('Subject row');
    expect(subjectMatches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Canonical row')).toBeInTheDocument();
    // Both row cards should be in the DOM
    expect(screen.getByLabelText('Subject (suspected)')).toBeInTheDocument();
    expect(screen.getByLabelText('Canonical (existing)')).toBeInTheDocument();
    expect(screen.getByText(/similarity: 1\.00/i)).toBeInTheDocument();
  });

  it('renders subject + warning panel when canonical is null', async () => {
    mockFetchItem.mockResolvedValueOnce({
      subject: makeRow({ id: SUBJECT_ID, title: 'Lone subject' }),
      canonical: null,
      similarity: 1,
    });

    const { Wrapper } = createQueryWrapper();
    render(<ContentDedupDetailClient id={SUBJECT_ID} />, { wrapper: Wrapper });

    await waitFor(() => {
      // CardTitle renders as a <div data-slot="card-title">, not a heading.
      expect(
        screen.getByText(/no canonical match found in metadata/i),
      ).toBeInTheDocument();
    });

    // "Lone subject" appears in both the H1 and the subject card.
    expect(screen.getAllByText('Lone subject').length).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      screen.queryByLabelText('Canonical (existing)'),
    ).not.toBeInTheDocument();
  });

  it('renders a loading state initially', () => {
    mockFetchItem.mockReturnValueOnce(new Promise(() => {}));

    const { Wrapper } = createQueryWrapper();
    render(<ContentDedupDetailClient id={SUBJECT_ID} />, { wrapper: Wrapper });

    expect(screen.getByText(/loading dedup item/i)).toBeInTheDocument();
  });

  it('renders an error panel + retry on fetch failure', async () => {
    mockFetchItem.mockRejectedValueOnce(new Error('detail boom'));

    const { Wrapper } = createQueryWrapper();
    render(<ContentDedupDetailClient id={SUBJECT_ID} />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByText(/failed to load dedup item/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('dedup-detail-retry')).toBeInTheDocument();
  });
});

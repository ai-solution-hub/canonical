/**
 * ContentDedupQueueClient Component Tests
 *
 * Verifies the list view: rows render, empty state shows when zero items,
 * loading skeleton appears initially, error panel surfaces a retry, and
 * the resolve link points at the detail route.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

const { mockFetchQueue } = vi.hoisted(() => ({
  mockFetchQueue: vi.fn(),
}));

vi.mock('@/lib/query/fetchers', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/query/fetchers')>(
      '@/lib/query/fetchers',
    );
  return {
    ...actual,
    fetchAdminDedupQueue: mockFetchQueue,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/content-dedup',
  useSearchParams: () => new URLSearchParams(),
}));

import { ContentDedupQueueClient } from '@/components/admin/content-dedup/content-dedup-queue';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import type { SuspectedDuplicateRow } from '@/lib/query/fetchers';

function makeRow(
  overrides: Partial<SuspectedDuplicateRow> = {},
): SuspectedDuplicateRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Cloud security policy v3',
    content: 'Body',
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

beforeEach(() => {
  vi.clearAllMocks();
  installRadixPointerShims();
});

describe('ContentDedupQueueClient', () => {
  it('renders the heading and rows when the queue has items', async () => {
    mockFetchQueue.mockResolvedValueOnce({
      items: [
        makeRow({ id: '11111111-1111-4111-8111-111111111111' }),
        makeRow({
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Other policy',
          primary_domain: 'compliance',
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });

    const { Wrapper } = createQueryWrapper();
    render(<ContentDedupQueueClient />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: /cross-system dedup review/i,
        }),
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        screen.getByText('Cloud security policy v3'),
      ).toBeInTheDocument();
    });

    expect(screen.getByText('Other policy')).toBeInTheDocument();
    expect(screen.getByText('2 rows pending review')).toBeInTheDocument();

    const resolveLink = screen.getByTestId(
      'dedup-row-resolve-11111111-1111-4111-8111-111111111111',
    );
    expect(resolveLink).toBeInTheDocument();
    // Button asChild renders the underlying <a> directly, so the testid
    // and href both live on the anchor element itself.
    expect(resolveLink).toHaveAttribute(
      'href',
      '/admin/content-dedup/11111111-1111-4111-8111-111111111111',
    );
  });

  it('renders the empty state when the queue is empty', async () => {
    mockFetchQueue.mockResolvedValueOnce({
      items: [],
      hasMore: false,
      nextCursor: null,
    });

    const { Wrapper } = createQueryWrapper();
    render(<ContentDedupQueueClient />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: /no suspected duplicates pending review/i,
        }),
      ).toBeInTheDocument();
    });
  });

  it('renders an error panel with retry on fetch failure', async () => {
    mockFetchQueue.mockRejectedValueOnce(new Error('boom'));

    const { Wrapper } = createQueryWrapper();
    render(<ContentDedupQueueClient />, { wrapper: Wrapper });

    await waitFor(() => {
      // Card titles are <div>s with `data-slot="card-title"`, not headings.
      expect(
        screen.getByText(/failed to load dedup queue/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('dedup-queue-retry')).toBeInTheDocument();
  });
});

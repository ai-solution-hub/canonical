/**
 * NearDuplicatesPairDetailClient Component Tests (AC4)
 *
 * Verifies side-by-side rendering of left + right cards, similarity in
 * the header, loading + error states, and a back-link to the list view.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

const { mockFetchPair } = vi.hoisted(() => ({
  mockFetchPair: vi.fn(),
}));

vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return {
    ...actual,
    fetchAdminNearDupPair: mockFetchPair,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/content-dedup/near-duplicates/[pairId]',
  useSearchParams: () => new URLSearchParams(),
}));

import { NearDuplicatesPairDetailClient } from '@/components/admin/content-dedup/near-duplicates/near-duplicates-pair-detail';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import type { NearDupPairMember } from '@/lib/query/fetchers';

const LEFT_ID = '11111111-1111-4111-8111-111111111111';
const RIGHT_ID = '22222222-2222-4222-8222-222222222222';
const PAIR_ID = `${LEFT_ID}__${RIGHT_ID}`;

function makeMember(
  overrides: Partial<NearDupPairMember> = {},
): NearDupPairMember {
  return {
    id: LEFT_ID,
    title: 'Left row title',
    content: 'left content body',
    dedup_status: 'clean',
    created_at: '2026-04-21T12:00:00Z',
    primary_domain: 'access-control',
    content_type: 'q_a_pair',
    content_owner_id: null,
    ingest_source: 'example-client-reingest-2026-v2',
    superseded_by: null,
    archived_at: null,
    publication_status: 'published',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installRadixPointerShims();
});

describe('NearDuplicatesPairDetailClient', () => {
  it('AC4: renders left + right cards side-by-side and similarity in header', async () => {
    mockFetchPair.mockResolvedValueOnce({
      left: makeMember({ id: LEFT_ID, title: 'Left row title' }),
      right: makeMember({
        id: RIGHT_ID,
        title: 'Right row title',
        created_at: '2026-03-14T12:00:00Z',
        ingest_source: 'client-new-markdown-2026',
      }),
      similarity: 0.943,
    });

    const { Wrapper } = createQueryWrapper();
    render(<NearDuplicatesPairDetailClient pairId={PAIR_ID} />, {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /resolve near-duplicate pair/i }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/Similarity: 0\.943/)).toBeInTheDocument();
    expect(screen.getByText('Left row title')).toBeInTheDocument();
    expect(screen.getByText('Right row title')).toBeInTheDocument();

    // Both labels rendered as Left + Right (side-by-side).
    expect(
      screen.getByTestId('near-dup-row-card-label-left'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('near-dup-row-card-label-right'),
    ).toBeInTheDocument();
  });

  it('renders error panel with retry on fetch failure', async () => {
    mockFetchPair.mockRejectedValueOnce(new Error('boom'));

    const { Wrapper } = createQueryWrapper();
    render(<NearDuplicatesPairDetailClient pairId={PAIR_ID} />, {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(
        screen.getByText(/failed to load near-duplicate pair/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('near-dup-detail-retry')).toBeInTheDocument();
  });

  it('back-link points at the near-duplicate list', async () => {
    mockFetchPair.mockResolvedValueOnce({
      left: makeMember({ id: LEFT_ID }),
      right: makeMember({ id: RIGHT_ID }),
      similarity: 0.943,
    });

    const { Wrapper } = createQueryWrapper();
    render(<NearDuplicatesPairDetailClient pairId={PAIR_ID} />, {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      const backLink = screen.getByRole('link', {
        name: /back to near-duplicate list/i,
      });
      expect(backLink).toHaveAttribute(
        'href',
        '/admin/content-dedup/near-duplicates',
      );
    });
  });
});

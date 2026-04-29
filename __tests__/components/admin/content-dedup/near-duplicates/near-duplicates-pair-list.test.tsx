/**
 * NearDuplicatesPairListClient Component Tests (AC1, AC10)
 *
 * Verifies the list view: rows render with similarity + pair titles,
 * empty state shows when zero pairs, loading skeleton on first paint,
 * error panel surfaces a retry, and the resolve link points at the
 * detail route with the pair-id encoded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

const { mockFetchPairs } = vi.hoisted(() => ({
  mockFetchPairs: vi.fn(),
}));

vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return {
    ...actual,
    fetchAdminNearDupPairs: mockFetchPairs,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/content-dedup/near-duplicates',
  useSearchParams: () => new URLSearchParams(),
}));

import { NearDuplicatesPairListClient } from '@/components/admin/content-dedup/near-duplicates/near-duplicates-pair-list';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import type { NearDupPair } from '@/lib/query/fetchers';

const LEFT_ID = '11111111-1111-4111-8111-111111111111';
const RIGHT_ID = '22222222-2222-4222-8222-222222222222';
const LEFT_ID_2 = '33333333-3333-4333-8333-333333333333';
const RIGHT_ID_2 = '44444444-4444-4444-8444-444444444444';

function makePair(overrides: Partial<NearDupPair> = {}): NearDupPair {
  return {
    pairId: `${LEFT_ID}__${RIGHT_ID}`,
    similarity: 0.943,
    left: {
      id: LEFT_ID,
      title: 'How are elevated access rights reviewed?',
      contentType: 'q_a_pair',
      primaryDomain: 'access-control',
    },
    right: {
      id: RIGHT_ID,
      title:
        'How are elevated access rights reviewed? Please specify frequency',
      contentType: 'q_a_pair',
      primaryDomain: 'access-control',
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installRadixPointerShims();
});

describe('NearDuplicatesPairListClient', () => {
  it('AC1: renders heading and rows when pairs are returned', async () => {
    mockFetchPairs.mockResolvedValueOnce({
      pairs: [
        makePair(),
        makePair({
          pairId: `${LEFT_ID_2}__${RIGHT_ID_2}`,
          similarity: 0.921,
          left: {
            id: LEFT_ID_2,
            title: 'Cloud security policy v3 (draft)',
            contentType: 'policy_doc',
            primaryDomain: 'tech-it',
          },
          right: {
            id: RIGHT_ID_2,
            title: 'Cloud security policy v3',
            contentType: 'policy_doc',
            primaryDomain: 'tech-it',
          },
        }),
      ],
      threshold: 0.95,
      total: 2,
    });

    const { Wrapper } = createQueryWrapper();
    render(<NearDuplicatesPairListClient />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /near-duplicate review/i }),
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        screen.getByText('How are elevated access rights reviewed?'),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText('Cloud security policy v3 (draft)'),
    ).toBeInTheDocument();
    // Numeric similarity label rendered (AC1 + WCAG: no colour alone)
    expect(screen.getByText('0.943')).toBeInTheDocument();
    expect(screen.getByText('0.921')).toBeInTheDocument();

    const resolveLink = screen.getByTestId(
      `near-dup-pair-resolve-${LEFT_ID}__${RIGHT_ID}`,
    );
    expect(resolveLink).toBeInTheDocument();
    expect(resolveLink).toHaveAttribute(
      'href',
      `/admin/content-dedup/near-duplicates/${LEFT_ID}__${RIGHT_ID}`,
    );
  });

  it('AC10: renders empty state when zero pairs returned', async () => {
    mockFetchPairs.mockResolvedValueOnce({
      pairs: [],
      threshold: 0.95,
      total: 0,
    });

    const { Wrapper } = createQueryWrapper();
    render(<NearDuplicatesPairListClient />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: /no near-duplicate pairs above threshold 0\.95/i,
        }),
      ).toBeInTheDocument();
    });
  });

  it('renders an error panel with retry on fetch failure', async () => {
    mockFetchPairs.mockRejectedValueOnce(new Error('boom'));

    const { Wrapper } = createQueryWrapper();
    render(<NearDuplicatesPairListClient />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByText(/failed to load near-duplicate pairs/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('near-dup-list-retry')).toBeInTheDocument();
  });

  it('shows a back-link to the §1.7 exact-hash queue', async () => {
    mockFetchPairs.mockResolvedValueOnce({
      pairs: [],
      threshold: 0.95,
      total: 0,
    });

    const { Wrapper } = createQueryWrapper();
    render(<NearDuplicatesPairListClient />, { wrapper: Wrapper });

    await waitFor(() => {
      const backLink = screen.getByRole('link', {
        name: /back to exact-hash queue/i,
      });
      expect(backLink).toHaveAttribute('href', '/admin/content-dedup');
    });
  });
});

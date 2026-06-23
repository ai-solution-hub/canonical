/**
 * QaDedupProposalListClient component tests (ID-120 {120.8}, TECH P-4).
 *
 * Acceptance (testStrategy): the queue renders rows with a subordinate
 * match-strength score (INV-23); a spanning proposal carries a non-colour-only
 * "spans workspaces/forms" badge (INV-11/18); explicit empty, loading, and
 * error states render (INV-19).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

const { mockFetchProposals } = vi.hoisted(() => ({
  mockFetchProposals: vi.fn(),
}));

vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return {
    ...actual,
    fetchAdminQaDedupProposals: mockFetchProposals,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/q-a-pairs/dedup-proposals',
  useSearchParams: () => new URLSearchParams(),
}));

import { QaDedupProposalListClient } from '@/components/admin/q-a-pairs/dedup-proposals/proposal-list';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import type { QaDedupProposalSummary } from '@/lib/query/fetchers';

const PROPOSAL_ID = '99999999-9999-4999-8999-999999999999';
const PAIR_A_ID = '11111111-1111-4111-8111-111111111111';
const PAIR_B_ID = '22222222-2222-4222-8222-222222222222';

function makeSummary(
  overrides: Partial<QaDedupProposalSummary> = {},
): QaDedupProposalSummary {
  return {
    id: PROPOSAL_ID,
    status: 'pending',
    similarityScore: 0.94,
    proposedSurvivorId: PAIR_A_ID,
    survivorReason: 'survivor: more recent (updated 15/06/2026)',
    resolvedSurvivorId: null,
    createdAt: '2026-06-20T08:00:00Z',
    pairAId: PAIR_A_ID,
    pairBId: PAIR_B_ID,
    spansWorkspaces: true,
    spansForms: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installRadixPointerShims();
});

function renderList() {
  const { Wrapper } = createQueryWrapper();
  return render(<QaDedupProposalListClient />, { wrapper: Wrapper });
}

describe('QaDedupProposalListClient', () => {
  it('renders the match-strength score as a subordinate affordance, not a headline (INV-23)', async () => {
    mockFetchProposals.mockResolvedValueOnce([makeSummary()]);
    renderList();

    await waitFor(() => {
      expect(
        screen.getByTestId(`qa-dedup-match-strength-${PROPOSAL_ID}`),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId(`qa-dedup-match-strength-${PROPOSAL_ID}`),
    ).toHaveTextContent('0.940');
    // The page heading is the corpus action, not the score.
    expect(
      screen.getByRole('heading', { name: /duplicate q&a proposals/i }),
    ).toBeInTheDocument();
  });

  it('badges a spanning proposal with a non-colour-only label (INV-11/18)', async () => {
    mockFetchProposals.mockResolvedValueOnce([
      makeSummary({ spansWorkspaces: true, spansForms: true }),
    ]);
    renderList();

    await waitFor(() => {
      expect(
        screen.getByTestId(`qa-dedup-spans-badge-${PROPOSAL_ID}`),
      ).toBeInTheDocument();
    });
    const badge = screen.getByTestId(`qa-dedup-spans-badge-${PROPOSAL_ID}`);
    expect(badge).toHaveTextContent(/spans workspaces\/forms/i);
    expect(badge).not.toHaveTextContent(/cross-tenant/i);
  });

  it('does not badge a same-workspace, same-form proposal', async () => {
    mockFetchProposals.mockResolvedValueOnce([
      makeSummary({ spansWorkspaces: false, spansForms: false }),
    ]);
    renderList();

    await waitFor(() => {
      expect(
        screen.getByTestId(`qa-dedup-proposal-row-${PROPOSAL_ID}`),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId(`qa-dedup-spans-badge-${PROPOSAL_ID}`),
    ).not.toBeInTheDocument();
  });

  it('renders an explicit empty state when there are no proposals (INV-19)', async () => {
    mockFetchProposals.mockResolvedValueOnce([]);
    renderList();

    await waitFor(() => {
      expect(
        screen.getByText(/no pending duplicate proposals/i),
      ).toBeInTheDocument();
    });
  });

  it('renders an explicit loading skeleton before data resolves', () => {
    mockFetchProposals.mockReturnValueOnce(new Promise(() => {}));
    const { container } = renderList();
    // Skeleton rows render while loading (no proposal rows yet).
    expect(
      screen.queryByTestId(`qa-dedup-proposal-row-${PROPOSAL_ID}`),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="skeleton"]'),
    ).toBeInTheDocument();
  });

  it('renders an explicit error panel with retry on fetch failure (INV-19)', async () => {
    mockFetchProposals.mockRejectedValueOnce(new Error('boom'));
    renderList();

    await waitFor(() => {
      expect(
        screen.getByText(/failed to load dedup proposals/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('qa-dedup-list-retry')).toBeInTheDocument();
  });
});

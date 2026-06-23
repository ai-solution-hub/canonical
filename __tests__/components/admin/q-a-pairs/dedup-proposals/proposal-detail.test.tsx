/**
 * QaDedupProposalDetailClient component tests (ID-120 {120.8}, TECH P-4).
 *
 * Acceptance (testStrategy): the detail view shows BOTH questions AND BOTH
 * answers side-by-side with each member's workspace/form + DD/MM/YYYY
 * last-updated + the nominated survivor and reason; a proposal spanning
 * workspaces/forms is badged with a non-colour-only label; the similarity is
 * a subordinate "match strength" affordance only; explicit loading + error
 * states render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

const { mockFetchProposal } = vi.hoisted(() => ({
  mockFetchProposal: vi.fn(),
}));

vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return {
    ...actual,
    fetchAdminQaDedupProposal: mockFetchProposal,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/q-a-pairs/dedup-proposals/[proposalId]',
  useSearchParams: () => new URLSearchParams(),
}));

import { QaDedupProposalDetailClient } from '@/components/admin/q-a-pairs/dedup-proposals/proposal-detail';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import type {
  QaDedupPairMember,
  QaDedupProposalDetail,
} from '@/lib/query/fetchers';

const PROPOSAL_ID = '99999999-9999-4999-8999-999999999999';
const PAIR_A_ID = '11111111-1111-4111-8111-111111111111';
const PAIR_B_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const WORKSPACE_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const FORM_A = 'cccccccc-1111-4111-8111-111111111111';
const FORM_B = 'dddddddd-2222-4222-8222-222222222222';

function makeMember(
  overrides: Partial<QaDedupPairMember> = {},
): QaDedupPairMember {
  return {
    id: PAIR_A_ID,
    questionText: 'What is your data retention policy?',
    answerText: 'We retain data for 7 years.',
    publicationStatus: 'published',
    sourceWorkspaceId: WORKSPACE_A,
    sourceFormResponseId: FORM_A,
    updatedAt: '2026-06-15T12:00:00Z',
    ...overrides,
  };
}

function makeProposal(
  overrides: Partial<QaDedupProposalDetail> = {},
): QaDedupProposalDetail {
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
    spansForms: true,
    pairA: makeMember({ id: PAIR_A_ID }),
    pairB: makeMember({
      id: PAIR_B_ID,
      questionText: 'How long do you keep customer data?',
      answerText: 'Customer data is kept for seven years.',
      sourceWorkspaceId: WORKSPACE_B,
      sourceFormResponseId: FORM_B,
      updatedAt: '2026-05-02T09:30:00Z',
    }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installRadixPointerShims();
});

function renderDetail() {
  const { Wrapper } = createQueryWrapper();
  return render(<QaDedupProposalDetailClient proposalId={PROPOSAL_ID} />, {
    wrapper: Wrapper,
  });
}

describe('QaDedupProposalDetailClient', () => {
  it('shows both questions and both answers side-by-side (INV-10)', async () => {
    mockFetchProposal.mockResolvedValueOnce(makeProposal());
    renderDetail();

    await waitFor(() => {
      expect(
        screen.getByText('What is your data retention policy?'),
      ).toBeInTheDocument();
    });
    // Both questions.
    expect(
      screen.getByText('How long do you keep customer data?'),
    ).toBeInTheDocument();
    // Both answers.
    expect(screen.getByText('We retain data for 7 years.')).toBeInTheDocument();
    expect(
      screen.getByText('Customer data is kept for seven years.'),
    ).toBeInTheDocument();
    // Two member cards rendered side-by-side.
    expect(screen.getByTestId('qa-dedup-member-card-a')).toBeInTheDocument();
    expect(screen.getByTestId('qa-dedup-member-card-b')).toBeInTheDocument();
  });

  it('shows each member workspace, form, and DD/MM/YYYY last-updated', async () => {
    mockFetchProposal.mockResolvedValueOnce(makeProposal());
    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId('qa-dedup-member-card-a')).toBeInTheDocument();
    });
    expect(screen.getByTestId('qa-dedup-member-workspace-a')).toHaveTextContent(
      WORKSPACE_A,
    );
    expect(screen.getByTestId('qa-dedup-member-form-a')).toHaveTextContent(
      FORM_A,
    );
    // UK date format DD/MM/YYYY (15 June 2026).
    expect(screen.getByTestId('qa-dedup-member-updated-a')).toHaveTextContent(
      '15/06/2026',
    );
    expect(screen.getByTestId('qa-dedup-member-updated-b')).toHaveTextContent(
      '02/05/2026',
    );
  });

  it('shows the nominated survivor and reason', async () => {
    mockFetchProposal.mockResolvedValueOnce(makeProposal());
    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId('qa-dedup-survivor-reason')).toHaveTextContent(
        'survivor: more recent (updated 15/06/2026)',
      );
    });
    // Pair A is the nominated survivor → its card carries the survivor badge.
    expect(
      screen.getByTestId('qa-dedup-member-survivor-a'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('qa-dedup-member-survivor-b'),
    ).not.toBeInTheDocument();
  });

  it('badges a proposal spanning workspaces/forms with a non-colour-only label (INV-11/18)', async () => {
    mockFetchProposal.mockResolvedValueOnce(makeProposal());
    renderDetail();

    await waitFor(() => {
      expect(
        screen.getByTestId('qa-dedup-detail-spans-badge'),
      ).toBeInTheDocument();
    });
    // The badge carries TEXT — information is not colour-only (WCAG 2.1 AA) —
    // and the text is "spans workspaces/forms", NOT "cross-tenant".
    const badge = screen.getByTestId('qa-dedup-detail-spans-badge');
    expect(badge).toHaveTextContent(/spans workspaces\/forms/i);
    expect(badge).not.toHaveTextContent(/cross-tenant/i);
  });

  it('does NOT badge a same-workspace, same-form proposal', async () => {
    mockFetchProposal.mockResolvedValueOnce(
      makeProposal({ spansWorkspaces: false, spansForms: false }),
    );
    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId('qa-dedup-member-card-a')).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('qa-dedup-detail-spans-badge'),
    ).not.toBeInTheDocument();
  });

  it('renders similarity only as a subordinate match-strength affordance (INV-23)', async () => {
    mockFetchProposal.mockResolvedValueOnce(makeProposal());
    renderDetail();

    await waitFor(() => {
      expect(
        screen.getByTestId('qa-dedup-detail-match-strength'),
      ).toBeInTheDocument();
    });
    const matchStrength = screen.getByTestId('qa-dedup-detail-match-strength');
    // Labelled "match strength", never "AI confidence" / "confidence".
    expect(matchStrength).toHaveTextContent(/match strength/i);
    expect(matchStrength).not.toHaveTextContent(/confiden/i);
    // It is NOT the page heading (subordinate, not a headline).
    const heading = screen.getByRole('heading', {
      name: /resolve duplicate proposal/i,
    });
    expect(heading).not.toHaveTextContent(/0\.94|confiden|match strength/i);
  });

  it('renders an explicit loading state before data resolves', () => {
    mockFetchProposal.mockReturnValueOnce(new Promise(() => {}));
    renderDetail();
    expect(screen.getByText(/loading dedup proposal/i)).toBeInTheDocument();
  });

  it('renders an explicit error panel with retry on fetch failure (INV-19)', async () => {
    mockFetchProposal.mockRejectedValueOnce(new Error('boom'));
    renderDetail();

    await waitFor(() => {
      expect(
        screen.getByText(/failed to load dedup proposal/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('qa-dedup-detail-retry')).toBeInTheDocument();
  });

  it('hides the action surface for an already-resolved proposal', async () => {
    mockFetchProposal.mockResolvedValueOnce(
      makeProposal({ status: 'approved', resolvedSurvivorId: PAIR_A_ID }),
    );
    renderDetail();

    await waitFor(() => {
      expect(
        screen.getByTestId('qa-dedup-already-resolved'),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('qa-dedup-approve-trigger'),
    ).not.toBeInTheDocument();
  });
});

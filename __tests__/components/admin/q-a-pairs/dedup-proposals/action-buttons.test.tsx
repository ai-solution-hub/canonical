/**
 * QaDedupActionButtons component tests (ID-120 {120.8}, TECH P-4).
 *
 * Acceptance (testStrategy): approve is NEVER pre-selected/pre-fired (INV-17) —
 * clicking "Approve…" opens the survivor-override dialog and does NOT call the
 * approve route; the approve mutation fires ONLY after the curator confirms a
 * survivor in the dialog. Reject calls the reject route directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

const { mockApprove, mockReject } = vi.hoisted(() => ({
  mockApprove: vi.fn(),
  mockReject: vi.fn(),
}));

vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return {
    ...actual,
    postAdminQaDedupApprove: mockApprove,
    postAdminQaDedupReject: mockReject,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/q-a-pairs/dedup-proposals/[proposalId]',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { QaDedupActionButtons } from '@/components/admin/q-a-pairs/dedup-proposals/action-buttons';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import type { QaDedupPairMember } from '@/lib/query/fetchers';

const PROPOSAL_ID = '99999999-9999-4999-8999-999999999999';
const PAIR_A_ID = '11111111-1111-4111-8111-111111111111';
const PAIR_B_ID = '22222222-2222-4222-8222-222222222222';

function makeMember(id: string): QaDedupPairMember {
  return {
    id,
    questionText: `question for ${id}`,
    answerText: `answer for ${id}`,
    publicationStatus: 'published',
    sourceWorkspaceId: null,
    sourceFormResponseId: null,
    updatedAt: '2026-06-15T12:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installRadixPointerShims();
});

function renderButtons() {
  const { Wrapper } = createQueryWrapper();
  return render(
    <QaDedupActionButtons
      proposalId={PROPOSAL_ID}
      pairA={makeMember(PAIR_A_ID)}
      pairB={makeMember(PAIR_B_ID)}
      proposedSurvivorId={PAIR_A_ID}
    />,
    { wrapper: Wrapper },
  );
}

describe('QaDedupActionButtons', () => {
  it('does not pre-fire approve — clicking Approve opens the dialog without calling the route (INV-17)', async () => {
    const user = userEvent.setup();
    renderButtons();

    // No approve confirm control is present before the dialog opens.
    expect(
      screen.queryByTestId('survivor-override-confirm'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId('qa-dedup-approve-trigger'));

    // Dialog appears; the route is NOT called yet.
    await waitFor(() => {
      expect(
        screen.getByTestId('survivor-override-confirm'),
      ).toBeInTheDocument();
    });
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it('fires approve only after confirming a survivor in the dialog', async () => {
    const user = userEvent.setup();
    mockApprove.mockResolvedValueOnce({ proposal: {}, survivor_id: PAIR_A_ID });
    renderButtons();

    await user.click(screen.getByTestId('qa-dedup-approve-trigger'));
    await waitFor(() => {
      expect(
        screen.getByTestId('survivor-override-confirm'),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('survivor-override-confirm'));

    await waitFor(() => {
      expect(mockApprove).toHaveBeenCalledWith(PROPOSAL_ID, {
        survivorId: PAIR_A_ID,
      });
    });
  });

  it('approves with the curator override survivor when one is chosen', async () => {
    const user = userEvent.setup();
    mockApprove.mockResolvedValueOnce({ proposal: {}, survivor_id: PAIR_B_ID });
    renderButtons();

    await user.click(screen.getByTestId('qa-dedup-approve-trigger'));
    await waitFor(() => {
      expect(
        screen.getByTestId(`survivor-option-${PAIR_B_ID}`),
      ).toBeInTheDocument();
    });
    // Override: pick Pair B instead of the proposer's nomination (Pair A).
    await user.click(screen.getByTestId(`survivor-option-${PAIR_B_ID}`));
    await user.click(screen.getByTestId('survivor-override-confirm'));

    await waitFor(() => {
      expect(mockApprove).toHaveBeenCalledWith(PROPOSAL_ID, {
        survivorId: PAIR_B_ID,
      });
    });
  });

  it('rejects directly without opening the survivor dialog', async () => {
    const user = userEvent.setup();
    mockReject.mockResolvedValueOnce({ proposal: {} });
    renderButtons();

    await user.click(screen.getByTestId('qa-dedup-reject'));

    await waitFor(() => {
      expect(mockReject).toHaveBeenCalledWith(PROPOSAL_ID);
    });
    expect(mockApprove).not.toHaveBeenCalled();
  });
});

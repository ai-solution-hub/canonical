/**
 * PromotionGateView composition tests (ID-145 {145.22} — TECH §5/§7 section
 * I, BI-38/39).
 *
 * Acceptance (testStrategy): the Governance-zone surface composes BOTH
 * existing/added building blocks — the promotion-candidates panel (driven by
 * the existing RPC + promote-corpus route) AND the existing dedup-proposals
 * queue (`QaDedupProposalListClient`, ID-120 {120.8}) — reused unmodified, no
 * new backend, no duplicated dedup logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

vi.mock(
  '@/components/governance/promotion-gate/promotion-candidates-panel',
  () => ({
    PromotionCandidatesPanel: () => (
      <div data-testid="stub-promotion-candidates-panel" />
    ),
  }),
);

vi.mock('@/components/admin/q-a-pairs/dedup-proposals/proposal-list', () => ({
  QaDedupProposalListClient: () => <div data-testid="stub-dedup-list" />,
}));

import { PromotionGateView } from '@/components/governance/promotion-gate/promotion-gate-view';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PromotionGateView', () => {
  it('composes the promotion-candidates panel and the existing dedup queue — no new backend', () => {
    render(<PromotionGateView />);
    expect(
      screen.getByTestId('stub-promotion-candidates-panel'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('stub-dedup-list')).toBeInTheDocument();
  });

  it('renders a heading and states the /review lane is separate and unchanged (BI-38)', () => {
    render(<PromotionGateView />);
    expect(
      screen.getByRole('heading', { name: /promotion gate/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/\/review/)).toBeInTheDocument();
  });
});

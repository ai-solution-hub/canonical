/**
 * QuickStatsStrip Component Tests
 *
 * ID-145 {145.20} BI-33 — the "active procurement count" tile must agree
 * with the dashboard heading/aria-label vocabulary ("procurement(s)"),
 * never "bid".
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { QuickStatsStrip } from '@/components/dashboard/quick-stats-strip';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const EMPTY_FRESHNESS = { fresh: 0, aging: 0, stale: 0, expired: 0 };

describe('QuickStatsStrip', () => {
  it('labels a single active procurement in the singular, procurement vocabulary (BI-33)', () => {
    render(
      <QuickStatsStrip
        freshness={EMPTY_FRESHNESS}
        activeProcurementCount={1}
        unreadNotificationCount={0}
      />,
    );

    expect(screen.getByText('Active procurement')).toBeInTheDocument();
    expect(screen.queryByText(/^Active bid$/i)).not.toBeInTheDocument();
  });

  it('labels multiple active procurements in the plural (BI-33)', () => {
    render(
      <QuickStatsStrip
        freshness={EMPTY_FRESHNESS}
        activeProcurementCount={4}
        unreadNotificationCount={0}
      />,
    );

    expect(screen.getByText('Active procurements')).toBeInTheDocument();
  });

  it('never reads "bid" anywhere on the tile (BI-33 acceptance)', () => {
    const { container } = render(
      <QuickStatsStrip
        freshness={EMPTY_FRESHNESS}
        activeProcurementCount={1}
        unreadNotificationCount={0}
      />,
    );

    expect(container.textContent?.toLowerCase()).not.toContain('bid');
  });
});

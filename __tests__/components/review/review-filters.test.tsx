/**
 * ReviewFilters — component tests.
 *
 * Tests the assigned_to_me toggle render, state changes, and integration
 * with the active filter count badge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewFilters } from '@/components/review/review-filters';
import type {
  ReviewFilters as ReviewFiltersType,
  ReviewStatsResponse,
} from '@/types/review';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseStats: ReviewStatsResponse = {
  total: 100,
  verified: 30,
  flagged: 5,
  unverified: 60,
  draft: 5,
  overdue: 0,
  by_domain: {
    Technical: { total: 50, verified: 20 },
    Commercial: { total: 50, verified: 10 },
  },
  by_content_type: {
    article: { total: 60, verified: 20 },
    guidance: { total: 40, verified: 10 },
  },
  by_source_file: {},
  by_source_document: {},
};

function renderFilters(
  filters: ReviewFiltersType = { status: 'unverified' },
  onFiltersChange = vi.fn(),
  stats: ReviewStatsResponse | null = baseStats,
) {
  const user = userEvent.setup();
  const result = render(
    <ReviewFilters
      filters={filters}
      onFiltersChange={onFiltersChange}
      stats={stats}
    />,
  );
  return { user, onFiltersChange, ...result };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assigned_to_me toggle', () => {
    it('renders the "Assigned to me" toggle in the filter popover', async () => {
      const { user } = renderFilters();

      // Open the popover
      const filterButton = screen.getByRole('button', { name: /filters/i });
      await user.click(filterButton);

      // The toggle should be visible
      const toggle = screen.getByRole('switch', { name: /assigned to me/i });
      expect(toggle).toBeInTheDocument();
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    it('shows toggle as checked when assigned_to_me filter is active', async () => {
      const { user } = renderFilters({
        status: 'unverified',
        assigned_to_me: true,
      });

      const filterButton = screen.getByRole('button', { name: /filters/i });
      await user.click(filterButton);

      const toggle = screen.getByRole('switch', { name: /assigned to me/i });
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('calls onFiltersChange with assigned_to_me=true when toggling on', async () => {
      const onFiltersChange = vi.fn();
      const { user } = renderFilters({ status: 'unverified' }, onFiltersChange);

      const filterButton = screen.getByRole('button', { name: /filters/i });
      await user.click(filterButton);

      const toggle = screen.getByRole('switch', { name: /assigned to me/i });
      await user.click(toggle);

      expect(onFiltersChange).toHaveBeenCalledWith(
        expect.objectContaining({ assigned_to_me: true }),
      );
    });

    it('calls onFiltersChange with assigned_to_me=undefined when toggling off', async () => {
      const onFiltersChange = vi.fn();
      const { user } = renderFilters(
        { status: 'unverified', assigned_to_me: true },
        onFiltersChange,
      );

      const filterButton = screen.getByRole('button', { name: /filters/i });
      await user.click(filterButton);

      const toggle = screen.getByRole('switch', { name: /assigned to me/i });
      await user.click(toggle);

      expect(onFiltersChange).toHaveBeenCalledWith(
        expect.objectContaining({ assigned_to_me: undefined }),
      );
    });

    it('increments the active filter count badge when assigned_to_me is on', async () => {
      // With assigned_to_me active + default status = 1 active filter
      renderFilters({ status: 'unverified', assigned_to_me: true });

      const filterButton = screen.getByRole('button', { name: /filters/i });
      // The badge should show "1"
      const badge = within(filterButton).getByText('1');
      expect(badge).toBeInTheDocument();
    });

    it('does not show badge when only default filters are active', () => {
      renderFilters({ status: 'unverified' });

      const filterButton = screen.getByRole('button', { name: /filters/i });
      // No badge should be present
      const badge = within(filterButton).queryByText(/^\d+$/);
      expect(badge).not.toBeInTheDocument();
    });

    it('composes assigned_to_me with other active filters in badge count', async () => {
      // status=flagged (1) + domain (1) + assigned_to_me (1) = 3
      renderFilters({
        status: 'flagged',
        domain: ['Technical'],
        assigned_to_me: true,
      });

      const filterButton = screen.getByRole('button', { name: /filters/i });
      const badge = within(filterButton).getByText('3');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('clear all filters', () => {
    it('clears assigned_to_me when "Clear all filters" is clicked', async () => {
      const onFiltersChange = vi.fn();
      const { user } = renderFilters(
        { status: 'flagged', assigned_to_me: true },
        onFiltersChange,
      );

      const filterButton = screen.getByRole('button', { name: /filters/i });
      await user.click(filterButton);

      const clearButton = screen.getByRole('button', {
        name: /clear all filters/i,
      });
      await user.click(clearButton);

      // Should reset to default (status: unverified, no assigned_to_me)
      expect(onFiltersChange).toHaveBeenCalledWith({ status: 'unverified' });
    });
  });

  // -------------------------------------------------------------------------
  // S205 WP-E T2 — "Overdue reviews" toggle
  // Plan: docs/plans/p0-document-control-phase-3-ui-plan.md §T2 (T2-AC1/4/5/7)
  // -------------------------------------------------------------------------

  describe('include_overdue toggle (S205 WP-E T2)', () => {
    it('renders the "Overdue reviews" toggle with aria-checked=false by default', async () => {
      // T2-AC1 + T2-AC5: toggle exists, has clear text label, and exposes
      // aria-checked="false" so screen readers communicate the off state.
      const { user } = renderFilters();

      const filterButton = screen.getByRole('button', { name: /filters/i });
      await user.click(filterButton);

      const toggle = screen.getByRole('switch', { name: /overdue reviews/i });
      expect(toggle).toBeInTheDocument();
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    it('calls onFiltersChange with include_overdue=true on click-on', async () => {
      // T2-AC4 (filter-driven query rekeying): clicking the toggle dispatches
      // the new filter state; the parent's TanStack Query key includes
      // include_overdue via queueFiltersKey, so a refetch is automatic.
      const onFiltersChange = vi.fn();
      const { user } = renderFilters({ status: 'unverified' }, onFiltersChange);

      const filterButton = screen.getByRole('button', { name: /filters/i });
      await user.click(filterButton);

      const toggle = screen.getByRole('switch', { name: /overdue reviews/i });
      await user.click(toggle);

      expect(onFiltersChange).toHaveBeenCalledWith(
        expect.objectContaining({ include_overdue: true }),
      );
    });

    it('renders the count pill from stats.overdue when > 0', async () => {
      // T2-AC4: count badge wired end-to-end from the T0 RPC overdue field.
      const { user } = renderFilters({ status: 'unverified' }, vi.fn(), {
        ...baseStats,
        overdue: 7,
      });

      const filterButton = screen.getByRole('button', { name: /filters/i });
      await user.click(filterButton);

      const toggle = screen.getByRole('switch', { name: /overdue reviews/i });
      // The count pill appears INSIDE the toggle alongside the label,
      // not on the popover trigger (which shows the active-filter count).
      expect(within(toggle).getByText('7')).toBeInTheDocument();
    });

    it('hides the count pill when stats.overdue is 0', async () => {
      // Pill visibility is gated on overdueCount > 0 — when zero, the user
      // is not nudged with a meaningless badge. (Matches the assigned_to_me
      // pattern of suppressing chrome that does not carry a signal.)
      const { user } = renderFilters({ status: 'unverified' }, vi.fn(), {
        ...baseStats,
        overdue: 0,
      });

      const filterButton = screen.getByRole('button', { name: /filters/i });
      await user.click(filterButton);

      const toggle = screen.getByRole('switch', { name: /overdue reviews/i });
      // No numeric badge inside the toggle.
      expect(within(toggle).queryByText(/^\d+$/)).not.toBeInTheDocument();
    });

    it('shows toggle as checked when include_overdue is true', async () => {
      // T2-AC5: aria-checked tracks state.
      const { user } = renderFilters({
        status: 'unverified',
        include_overdue: true,
      });

      const filterButton = screen.getByRole('button', { name: /filters/i });
      await user.click(filterButton);

      const toggle = screen.getByRole('switch', { name: /overdue reviews/i });
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('contributes to the active filter count badge when on', async () => {
      // include_overdue is treated as an active filter, so the popover
      // trigger badge counts it (parity with assigned_to_me).
      renderFilters({ status: 'unverified', include_overdue: true });

      const filterButton = screen.getByRole('button', { name: /filters/i });
      // Active-filter count badge on the trigger button itself shows "1".
      const badge = within(filterButton).getByText('1');
      expect(badge).toBeInTheDocument();
    });
  });
});

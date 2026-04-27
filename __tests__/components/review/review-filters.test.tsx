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
      const { user } = renderFilters({ status: 'unverified', assigned_to_me: true });

      const filterButton = screen.getByRole('button', { name: /filters/i });
      await user.click(filterButton);

      const toggle = screen.getByRole('switch', { name: /assigned to me/i });
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('calls onFiltersChange with assigned_to_me=true when toggling on', async () => {
      const onFiltersChange = vi.fn();
      const { user } = renderFilters(
        { status: 'unverified' },
        onFiltersChange,
      );

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
});
